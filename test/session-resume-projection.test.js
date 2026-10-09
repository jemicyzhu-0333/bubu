'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverStateQuery } = require('../src/application');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const stateChannel = require('../src/core/state-channel.mjs');
const { createPopoverProjectionStore } = require('../src/surfaces/popover/state/projection-store.mjs');
const { createPopoverTodayFeature } = require('../src/surfaces/popover/features/today.mjs');
const { SKINS } = require('../src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');
const NOW = new Date(2026, 9, 7, 12).getTime();

test('both real query surfaces share canonical action, held reason and kind across paused cases', () => {
  for (const kind of ['focus', 'quick-start', 'break']) for (const mode of ['ordinary', 'done', 'offline-due', 'task-due', 'inconsistent']) {
    const state = normalizePersistedState({ tasks: [{ id: 'task', title: 'Synthetic task', createdAt: NOW }] }, { now: NOW });
    const start = kind === 'break' ? execution.focusSession.startBreak : kind === 'quick-start'
      ? execution.focusSession.startQuickStart : execution.focusSession.startFocus;
    const running = start(state.focusSession, { now: NOW - 360000, sessionId: 'original', taskId: 'task', minutes: 5 }).session;
    state.focusSession = mode.endsWith('due') ? execution.focusSession.pauseForOfflineConfirmation(running, NOW).session
      : execution.focusSession.pauseSession(running, NOW - 330000).session;
    if (mode === 'task-due') state.focusSession.recoveryReason = 'task-completed-at-deadline';
    if (mode === 'done' || mode === 'task-due') state.tasks[0].done = true;
    if (mode === 'inconsistent') state.focusSession.awaitingOfflineConfirmation = true;
    let samples = 0;
    const query = createPopoverStateQuery({ readSnapshot: () => state, readRevision: () => 1,
      readSession: () => state.focusSession, clock: { now: () => { samples++; return NOW; }, dayKey: localDayKey },
      skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS, credentialStore: { status: () => ({ configured: false }) },
      aiDisclosure: () => ({}), pomodoroView: () => execution.sessionProjection.projectSession(state.focusSession, NOW), schemaVersion: 17 });
    const view = query.execute(); const action = view.pomodoro.resumeAction;
    assert.equal(samples, 1); assert.equal(view.quickPanel.session.resumeAction, action);
    assert.equal(view.quickPanel.session.kind, kind);
    assert.equal(action.intent, mode.endsWith('due') || mode === 'inconsistent' ? 'confirm-completion' : 'resume');
    assert.equal(action.reason, mode === 'inconsistent' ? 'recovery-state-inconsistent' : mode === 'done' && kind !== 'break' ? 'task-completed' : null);
    assert.equal(view.quickPanel.session.recoveryReason, view.pomodoro.recoveryReason);
    if (kind === 'break') { assert.equal(view.quickPanel.task, null); assert.deepEqual(view.quickPanel.steps, []); }
    if (mode === 'done') assert.equal(view.quickPanel.taskActionable, false);
  }
});

test('task-only delta refreshes a paused action through the existing Today subscription and preserves revision-gap handling', () => {
  const first = { revision: 1, tasks: [{ id: 'task', done: false }], pomodoro: { paused: true,
    resumeAction: { sessionId: 'session', intent: 'resume', enabled: true, reason: null } } };
  const second = { ...first, tasks: [{ id: 'task', done: true }], pomodoro: { ...first.pomodoro,
    resumeAction: { ...first.pomodoro.resumeAction, enabled: false, reason: 'task-completed' } }, focusSession: {}, quickPanel: {} };
  const delta = stateChannel.buildStateDelta(second, { tasks: true });
  assert.equal(delta.pomodoro, second.pomodoro);
  assert.equal(Object.hasOwn(delta, 'focusSession'), false); assert.equal(Object.hasOwn(delta, 'quickPanel'), false);
  const applied = stateChannel.applyStateDelta(first, { revision: 2, dirty: { tasks: true }, delta });
  assert.equal(applied.state.pomodoro.resumeAction.enabled, false);
  assert.equal(stateChannel.applyStateDelta(first, { revision: 3, dirty: { tasks: true }, delta }).reason, 'revision-gap');
  let render, calls = 0;
  const noop = () => {};
  const today = createPopoverTodayFeature({ renderers: { renderHeader: noop, renderPomoStructure: () => { calls++; },
    renderPomoTick: noop, renderNowCard: noop, renderNowTaskDetail: noop, renderLanding: noop } });
  today.mount({ subscribe: handler => { render = handler; return noop; } });
  render({ state: applied.state, dirty: { tasks: true } }); assert.equal(calls, 1); today.dispose();
  assert.equal(Object.hasOwn(stateChannel.buildStateDelta({ pomodoro: { paused: false } }, { tasks: true }), 'pomodoro'), false);
});

test('same-revision late reads cannot replace the projection refreshed for a new visit', async () => {
  const reads = []; const seen = [];
  const store = createPopoverProjectionStore({ stateChannel, client: {
    getState: () => new Promise(resolve => reads.push(resolve)), onStateDiff: () => () => {} } });
  store.subscribe(change => seen.push(change.state.pomodoro.resumeAction.sessionId));
  const first = store.start(), fresh = store.refresh();
  reads[1]({ revision: 1, pomodoro: { resumeAction: { sessionId: 'new' } } }); await fresh;
  reads[0]({ revision: 1, pomodoro: { resumeAction: { sessionId: 'old' } } }); await first;
  assert.deepEqual(seen, ['new']); assert.equal(store.getState().pomodoro.resumeAction.sessionId, 'new'); store.dispose();
});
