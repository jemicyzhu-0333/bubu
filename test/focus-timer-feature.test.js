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
    setStatusLine(selector, text) { $(selector).textContent = text; }, sessionDuration, currentTask: options.currentTask || (() => null), focusActionMessage: options.focusActionMessage || (() => 'failed'),
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

test('locale copy repaint preserves pending resume receipt and uncommitted duration preview', async t => {
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN'); let finish;
  const h = harness({ resumePomodoro: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => { h.feature.dispose(); setLocale('zh-CN'); });
  Object.assign(h.session, { paused: true, status: 'paused', mode: 'focus', kind: 'focus', sessionId: 'one', remainingMs: 30000,
    resumeAction: { sessionId: 'one', intent: 'resume', enabled: true, reason: null } });
  h.feature.renderPomoStructure(); h.feature.renderDurationPicker();
  const pending = h.$('#btnResumeFocus').fire('click');
  const slider = h.$('#durationSlider'); slider.value = '45'; slider.fire('input');
  const buttons = [...h.$('#durationPresets').children];
  setLocale('en');
  h.feature.renderPomoStructure({ copyOnly: true }); h.feature.renderDurationPicker({ copyOnly: true });
  h.feature.renderPomoStructure(); h.feature.renderDurationPicker();
  assert.equal(slider.value, '45'); assert.equal(h.$('#durationValue').textContent, '45 min');
  assert.deepEqual(h.$('#durationPresets').children, buttons);
  finish({ ok: false, reason: 'session-changed' }); await pending;
  assert.equal(h.$('#focusActionStatus').textContent, 'failed');
});

test('focus launch deduplicates pending requests and stale failure stays quiet after hide', async t => {
  let finish, calls = 0, hide;
  const h = harness({ startPomodoro: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, onPopoverHidden: callback => { hide = callback; return () => {}; } });
  t.after(() => h.feature.dispose());
  const first = h.feature.runFocusAction('focus', null, 25);
  await h.feature.runFocusAction('focus', null, 25); assert.equal(calls, 1);
  hide(); finish({ ok: false }); await first; assert.notEqual(h.$('#focusActionStatus').textContent, 'failed');
});

test('old launch failure releases busy controls after hide and reopen', async t => {
  let finish, hide;
  const h = harness({ startPomodoro: () => new Promise(resolve => { finish = resolve; }), onPopoverHidden: callback => { hide = callback; return () => {}; } }, { refreshProjection: async () => true });
  t.after(() => h.feature.dispose()); const pending = h.feature.runFocusAction('focus', null, 25);
  hide(); h.document.defaultView.fire('focus'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.$('#btnStartFocus').disabled, true);
  finish({ ok: false }); await pending; assert.equal(h.$('#btnStartFocus').disabled, false);
  assert.notEqual(h.$('#focusActionStatus').textContent, 'failed');
});

test('launch receipt from disposed instance cannot publish into its remount', async t => {
  let finish;
  const h = harness({ startPomodoro: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.feature.dispose()); const pending = h.feature.runFocusAction('focus', null, 25);
  h.feature.dispose(); h.feature.mount(); finish({ ok: false }); await pending;
  assert.notEqual(h.$('#focusActionStatus').textContent, 'failed'); assert.equal(h.$('#btnStartFocus').disabled, false);
});

test('pause shares action deduplication and reports transport failure', async t => {
  let reject, calls = 0;
  const h = harness({ pausePomodoro: () => { calls++; return new Promise((_, no) => { reject = no; }); } });
  t.after(() => h.feature.dispose()); h.session.running = true; h.feature.renderPomoStructure();
  const first = h.$('#btnPauseFocus').fire('click'); await h.$('#btnPauseFocus').fire('click'); assert.equal(calls, 1);
  reject(new Error('offline')); await first; assert.equal(h.$('#focusActionStatus').textContent, 'failed');
});



test('paused recovery feedback clears when idle offers the next title-only task', t => {
  const task = { id: 'title-only', title: 'Review proposal', steps: [], nextAction: null };
  const h = harness({}, { currentTask: () => task, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  h.state.focusMinutes.chosen = 90;
  Object.assign(h.session, { paused: true, sessionId: 'old', remainingMs: 60000, resumeAction: null });
  h.feature.renderPomoStructure();
  assert.equal(h.$('#focusActionStatus').textContent, 'resume-action-unavailable');
  Object.assign(h.session, { paused: false, sessionId: null });
  h.feature.renderPomoStructure();
  assert.equal(h.$('#focusActionStatus').textContent, '');
  assert.equal(h.$('#btnStartFocus').disabled, false);
  assert.equal(h.$('#pomoTime').textContent, '90:00');
});

test('title-only normal focus launches and its real failure survives idle repaint until retry', async t => {
  const task = { id: 'title-only', title: 'Review proposal', steps: [], nextAction: null };
  const calls = []; let succeed = false;
  const h = harness({ startPomodoro: async (...args) => { calls.push(args); return { ok: succeed, reason: 'storage-failed' }; } },
    { currentTask: () => task, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  await h.feature.runFocusAction('focus', task, 90);
  assert.deepEqual(calls, [[task.id, 90]]);
  assert.equal(h.$('#focusActionStatus').textContent, 'storage-failed');
  h.state.settings.pomodoroMinutes = 30; h.feature.renderPomoStructure();
  h.feature.renderPomoStructure({ copyOnly: true });
  assert.equal(h.$('#focusActionStatus').textContent, 'storage-failed');
  succeed = true; await h.feature.runFocusAction('focus', task, 90);
  assert.equal(h.$('#focusActionStatus').textContent, '');
});

for (const replacement of ['session', 'task']) test(`late launch failure cannot overwrite a new ${replacement} context`, async t => {
  let task = { id: 'original', title: 'Original' }; let finish;
  const h = harness({ startPomodoro: () => new Promise(resolve => { finish = resolve; }) }, { currentTask: () => task, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  const pending = h.feature.runFocusAction('focus', task, 25);
  if (replacement === 'session') Object.assign(h.session, { paused: true, sessionId: 'replacement', taskId: 'other', resumeAction: null });
  else task = { id: 'replacement', title: 'Replacement' };
  h.feature.renderPomoStructure();
  if (replacement === 'task') h.feature.showFocusActionStatus('New context feedback');
  finish({ ok: false, reason: 'old-failure' }); await pending;
  assert.equal(h.$('#focusActionStatus').textContent, replacement === 'task' ? 'New context feedback' : 'resume-action-unavailable');
});

for (const order of ['projection-first', 'receipt-first']) test(`scheduled selection owns its ${order} publication and still starts`, async t => {
  const original = { id: 'old', title: 'Old' };
  const target = { id: 'future', title: 'Future', scheduledFor: new Date(Date.now() + 600000).toISOString() };
  let selected = original, h;
  const publish = () => { selected = target; h.feature.renderPomoStructure(); };
  h = harness({
    setNowTask: async () => { if (order === 'projection-first') publish(); return { ok: true }; },
    startPomodoro: async (...args) => { h.calls.push(args); if (order === 'receipt-first') publish(); return { ok: false, reason: 'storage-failed' }; }
  }, { currentTask: () => selected, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  const result = await h.feature.runFocusAction('focus', target, 25);
  assert.deepEqual(h.calls, [[target.id, 25]]);
  assert.equal(result.reason, 'storage-failed');
  assert.equal(h.$('#focusActionStatus').textContent, 'storage-failed');
});

for (const replacement of ['other-task', 'other-session', 'switched-away-and-back', 'hidden']) {
  test(`scheduled selection cannot start after ${replacement}`, async t => {
    const original = { id: 'old', title: 'Old' };
    const target = { id: 'future', title: 'Future', scheduledFor: new Date(Date.now() + 600000).toISOString() };
    let selected = original, finish;
    const h = harness({ setNowTask: () => new Promise(resolve => { finish = resolve; }) }, { currentTask: () => selected });
    t.after(() => h.feature.dispose());
    const pending = h.feature.runFocusAction('focus', target, 25);
    if (replacement === 'hidden') { h.document.hidden = true; h.document.fire('visibilitychange'); }
    else {
      selected = replacement === 'other-session' ? target : { id: 'other', title: 'Other' };
      if (replacement === 'other-session') Object.assign(h.session, { running: true, sessionId: 'new-session', taskId: 'other' });
      h.feature.renderPomoStructure();
      if (replacement === 'switched-away-and-back') { selected = target; h.feature.renderPomoStructure(); }
    }
    finish({ ok: true });
    assert.equal((await pending).reason, 'launch-cancelled');
    assert.deepEqual(h.calls, []);
  });
}

for (const order of ['projection-first', 'receipt-first', 'session-preempted']) {
  test(`scheduled focus uses real selection and start transactions (${order})`, async t => {
    const { createUnitOfWork, createSelectNowWorkflow, createStartFocusSessionWorkflow } = require('../src/application');
    const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
    const now = Date.now();
    const original = { id: 'old', title: 'Old', steps: [] };
    const target = { id: 'future', title: 'Future', steps: [], scheduledFor: new Date(now + 600000).toISOString() };
    let canonical = normalizePersistedState({ ...normalizePersistedState({}, { now }), tasks: [original, target], nowTaskId: original.id }, { now });
    let revision = 0;
    const repository = { snapshot: () => structuredClone(canonical), revision: () => revision,
      commit: (candidate, context) => { canonical = normalizePersistedState(candidate, context); revision++; return structuredClone(canonical); } };
    const unitOfWork = createUnitOfWork({ repository });
    let selected = canonical.tasks[0], h, starts = 0;
    const publishSelection = () => { selected = canonical.tasks.find(task => task.id === canonical.nowTaskId); h.feature.renderPomoStructure(); };
    const select = createSelectNowWorkflow({ unitOfWork, clock: { now: () => now },
      publish: () => { if (order !== 'receipt-first') publishSelection(); } });
    const start = createStartFocusSessionWorkflow({ unitOfWork, clock: { now: () => now }, sessionClock: { now: () => now },
      idFactory: () => `session-${revision}` });
    h = harness({
      setNowTask: async taskId => {
        const receipt = select.execute({ taskId });
        if (order === 'session-preempted') {
          const other = start.execute({ taskId: original.id, minutes: 15 });
          assert.equal(other.ok, true);
          Object.assign(h.session, other.session); h.feature.renderPomoStructure();
        }
        return receipt;
      },
      startPomodoro: async (taskId, minutes) => {
        starts++;
        if (order === 'receipt-first') publishSelection();
        return start.execute({ taskId, minutes });
      }
    }, { currentTask: () => selected });
    t.after(() => h.feature.dispose());
    const result = await h.feature.runFocusAction('focus', target, 90);
    if (order === 'session-preempted') {
      assert.equal(result.reason, 'launch-cancelled'); assert.equal(starts, 0);
      assert.equal(canonical.focusSession.taskId, original.id);
    } else {
      assert.equal(result.ok, true); assert.equal(starts, 1);
      assert.equal(canonical.focusSession.taskId, target.id);
      assert.equal(canonical.focusSession.plannedDurationMs, 90 * 60000);
      assert.equal(canonical.tasks.find(task => task.id === target.id).scheduledFor, null);
    }
  });
}

// Correlation-token ownership: a request may observe its own selection any
// number of times (projection, refresh, receipt) without losing its feedback.
test('own scheduled selection published repeatedly keeps the request and its failure notice', async t => {
  const original = { id: 'old', title: 'Old' };
  const target = { id: 'future', title: 'Future', scheduledFor: new Date(Date.now() + 600000).toISOString() };
  let selected = original, h;
  h = harness({
    setNowTask: async () => { selected = target; for (let i = 0; i < 3; i++) h.feature.renderPomoStructure(); return { ok: true }; },
    startPomodoro: async (...args) => { h.calls.push(args); h.feature.renderPomoStructure(); return { ok: false, reason: 'storage-failed' }; }
  }, { currentTask: () => selected, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  const result = await h.feature.runFocusAction('focus', target, 25);
  assert.deepEqual(h.calls, [[target.id, 25]]);
  assert.equal(result.reason, 'storage-failed');
  assert.equal(h.$('#focusActionStatus').textContent, 'storage-failed');
});

test('a finished request cannot be revived: later owner change clears its notice', async t => {
  let task = { id: 'a', title: 'A' };
  const h = harness({ startPomodoro: async () => ({ ok: false, reason: 'storage-failed' }) },
    { currentTask: () => task, focusActionMessage: reason => reason || 'failed' });
  t.after(() => h.feature.dispose());
  await h.feature.runFocusAction('focus', task, 25);
  assert.equal(h.$('#focusActionStatus').textContent, 'storage-failed');
  task = { id: 'b', title: 'B' }; h.feature.renderPomoStructure();
  assert.equal(h.$('#focusActionStatus').textContent, '');
  task = { id: 'a', title: 'A' }; h.feature.renderPomoStructure();
  assert.equal(h.$('#focusActionStatus').textContent, '');
});
