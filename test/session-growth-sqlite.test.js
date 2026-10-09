'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const app = require('../src/application');
const execution = require('../src/capabilities/execution');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const { lifetimeXp } = require('../src/content/growth-policy.mjs');

function fixture(t, { taskId = 'task', recurring = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-session-'));
  let now = new Date(2026, 9, 7, 23, 58).getTime();
  let sequence = 0;
  let failCommit = false;
  let repository;
  function open() {
    return createSqliteStateAdapter({ userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION,
      normalize: normalizePersistedState, now: () => now,
      authorityFactory: options => openSqliteConfigAuthority(options, {
        selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
        makeHandle: ({ db, filePath }) => ({
          exec(sql) {
            if (failCommit && filePath === path.join(dir, 'config.sqlite') && sql === 'COMMIT') {
              failCommit = false;
              throw new Error('synthetic pre-COMMIT failure');
            }
            return db.exec(sql);
          },
          run: (sql, args = []) => db.prepare(sql).run(...args),
          get: (sql, args = []) => db.prepare(sql).get(...args),
          all: (sql, args = []) => db.prepare(sql).all(...args),
          userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
          setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
        })
      }) });
  }
  repository = open();
  t.after(() => { repository.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const task = { id: 'task', title: 'Synthetic task', createdAt: now - 1000, nextAction: 'First step',
    steps: [{ id: 'step', title: 'First step', done: false }] };
  const day = localDayKey(now);
  if (recurring) Object.assign(task, { seriesId: 'series', occurrenceDate: day, plannedFor: day });
  const state = normalizePersistedState({ ...repository.snapshot(), tasks: taskId ? [task] : [],
    recurrenceSeries: recurring ? [{ id: 'series', createdAt: now, state: 'active',
      rule: { frequency: 'daily', interval: 1, weekdays: null, strategy: 'fixed', anchorDate: day },
      template: { title: task.title, stepTitles: [], energy: 'medium', energyAuto: true },
      openTaskId: 'task', lastOccurrenceDate: day }] : []
  }, { now });
  repository.commit(state, { now });
  const events = [];
  const common = () => ({ unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => now, dayKey: localDayKey },
    sessionClock: { now: () => now }, idFactory: prefix => `${prefix}-${++sequence}`, renewExpiry: () => null,
    publish: fact => events.push(fact) });
  return {
    get repository() { return repository; },
    common, events, get now() { return now; }, tick: ms => { now += ms; },
    fail: () => { failCommit = true; },
    reopen() { const before = repository.snapshot(); repository.close(); repository = open(); assert.deepEqual(repository.snapshot(), before); },
    start(kind = 'focus') {
      const result = app.createStartFocusSessionWorkflow(common()).execute({ taskId, minutes: 5, kind });
      assert.equal(result.ok, true);
      return repository.snapshot().focusSession.sessionId;
    },
    due() { now += 5 * 60000; assert.equal(app.createCompleteDueSessionWorkflow(common()).execute().completed, true); },
    mutate(fn) { const next = repository.snapshot(); fn(next); repository.commit(next, { now }); },
    confirm(sessionId, progressMade = true) {
      return app.createResolveFocusLandingWorkflow(common()).execute({ sessionId, action: 'skip', progressMade });
    }
  };
}

for (const terminal of ['done', 'skipped', 'archived', 'missing', 'free']) {
  test(`EXEC001 real SQLite session → ${terminal} → reopen → explicit landing retains original identity`, t => {
    const f = fixture(t, { taskId: terminal === 'free' ? null : 'task', recurring: terminal === 'skipped' });
    const sessionId = f.start();
    f.due();
    assert.equal(f.repository.snapshot().xp, 0, 'timer completion is a zero-XP source fact');
    if (terminal === 'done') assert.equal(app.createCompleteWorkItemWorkflow(f.common()).execute({ taskId: 'task', confirmUnfinishedSteps: true }).ok, true);
    if (terminal === 'skipped') assert.equal(app.createSkipWorkOccurrenceWorkflow(f.common()).execute({ taskId: 'task' }).ok, true);
    if (terminal === 'archived') assert.equal(app.createArchiveWorkItemWorkflow(f.common()).execute({ taskId: 'task' }).ok, true);
    if (terminal === 'missing') f.mutate(state => { state.tasks = []; state.nowTaskId = null; });
    f.reopen();
    const before = f.repository.snapshot();
    assert.equal(before.focusLandingPrompt.sessionId, sessionId);
    assert.equal(before.focusLandingPrompt.taskId, terminal === 'free' ? null : 'task');
    const invalidNote = app.createResolveFocusLandingWorkflow(f.common()).execute({ sessionId, action: 'save', landingNote: 'Cannot edit', progressMade: true });
    assert.equal(invalidNote.ok, false);
    assert.deepEqual(f.repository.snapshot(), before, 'rejected note cannot consume confirmation or growth');
    assert.equal(f.confirm(sessionId).ok, true);
    const after = f.repository.snapshot();
    assert.equal(after.focusLandingPrompt, null);
    assert.equal(lifetimeXp(after.level, after.xp), 40);
    assert.equal(after.pet.foodTickets, 9);
    assert.equal(after.stats.totalPomodoros, 1);
    assert.deepEqual(Object.values(after.stats.dailyFocus).sort((a,b) => a-b), [120000, 180000]);
    const revision = f.repository.revision();
    assert.equal(f.confirm(sessionId).ok, false);
    assert.equal(f.repository.revision(), revision);
    f.reopen();
    const unit = f.repository.snapshot().rewardLedger.events.find(event => event.source === 'growth-unit');
    assert.equal(unit.metadata.taskId, terminal === 'free' ? null : 'task');
  });
}

test('GROW001 real step → task completion → session confirmation shares unit and atomic ticket/bond grant', t => {
  const f = fixture(t);
  const sessionId = f.start();
  assert.equal(app.createCompleteWorkStepWorkflow(f.common()).execute({ taskId: 'task', stepId: 'step' }).awarded, 30);
  f.tick(60000);
  assert.equal(app.createCompleteWorkItemWorkflow(f.common()).execute({ taskId: 'task' }).ok, true);
  const paused = f.repository.snapshot().focusSession;
  assert.equal(paused.taskId, 'task');
  assert.equal(paused.status, 'paused');
  f.reopen();
  assert.equal(app.createAcceptHealthyShutdownWorkflow(f.common()).execute({ dayKey: localDayKey(f.now) }).ok, true);
  assert.equal(f.repository.snapshot().focusLandingPrompt.sessionId, sessionId);
  assert.equal(f.confirm(sessionId).ok, true);
  const after = f.repository.snapshot();
  assert.equal(lifetimeXp(after.level, after.xp), 40);
  assert.equal(after.pet.foodTickets, 9);
  assert.equal(after.companion.relationships.dango.bondPoints, 3);
  assert.equal(after.stats.totalTasksDone, 1);
  f.reopen();
});

test('held completion retains linked identity through task completion and restart', t => {
  const f = fixture(t);
  const sessionId = f.start();
  f.tick(6 * 60000);
  assert.equal(app.createCompleteWorkItemWorkflow(f.common()).execute({ taskId: 'task', confirmUnfinishedSteps: true }).ok, true);
  f.reopen();
  const held = f.repository.snapshot().focusSession;
  assert.equal(held.awaitingOfflineConfirmation, true);
  assert.equal(held.taskId, 'task');
  const result = app.createResumeFocusSessionWorkflow(f.common()).execute({ sessionId, intent: 'confirm-completion' });
  assert.equal(result.reason, 'session-completed');
  assert.equal(app.createSettleFocusSessionWorkflow(f.common()).execute({ nextSession: result.nextSession,
    completion: result.completion, settledAt: result.settledAt }).ok, true);
  f.reopen();
  assert.equal(f.repository.snapshot().focusLandingPrompt.taskId, 'task');
  assert.equal(f.confirm(sessionId).ok, true);
  assert.equal(lifetimeXp(f.repository.snapshot().level, f.repository.snapshot().xp), 40);
});

test('failed COMMIT rolls back consumed prompt, reward, wallet and relationship; explicit retry commits once', t => {
  const f = fixture(t);
  const sessionId = f.start();
  f.due();
  const before = f.repository.snapshot();
  const revision = f.repository.revision();
  const events = f.events.length;
  f.fail();
  assert.throws(() => f.confirm(sessionId), /COMMIT|commit|write/i);
  assert.deepEqual(f.repository.snapshot(), before);
  assert.equal(f.repository.revision(), revision);
  assert.equal(f.events.length, events);
  f.reopen();
  assert.equal(f.confirm(sessionId).ok, true);
  assert.equal(f.repository.revision(), revision + 1);
  assert.equal(f.repository.snapshot().pet.foodTickets, 9);
});

test('late confirmation cannot consume a replacement prompt or reward it under the old identity', t => {
  const f = fixture(t);
  const oldId = f.start();
  f.due();
  assert.equal(f.confirm(oldId, false).ok, true);
  const nextId = f.start();
  f.due();
  const before = f.repository.snapshot();
  assert.equal(f.confirm(oldId).reason, 'no-matching-focus-landing');
  assert.deepEqual(f.repository.snapshot(), before);
  assert.equal(f.confirm(nextId).ok, true);
  assert.equal(f.repository.snapshot().pet.foodTickets, 9);
});

test('missing live target remains linked through normalization, restart and automatic settlement', t => {
  const f = fixture(t);
  const sessionId = f.start();
  f.mutate(state => { state.tasks = []; state.nowTaskId = null; });
  f.reopen();
  assert.equal(f.repository.snapshot().focusSession.taskId, 'task');
  f.due();
  f.reopen();
  assert.equal(f.repository.snapshot().focusLandingPrompt.taskId, 'task');
  assert.equal(f.confirm(sessionId).ok, true);
  const unit = f.repository.snapshot().rewardLedger.events.find(event => event.source === 'growth-unit');
  assert.equal(unit.metadata.taskId, 'task');
});

test('wallet overflow rejects a first advance atomically with no lost prompt, facts or XP', t => {
  const f = fixture(t);
  const sessionId = f.start();
  f.due();
  f.mutate(state => { state.pet.foodTickets = Number.MAX_SAFE_INTEGER; });
  const before = f.repository.snapshot();
  const revision = f.repository.revision();
  assert.throws(() => f.confirm(sessionId), /food-wallet-capacity/);
  assert.deepEqual(f.repository.snapshot(), before);
  assert.equal(f.repository.revision(), revision);
  f.reopen();
  // Close-only does not mint tickets and remains possible at wallet capacity.
  assert.equal(f.confirm(sessionId, false).ok, true);
  assert.equal(f.repository.snapshot().xp, 10);
  assert.equal(f.repository.snapshot().pet.foodTickets, Number.MAX_SAFE_INTEGER);
});
