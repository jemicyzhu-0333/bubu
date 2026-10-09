'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectPetSessionDisplay } = require('../src/application/queries/pet-session-display');
const { harness, runningState, execution, NOW, app, taskState } = require('../test-support/surface-sync-fixture');
const base = { sessionId: 'session', kind: 'focus', mode: 'focus', running: true,
  paused: false, plannedDurationMs: 120000, elapsedMs: 58000 };
for (const [phase, changes] of [
  ['focus', {}], ['break', { kind: 'break', mode: 'break' }],
  ['paused', { running: false, paused: true }],
  ['task-completed', { running: false, paused: true, resumeAction: { enabled: false, intent: 'resume', reason: 'task-completed' } }],
  ['attention', { running: false, paused: true, kind: 'quick-start', resumeAction: { enabled: false, intent: 'resume', reason: 'task-not-found' } }],
  ['confirm', { running: false, paused: true, elapsedMs: 120000, resumeAction: { enabled: true, intent: 'confirm-completion', reason: null } }],
  ['attention', { running: false, paused: true, resumeAction: { enabled: false, intent: 'confirm-completion', reason: 'recovery-state-inconsistent' } }]
]) test(`pure canonical pet phase: ${phase} ${changes.kind || ''}`, () => {
  const input = { pomodoro: { ...base, ...changes } }, before = structuredClone(input);
  const display = projectPetSessionDisplay(input);
  assert.equal(display.phase, phase); assert.equal(display.kind, changes.kind || 'focus');
  assert.equal(display.running, ['focus', 'break'].includes(phase));
  assert.deepEqual(input, before); assert.ok(Object.isFrozen(display));
  assert.deepEqual(Object.keys(display).sort(), ['sessionId','kind','phase','reason','mode','plannedMs','elapsedMs','running'].sort());
});
test('idle is null; pending decisions have no invented timer and active sessions take precedence', () => {
  assert.equal(projectPetSessionDisplay(), null);
  for (const key of ['quickStartDecision', 'focusLandingPrompt']) {
    const pending = { [key]: { sessionId: 'done', status: 'pending', taskId: 'private-task', taskTitle: 'private' } };
    const result = projectPetSessionDisplay(pending);
    assert.equal(result.phase, 'complete'); assert.equal(result.plannedMs, 0); assert.equal(result.running, false);
    assert.equal(result.kind, key === 'quickStartDecision' ? 'quick-start' : 'focus');
    assert.equal(projectPetSessionDisplay({ ...pending, pomodoro: base }).phase, 'focus');
    assert.equal(projectPetSessionDisplay({ [key]: { ...pending[key], status: 'resolved' } }), null);
  }
});
test('real shared snapshot projects completed paused target without mutation', () => {
  const initial = runningState({ task: true });
  initial.focusSession = execution.focusSession.pauseSession(initial.focusSession, NOW).session;
  initial.tasks[0].done = true; initial.tasks[0].completedAt = NOW;
  const h = harness({ initial }), before = h.state();
  h.publish({ tasks: true });
  const live = h.message('pet'), hydration = h.petQueries.getState();
  assert.equal(live.sessionDisplay.phase, 'task-completed');
  assert.deepEqual(hydration.sessionDisplay, live.sessionDisplay);
  assert.equal(live.focusRing.running, false); assert.equal(h.commits(), 0); assert.deepEqual(h.state(), before);
});
for (const key of ['quickStartDecision', 'focusLandingPrompt']) test(`${key}-only publication refreshes pet completion state`, () => {
  const h = harness();
  h.publish({ [key]: true });
  assert.ok(h.message('pet')); assert.equal(h.message('pet').sessionDisplay, null);
  assert.equal(h.counts.snapshot, 1); assert.equal(h.counts.wall, 1); assert.equal(h.commits(), 0);
});

test('actual completion after pause publishes task-completed, preserving reward and session guards', () => {
  const h = harness({ initial: runningState({ task: true }) });
  const pause = execution.pauseSession.createPauseSessionCommand({ ...h.ports, publish: h.publishFact({ pomodoro: true }) });
  assert.equal(pause.execute().ok, true);
  assert.equal(h.message('pet').sessionDisplay.phase, 'paused');
  const command = app.createCompleteWorkItemWorkflow({ ...h.ports, publish: h.publishFact({ tasks: true, focusLandingPrompt: true }) });
  assert.equal(command.execute({ taskId: 'task-1' }).ok, true);
  assert.equal(h.message('pet').sessionDisplay.phase, 'task-completed');
  const commits = h.commits(), before = h.state();
  h.petQueries.getState(); h.publish({ focusLandingPrompt: true });
  assert.equal(h.commits(), commits); assert.deepEqual(h.state(), before);
});
for (const [reason, change] of [
  ['task-not-found', state => { state.tasks = []; }],
  ['task-completed', state => { state.tasks[0].done = true; }],
  ['task-scheduled', state => { state.tasks[0].scheduledFor = new Date(NOW + 3600000).toISOString(); }]
]) test(`real quick-start paused projection: ${reason}`, () => {
  const initial = runningState({ task: true, quick: true });
  initial.focusSession = execution.focusSession.pauseSession(initial.focusSession, NOW).session;
  change(initial);
  const h = harness({ initial }); h.publish({ tasks: true });
  const display = h.message('pet').sessionDisplay;
  assert.equal(display.kind, 'quick-start'); assert.equal(display.reason, reason);
  assert.equal(display.phase, reason === 'task-completed' ? 'task-completed' : 'attention');
  assert.equal(display.running, false); assert.equal(h.commits(), 0);
});
for (const key of ['quickStartDecision', 'focusLandingPrompt']) test(`${key} pending is canonical, private and clears through same publication`, () => {
  const initial = taskState();
  initial[key] = { sessionId: 'finished-session', taskId: 'task-1', completedAt: NOW - 1000, status: 'pending',
    ...(key === 'quickStartDecision' ? { elapsedMs: 120000 } : {}) };
  const h = harness({ initial }); h.publish({ [key]: true });
  assert.equal(h.message('pet').sessionDisplay.phase, 'complete');
  assert.equal(h.message('pet').sessionDisplay.sessionId, 'finished-session');
  assert.equal(h.message('pet').focusRing, null);
  assert.equal(JSON.stringify(h.message('pet')).includes('Synthetic task'), false);
  assert.equal(Object.hasOwn(h.message('pet').sessionDisplay, 'taskId'), false);
  const factory = key === 'quickStartDecision' ? app.createResolveQuickStartWorkflow : app.createResolveFocusLandingWorkflow;
  const resolve = factory({ ...h.ports, renewExpiry() {}, publish: () => h.publish({ [key]: true }) });
  const result = resolve.execute({ sessionId: 'finished-session', action: key === 'quickStartDecision' ? 'done' : 'skip', progressMade: false });
  assert.equal(result.ok, true); assert.equal(h.message('pet').sessionDisplay, null);
  assert.equal(h.message('pet').contextRevision, 2); assert.equal(h.commits(), 1);
});
test('active break takes phase priority without consuming unanswered focus landing', () => {
  const initial = taskState();
  initial.focusLandingPrompt = { sessionId: 'prior-focus', taskId: 'task-1', completedAt: NOW - 1000, status: 'pending' };
  initial.focusSession = execution.focusSession.startBreak(initial.focusSession, { now: NOW, minutes: 5, sessionId: 'break' }).session;
  const h = harness({ initial }); h.publish({ focusLandingPrompt: true });
  assert.equal(h.message('pet').sessionDisplay.phase, 'break');
  assert.equal(h.sample().focusLandingPrompt.sessionId, 'prior-focus');
  assert.equal(h.state().focusLandingPrompt.status, 'pending'); assert.equal(h.commits(), 0);
});
