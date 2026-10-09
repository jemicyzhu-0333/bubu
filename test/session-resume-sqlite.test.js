'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const app = require('../src/application');
const execution = require('../src/capabilities/execution');
const { createSessionResumeAdapter } = require('../src/bootstrap/session-resume');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');

for (const choice of ['confirm', 'abandon', 'commit-failure']) test(`actual SQLite recover → ${choice} preserves atomic accounting`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-resume-test-'));
  let now = new Date(2026, 9, 7, 23, 59).getTime(), failCommit = false;
  const repository = createSqliteStateAdapter({ userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => now,
    authorityFactory: options => openSqliteConfigAuthority(options, {
      selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
      makeHandle: ({ db, filePath }) => ({
        exec(sql) {
          if (failCommit && filePath === path.join(dir, 'config.sqlite') && sql === 'COMMIT') {
            failCommit = false; throw new Error('synthetic pre-COMMIT failure');
          }
          return db.exec(sql);
        },
        run: (sql, args = []) => db.prepare(sql).run(...args), get: (sql, args = []) => db.prepare(sql).get(...args),
        all: (sql, args = []) => db.prepare(sql).all(...args), userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        setUserVersion: value => db.exec(`PRAGMA user_version=${value}`), close: () => db.close()
      })
    }) });
  t.after(() => { repository.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const state = normalizePersistedState({ ...repository.snapshot(), tasks: [{ id: 'task', title: 'Synthetic task', createdAt: now, steps: [] }] }, { now });
  state.focusSession = execution.focusSession.startFocus(state.focusSession, { now, minutes: 5, sessionId: 'sql-session', taskId: 'task' }).session;
  repository.commit(state, { now }); now += 6 * 60000;
  const events = [];
  const common = { unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => now }, sessionClock: { now: () => now },
    synchronize: () => events.push('sync'), publish: () => events.push('publish') };
  const recovery = execution.recoverSession.createRecoverSessionCommand(common).execute();
  assert.equal(recovery.action, 'awaiting-confirmation'); assert.equal(recovery.session.remainingMs, 0);
  events.length = 0;
  const before = repository.snapshot(), revision = repository.revision();
  const resume = app.createResumeFocusSessionWorkflow(common);
  const settle = app.createSettleFocusSessionWorkflow(common);
  const run = createSessionResumeAdapter({ workflow: resume,
    settle: (nextSession, completion, settledAt) => {
      const result = settle.execute({ nextSession, completion, settledAt });
      if (!result.ok) throw new Error(result.reason);
    }, present: () => events.push('present'), publish: () => events.push('bridge-publish'),
    project: () => execution.sessionProjection.projectSession(repository.get('focusSession'), now) });
  assert.equal(run({ sessionId: 'sql-session', intent: 'resume' }).reason, 'resume-intent-mismatch');
  assert.equal(repository.revision(), revision); assert.deepEqual(events, []);
  if (choice === 'commit-failure') {
    failCommit = true;
    assert.throws(() => run({ sessionId: 'sql-session', intent: 'confirm-completion' }), /commit|COMMIT|write/i);
    assert.deepEqual(repository.snapshot(), before); assert.equal(repository.revision(), revision); assert.deepEqual(events, []);
    return;
  }
  const stop = app.createStopFocusSessionWorkflow(common);
  const result = choice === 'abandon' ? stop.execute({ sessionId: 'sql-session' })
    : run({ sessionId: 'sql-session', intent: 'confirm-completion' });
  assert.equal(result.ok, true); assert.equal(repository.revision(), revision + 1);
  const after = repository.snapshot();
  assert.equal(after.xp, 0);
  assert.equal(after.stats.totalFocusMs, 300000); assert.equal(after.tasks[0].focusedMs, 300000);
  assert.equal(after.stats.totalPomodoros, choice === 'confirm' ? 1 : 0);
  assert.equal(Boolean(after.focusLandingPrompt), choice === 'confirm');
  assert.deepEqual(Object.values(after.stats.dailyFocus).sort((a,b) => a-b), [60000, 240000]);
  assert.equal(after.rewardLedger.seenEventIds.length, before.rewardLedger.seenEventIds.length + 1);
  assert.equal(run({ sessionId: 'sql-session', intent: 'confirm-completion' }).reason, 'not-paused');
  assert.equal(stop.execute({ sessionId: 'sql-session' }).reason, 'not-running');
  assert.deepEqual(repository.snapshot(), after); assert.equal(repository.revision(), revision + 1);
});
