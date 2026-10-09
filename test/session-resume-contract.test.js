'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { buildQuickPanelView } = require('../src/application/queries/quick-panel-view');
const AT = Date.parse('2026-10-07T23:59:00Z');

function fixture({ kind = 'focus', taskId = 'task-1', due = false, held = false, patch = {} } = {}) {
  let now = AT;
  let state = normalizePersistedState({ ...normalizePersistedState({}, { now }),
    recurrenceSeries: patch.seriesId ? [{ id: patch.seriesId, state: 'active', createdAt: AT,
      rule: { frequency: 'daily', interval: 1, weekdays: null, strategy: 'fixed', anchorDate: '2026-10-07' },
      template: { title: 'Synthetic series', stepTitles: [] }, openTaskId: null, lastOccurrenceDate: '2026-10-07' }] : [], tasks: [{ id: 'task-1', title: 'Synthetic task', createdAt: AT,
    steps: [{ id: 'step-1', title: 'First step', done: false }], ...patch }] }, { now });
  const start = kind === 'break' ? execution.focusSession.startBreak
    : kind === 'quick-start' ? execution.focusSession.startQuickStart : execution.focusSession.startFocus;
  const running = start(execution.focusSession.createIdleSession(now), {
    now, minutes: kind === 'quick-start' ? 2 : 5, quick: kind === 'quick-start', taskId, sessionId: 'session-1'
  }).session;
  now += due ? 6 * 60_000 : 30_000;
  state.focusSession = due ? execution.focusSession.pauseForOfflineConfirmation(running, now).session
    : execution.focusSession.pauseSession(running, now).session;
  if (held) state.focusSession = execution.focusSession.normalizeFocusSession({ ...state.focusSession, awaitingOfflineConfirmation: true }, { now });
  state.nowTaskId = state.tasks.some(task => task.id === taskId && !task.done && !task.skippedAt) ? taskId : null;
  let commits = 0;
  let failCommit = false;
  const events = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => commits,
    commit(candidate) { if (failCommit) throw new Error('synthetic COMMIT failure'); state = structuredClone(candidate); commits++; return structuredClone(state); } };
  const common = { unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => now }, sessionClock: { now: () => now },
    synchronize: () => events.push('sync'), publish: () => events.push('publish') };
  return { common, events, repository, resume: app.createResumeFocusSessionWorkflow(common),
    stop: app.createStopFocusSessionWorkflow(common), settle: app.createSettleFocusSessionWorkflow(common),
    read: () => structuredClone(state), commits: () => commits, now: () => now,
    replace: next => { state = structuredClone(next); }, fail: () => { failCommit = true; }, running };
}
function request(intent = 'resume', sessionId = 'session-1') { return { sessionId, intent }; }
function assertRefused(h, input, reason) {
  const before = h.read(), commits = h.commits(), effects = h.events.length;
  const result = h.resume.execute(input); assert.equal(result.ok, false); assert.equal(result.reason, reason);
  assert.deepEqual(h.read(), before); assert.equal(h.commits(), commits); assert.equal(h.events.length, effects);
}

test('actual complete-work-item pauses a 30 second session; it cannot be resumed on the completed task', () => {
  const h = fixture(); const state = h.read(); state.focusSession = h.running; h.replace(state);
  const completed = app.createCompleteWorkItemWorkflow({ ...h.common, idFactory: () => 'next' }).execute({ taskId: 'task-1', confirmUnfinishedSteps: true });
  assert.equal(completed.ok, true);
  assert.equal(h.read().focusSession.status, 'paused'); assert.equal(h.read().nowTaskId, null);
  assertRefused(h, request(), 'task-completed');
});
for (const kind of ['focus', 'quick-start']) {
  for (const [reason, patch] of [
    ['task-completed', { done: true, completedAt: AT }], ['occurrence-skipped', { seriesId: 'series-1', occurrenceDate: '2026-10-07', skippedAt: AT }],
    ['task-expired', { expiresAt: new Date(AT).toISOString(), expired: true }],
    ['task-scheduled', { scheduledFor: new Date(AT + 60 * 60_000).toISOString() }]
  ]) test(`${kind} refuses ${reason} without writes/effects`, () => assertRefused(fixture({ kind, patch }), request(), reason));
  test(`${kind} refuses a missing linked task`, () => assertRefused(fixture({ kind, taskId: 'missing' }), request(), 'task-not-found'));
}
test('resume requires the rendered identity and exact intent, including replacement sessions', () => {
  const h = fixture();
  assertRefused(h, {}, 'session-changed');
  assertRefused(h, request('resume', 'old'), 'session-changed');
  assertRefused(h, request('confirm-completion'), 'resume-intent-mismatch');
  assertRefused(h, request('unexpected'), 'resume-intent-mismatch');
  const state = h.read(); state.focusSession.sessionId = 'replacement'; h.replace(state);
  assertRefused(h, request(), 'session-changed');
});
test('a held snapshot with remaining time remains held and cannot resume or confirm', () => {
  const h = fixture({ held: true });
  assertRefused(h, request(), 'resume-intent-mismatch');
  assertRefused(h, request('confirm-completion'), 'recovery-state-inconsistent');
});
test('due recovery cannot be settled by an ordinary continue', () => assertRefused(fixture({ due: true }), request(), 'resume-intent-mismatch'));
test('free focus and linked break ignore task availability; only focus counts a return', () => {
  for (const options of [{ taskId: null }, { kind: 'break', patch: { done: true, completedAt: AT } }]) {
    const h = fixture(options); const before = h.read().rewardLedger;
    assert.equal(h.resume.execute(request()).ok, true);
    assert.equal(h.commits(), 1);
    if (options.kind === 'break') assert.deepEqual(h.read().rewardLedger, before);
    else assert.equal(Object.values(h.read().stats.dailyReturns).reduce((a,b) => a+b, 0), 1);
    assertRefused(h, request(), 'not-paused');
  }
});
test('quick panel preserves held action, reason and kind; a linked break has no actionable task or steps', () => {
  for (const kind of ['focus', 'quick-start', 'break']) {
    const h = fixture({ kind, due: true });
    const action = Object.freeze({ sessionId: 'session-1', intent: 'confirm-completion', enabled: true, reason: null });
    const pomodoro = { ...execution.sessionProjection.projectSession(h.read().focusSession, h.now()), resumeAction: action };
    const view = buildQuickPanelView({ tasks: h.read().tasks, pomodoro });
    assert.equal(view.session.kind, kind); assert.deepEqual(view.session.resumeAction, action);
    assert.equal(view.session.awaitingOfflineConfirmation, true);
    assert.equal(view.session.recoveryReason, pomodoro.recoveryReason);
    if (kind === 'break') { assert.equal(view.task, null); assert.deepEqual(view.steps, []); }
  }
});

const { createSessionResumeAdapter } = require('../src/bootstrap/session-resume');
const { projectSessionResumeAction } = require('../src/application/queries/session-resume-action');
function bridge(h, overrides = {}) {
  return createSessionResumeAdapter({ workflow: h.resume,
    settle(nextSession, completion, settledAt) {
      const result = h.settle.execute({ nextSession, completion, settledAt });
      if (!result.ok) throw new Error(result.reason);
    },
    present: () => h.events.push('presentation'), publish: () => h.events.push('bridge-publish'),
    project: () => execution.sessionProjection.projectSession(h.read().focusSession, h.now()), ...overrides });
}

for (const kind of ['focus', 'quick-start', 'break']) {
  for (const target of ['current', 'done', 'missing']) test(`${kind} confirms ${target} historical investment exactly once`, () => {
    const h = fixture({ kind, due: true, taskId: target === 'missing' ? 'missing' : 'task-1',
      patch: target === 'done' ? { done: true, completedAt: AT } : {} });
    const before = h.read();
    const envelope = h.resume.execute(request('confirm-completion'));
    assert.equal(envelope.reason, 'session-completed'); assert.equal(h.commits(), 0); assert.deepEqual(h.events, []);
    const run = bridge(h); assert.equal(run(request('confirm-completion')).ok, true);
    const after = h.read();
    assert.equal(after.xp - before.xp, 0);
    assert.equal(after.stats.totalFocusMs, kind === 'break' ? 0 : kind === 'focus' ? 300000 : 120000);
    assert.equal(after.stats.totalPomodoros, kind === 'focus' ? 1 : 0);
    assert.equal(Boolean(after.quickStartDecision), kind === 'quick-start');
    assert.equal(Boolean(after.focusLandingPrompt), kind === 'focus');
    assert.equal(after.tasks[0].done, before.tasks[0].done);
    assert.equal(after.tasks[0].title, before.tasks[0].title);
    assert.deepEqual(after.tasks[0].steps, before.tasks[0].steps);
    const effects = h.events.length;
    assert.equal(run(request('confirm-completion')).reason, 'not-paused');
    assert.equal(h.commits(), 1); assert.equal(h.events.length, effects); assert.deepEqual(h.read(), after);
  });
  test(`${kind} abandon is zero reward, retains measured time and is idempotent`, () => {
    const h = fixture({ kind, due: true });
    const result = h.stop.execute({ sessionId: 'session-1' });
    assert.equal(result.ok, true); assert.equal(result.completion.completed, false);
    const after = h.read(), effects = h.events.length;
    assert.equal(after.xp, 0); assert.equal(after.stats.totalPomodoros, 0);
    assert.equal(after.stats.totalFocusMs, kind === 'break' ? 0 : kind === 'focus' ? 300000 : 120000);
    assert.equal(after.quickStartDecision, null); assert.equal(after.focusLandingPrompt, null);
    assert.equal(h.stop.execute({ sessionId: 'session-1' }).reason, 'not-running');
    assert.equal(h.commits(), 1); assert.equal(h.events.length, effects); assert.deepEqual(h.read(), after);
  });
}
test('confirmation publishes once and projects a newly started linked break; old confirm/abandon cannot touch it', () => {
  const h = fixture({ due: true });
  const startBreak = app.createStartBreakSessionWorkflow({ ...h.common, idFactory: () => 'new-break' });
  const run = bridge(h, { present: completion => {
    assert.equal(startBreak.execute({ taskId: completion.taskId, minutes: 5 }).ok, true);
  } });
  const confirmed = run(request('confirm-completion'));
  assert.equal(confirmed.session.sessionId, 'new-break'); assert.equal(confirmed.session.kind, 'break');
  const before = h.read(), commits = h.commits(), effects = h.events.length;
  assert.equal(run(request('confirm-completion')).reason, 'not-paused');
  assert.equal(h.stop.execute({ sessionId: 'session-1' }).reason, 'session-changed');
  assert.deepEqual(h.read(), before); assert.equal(h.commits(), commits); assert.equal(h.events.length, effects);
});
test('ordinary resume and held settlement COMMIT failure leave all slices unchanged and emit nothing', () => {
  for (const due of [false, true]) {
    const h = fixture({ due }); const before = h.read(); h.fail();
    assert.throws(() => bridge(h)(request(due ? 'confirm-completion' : 'resume')), /COMMIT/);
    assert.deepEqual(h.read(), before); assert.equal(h.commits(), 0); assert.deepEqual(h.events, []);
  }
});
test('postcommit settlement presentation errors do not make successful confirmation retryable', () => {
  const h = fixture({ due: true }); const errors = [];
  const run = bridge(h, { present: () => { throw new Error('fake presentation'); },
    publish: () => { throw new Error('fake publication'); }, reportEffectError: error => errors.push(error.message) });
  assert.equal(run(request('confirm-completion')).ok, true);
  assert.deepEqual(errors, ['fake presentation', 'fake publication']);
  assert.equal(h.read().xp, 0); assert.equal(h.commits(), 1);
  assert.equal(run(request('confirm-completion')).reason, 'not-paused');
});
test('availability uses the captured wall clock, including the exact scheduled boundary and rollback', () => {
  const h = fixture({ patch: { scheduledFor: new Date(AT + 60_000).toISOString() } });
  const guarded = app.createResumeFocusSessionWorkflow({ ...h.common, sessionClock: { now: () => AT + 120_000 } });
  assert.equal(guarded.execute(request()).reason, 'task-scheduled'); assert.equal(h.commits(), 0);
  const state = h.read(); state.tasks[0].scheduledFor = new Date(h.now()).toISOString(); h.replace(state);
  assert.equal(guarded.execute(request()).ok, true);
});
test('shared action is frozen and side-effect free, and zero remaining requires confirmation even without the flag', () => {
  const h = fixture({ due: true }); const state = h.read(); state.focusSession.awaitingOfflineConfirmation = false;
  const before = structuredClone(state);
  const action = projectSessionResumeAction({ session: state.focusSession, tasks: state.tasks, now: h.now() });
  assert.deepEqual(action, { sessionId: 'session-1', intent: 'confirm-completion', enabled: true, reason: null });
  assert.equal(Object.isFrozen(action), true); assert.deepEqual(state, before);
  assert.equal(projectSessionResumeAction({ session: h.running, tasks: state.tasks, now: h.now() }), null);
});

test('ordinary linked quick-start returns once and duplicate abandon cannot stop a later linked break', () => {
  const ordinary = fixture({ kind: 'quick-start' });
  assert.equal(ordinary.resume.execute(request()).ok, true);
  assert.equal(Object.values(ordinary.read().stats.dailyReturns).reduce((a,b) => a+b, 0), 1);
  assertRefused(ordinary, request(), 'not-paused');
  const held = fixture({ due: true });
  assert.equal(held.stop.execute({ sessionId: 'session-1' }).ok, true);
  const rest = app.createStartBreakSessionWorkflow({ ...held.common, idFactory: () => 'later-break' });
  assert.equal(rest.execute({ taskId: 'task-1', minutes: 5 }).ok, true);
  const before = held.read(), commits = held.commits(), effects = held.events.length;
  assert.equal(held.stop.execute({ sessionId: 'session-1' }).reason, 'session-changed');
  assert.deepEqual(held.read(), before); assert.equal(held.commits(), commits); assert.equal(held.events.length, effects);
});

test('task completion at the deadline uses neutral held confirmation and preserves the current reward rule', () => {
  const h = fixture({ due: true }); const state = h.read(); state.focusSession = h.running; h.replace(state);
  assert.equal(app.createCompleteWorkItemWorkflow({ ...h.common, idFactory: () => 'next' })
    .execute({ taskId: 'task-1', confirmUnfinishedSteps: true }).ok, true);
  assert.equal(h.read().focusSession.awaitingOfflineConfirmation, true);
  const xp = h.read().xp;
  assertRefused(h, request(), 'resume-intent-mismatch');
  assert.equal(bridge(h)(request('confirm-completion')).ok, true);
  assert.equal(h.read().xp - xp, 0); assert.equal(h.read().tasks[0].done, true);
});
