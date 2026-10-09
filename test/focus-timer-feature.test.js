'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverFocusTimer } = require('../src/surfaces/popover/features/focus-timer.mjs');
const sessionDuration = require('../src/capabilities/execution/contract/session-duration.mjs');

function harness(overrides = {}, options = {}) {
  const elements = new Map();
  function element() {
    const handlers = new Map();
    return {
      value: '', dataset: {}, style: {}, attributes: {}, children: [], textContent: '',
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); },
      addEventListener: (name, fn) => handlers.set(name, fn),
      removeEventListener: name => handlers.delete(name),
      fire(name) { return handlers.get(name)?.({ target: this }); }
    };
  }
  const $ = key => {
    if (!elements.has(key)) elements.set(key, element());
    return elements.get(key);
  };
  const state = { tasks: [], settings: { pomodoroMinutes: 25, breakMinutes: 5 },
    focusMinutes: { min: 5, max: 120, chosen: 25, presets: [15, 25, 45, 60, 90, 120] } };
  const session = { running: false, paused: false };
  const calls = [];
  const document = { ...element(), body: { dataset: {} }, createElement: element, defaultView: element() };
  const feature = createPopoverFocusTimer({
    document, $, $$: () => [], refreshProjection: options.refreshProjection,
    getState: () => state, getSession: () => session, pad2: n => String(n).padStart(2, '0'),
    setStatusLine() {}, sessionDuration, currentTask: () => null, focusActionMessage: () => 'failed',
    surfaceClient: {
      updateSettings: async patch => { calls.push(patch); return { ok: true }; },
      startPomodoro: async (taskId, minutes) => { calls.push({ taskId, minutes }); return { ok: true }; },
      ...overrides
    }
  });
  feature.mount(); feature.renderDurationPicker();
  return { $, state, session, calls, feature, document };
}

test('header remains a calendar clock while focus starts and pauses', t => {
  const h = harness(); t.after(() => h.feature.dispose());
  Object.assign(h.session, { running: true, kind: 'focus', mode: 'focus', plannedDurationMs: 120 * 60000 });
  h.feature.renderPomoStructure();
  assert.match(h.$('#headerMiniTime').textContent, /月.*日 周.*\d{2}:\d{2}/);
  assert.notEqual(h.$('#headerMiniTime').textContent, h.$('#pomoTime').textContent);
  Object.assign(h.session, { running: false, paused: true });
  h.feature.renderPomoStructure();
  assert.match(h.$('#headerMiniTime').attributes['aria-label'], /当前时间/);
});

test('dragging previews locally; launching waits for duration persistence even before the projection arrives', async t => {
  let resolve;
  const h = harness({ updateSettings: () => new Promise(done => { resolve = done; }) });
  t.after(() => h.feature.dispose());
  const slider = h.$('#durationSlider'); slider.value = '45'; slider.fire('input');
  assert.equal(h.$('#durationValue').textContent, '45 分钟');
  assert.equal(h.calls.length, 0);
  slider.fire('change'); await Promise.resolve();
  const launch = h.$('#btnStartFocus').fire('click');
  assert.equal(h.calls.length, 0, 'no session while the selection is uncommitted');
  resolve({ ok: true }); await launch;
  assert.deepEqual(h.calls, [{ taskId: null, minutes: 45 }]);
});

test('a failed duration write restores the persisted selection and prevents an accidental launch', async t => {
  const h = harness({ updateSettings: async () => { throw new Error('disk full'); } });
  t.after(() => h.feature.dispose());
  const slider = h.$('#durationSlider'); slider.value = '90'; slider.fire('input'); slider.fire('change');
  await h.$('#btnStartFocus').fire('click');
  assert.equal(h.$('#durationValue').textContent, '25 分钟');
  assert.match(h.$('#durationStatus').textContent, /未保存/);
  assert.deepEqual(h.calls, []);
});

test('paused ring and spoken progress use the same remaining time and enforce the elapsed-duration floor', t => {
  const h = harness(); t.after(() => h.feature.dispose());
  Object.assign(h.session, { paused: true, kind: 'focus', mode: 'focus', plannedDurationMs: 3600000,
    remainingMs: 1800000, elapsedMs: 1800000, status: 'paused', sessionId: 'one' });
  h.feature.syncPomoCountdownAnchor(); h.feature.renderPomoTick(); h.feature.renderDurationPicker();
  assert.equal(h.$('#pomoTime').textContent, '30:00');
  assert.equal(h.$('#focusOrbit').style.strokeDashoffset, '50');
  assert.equal(h.$('#pomoProgress').attributes['aria-valuenow'], '50');
  assert.ok(Number(h.$('#durationSlider').min) >= 30);
});

test('resume submits only the rendered action, bounds double clicks and replaces same-looking session identity', async t => {
  const sent = []; let resolve;
  const h = harness({ resumePomodoro: action => { sent.push(action); return new Promise(done => { resolve = done; }); } });
  t.after(() => h.feature.dispose());
  Object.assign(h.session, { paused: true, status: 'paused', mode: 'focus', kind: 'focus', sessionId: 'old', remainingMs: 30000,
    resumeAction: { sessionId: 'old', intent: 'resume', enabled: true, reason: null } });
  h.feature.renderPomoStructure();
  // State has changed, but the still visible button belongs to the old projection.
  h.session.resumeAction = { sessionId: 'new', intent: 'resume', enabled: true, reason: null };
  const pending = h.$('#btnResumeFocus').fire('click'); h.$('#btnResumeFocus').fire('click');
  assert.deepEqual(sent, [{ sessionId: 'old', intent: 'resume' }]);
  h.session.sessionId = 'new'; h.feature.renderPomoStructure();
  resolve({ ok: false, reason: 'session-changed' }); await pending;
  assert.equal(h.$('#focusActionStatus').textContent, '');
  h.$('#btnResumeFocus').fire('click');
  assert.deepEqual(sent[1], { sessionId: 'new', intent: 'resume' });
  resolve({ ok: true });
});

test('due actions are explicit, absent or disabled actions cannot invoke, and linked break ignores completed task', async t => {
  const sent = [];
  const h = harness({ resumePomodoro: async action => { sent.push(action); return { ok: true }; } });
  t.after(() => h.feature.dispose());
  Object.assign(h.session, { paused: true, status: 'paused', mode: 'focus', kind: 'focus', sessionId: 'due', remainingMs: 0 });
  h.feature.renderPomoStructure(); await h.$('#btnResumeFocus').fire('click');
  assert.equal(sent.length, 0);
  h.session.resumeAction = { sessionId: 'due', intent: 'confirm-completion', enabled: false, reason: 'recovery-state-inconsistent' };
  h.feature.renderPomoStructure(); await h.$('#btnResumeFocus').fire('click'); assert.equal(sent.length, 0);
  h.session.resumeAction = { ...h.session.resumeAction, enabled: true, reason: null };
  h.feature.renderPomoStructure();
  assert.equal(h.$('#btnResumeFocusText').textContent, '确认计入完成');
  assert.equal(h.$('#btnStopFocusText').textContent, '放弃本轮');
  assert.doesNotMatch(h.$('#pomoLabel').textContent, /离线/);
  await h.$('#btnResumeFocus').fire('click');
  assert.deepEqual(sent, [{ sessionId: 'due', intent: 'confirm-completion' }]);
  h.state.tasks = [{ id: 'task', done: true }];
  Object.assign(h.session, { sessionId: 'break', mode: 'break', kind: 'break', taskId: 'task', remainingMs: 1000,
    resumeAction: { sessionId: 'break', intent: 'resume', enabled: true, reason: null } });
  h.feature.renderPomoStructure(); assert.equal(h.$('#btnResumeFocus').disabled, false);
});

test('hidden/reopen invalidates old action and ignores late command results until a fresh projection arrives', async t => {
  let hidden, finish, reload;
  const sent = [];
  const h = harness({ onPopoverHidden: fn => { hidden = fn; return () => {}; },
    resumePomodoro: input => { sent.push(input); return new Promise(resolve => { finish = resolve; }); } },
  { refreshProjection: () => new Promise(resolve => { reload = resolve; }) });
  t.after(() => h.feature.dispose());
  Object.assign(h.session, { paused: true, status: 'paused', mode: 'focus', sessionId: 'one', remainingMs: 30000,
    resumeAction: { sessionId: 'one', intent: 'resume', enabled: true, reason: null } });
  h.feature.renderPomoStructure();
  const pending = h.$('#btnResumeFocus').fire('click'); hidden();
  h.document.defaultView.fire('focus');
  await h.$('#btnResumeFocus').fire('click'); assert.equal(sent.length, 1);
  h.session.sessionId = 'two'; h.session.resumeAction = { ...h.session.resumeAction, sessionId: 'two' };
  reload(h.state); await new Promise(resolve => setImmediate(resolve));
  finish({ ok: false, reason: 'session-changed' }); await pending;
  assert.equal(h.$('#focusActionStatus').textContent, '');
  const next = h.$('#btnResumeFocus').fire('click');
  assert.deepEqual(sent[1], { sessionId: 'two', intent: 'resume' }); finish({ ok: true }); await next;
});

test('popover abandon submits the exact rendered held identity and bounds repeated clicks', async t => {
  let finish; const sent = [];
  const h = harness({ stopPomodoro: input => { sent.push(input); return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => h.feature.dispose());
  Object.assign(h.session, { paused: true, status: 'paused', mode: 'focus', sessionId: 'held', remainingMs: 0,
    resumeAction: { sessionId: 'held', intent: 'confirm-completion', enabled: true, reason: null } });
  h.feature.renderPomoStructure();
  const pending = h.$('#btnStopFocus').fire('click'); h.$('#btnStopFocus').fire('click');
  assert.deepEqual(sent, [{ sessionId: 'held' }]); finish({ ok: true }); await pending;
});

test('a superseded reopen read waits for the newer revision-gap read before unlocking actions', async t => {
  const { createPopoverProjectionStore } = require('../src/surfaces/popover/state/projection-store.mjs');
  const stateChannel = require('../src/core/state-channel.mjs');
  const reads = []; let hidden, diff;
  const projectionStore = createPopoverProjectionStore({ stateChannel, client: {
    getState: () => new Promise(resolve => reads.push(resolve)), onStateDiff: fn => { diff = fn; return () => {}; } } });
  const sent = [];
  const h = harness({ onPopoverHidden: fn => { hidden = fn; return () => {}; },
    resumePomodoro: async input => { sent.push(input); return { ok: true }; } },
  { refreshProjection: () => projectionStore.refresh() });
  t.after(() => { h.feature.dispose(); projectionStore.dispose(); });
  const old = { revision: 1, pomodoro: { paused: true, status: 'paused', mode: 'focus', remainingMs: 1000, sessionId: 'old',
    resumeAction: { sessionId: 'old', intent: 'resume', enabled: true, reason: null } } };
  projectionStore.subscribe(change => { Object.assign(h.session, change.state.pomodoro); h.feature.renderPomoStructure(); });
  const starting = projectionStore.start(); reads[0](old); await starting;
  hidden(); h.document.defaultView.fire('focus');
  const gap = diff({ revision: 3, dirty: { tasks: true }, delta: {} });
  reads[1](old); await new Promise(resolve => setImmediate(resolve));
  await h.$('#btnResumeFocus').fire('click');
  assert.equal(h.$('#btnResumeFocus').disabled, true); assert.deepEqual(sent, []);
  reads[2]({ revision: 3, pomodoro: { ...old.pomodoro, sessionId: 'new', resumeAction: { ...old.pomodoro.resumeAction, sessionId: 'new' } } });
  await gap; await new Promise(resolve => setImmediate(resolve));
  await h.$('#btnResumeFocus').fire('click');
  assert.deepEqual(sent, [{ sessionId: 'new', intent: 'resume' }]);
});
