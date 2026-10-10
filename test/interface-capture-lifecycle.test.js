const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = name => import(pathToFileURL(path.join(__dirname, '..', name)).href);
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

test('capture locale repaint preserves focused input, pending save identity and feedback expiry', async context => {
  const { setLocale, getLocale } = await load('src/surfaces/shared/interface/i18n.mjs');
  const before = getLocale(); context.after(() => setLocale(before));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  setLocale('zh-CN');
  let finish, writes = 0;
  const h = await captureBar({ addImpulse: () => { writes++; return new Promise(resolve => { finish = resolve; }); } });
  context.after(() => h.bar.dispose());
  h.document.body.dataset.session = 'focus';
  h.input.value = '设置 {minutes}'; h.input.focus();
  const pending = h.bar.submit();
  setLocale('en'); await h.bar.submit();
  assert.equal(writes, 1); assert.equal(h.input.value, '设置 {minutes}'); assert.equal(h.input.focused, true);
  assert.match(h.input.placeholder, /without interrupting focus/);
  finish({ ok: false }); await pending;
  assert.match(h.status.textContent, /Could not save/);
  context.mock.timers.tick(2000); setLocale('zh-CN');
  assert.match(h.status.textContent, /没存上/); assert.equal(h.input.value, '设置 {minutes}');
  context.mock.timers.tick(600); assert.equal(h.status.textContent, '', 'locale change does not extend the original receipt expiry');
  h.bar.dispose(); const placeholder = h.input.placeholder; setLocale('en'); assert.equal(h.input.placeholder, placeholder);
});

test('session-step copy is resolved by its status owner without replaying an in-flight append', async context => {
  const { setLocale, getLocale, t, onLocaleChanged } = await load('src/surfaces/shared/interface/i18n.mjs');
  const { createSessionStep } = await load('src/surfaces/popover/features/session-step.mjs');
  const before = getLocale(); context.after(() => setLocale(before)); setLocale('zh-CN');
  const document = fakeDocument(), $ = selector => document.querySelector(selector);
  let finish, calls = [], statusSource = '', status = '';
  const repaint = () => { status = t(statusSource); };
  const stop = onLocaleChanged(repaint); context.after(stop);
  const feature = createSessionStep({ $, getSession: () => ({ mode: 'focus', taskId: 'task', running: true }),
    surfaceClient: { updateTask: (...args) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); } },
    showStatus: source => { statusSource = source; repaint(); } });
  feature.mount(); context.after(() => feature.dispose()); feature.render({ id: 'task' });
  const input = $('#sessionStepInput'); input.value = '设置 {minutes}'; input.focus();
  const submit = $('#sessionStepForm').listeners.submit[0];
  const pending = submit({ preventDefault() {} }); setLocale('en'); await submit({ preventDefault() {} });
  assert.equal(calls.length, 1); assert.equal(input.value, '设置 {minutes}'); assert.equal(input.focused, true);
  assert.deepEqual(calls[0], ['task', { steps: [{ op: 'add', title: '设置 {minutes}' }] }, 'current']);
  finish({ ok: false }); await pending;
  assert.equal(status, 'Not added: the task changed. Try again.');
  setLocale('zh-CN'); assert.equal(status, '没有添加：任务状态已变化，请重试。');
  assert.equal(input.value, '设置 {minutes}');
});

test('capture teardown prevents a late commit receipt from changing old controls or starting a timer', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const h = await captureBar({ addImpulse: () => new Promise(resolve => { finish = resolve; }) });
  h.input.value = 'retained draft'; const pending = h.bar.submit(); h.bar.dispose();
  finish({ ok: true }); await pending;
  assert.equal(h.input.value, 'retained draft'); assert.equal(h.status.textContent, '');
  context.mock.timers.tick(10000); assert.equal(h.status.textContent, '');
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/renderer/popover.mjs'), 'utf8');
  assert.match(source, /const captureBar = createPopoverCaptureBar\(/);
  assert.match(source, /const features = \[[^\]]*\bcaptureBar\b/);
});

test('capture receipts preserve a newer draft and only explicit resubmission sends it', async context => {
  const pending = [], sent = [];
  const h = await captureBar({ addImpulse: text => {
    sent.push(text); return new Promise(resolve => pending.push(resolve));
  } });
  context.after(() => h.bar.dispose());
  h.input.value = 'first capture'; const first = h.bar.submit();
  h.input.value = 'new unsent draft'; h.input.listeners.input[0]();
  await h.bar.submit(); assert.deepEqual(sent, ['first capture'], 'repeated submit while busy sends nothing');
  pending.shift()({ ok: true }); await first;
  assert.equal(h.input.value, 'new unsent draft');
  const retry = h.bar.submit();
  pending.shift()({ ok: false }); await retry;
  assert.equal(h.input.value, 'new unsent draft');
  const final = h.bar.submit(); pending.shift()({ ok: true }); await final;
  assert.equal(h.input.value, '');
  assert.deepEqual(sent, ['first capture', 'new unsent draft', 'new unsent draft']);
});

test('capture receipt does not clear an edited-back draft or text typed after Escape', async context => {
  for (const cancel of [false, true]) {
    let finish;
    const h = await captureBar({ addImpulse: () => new Promise(resolve => { finish = resolve; }) });
    context.after(() => h.bar.dispose());
    h.input.value = 'same words'; const saving = h.bar.submit();
    if (cancel) h.input.listeners.keydown[0]({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    else { h.input.value = 'different words'; h.input.listeners.input[0](); }
    h.input.value = 'same words'; h.input.listeners.input[0]();
    finish({ ok: true }); await saving;
    assert.equal(h.input.value, 'same words');
  }
});

test('session-step success retains a newer draft and cannot close a reopened form', async context => {
  const { createSessionStep } = await load('src/surfaces/popover/features/session-step.mjs');
  const document = fakeDocument(), $ = selector => document.querySelector(selector);
  let finish, calls = 0;
  const feature = createSessionStep({ $, getSession: () => ({ mode: 'focus', taskId: 'task', running: true }),
    surfaceClient: { updateTask: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }, showStatus() {} });
  feature.mount(); context.after(() => feature.dispose()); feature.render({ id: 'task' });
  const click = id => $(id).listeners.click[0]();
  const submit = () => $('#sessionStepForm').listeners.submit[0]({ preventDefault() {} });
  click('#btnAddSessionStep'); $('#sessionStepInput').value = 'first'; const first = submit();
  $('#sessionStepInput').value = 'second'; finish({ ok: true }); await first;
  assert.equal($('#sessionStepInput').value, 'second'); assert.equal($('#sessionStepForm').classList.contains('hidden'), false);
  const second = submit(); click('#cancelSessionStep'); click('#btnAddSessionStep');
  $('#sessionStepInput').value = 'third'; finish({ ok: true }); await second;
  assert.equal($('#sessionStepInput').value, 'third'); assert.equal($('#sessionStepForm').classList.contains('hidden'), false);
  assert.equal(calls, 2);
});
