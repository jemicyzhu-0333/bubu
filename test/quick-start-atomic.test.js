'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const execution = require('../src/capabilities/execution');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { projectQuickStartAction } = require('../src/application/queries/quick-start-action');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { NOW, memoryRepository, createQuickStartFixture } = require('../test-support/quick-start-fixture');

function sqlite(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-start-atomic-'));
  let failCommit = false;
  const options = { userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => NOW,
    authorityFactory: options => openSqliteConfigAuthority(options, {
      selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
      makeHandle: ({ db, filePath }) => ({
        exec(sql) {
          if (failCommit && filePath === path.join(dir, 'config.sqlite') && sql === 'COMMIT') {
            failCommit = false; throw new Error('Synthetic pre-COMMIT failure');
          }
          return db.exec(sql);
        },
        run: (sql, args = []) => db.prepare(sql).run(...args), get: (sql, args = []) => db.prepare(sql).get(...args),
        all: (sql, args = []) => db.prepare(sql).all(...args), userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        setUserVersion: value => db.exec(`PRAGMA user_version=${value}`), close: () => db.close()
      })
    }) };
  let repository = createSqliteStateAdapter(options);
  t.after(() => { repository.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { repository, failNextCommit: () => { failCommit = true; },
    reopen: () => { repository.close(); repository = createSqliteStateAdapter(options); return repository; } };
}

for (const scenario of ['success', 'commit-failure', 'effect-failure']) test(`actual SQLite title-only clarification/start: ${scenario}`, t => {
  const sql = sqlite(t), f = createQuickStartFixture({ repository: sql.repository, effectFailure: scenario === 'effect-failure' });
  const task = f.create.execute({ task: { title: 'Synthetic title', steps: [],
    recurrence: { frequency: 'daily', interval: 1, strategy: 'fixed', anchorDate: null } } }).task;
  const before = f.repository.snapshot(), revision = f.repository.revision();
  const input = { taskId: task.id, quick: true, nextAction: 'Open notes', taskVersion: entityFingerprint(task) };
  if (scenario === 'commit-failure') {
    sql.failNextCommit(); assert.throws(() => f.start.execute(input), /commit|COMMIT|write/i);
    assert.deepEqual(f.repository.snapshot(), before); assert.equal(f.repository.revision(), revision);
    assert.deepEqual(f.events, []); assert.deepEqual(sql.reopen().snapshot(), before); return;
  }
  const result = f.start.execute(input);
  assert.equal(result.ok, true); assert.equal(result.session.kind, 'quick-start');
  assert.equal(result.session.plannedDurationMs, 120000); assert.equal(result.session.startedAt, NOW + 250);
  assert.equal(f.repository.revision(), revision + 1);
  const after = f.repository.snapshot();
  assert.equal(after.tasks[0].nextAction, 'Open notes'); assert.equal(after.tasks[0].steps[0].title, 'Open notes');
  assert.equal(after.stats.dailyLaunches['2026-10-07'], 1);
  assert.deepEqual(after.recurrenceSeries, before.recurrenceSeries);
  assert.equal(f.events.filter(([kind]) => kind === 'publish').length, 1);
  assert.deepEqual(f.events.find(([kind]) => kind === 'publish')[1], {
    pomodoro: true, stats: true, nowTask: true, quickStartDecision: true, tasks: true, recommendations: true
  });
  assert.equal(f.start.execute(input).ok, false); assert.equal(f.repository.revision(), revision + 1);
  assert.equal(f.failures.length, scenario === 'effect-failure' ? 4 : 0);
  assert.deepEqual(sql.reopen().snapshot(), after);
});

const blocks = [
  ['task-completed', state => { state.tasks[0].done = true; state.tasks[0].completedAt = NOW; }],
  ['occurrence-skipped', state => { state.tasks[0].skippedAt = NOW; }],
  ['task-expired', state => { state.tasks[0].expiresAt = new Date(NOW).toISOString(); }],
  ['task-scheduled', state => { state.tasks[0].scheduledFor = new Date(NOW + 1).toISOString(); }],
  ['task-not-found', state => { state.tasks = []; }],
  ['quick-start-decision-pending', state => { state.quickStartDecision = { sessionId: 'prior', taskId: 'task', completedAt: NOW - 1, elapsedMs: 120000, status: 'pending' }; }],
  ['focus-landing-pending', state => { state.focusLandingPrompt = { sessionId: 'prior', taskId: 'task', completedAt: NOW - 1, status: 'pending' }; }],
  ['session-active', state => { state.focusSession = execution.focusSession.startFocus(state.focusSession, { now: NOW, taskId: 'task', minutes: 25, sessionId: 'active' }).session; }],
  ['awaiting-confirmation', state => {
    const active = execution.focusSession.startFocus(state.focusSession, { now: NOW - 600000, taskId: 'task', minutes: 5, sessionId: 'held' }).session;
    state.focusSession = execution.focusSession.pauseForOfflineConfirmation(active, NOW).session;
  }]
];
for (const [reason, alter] of blocks) test(`quick-start rechecks ${reason} before persisting any clarification`, () => {
  const initial = normalizePersistedState({ tasks: [{ id: 'task', title: 'Synthetic', createdAt: NOW, nextAction: null, steps: [] }] }, { now: NOW });
  const taskVersion = entityFingerprint(initial.tasks[0]); alter(initial);
  const f = createQuickStartFixture({ repository: memoryRepository(initial) });
  const action = projectQuickStartAction({ taskId: 'task', tasks: initial.tasks, startState: initial, now: NOW });
  assert.equal(action.enabled, false); assert.equal(action.reason, reason);
  const result = f.start.execute({ taskId: 'task', quick: true, nextAction: 'Open notes', taskVersion });
  assert.equal(result.reason, reason); assert.equal(f.repository.revision(), 0);
  assert.deepEqual(f.repository.snapshot(), initial); assert.deepEqual(f.events, []);
});

test('due preflight preserves the original settlement envelope and never partially clarifies', () => {
  const initial = normalizePersistedState({ tasks: [{ id: 'task', title: 'Synthetic', createdAt: NOW, nextAction: null }] }, { now: NOW });
  initial.focusSession = execution.focusSession.startFocus(initial.focusSession, { now: NOW - 300000, taskId: 'task', minutes: 5, sessionId: 'due' }).session;
  const f = createQuickStartFixture({ repository: memoryRepository(initial) });
  const result = f.start.execute({ taskId: 'task', quick: true, nextAction: 'Open notes', taskVersion: entityFingerprint(initial.tasks[0]) });
  assert.equal(result.reason, 'previous-session-completed'); assert.equal(result.completion.sessionId, 'due');
  assert.equal(result.settledAt, NOW + 250); assert.equal(f.repository.revision(), 0);
  assert.deepEqual(f.repository.snapshot(), initial); assert.deepEqual(f.events, []);
});

test('query samples wall time once and fingerprints canonical full contents independently of key order', () => {
  const f = createQuickStartFixture(); const created = f.create.execute({ task: { title: 'Title only', steps: [] } });
  const samples = f.samples(), projected = f.query.execute();
  assert.equal(f.samples(), samples + 1);
  const action = projected.quickPanel.candidates[0].quickStartAction;
  assert.equal(action.taskVersion, entityFingerprint(created.task));
  assert.equal(entityFingerprint(Object.fromEntries(Object.entries(created.task).reverse())), action.taskVersion);
  assert.equal(action.intent, 'clarify-and-start'); assert.equal(action.enabled, true);
});
