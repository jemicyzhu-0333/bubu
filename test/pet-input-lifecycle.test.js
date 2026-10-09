'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetPointer } = require('../src/surfaces/pet/pointer.mjs');
const { createPetMenu } = require('../src/surfaces/pet/menu.mjs');

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function scheduler() {
  let next = 0;
  const pending = new Map(), retained = [];
  return {
    pending, retained,
    schedule(callback, delay) {
      const id = ++next;
      pending.set(id, { callback, delay }); retained.push(callback);
      return id;
    },
    cancel(id) { pending.delete(id); },
    fire() {
      for (const [id, { callback }] of [...pending]) { pending.delete(id); callback(); }
    }
  };
}

function world() {
  const trace = [], elements = [], observers = [];
  let document;
  function element(name) {
    const handlers = new Map(), classes = new Set(), captures = new Set();
    const item = {
      name, handlers, dataset: {}, style: {}, attributes: {}, focusCount: 0,
      classList: {
        contains: value => classes.has(value),
        add(...values) { trace.push([name, 'add', ...values]); values.forEach(value => classes.add(value)); },
        remove(...values) { trace.push([name, 'remove', ...values]); values.forEach(value => classes.delete(value)); },
        toggle(value, active) {
          trace.push([name, 'toggle', value, active]);
          if (active) classes.add(value); else classes.delete(value);
        }
      },
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(handler);
      },
      removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
      dispatch(type, event = {}) {
        for (const handler of [...(handlers.get(type) || [])]) handler({ currentTarget: item, ...event });
      },
      setAttribute(key, value) { trace.push([name, key, value]); item.attributes[key] = value; },
      focus() { trace.push([name, 'focus']); item.focusCount++; document.activeElement = item; },
      contains(node) { return node === item || (name === 'menu' && node === command); },
      querySelector(selector) {
        if (name === 'menu' && selector.startsWith('[role')) return command;
        return null;
      },
      querySelectorAll() { return name === 'menu' ? [command] : []; },
      setPointerCapture(id) { captures.add(id); },
      hasPointerCapture(id) { return captures.has(id); },
      releasePointerCapture(id) { trace.push([name, 'release-capture', id]); captures.delete(id); }
    };
    elements.push(item);
    return item;
  }
  const window = element('window'), petHit = element('hit'), petLayer = element('layer');
  const stage = element('stage'), commandMenu = element('menu'), command = element('command');
  const feedQuick = element('feed'), foodPanel = element('food'), body = element('body');
  command.dataset.act = 'wave';
  document = Object.assign(element('document'), {
    activeElement: null, body,
    documentElement: { style: { setProperty(name, value) { trace.push(['style', name, value]); this[name] = value; } } },
    getElementById: () => null,
    querySelector: selector => selector === '#foodPanel' ? foodPanel : null,
    querySelectorAll: selector => selector === '.command-item' ? [command] : []
  });
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = 0; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected++; }
  };
  document.defaultView = window;
  const timers = scheduler(), frames = scheduler();
  const ports = {
    requestAnimationFrame: frames.schedule, cancelAnimationFrame: frames.cancel,
    setTimeout: timers.schedule, clearTimeout: timers.cancel
  };
  function listeners() {
    return elements.flatMap(item => [...item.handlers.values()].flatMap(set => [...set]));
  }
  return { trace, observers, elements, listeners, window, document, petHit, petLayer, stage,
    commandMenu, command, feedQuick, foodPanel, timers, frames, ports };
}

function menuHarness(w = world(), overrides = {}, callbackOverrides = {}) {
  const calls = [], callbacks = [], viewport = [];
  let subscriptions = 0;
  const client = {
    pet_setMenuOpen: async open => {
      calls.push(['menu', open]);
      return { width: open ? 520 : 220, height: open ? 360 : 220 };
    },
    onPetViewport(callback) {
      subscriptions++; viewport.push(callback);
      return () => { subscriptions--; };
    },
    ...overrides
  };
  const menu = createPetMenu({ ...w, ...w.ports, client, callbacks: {
    onStateChange: state => callbacks.push(['state', state]),
    reportRuntime: () => callbacks.push(['runtime']),
    onCancel: reason => callbacks.push(['cancel', reason]),
    handleClick: () => callbacks.push(['tap']),
    openCommandMenuOnce: source => callbacks.push(['command', source]),
    openFoodMenu: () => callbacks.push(['food']),
    runCommand: act => callbacks.push(['run', act]),
    ...callbackOverrides
  } });
  return { w, menu, calls, callbacks, viewport, subscriptions: () => subscriptions };
}

function pointer(overrides = {}) {
  return { pointerId: 7, isPrimary: true, button: 0, ctrlKey: false, screenX: 0, screenY: 0, ...overrides };
}

function pointerHarness(w = world(), clientOverrides = {}, callbackOverrides = {}) {
  const calls = [], callbacks = [];
  const client = {
    pet_dragStart: async () => { calls.push(['start']); },
    pet_getBounds: async () => { calls.push(['bounds']); return { x: 100, y: 80 }; },
    pet_setPosition: async (x, y) => { calls.push(['position', x, y]); },
    pet_dragEnd: async () => { calls.push(['end']); },
    pet_savePosition: async (x, y) => { calls.push(['save', x, y]); },
    pet_interaction: async action => { calls.push(['interaction', action]); return { text: 'landed' }; },
    ...clientOverrides
  };
  const owner = createPetPointer({ ...w, ...w.ports, client, callbacks: {
    onStateChange: state => callbacks.push(['state', state]),
    toggleCommandMenu: async () => { callbacks.push(['close-menu']); },
    isFoodMenuOpen: () => false,
    calmMotionRequested: () => true,
    readWallClock: () => 100,
    handleClick: () => callbacks.push(['tap']),
    openCommandMenuOnce: source => callbacks.push(['command', source]),
    say: text => callbacks.push(['say', text]),
    markInteraction: () => callbacks.push(['mark']),
    onHeldExpressionChange: id => callbacks.push(['held', id]),
    ...callbackOverrides
  } });
  function drag() {
    w.petHit.dispatch('pointerdown', pointer());
    w.petHit.dispatch('pointermove', pointer({ screenX: 30 }));
  }
  return { w, owner, calls, callbacks, drag };
}

test('menu owns injectable timeout/frame ports and releases subscription, observer and every listener once', async t => {
  const h = menuHarness(); t.after(() => h.menu.dispose());
  await h.menu.toggle(true, { focus: true });
  h.w.commandMenu.dispatch('focusout');
  assert.equal(h.w.timers.pending.size, 1, 'auto-close uses the injected timer owner');
  assert.equal(h.w.frames.pending.size, 2);
  h.menu.dispose(); h.menu.dispose();
  assert.equal(h.subscriptions(), 0, 'viewport unsubscribe is retained and invoked exactly once');
  assert.equal(h.w.timers.pending.size, 0);
  assert.equal(h.w.frames.pending.size, 0);
  assert.equal(h.w.listeners().length, 0);
  assert.ok(h.w.observers.every(observer => observer.disconnected === 1));
});

test('disposed menu callbacks and public entry points cannot touch a fresh menu on the same elements', async t => {
  const h = menuHarness(); t.after(() => h.menu.dispose());
  await h.menu.toggle(true, { focus: true });
  h.w.commandMenu.dispatch('focusout');
  const listeners = h.w.listeners(), frames = [...h.w.frames.retained], timers = [...h.w.timers.retained];
  h.menu.dispose();
  const fresh = menuHarness(h.w); t.after(() => fresh.menu.dispose());
  await fresh.menu.toggle(true);
  const before = { trace: [...h.w.trace], calls: [...h.calls], callbacks: [...h.callbacks] };
  for (const callback of frames) callback();
  for (const callback of timers) callback();
  for (const callback of listeners) callback({ currentTarget: h.w.command, key: 'Enter', preventDefault() {}, stopPropagation() {} });
  for (const observer of h.w.observers.slice(0, 2)) observer.callback();
  h.viewport[0]({ width: 999 });
  h.menu.cancel(); h.menu.dispose(); await h.menu.toggle(true); await h.menu.syncStageExpansion();
  await settle();
  assert.deepEqual({ trace: h.w.trace, calls: h.calls, callbacks: h.callbacks }, before);
  h.w.command.dispatch('click', { stopPropagation() {} });
  assert.deepEqual(fresh.callbacks.at(-1), ['run', 'wave']);
});

test('menu disposal synchronously closes owned DOM and clears geometry without native work before remount', async t => {
  const h = menuHarness(); t.after(() => h.menu.dispose());
  await h.menu.toggle(true, { focus: true, keyboard: true });
  h.w.petHit.dispatch('pointerenter');
  h.viewport[0]({ width: 520, height: 360, side: 'left', stageOffset: { x: 90, y: -40 } });
  assert.equal(h.w.commandMenu.classList.contains('show'), true);
  assert.equal(h.w.stage.classList.contains('menu-open'), true);
  assert.equal(h.w.document.documentElement.style['--stage-dx'], '90px');
  const native = [...h.calls];
  h.menu.dispose();
  assert.equal(h.w.commandMenu.classList.contains('show'), false);
  assert.equal(h.w.commandMenu.attributes['aria-hidden'], 'true');
  assert.equal(h.w.petHit.attributes['aria-expanded'], 'false');
  assert.equal(h.w.stage.classList.contains('menu-open'), false);
  for (const name of ['--stage-dx', '--stage-dy', '--pet-stage-left', '--pet-stage-top']) {
    assert.equal(h.w.document.documentElement.style[name], '', `clears owned ${name}`);
  }
  assert.equal(h.w.commandMenu.dataset.side, undefined);
  assert.deepEqual(h.menu.snapshot(), {
    commandMenuOpen: false, menuKeyboardActive: false, pointerInsidePet: false,
    stageExpanded: false, lastStageGeo: null
  });
  assert.deepEqual(h.calls, native, 'terminal cleanup does not send a native resize');
  const fresh = menuHarness(h.w); t.after(() => fresh.menu.dispose());
  assert.equal(h.w.commandMenu.classList.contains('show'), false);
  await fresh.menu.toggle(true);
  fresh.viewport[0]({ width: 520, height: 360, side: 'left', stageOffset: { x: 12, y: 7 } });
  const trace = [...h.w.trace], snapshot = fresh.menu.snapshot();
  h.menu.dispose(); h.menu.cancel(); await h.menu.toggle(false);
  assert.deepEqual(h.w.trace, trace, 'repeated disposal cannot erase the fresh owner');
  assert.deepEqual(fresh.menu.snapshot(), snapshot);
});

test('actual controller stop leaves closed command DOM for a replacement controller on the same document', async t => {
  const { createLifecycleHarness } = require('../test-support/pet-lifecycle-fixture');
  const { createPetRuntime } = require('../src/surfaces/pet/runtime.mjs');
  const { createPetSurfaceClient } = require('../src/surfaces/pet/adapter/surface-client.mjs');
  const h = createLifecycleHarness(); t.after(() => h.runtime.stop());
  await settle();
  const menu = h.document.getElementById('commandMenu'), hit = h.document.getElementById('petHit');
  hit.dispatch('contextmenu'); await settle();
  assert.equal(menu.classList.contains('show'), true);
  h.runtime.stop();
  const next = createPetRuntime({ environment: h.environment, clients: createPetSurfaceClient(h.window.focuspix) });
  t.after(() => next.stop());
  await next.start();
  assert.equal(menu.classList.contains('show'), false);
  assert.equal(menu.getAttribute('aria-hidden'), 'true');
  assert.equal(hit.getAttribute('aria-expanded'), 'false');
  hit.dispatch('contextmenu'); await settle();
  assert.equal(menu.classList.contains('show'), true);
  h.runtime.stop();
  assert.equal(menu.classList.contains('show'), true, 'old stop cannot close the replacement menu');
});

for (const opening of [true, false]) test(`menu disposal invalidates deferred ${opening ? 'open' : 'close'} geometry and completion callbacks`, async t => {
  const wait = deferred(); let block = false;
  const h = menuHarness(undefined, { pet_setMenuOpen: async open => block ? wait.promise : { width: open ? 520 : 220 } });
  t.after(() => h.menu.dispose());
  if (!opening) await h.menu.toggle(true);
  block = true;
  const request = h.menu.toggle(opening, { focus: true }); await settle();
  h.menu.dispose();
  const snapshot = h.menu.snapshot(), trace = [...h.w.trace], callbacks = [...h.callbacks];
  wait.resolve({ width: 999, height: 999 }); await request;
  assert.deepEqual(h.menu.snapshot(), snapshot, 'late native result cannot update terminal owner state');
  assert.deepEqual(h.w.trace, trace);
  assert.deepEqual(h.callbacks, callbacks);
  assert.equal(h.w.frames.pending.size, 0);
});

test('closing and reopening a live menu invalidates an earlier queued focus frame', async t => {
  const h = menuHarness(); t.after(() => h.menu.dispose());
  await h.menu.toggle(true, { focus: true });
  const oldFrame = h.w.frames.retained.at(-1);
  await h.menu.toggle(false); await h.menu.toggle(true);
  const focuses = h.w.command.focusCount;
  oldFrame();
  assert.equal(h.w.command.focusCount, focuses);
});

test('disposing a queued menu expansion before its microtask sends no native request', async () => {
  const h = menuHarness();
  const opening = h.menu.toggle(true, { focus: true });
  h.menu.dispose();
  await opening;
  assert.deepEqual(h.calls, []);
  assert.equal(h.w.frames.pending.size, 0);
  assert.equal(h.w.timers.pending.size, 0);
  assert.equal(h.subscriptions(), 0);
});

test('live menu preserves serialized native geometry, viewport updates, command delivery and timed close', async t => {
  const wait = deferred(), native = [];
  const h = menuHarness(undefined, { pet_setMenuOpen: open => {
    native.push(open); return open ? wait.promise : Promise.resolve({ width: 220, height: 220 });
  } });
  t.after(() => h.menu.dispose());
  const opening = h.menu.toggle(true, { focus: true }); await settle();
  const closing = h.menu.toggle(false);
  wait.resolve({ width: 520, height: 360, side: 'left' });
  await Promise.all([opening, closing]);
  assert.deepEqual(native, [true, false]);
  assert.equal(h.w.commandMenu.classList.contains('show'), false);
  h.viewport[0]({ width: 300, height: 240, side: 'left' });
  assert.equal(h.w.commandMenu.dataset.side, 'left');
  assert.equal(h.menu.snapshot().lastStageGeo.width, 300);
  await h.menu.toggle(true, { focus: true, keyboard: true });
  h.w.frames.fire();
  assert.equal(h.w.document.activeElement, h.w.command);
  h.w.command.dispatch('click', { stopPropagation() {} });
  assert.deepEqual(h.callbacks.at(-1), ['run', 'wave']);
  h.w.timers.fire(); await settle();
  assert.equal(h.menu.snapshot().commandMenuOpen, false);
});

test('pointer terminal disposal cancels its timer and rejects retained listeners and repeated cancel', t => {
  const h = pointerHarness(); t.after(() => h.owner.dispose());
  h.w.petHit.dispatch('pointerdown', pointer());
  assert.equal(h.w.timers.pending.size, 1);
  const listeners = h.w.listeners(), timers = [...h.w.timers.retained];
  h.owner.dispose();
  assert.equal(h.w.timers.pending.size, 0);
  assert.equal(h.w.listeners().length, 0);
  assert.equal(h.w.petHit.hasPointerCapture(7), false);
  const before = { trace: [...h.w.trace], calls: [...h.calls], callbacks: [...h.callbacks] };
  for (const callback of listeners) callback(pointer({ screenX: 50 }));
  for (const callback of timers) callback();
  h.owner.cancel(); h.owner.dispose();
  assert.deepEqual({ trace: h.w.trace, calls: h.calls, callbacks: h.callbacks }, before);
  assert.equal(h.w.timers.pending.size, 0);
});

for (const stage of ['menu', 'food', 'native-start', 'bounds']) {
  test(`pointer disposal blocks drag-start continuation after deferred ${stage}`, async t => {
    const wait = deferred(), late = [];
    const h = pointerHarness(undefined, {
      pet_dragStart: async () => { late.push('start'); if (stage === 'native-start') await wait.promise; },
      pet_getBounds: async () => { late.push('bounds'); return stage === 'bounds' ? wait.promise : { x: 100, y: 80 }; }
    }, {
      toggleCommandMenu: async () => { if (stage === 'menu') await wait.promise; },
      isFoodMenuOpen: () => { late.push('food-open'); return true; },
      closeFoodMenu: async () => { late.push('close-food'); if (stage === 'food') await wait.promise; }
    });
    t.after(() => h.owner.dispose());
    h.drag(); await settle(); h.owner.dispose();
    const before = { late: [...late], calls: [...h.calls], callbacks: [...h.callbacks], trace: [...h.w.trace] };
    wait.resolve({ x: 999, y: 999 }); await settle();
    assert.deepEqual({ late, calls: h.calls, callbacks: h.callbacks, trace: h.w.trace }, before);
  });
}

for (const stage of ['position', 'native-end', 'bounds', 'fling']) {
  test(`pointer disposal blocks drag-end continuation after deferred ${stage}`, async t => {
    const wait = deferred(), late = []; let boundsCount = 0;
    const h = pointerHarness(undefined, {
      pet_getBounds: async () => {
        late.push('bounds'); boundsCount++;
        return stage === 'bounds' && boundsCount > 1 ? wait.promise : { x: 100, y: 80 };
      },
      pet_setPosition: async () => { late.push('position'); if (stage === 'position') await wait.promise; },
      pet_dragEnd: async () => { late.push('end'); if (stage === 'native-end') await wait.promise; },
      pet_interaction: async () => { late.push('fling'); return stage === 'fling' ? wait.promise : {}; }
    });
    t.after(() => h.owner.dispose());
    h.drag(); await settle();
    h.w.petHit.dispatch('pointermove', pointer({ screenX: 35 }));
    h.w.petHit.dispatch('pointerup', pointer({ screenX: 35 })); await settle();
    h.owner.dispose();
    const before = { late: [...late], calls: [...h.calls], callbacks: [...h.callbacks], trace: [...h.w.trace] };
    wait.resolve({ x: 999, y: 999, text: 'old fling' }); await settle();
    assert.deepEqual({ late, calls: h.calls, callbacks: h.callbacks, trace: h.w.trace }, before);
    assert.equal(h.w.frames.pending.size, 0);
  });
}

for (const stage of ['native-start', 'position', 'native-end', 'bounds']) {
  test(`pointer disposal releases exactly its owned host drag while ${stage} is pending`, async t => {
    const wait = deferred(); let hostDragging = false, starts = 0, ends = 0, bounds = 0;
    const client = {
      pet_dragStart() { starts++; hostDragging = true; return stage === 'native-start' && starts === 1 ? wait.promise : Promise.resolve(); },
      pet_dragEnd() { ends++; hostDragging = false; return stage === 'native-end' && ends === 1 ? wait.promise : Promise.resolve(); },
      pet_getBounds() { bounds++; return stage === 'bounds' && bounds === 2 ? wait.promise : Promise.resolve({ x: 100, y: 80 }); },
      pet_setPosition: () => stage === 'position' ? wait.promise : Promise.resolve()
    };
    const h = pointerHarness(undefined, client); t.after(() => h.owner.dispose());
    h.drag(); await settle();
    assert.equal(hostDragging, true);
    if (stage !== 'native-start') {
      h.w.petHit.dispatch('pointermove', pointer({ screenX: 35 }));
      h.w.petHit.dispatch('pointerup', pointer({ screenX: 35 })); await settle();
    }
    h.owner.dispose();
    assert.equal(hostDragging, false, 'synchronous terminal release balances the native drag');
    assert.equal(ends, 1, 'does not resend end when its acknowledgement or bounds are pending');
    const fresh = pointerHarness(h.w, client); t.after(() => fresh.owner.dispose());
    fresh.drag(); await settle();
    assert.equal(hostDragging, true);
    const before = { calls: [...h.calls], callbacks: [...h.callbacks] };
    h.owner.dispose(); h.owner.cancel(); wait.resolve({ x: 777, y: 888 }); await settle();
    assert.equal(hostDragging, true, 'old completion and repeated disposal cannot release the new drag');
    assert.equal(ends, 1);
    assert.deepEqual({ calls: h.calls, callbacks: h.callbacks }, before);
    fresh.owner.dispose();
    assert.equal(hostDragging, false);
    assert.equal(ends, 2);
  });
}

test('old pointer RAF and callbacks cannot take over a freshly mounted pointer owner', async t => {
  const old = pointerHarness(); t.after(() => old.owner.dispose());
  old.drag(); await settle();
  old.w.petHit.dispatch('pointermove', pointer({ screenX: 35 }));
  const frames = [...old.w.frames.retained], listeners = old.w.listeners();
  old.owner.dispose();
  assert.equal(old.w.frames.pending.size, 0);
  const fresh = pointerHarness(old.w); t.after(() => fresh.owner.dispose());
  fresh.drag(); await settle();
  fresh.w.petHit.dispatch('pointermove', pointer({ screenX: 40 }));
  const before = { calls: [...old.calls], callbacks: [...old.callbacks], trace: [...old.w.trace] };
  frames.forEach(callback => callback());
  listeners.forEach(callback => callback(pointer({ screenX: 99 })));
  old.owner.cancel(); old.owner.dispose();
  assert.deepEqual({ calls: old.calls, callbacks: old.callbacks, trace: old.w.trace }, before);
  fresh.w.frames.fire();
  assert.deepEqual(fresh.calls.at(-1), ['position', 110, 80]);
  fresh.w.petHit.dispatch('pointerup', pointer({ screenX: 40 })); await settle();
  assert.deepEqual(fresh.calls.slice(-3), [['end'], ['bounds'], ['save', 100, 80]]);
});

test('live pointer retains tap, command, drag position/end/save and fling receipts', async t => {
  const h = pointerHarness(); t.after(() => h.owner.dispose());
  h.w.petHit.dispatch('pointerdown', pointer()); h.w.petHit.dispatch('pointerup', pointer());
  assert.ok(h.callbacks.some(entry => entry[0] === 'tap'));
  h.w.petHit.dispatch('pointerdown', pointer({ ctrlKey: true }));
  assert.ok(h.callbacks.some(entry => entry[0] === 'command' && entry[1] === 'control-click'));
  h.drag(); await settle();
  h.w.petHit.dispatch('pointermove', pointer({ screenX: 35 }));
  h.w.petHit.dispatch('pointerup', pointer({ screenX: 35 })); await settle();
  assert.deepEqual(h.calls, [
    ['start'], ['bounds'], ['interaction', 'fling'], ['position', 105, 80],
    ['end'], ['bounds'], ['save', 100, 80]
  ]);
  assert.ok(h.callbacks.some(entry => entry[0] === 'say' && entry[1] === 'landed'));
  assert.equal(h.callbacks.at(-1)[0], 'mark');
});

test('a disposed menu settles a rejected native expansion without publishing or reviving its queue', async t => {
  const wait = deferred();
  const h = menuHarness(undefined, { pet_setMenuOpen: () => wait.promise });
  t.after(() => h.menu.dispose());
  const opening = h.menu.toggle(true); await settle(); h.menu.dispose();
  const before = [...h.callbacks];
  wait.reject(new Error('closed native window'));
  await assert.doesNotReject(opening);
  assert.deepEqual(h.callbacks, before);
});

for (const ending of [false, true]) test(`disposed pointer consumes rejected drag-${ending ? 'end' : 'start'} continuations`, async t => {
  const wait = deferred();
  const h = pointerHarness(undefined, {
    [ending ? 'pet_dragEnd' : 'pet_dragStart']: () => wait.promise
  });
  t.after(() => h.owner.dispose());
  h.drag(); await settle();
  if (ending) { h.w.petHit.dispatch('pointerup', pointer({ screenX: 30 })); await settle(); }
  h.owner.dispose();
  const before = { calls: [...h.calls], callbacks: [...h.callbacks] };
  wait.reject(new Error('closed native window')); await settle();
  assert.deepEqual({ calls: h.calls, callbacks: h.callbacks }, before);
});

test('cancelled live menu timers and pointer press timers cannot consume a newer gesture', async t => {
  const menu = menuHarness(); t.after(() => menu.menu.dispose());
  await menu.menu.toggle(true);
  const oldClose = menu.w.timers.retained.at(-1);
  menu.w.petHit.dispatch('pointerenter');
  oldClose(); await settle();
  assert.equal(menu.menu.snapshot().commandMenuOpen, true);
  assert.equal(menu.w.timers.pending.size, 1);
  const h = pointerHarness(); t.after(() => h.owner.dispose());
  h.w.petHit.dispatch('pointerdown', pointer());
  const oldPress = h.w.timers.retained.at(-1);
  h.w.petHit.dispatch('pointerup', pointer());
  h.w.petHit.dispatch('pointerdown', pointer());
  const before = [...h.callbacks]; oldPress();
  assert.deepEqual(h.callbacks, before);
  assert.equal(h.w.timers.pending.size, 1);
});

for (const action of ['command', 'food', 'timeout', 'cancel']) {
  test(`menu ${action} event boundary consumes rejected asynchronous work`, async t => {
    const wait = deferred();
    const h = menuHarness(undefined, {
      pet_setMenuOpen: open => open ? Promise.resolve({ width: 520 }) : wait.promise
    }, { runCommand: () => wait.promise, openFoodMenu: () => wait.promise });
    t.after(() => h.menu.dispose());
    await h.menu.toggle(true);
    if (action === 'command') h.w.command.dispatch('click', { stopPropagation() {} });
    else if (action === 'food') h.w.feedQuick.dispatch('click', { stopPropagation() {} });
    else if (action === 'timeout') h.w.timers.fire();
    else h.menu.cancel();
    await settle();
    if (action === 'command' || action === 'food') h.menu.dispose();
    wait.reject(new Error('native request rejected')); await settle();
    assert.equal(h.w.timers.pending.size, 0);
  });
}
