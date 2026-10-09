'use strict';

// 两个“先记下来”的入口的键盘行为：快捷面板的 ⌘/Ctrl+1–3，和面板底部的随手记（`/` 聚焦、回车收下、Esc 清空）。
// 仓库里没有 jsdom，所以宿主元素是只带这两个功能会碰到的成员的桩；碰到桩以外的东西会直接抛错。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createQuickStartFixture } = require('../test-support/quick-start-fixture');

const ROOT = path.resolve(__dirname, '..');
const load = relative => import(pathToFileURL(path.join(ROOT, relative)).href);

function element(tagName = 'DIV') {
  const node = {
    tagName, value: '', textContent: '', innerHTML: '', placeholder: '', dataset: {}, style: {},
    classes: new Set(), attributes: {}, listeners: {}, focused: false, children: [],
    classList: {
      toggle(name, on) { if (on === undefined ? !node.classes.has(name) : on) node.classes.add(name); else node.classes.delete(name); },
      add: name => node.classes.add(name),
      remove: name => node.classes.delete(name),
      contains: name => node.classes.has(name)
    },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute: name => node.attributes[name],
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { node.listeners[type] = (node.listeners[type] || []).filter(fn => fn !== handler); },
    append(...items) { node.children.push(...items); },
    appendChild(item) { node.children.push(item); return item; },
    replaceChildren(...items) { node.children = items; },
    querySelectorAll() { return []; },
    focus() { node.focused = true; },
    blur() { node.focused = false; }
  };
  return node;
}

function fakeDocument() {
  const nodes = new Map();
  const document = {
    body: element('BODY'),
    nodes,
    listeners: {},
    querySelector(selector) {
      if (selector === '.modal-mask:not(.hidden), .settings-mask:not(.hidden)') return document.openModal || null;
      if (!nodes.has(selector)) nodes.set(selector, element(selector.startsWith('input') || selector.includes('Input') ? 'INPUT' : 'DIV'));
      return nodes.get(selector);
    },
    querySelectorAll(selector) {
      return selector === '[data-quick-shortcut]' ? [document.querySelector(selector)] : [];
    },
    createElement: tag => element(tag.toUpperCase()),
    addEventListener(type, handler) { (document.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { document.listeners[type] = (document.listeners[type] || []).filter(fn => fn !== handler); },
    press(event) {
      const seen = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...event };
      for (const handler of document.listeners.keydown || []) handler(seen);
      return seen;
    }
  };
  return document;
}

// ---------- 快捷面板 ----------
async function quickPanel(quickPanelState, overrides = {}, windowOverrides = {}) {
  const { createQuickPanelFeature } = await load('src/surfaces/impulse/quick-panel.mjs');
  const document = fakeDocument();
  const calls = [];
  const windowEvents = new Map();
  let onDiff;
  const window = {
    performance: { now: () => 0 },
    requestAnimationFrame: fn => fn(),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: fn => fn(),
    addEventListener: (name, fn) => windowEvents.set(name, fn),
    removeEventListener: name => windowEvents.delete(name), ...windowOverrides
  };
  const client = {
    getState: async () => ({ quickPanel: quickPanelState }),
    addImpulse: async text => { calls.push(['addImpulse', text]); return { ok: true }; },
    kickstart: async (id, clarification) => { calls.push(clarification ? ['kickstart', id, clarification] : ['kickstart', id]); return { ok: true }; },
    startPomodoro: async id => { calls.push(['startPomodoro', id]); return { ok: true }; },
    completeStep: async (taskId, stepId) => { calls.push(['completeStep', taskId, stepId]); return { ok: true }; },
    hideImpulse: async () => { calls.push(['hide']); },
    onStateDiff: fn => { onDiff = fn; return () => {}; },
    onSensoryProfile: () => () => {}, ...overrides
  };
  const feature = createQuickPanelFeature({ window, document, client });
  feature.mount();
  await feature.refresh();
  return { document, calls, feature, windowEvents, client, diff: message => onDiff(message) };
}

const readyAction = id => ({ taskId: id, intent: 'start', enabled: true, reason: null, taskVersion: 'a'.repeat(64) });
const IDLE = { mode: 'idle', candidates: [{ id: 'a', title: '整理笔记', quickStartAction: readyAction('a') },
  { id: 'b', title: '回邮件', quickStartAction: readyAction('b') }] };
const TITLE_ONLY = { ...IDLE, candidates: [{ ...IDLE.candidates[0],
  quickStartAction: { ...readyAction('a'), intent: 'clarify-and-start' } }] };
const ACTIVE = {
  mode: 'active', taskActionable: true,
  session: { kind: 'focus', paused: false, elapsedMs: 0, remainingMs: 1000, running: true },
  task: { id: 't1', title: '写周报' },
  steps: [{ id: 's1', title: '打开文档' }, { id: 's2', title: '列提纲' }]
};
const settle = () => new Promise(resolve => setImmediate(resolve));
function emit(node, type) { for (const listener of node.listeners[type] || []) listener({ preventDefault() {} }); }

test('title-only numeric choice is local until explicit action confirmation; unchanged pushes retain input', async t => {
  const h = await quickPanel(TITLE_ONLY); t.after(() => h.feature.dispose());
  h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } }); await settle();
  assert.deepEqual(h.calls, []);
  const input = h.document.querySelector('#quickStartInput'); input.value = 'Open notes'; emit(input, 'input');
  h.diff(); await settle(); assert.equal(input.value, 'Open notes');
  emit(h.document.querySelector('#quickStartForm'), 'submit'); await settle();
  assert.deepEqual(h.calls, [['kickstart', 'a', { nextAction: 'Open notes', taskVersion: 'a'.repeat(64) }], ['hide']]);
});

test('Cancel and Escape discard unsent local actions without writing or hiding the panel', async t => {
  const h = await quickPanel(TITLE_ONLY); t.after(() => h.feature.dispose());
  for (const cancel of ['button', 'escape']) {
    emit(h.document.querySelector('#quickCandidates').children[0], 'click'); await settle();
    if (cancel === 'button') emit(h.document.querySelector('#quickStartCancel'), 'click');
    else h.document.press({ key: 'Escape', target: { tagName: 'INPUT' } });
    await settle(); assert.deepEqual(h.calls, []);
    assert.equal(h.document.querySelector('#quickStartForm').classes.has('hidden'), true);
  }
});

for (const outcome of ['success', 'refuse', 'reject']) test(`same-visit replacement owns UI after old quick-start ${outcome}`, async t => {
  let firstResolve, firstReject, secondResolve; let count = 0;
  const h = await quickPanel(TITLE_ONLY, { kickstart: () => ++count === 1
    ? new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; })
    : new Promise(resolve => { secondResolve = resolve; }) });
  t.after(() => h.feature.dispose());
  const open = () => emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  const submit = () => emit(h.document.querySelector('#quickStartForm'), 'submit');
  open(); const input = h.document.querySelector('#quickStartInput'); input.value = 'First'; emit(input, 'input'); submit();
  emit(h.document.querySelector('#quickStartCancel'), 'click'); open(); input.value = 'Second'; emit(input, 'input'); submit();
  assert.equal(count, 2); const status = h.document.querySelector('#panelStatus'); status.textContent = 'New draft';
  if (outcome === 'reject') firstReject(new Error('late')); else firstResolve({ ok: outcome === 'success', reason: 'task-changed' });
  await settle(); assert.equal(status.textContent, 'New draft'); assert.equal(input.value, 'Second');
  assert.equal(h.document.querySelector('#quickStartConfirm').disabled, true); assert.deepEqual(h.calls, []);
  submit(); assert.equal(count, 2); secondResolve({ ok: true }); await settle(); assert.deepEqual(h.calls, [['hide']]);
});

test('changed task fingerprint preserves text but cannot silently rebind and send', async t => {
  const h = await quickPanel(TITLE_ONLY); t.after(() => h.feature.dispose());
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  const input = h.document.querySelector('#quickStartInput'); input.value = 'Old thought'; emit(input, 'input');
  h.feature.render({ ...TITLE_ONLY, candidates: [{ ...TITLE_ONLY.candidates[0],
    quickStartAction: { ...TITLE_ONLY.candidates[0].quickStartAction, taskVersion: 'b'.repeat(64) } }] });
  assert.equal(input.value, 'Old thought'); assert.equal(h.document.querySelector('#quickStartConfirm').disabled, true);
  emit(h.document.querySelector('#quickStartForm'), 'submit'); await settle(); assert.deepEqual(h.calls, []);
});

test('a post-commit push keeps the current receipt and hide rejection never retries the committed start', async t => {
  let finish; let writes = 0;
  const h = await quickPanel(TITLE_ONLY, { kickstart: () => { writes++; return new Promise(resolve => { finish = resolve; }); },
    hideImpulse: async () => { throw new Error('Synthetic window failure'); } });
  t.after(() => h.feature.dispose());
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  h.document.querySelector('#quickStartInput').value = 'Open notes';
  emit(h.document.querySelector('#quickStartForm'), 'submit');
  h.client.getState = async () => ({ revision: 2, quickPanel: ACTIVE }); h.diff({ revision: 2 }); await settle();
  finish({ ok: true }); await settle(); await settle();
  assert.match(h.document.querySelector('#panelStatus').textContent, /已开始/);
  assert.equal(h.document.body.attributes['aria-busy'], 'false');
  emit(h.document.querySelector('#quickStartForm'), 'submit'); await settle(); assert.equal(writes, 1);
});

test('missing kickstart fails explicitly and never falls back to a longer session', async t => {
  const h = await quickPanel(IDLE, { kickstart: undefined }); t.after(() => h.feature.dispose());
  h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } }); await settle();
  assert.deepEqual(h.calls, []); assert.match(h.document.querySelector('#panelStatus').textContent, /两分钟.*不可用/);
});

for (const entry of ['button', 'shortcut']) test(`real title creation → recommendation → ${entry} → explicit action starts atomically`, async t => {
  let h;
  const f = createQuickStartFixture({ onPublish: message => h?.diff(message) });
  const created = f.create.execute({ task: { title: 'Only a title', steps: [] } });
  assert.equal(created.ok, true); assert.equal(created.task.nextAction, null);
  const state = f.query.execute(), before = f.repository.revision();
  assert.equal(state.quickPanel.candidates[0].id, created.task.id);
  h = await quickPanel(state.quickPanel, { getState: async () => f.query.execute(),
    kickstart: async (taskId, extra) => f.start.execute({ taskId, quick: true, ...extra }) });
  t.after(() => h.feature.dispose());
  if (entry === 'button') emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  else h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } });
  assert.equal(f.repository.revision(), before);
  h.document.querySelector('#quickStartInput').value = 'Open the notebook';
  emit(h.document.querySelector('#quickStartForm'), 'submit'); emit(h.document.querySelector('#quickStartForm'), 'submit');
  await settle();
  assert.equal(f.repository.revision(), before + 1);
  const after = f.repository.snapshot();
  assert.equal(after.tasks[0].nextAction, 'Open the notebook');
  assert.equal(after.tasks[0].steps[0].title, 'Open the notebook');
  assert.equal(after.focusSession.taskId, created.task.id); assert.equal(after.focusSession.plannedDurationMs, 120000);
  assert.deepEqual(h.calls, [['hide']]);
  assert.equal(f.events.find(([name]) => name === 'publish')[1].tasks, true);
  assert.equal(f.events.find(([name]) => name === 'publish')[1].recommendations, true);
});

test('current quick-start refusal preserves input for explicit retry and validates before sending', async t => {
  let calls = 0;
  const h = await quickPanel(TITLE_ONLY, { kickstart: async () => ++calls === 1 ? { ok: false, reason: 'revision-conflict' } : { ok: true } });
  t.after(() => h.feature.dispose());
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  const input = h.document.querySelector('#quickStartInput'), form = h.document.querySelector('#quickStartForm');
  for (const invalid of [' ', 'x'.repeat(201)]) { input.value = invalid; emit(form, 'submit'); await settle(); }
  assert.equal(calls, 0); input.value = 'Keep this input'; emit(form, 'submit'); await settle();
  assert.equal(input.value, 'Keep this input'); assert.equal(h.document.querySelector('#quickStartConfirm').disabled, false);
  assert.deepEqual(h.calls, []); emit(form, 'submit'); await settle(); assert.equal(calls, 2); assert.deepEqual(h.calls, [['hide']]);
});

for (const ending of ['reopen', 'dispose']) for (const outcome of ['success', 'refuse', 'reject']) {
  test(`${ending} prevents late quick-start ${outcome} from changing status, focus or hiding`, async t => {
    let resolve, reject;
    const h = await quickPanel(TITLE_ONLY, { kickstart: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
    t.after(() => h.feature.dispose());
    emit(h.document.querySelector('#quickCandidates').children[0], 'click');
    h.document.querySelector('#quickStartInput').value = 'Old action'; emit(h.document.querySelector('#quickStartForm'), 'submit');
    if (ending === 'reopen') {
      h.windowEvents.get('blur')(); h.windowEvents.get('focus')(); await settle();
      emit(h.document.querySelector('#quickCandidates').children[0], 'click');
    } else h.feature.dispose();
    const input = h.document.querySelector('#quickStartInput'); input.value = 'New input'; input.focused = false;
    h.document.querySelector('#panelStatus').textContent = 'New owner';
    if (outcome === 'reject') reject(new Error('Late failure')); else resolve({ ok: outcome === 'success', reason: 'task-changed' });
    await settle(); assert.equal(input.value, 'New input'); assert.equal(input.focused, false);
    assert.equal(h.document.querySelector('#panelStatus').textContent, 'New owner'); assert.deepEqual(h.calls, []);
  });
}

test('queued quick-start and capture focus obey draft and visit generations', async t => {
  const frames = [];
  const h = await quickPanel(TITLE_ONLY, {}, { requestAnimationFrame: callback => frames.push(callback) });
  t.after(() => h.feature.dispose());
  const input = h.document.querySelector('#quickStartInput');
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  emit(h.document.querySelector('#quickStartCancel'), 'click');
  const oldFrames = frames.splice(0);
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  oldFrames.forEach(callback => callback()); assert.equal(input.focused, false);
  frames.splice(0).forEach(callback => callback()); assert.equal(input.focused, true);
  input.focused = false; h.windowEvents.get('blur')(); h.windowEvents.get('focus')(); await settle();
  h.feature.dispose(); frames.splice(0).forEach(callback => callback()); assert.equal(input.focused, false);
});

test('old read cannot overwrite a new push or replace the draft original version', async t => {
  const h = await quickPanel(TITLE_ONLY); t.after(() => h.feature.dispose());
  emit(h.document.querySelector('#quickCandidates').children[0], 'click');
  const input = h.document.querySelector('#quickStartInput'); input.value = 'Original input';
  let oldRead;
  h.client.getState = () => new Promise(resolve => { oldRead = resolve; }); const reading = h.feature.refresh();
  const changed = { ...TITLE_ONLY, candidates: [{ ...TITLE_ONLY.candidates[0],
    quickStartAction: { ...TITLE_ONLY.candidates[0].quickStartAction, taskVersion: 'b'.repeat(64) } }] };
  h.client.getState = async () => ({ revision: 5, quickPanel: changed }); h.diff({ revision: 5 }); await settle();
  oldRead({ revision: 4, quickPanel: TITLE_ONLY }); await reading;
  assert.equal(input.value, 'Original input'); assert.equal(h.document.querySelector('#quickStartConfirm').disabled, true);
  emit(h.document.querySelector('#quickStartForm'), 'submit'); await settle(); assert.deepEqual(h.calls, []);
});

test('hide refusal retains committed success; malformed command receipt never hides', async t => {
  for (const receipt of [{ ok: true }, undefined]) {
    let writes = 0;
    const h = await quickPanel(IDLE, { kickstart: async () => { writes++; return receipt; }, hideImpulse: async () => ({ ok: false }) });
    t.after(() => h.feature.dispose());
    h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } }); await settle(); await settle();
    assert.equal(writes, 1);
    assert.match(h.document.querySelector('#panelStatus').textContent, receipt ? /已开始.*未能关闭/ : /结果暂不可用/);
  }
});

test('ready candidate missing/disabled action and detached rows cannot bypass current decisions', async t => {
  const h = await quickPanel(IDLE); t.after(() => h.feature.dispose());
  const old = h.document.querySelector('#quickCandidates').children[0];
  for (const action of [null, { ...readyAction('a'), enabled: false, reason: 'focus-landing-pending' }]) {
    h.feature.render({ ...IDLE, candidates: [{ ...IDLE.candidates[0], quickStartAction: action }] });
    h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } });
    emit(old, 'click'); await settle(); assert.deepEqual(h.calls, []);
  }
});

test('quick panel confirms the rendered due identity once, abandons that identity and blocks absent/disabled actions', async t => {
  const sent = []; let finish;
  const action = { sessionId: 'held', intent: 'confirm-completion', enabled: true, reason: null };
  const due = { ...ACTIVE, session: { ...ACTIVE.session, sessionId: 'held', running: false, paused: true,
    remainingMs: 0, awaitingOfflineConfirmation: true, resumeAction: action } };
  const h = await quickPanel(due, { resumePomodoro: input => { sent.push(input); return new Promise(resolve => { finish = resolve; }); },
    stopPomodoro: async input => { sent.push(['stop', input]); return { ok: true }; } });
  t.after(() => h.feature.dispose());
  const pause = h.document.querySelector('#btnPauseQuickSession');
  assert.equal(pause.textContent, '确认计入完成');
  assert.equal(h.document.querySelector('#btnStopQuickSession').textContent, '放弃本轮');
  emit(pause, 'click'); emit(pause, 'click');
  assert.deepEqual(sent, [{ sessionId: 'held', intent: 'confirm-completion' }]);
  finish({ ok: true }); await settle();
  emit(h.document.querySelector('#btnStopQuickSession'), 'click'); await settle();
  assert.deepEqual(sent.at(-1), ['stop', { sessionId: 'held' }]);
  for (const resumeAction of [null, { ...action, enabled: false, reason: 'recovery-state-inconsistent' }]) {
    h.feature.render({ ...due, session: { ...due.session, resumeAction } });
    assert.equal(pause.disabled, true); emit(pause, 'click'); await settle();
    assert.equal(sent.length, 2);
  }
  assert.match(h.document.querySelector('#panelStatus').textContent, /不一致/);
});

test('break and completed linked work reject all task actions, including stale rows and numeric shortcuts', async t => {
  const sent = [];
  const h = await quickPanel(ACTIVE, { appendTaskStep: async (...args) => sent.push(args),
    completeTask: async (...args) => sent.push(args), renameTaskStep: async (...args) => sent.push(args) });
  t.after(() => h.feature.dispose());
  const oldRow = h.document.querySelector('#quickSteps').children[0];
  for (const kind of ['break', 'focus']) {
    h.feature.render({ ...ACTIVE, taskActionable: false, session: { ...ACTIVE.session, kind } });
    h.document.press({ key: '1', ctrlKey: true, target: { tagName: 'INPUT' } });
    h.document.querySelector('#stepInput').value = 'New step';
    emit(h.document.querySelector('#appendStepForm'), 'submit');
    emit(h.document.querySelector('#btnCompleteQuickTask'), 'click');
    emit(oldRow.children[0], 'click'); emit(oldRow.children[1], 'click');
    await settle();
    assert.equal(h.document.querySelector('#quickStepsSection').classes.has('hidden'), true);
    assert.equal(h.document.querySelector('#appendStepForm').classes.has('hidden'), true);
    assert.equal(h.document.querySelector('#btnCompleteQuickTask').classes.has('hidden'), true);
  }
  assert.deepEqual(sent, []); assert.deepEqual(h.calls, []);
});

test('late quick-panel reads and commands cannot overwrite or close a new visit/action', async t => {
  let finish, oldRead;
  const oldAction = { sessionId: 'old', intent: 'resume', enabled: true, reason: null };
  const old = { ...ACTIVE, session: { ...ACTIVE.session, sessionId: 'old', paused: true, running: false, resumeAction: oldAction } };
  const h = await quickPanel(old, { resumePomodoro: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.feature.dispose());
  emit(h.document.querySelector('#btnPauseQuickSession'), 'click');
  h.client.getState = () => new Promise(resolve => { oldRead = resolve; });
  const pendingRead = h.feature.refresh();
  h.windowEvents.get('blur')();
  const next = { ...old, session: { ...old.session, sessionId: 'new', resumeAction: { ...oldAction, sessionId: 'new', enabled: false, reason: 'task-completed' } } };
  h.client.getState = async () => ({ quickPanel: next });
  h.windowEvents.get('focus')(); await settle();
  finish({ ok: false, reason: 'session-changed' }); oldRead({ quickPanel: old });
  await pendingRead; await settle();
  assert.equal(h.document.querySelector('#btnPauseQuickSession').disabled, true);
  assert.equal(h.document.querySelector('#panelStatus').textContent, '这件任务已经完成。');
  h.windowEvents.get('blur')(); h.diff(); await settle();
  assert.equal(h.document.body.dataset.mode, 'fallback');
});

test('a successful capture receipt survives an unrelated refresh in the same visit', async t => {
  let finish;
  const h = await quickPanel(IDLE, { addImpulse: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.feature.dispose());
  const input = h.document.querySelector('#impInput'); input.value = 'Synthetic capture';
  emit(h.document.querySelector('#impulseForm'), 'submit');
  h.diff(); await settle(); finish({ ok: true }); await settle();
  assert.equal(input.value, '');
  assert.equal(h.document.querySelector('#panelStatus').textContent, '记好了');
  assert.deepEqual(h.calls, [['hide']]);
});

test('an old command refresh cannot clear a new visit step draft', async t => {
  let oldRead;
  const h = await quickPanel(ACTIVE, { appendTaskStep: async () => ({ ok: true }) });
  t.after(() => h.feature.dispose());
  h.client.getState = () => new Promise(resolve => { oldRead = resolve; });
  const input = h.document.querySelector('#stepInput'); input.value = 'Old step';
  emit(h.document.querySelector('#appendStepForm'), 'submit'); await settle();
  h.windowEvents.get('blur')(); h.client.getState = async () => ({ quickPanel: ACTIVE });
  h.windowEvents.get('focus')(); await settle(); input.value = 'Unsaved new visit step';
  oldRead({ quickPanel: ACTIVE }); await settle();
  assert.equal(input.value, 'Unsaved new visit step');
});

test('popover linked break exposes no session task completion, step append or editor action', async t => {
  const { createPopoverNowCard } = await load('src/surfaces/popover/features/now-card.mjs');
  const document = fakeDocument(), sent = [];
  const session = { paused: true, running: false, mode: 'focus', kind: 'focus', taskId: 'task' };
  const task = { id: 'task', title: 'Synthetic task', steps: [{ id: 'step', title: 'First', done: false }] };
  const state = { tasks: [task], nowTaskId: 'task' };
  const noop = () => {};
  const feature = createPopoverNowCard({ document, $: selector => document.querySelector(selector),
    getState: () => state, getSession: () => session, escapeHTML: String,
    surfaceClient: { updateTask: async (...args) => { sent.push(args); return { ok: true }; } },
    taskLaunchBlockReason: () => null, focusActionMessage: String, taskActionMessage: String,
    scoreSummary: () => '', syncBlocker: noop, canReceiveFocus: () => false, celebrate: noop,
    completeTask: async task => sent.push(['complete', task]), openTaskEditor: task => sent.push(['edit', task]),
    runQuickStart: noop, showFocusStatus: noop });
  feature.mount(); t.after(() => feature.dispose()); feature.renderDetail();
  session.kind = 'break'; session.mode = 'break';
  feature.renderDetail();
  assert.equal(feature.currentTask(), null);
  assert.equal(document.querySelector('#nowTaskDetail').classes.has('hidden'), true);
  document.querySelector('#sessionStepInput').value = 'Break must not append';
  emit(document.querySelector('#sessionStepForm'), 'submit');
  emit(document.querySelector('#btnCompleteNowTask'), 'click'); emit(document.querySelector('#btnEditNowTask'), 'click');
  await settle(); assert.deepEqual(sent, []);
});

test('quick panel: with the capture input focused a bare digit is typed, ⌘/Ctrl+digit acts', async () => {
  const { document, calls } = await quickPanel(IDLE);
  const input = { tagName: 'INPUT' };
  assert.equal(document.press({ key: '1', target: input }).defaultPrevented, false);
  await settle();
  assert.deepEqual(calls, [], 'a bare digit in the input must reach the input, not start a task');

  const withCtrl = document.press({ key: '2', ctrlKey: true, target: input });
  await settle();
  assert.equal(withCtrl.defaultPrevented, true);
  assert.deepEqual(calls.slice(0, 1), [['kickstart', 'b']], '⌘/Ctrl+2 is the second candidate, started as the two-minute start');
});

test('quick panel: outside the input a bare digit works, Alt/Shift combinations and empty slots do not', async () => {
  const { document, calls } = await quickPanel(IDLE);
  document.press({ key: '1', target: { tagName: 'BODY' } });
  await settle();
  assert.deepEqual(calls[0], ['kickstart', 'a']);
  const before = calls.length;
  document.press({ key: '1', altKey: true, target: { tagName: 'BODY' } });
  document.press({ key: '1', shiftKey: true, metaKey: true, target: { tagName: 'BODY' } });
  document.press({ key: '3', target: { tagName: 'BODY' } });
  await settle();
  assert.equal(calls.length, before, 'no third candidate, and Alt/Shift are never shortcuts');
});

test('quick panel: while a task is active the digits complete that step, and Escape hides the panel', async () => {
  const { document, calls } = await quickPanel(ACTIVE);
  document.press({ key: '2', metaKey: true, target: { tagName: 'INPUT' } });
  await settle();
  assert.deepEqual(calls[0], ['completeStep', 't1', 's2']);
  const escape = document.press({ key: 'Escape', target: { tagName: 'INPUT' } });
  await settle();
  assert.equal(escape.defaultPrevented, true);
  assert.ok(calls.some(call => call[0] === 'hide'));
});

// ---------- 面板底部的随手记 ----------
async function captureBar({ addImpulse } = {}) {
  const { createPopoverCaptureBar } = await load('src/surfaces/popover/features/capture-bar.mjs');
  const document = fakeDocument();
  const input = document.querySelector('#captureInput');
  const sent = [];
  const surfaceClient = { addImpulse: addImpulse || (async text => { sent.push(text); return { ok: true }; }) };
  const bar = createPopoverCaptureBar({ document, $: sel => document.querySelector(sel), surfaceClient });
  bar.mount();
  return { document, input, sent, bar, status: document.querySelector('#captureStatus') };
}

test('capture bar: enter saves the trimmed line, clears the input and says so', async () => {
  const { input, sent, bar, status } = await captureBar();
  input.value = '  明天回房东邮件  ';
  await bar.submit({ preventDefault() {} });
  assert.deepEqual(sent, ['明天回房东邮件']);
  assert.equal(input.value, '');
  assert.equal(status.dataset.tone, 'ok');
  assert.match(status.textContent, /收下了/);
});

test('capture bar: a blank line is ignored and a failed save keeps the text', async () => {
  const blank = await captureBar();
  blank.input.value = '   ';
  await blank.bar.submit();
  assert.deepEqual(blank.sent, []);

  const failing = await captureBar({ addImpulse: async () => ({ ok: false }) });
  failing.input.value = '别丢了这句';
  await failing.bar.submit();
  assert.equal(failing.input.value, '别丢了这句', 'the text is the only copy; it must survive a failed save');
  assert.equal(failing.status.dataset.tone, 'error');

  const throwing = await captureBar({ addImpulse: async () => { throw new Error('ipc'); } });
  throwing.input.value = '也不能丢';
  await throwing.bar.submit();
  assert.equal(throwing.input.value, '也不能丢');
});

test('capture bar: "/" focuses the input from anywhere except typing fields and open dialogs; Escape clears', async () => {
  const { document, input } = await captureBar();
  const slash = document.press({ key: '/', target: { tagName: 'BODY' } });
  assert.equal(slash.defaultPrevented, true);
  assert.equal(input.focused, true);

  input.focused = false;
  assert.equal(document.press({ key: '/', target: { tagName: 'INPUT' } }).defaultPrevented, false);
  assert.equal(document.press({ key: '/', target: { tagName: 'TEXTAREA' } }).defaultPrevented, false);
  assert.equal(document.press({ key: '/', metaKey: true, target: { tagName: 'BODY' } }).defaultPrevented, false);
  document.openModal = element();
  assert.equal(document.press({ key: '/', target: { tagName: 'BODY' } }).defaultPrevented, false, 'a modal owns the keyboard');
  assert.equal(input.focused, false);

  input.value = '写到一半';
  const escapes = input.listeners.keydown;
  const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
  for (const handler of escapes) handler(event);
  assert.equal(input.value, '');
});

test('capture bar: the placeholder tells the truth about focus sessions and dispose removes every listener', async () => {
  const { document, input, bar } = await captureBar();
  document.body.dataset.session = 'focus';
  for (const handler of input.listeners.focus) handler();
  assert.match(input.placeholder, /不打断/);
  document.body.dataset.session = 'idle';
  for (const handler of input.listeners.focus) handler();
  assert.doesNotMatch(input.placeholder, /不打断/);
  bar.dispose();
  assert.equal((document.listeners.keydown || []).length, 0);
  assert.equal((input.listeners.keydown || []).length, 0);
});
