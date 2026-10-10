'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { registerImpulseWindowIpc } = require('../src/platform/electron/windows/impulse-window');

function node() {
  const events = new Map();
  return { style: {}, scrollTop: 0, scrollHeight: 42,
    addEventListener: (type, fn) => events.set(type, fn),
    removeEventListener: type => events.delete(type),
    emit: (type, event = {}) => events.get(type)?.(event) };
}
async function harness() {
  const { createQuickPanelLayout } = await import('../src/surfaces/impulse/panel-layout.mjs');
  const input = node();
  let submits = 0;
  let bodyHeight = 100;
  const content = { getBoundingClientRect: () => ({ height: bodyHeight }) };
  const nodes = { impInput: input, quickContent: content, quickShell: {}, impulseForm: { requestSubmit: () => submits++ } };
  const timers = new Map();
  let next = 0;
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.closed = true; }
  }
  const window = Object.assign(node(), {
    setTimeout: fn => { timers.set(++next, fn); return next; },
    clearTimeout: id => timers.delete(id),
    getComputedStyle: () => ({ paddingTop: '16px', paddingBottom: '16px', borderTopWidth: '1px', borderBottomWidth: '1px' }),
    MutationObserver: Observer, ResizeObserver: Observer
  });
  const sizes = [];
  const layout = createQuickPanelLayout({ window, document: { getElementById: id => nodes[id] },
    client: { resizeImpulse: height => { sizes.push(height); return Promise.resolve({ ok: true }); } } });
  layout.mount();
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { input, window, sizes, layout, observers, flush, timers,
    setHeight: value => { bodyHeight = value; }, submits: () => submits };
}

test('natural content measurement coalesces, grows, shrinks and deduplicates feedback', async () => {
  const h = await harness();
  h.flush();
  assert.deepEqual(h.sizes, [134]);
  assert.equal(h.input.style.height, '42px');
  h.input.scrollHeight = 108;
  h.input.emit('input'); h.input.emit('input'); h.observers[0].callback();
  assert.equal(h.timers.size, 1);
  h.setHeight(166); h.flush();
  assert.equal(h.input.style.height, '108px');
  assert.deepEqual(h.sizes, [134, 200]);
  h.observers[1].callback(); h.flush();
  assert.deepEqual(h.sizes, [134, 200], 'observer feedback does not resize again');
  h.input.scrollHeight = 500; h.input.scrollTop = 200;
  h.input.emit('input'); h.setHeight(188); h.flush();
  assert.equal(h.input.style.height, '130px');
  assert.equal(h.input.scrollTop, 200);
  // Receipt clears value programmatically; its DOM mutation must shrink the input.
  h.input.scrollHeight = 42; h.observers[0].callback(); h.setHeight(100); h.flush();
  assert.equal(h.input.style.height, '42px');
  assert.equal(h.sizes.at(-1), 134);
  h.window.emit('focus'); h.flush();
  assert.equal(h.sizes.at(-1), 134);
  assert.equal(h.sizes.length, 5, 'reopen sends fresh measurement even at same height');
  h.input.emit('input'); h.layout.dispose(); h.flush();
  assert.equal(h.timers.size, 0);
  assert.ok(h.observers.every(observer => observer.closed));
});

test('textarea Enter submits exactly once while Shift+Enter and IME stay in the draft', async () => {
  const h = await harness();
  const enter = extra => ({ key: 'Enter', preventDefault() { this.prevented = true; }, ...extra });
  for (const event of [enter({ shiftKey: true }), enter({ isComposing: true }), enter({ keyCode: 229 })]) {
    h.input.emit('keydown', event);
    assert.equal(event.prevented, undefined);
  }
  h.input.emit('compositionstart'); h.input.emit('keydown', enter({}));
  assert.equal(h.submits(), 0);
  h.input.emit('compositionend');
  const event = enter({}); h.input.emit('keydown', event);
  assert.equal(event.prevented, true);
  assert.equal(h.submits(), 1);
  h.layout.dispose();
});

test('resize IPC is a closed impulse-only integer-height contract', () => {
  assert.deepEqual(allowedSurfacesFor('impulse:resize'), ['impulse']);
  for (const height of [1, 130, 620, 4096]) assert.equal(validateIpcPayload('impulse:resize', { height }).ok, true);
  for (const payload of [null, {}, { height: 0 }, { height: -1 }, { height: 4097 }, { height: NaN },
    { height: Infinity }, { height: 1.5 }, { height: '200' }, { height: 200, width: 480 }, { height: 200, target: 'pet' }]) {
    assert.equal(validateIpcPayload('impulse:resize', payload).ok, false);
  }
});

test('registered resize forwards exact sender to the live impulse window only', () => {
  const routes = new Map();
  const calls = [];
  const event = { sender: {} };
  const payload = { height: 330 };
  let host = { resizeContent: (sender, size) => { calls.push([sender, size]); return { ok: true }; } };
  registerImpulseWindowIpc({ registerIpc: (name, handler) => routes.set(name, handler), open() {}, hide() {}, getWindow: () => host });
  assert.deepEqual(routes.get('impulse:resize')(event, payload), { ok: true });
  assert.deepEqual(calls, [[event, payload]]);
  host = null;
  assert.deepEqual(routes.get('impulse:resize')(event, payload), { ok: false });
});
