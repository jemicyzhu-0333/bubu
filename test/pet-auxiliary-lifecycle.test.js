'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetDevtools } = require('../src/surfaces/pet/devtools.mjs');
const { createNotebookVisit } = require('../src/surfaces/pet/notebook-visit.mjs');
const { createPetFoodMenu } = require('../src/surfaces/pet/food-menu.mjs');
const { createPetFeeding } = require('../src/surfaces/pet/feeding.mjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function scheduler() {
  let id = 0;
  const timeouts = new Map(), intervals = new Map(), frames = new Map();
  const add = map => callback => { const key = ++id; map.set(key, callback); return key; };
  return { timeouts, intervals, frames,
    setTimeout: add(timeouts), clearTimeout: key => timeouts.delete(key),
    setInterval: add(intervals), clearInterval: key => intervals.delete(key),
    requestFrame: add(frames), cancelFrame: key => frames.delete(key) };
}
function element() {
  const listeners = new Map(), classes = new Set();
  const node = { children: [], dataset: {}, style: {}, attributes: {}, focusCount: 0,
    classList: { add: (...keys) => keys.forEach(key => classes.add(key)),
      remove: (...keys) => keys.forEach(key => classes.delete(key)), contains: key => classes.has(key),
      toggle: (key, value) => value ? classes.add(key) : classes.delete(key) },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    handlers: type => [...(listeners.get(type) || [])],
    dispatch(type) { return Promise.all(node.handlers(type).map(fn => fn({ target: node, stopPropagation() {} }))); },
    setAttribute(key, value) { node.attributes[key] = value; },
    appendChild(child) { child.parent = node; node.children.push(child); return child; },
    append(...children) { children.forEach(child => node.appendChild(child)); },
    replaceChildren(...children) { node.children = []; node.append(...children); },
    remove() { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); },
    focus() { node.focusCount++; }, querySelector() { return null; }, closest() { return null; } };
  Object.defineProperty(node, 'innerHTML', { set() { node.replaceChildren(); }, get() { return ''; } });
  return node;
}
function dom() {
  const nodes = new Map(), view = element();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const document = { body: element(), defaultView: view, createElement: element,
    getElementById: get, querySelector: selector => get(selector) };
  return { document, get, view };
}
function devtoolsFixture(schedules = scheduler()) {
  const { document, get } = dom(), panel = get('panel'), list = get('list');
  const actions = Object.fromEntries(['close', 'all', 'play-all', 'clear'].map(key => [key, element()]));
  panel.querySelector = selector => actions[selector.match(/"([^"]+)"/)[1]];
  const previews = [], changes = [], clears = [];
  const devtools = createPetDevtools({ document, panel, list, ...schedules,
    callbacks: { preview: value => previews.push(value), clear: () => clears.push(true), onStateChange: value => changes.push(value) } });
  const catalog = { actions: [{ id: 'one' }, { id: 'two' }] };
  devtools.setCatalog(catalog);
  return { devtools, panel, list, actions, previews, changes, clears, catalog, schedules,
    buttons: () => list.children.flatMap(section => section.children[1].children) };
}
const FOODS = { basic: { name: 'Basic', emoji: '', satiation: 30 }, berry: { name: 'Berry', emoji: '', satiation: 10 } };
const snapshot = () => ({ satiation: 40, foodInventory: { berry: 2 }, totalFeeds: 0, basicMeal: { remaining: 3, eligible: true } });
function menuFixture(overrides = {}) {
  const { document, get } = dom(), schedules = scheduler();
  let reads = 0, send = async () => ({ ok: true }), read = async () => snapshot();
  const sent = [], opened = [], focused = [], changed = [], shown = [], speech = [];
  const menu = createPetFoodMenu({ document, content: () => ({ FOODS }), ...schedules,
    client: { pet_getFeedState: () => { reads++; return read(); }, pet_feed: request => { sent.push(request); return send(request); } },
    setOpen: value => opened.push(value), available: () => true, beforeOpen: () => menu.feed.cancel('menu-open'),
    closeCommandMenu: async () => {}, expand: async () => ({ side: 'right' }), changed: () => changed.push(true),
    focusReturn: () => focused.push(true), updateSatBar() {},
    feeding: { clock: { read: () => 0 }, now: () => 1000, nonce: () => `menu-${sent.length}`,
      present: value => shown.push(value), say: value => speech.push(value) }, ...overrides });
  return { menu, get, schedules, sent, opened, focused, changed, shown, speech, reads: () => reads,
    setRead: value => { read = value; }, setSend: value => { send = value; },
    button: id => get('foodList').children.find(node => node.dataset.food === id) };
}
function feedingFixture(overrides = {}) {
  const schedules = scheduler(), sent = [], shown = [], rendered = [], spoken = [], busy = [], accepted = [], actions = [];
  let send = async () => ({ ok: true, animation: 'happy' }), read = async () => snapshot(), reads = 0, speechCancelled = 0;
  const feeding = createPetFeeding({ client: { pet_feed: request => { sent.push(request); return send(request); } },
    content: () => ({ FOODS }), clock: { read: () => 0 }, now: () => 1000, nonce: () => `feed-${sent.length}`,
    refresh: () => { reads++; return read(); }, present: value => shown.push(value), render: value => rendered.push(value),
    say: value => { spoken.push(value); return () => { speechCancelled++; }; },
    onBusyChanged: () => busy.push(true), onFeedAccepted: value => accepted.push(value),
    presentAction: () => { actions.push('start'); return () => actions.push('cancel'); },
    scheduleReaction: schedules.setTimeout, clearReaction: schedules.clearTimeout, ...overrides });
  return { feeding, schedules, sent, shown, rendered, spoken, busy, accepted, actions, reads: () => reads,
    speechCancelled: () => speechCancelled, setRead: value => { read = value; }, setSend: value => { send = value; } };
}

test('devtools releases replaced buttons and all terminal listeners without restarting', async () => {
  const h = devtoolsFixture(), old = h.buttons()[0], captured = old.handlers('click')[0];
  h.devtools.setCatalog(h.catalog);
  assert.equal(old.handlers('click').length, 0);
  captured({}); assert.equal(h.previews.length, 0);
  h.devtools.open(); h.devtools.close(); h.devtools.open(); assert.equal(h.devtools.isOpen, true);
  const current = h.buttons()[0], late = current.handlers('click')[0];
  h.devtools.dispose(); h.devtools.dispose();
  assert.equal(h.devtools.isOpen, false); assert.equal(h.panel.classList.contains('show'), false);
  for (const button of [...Object.values(h.actions), current]) assert.equal(button.handlers('click').length, 0);
  const before = [...h.changes];
  h.devtools.open(); h.devtools.toggle(); h.devtools.close(); h.devtools.setCatalog(h.catalog); late({});
  await h.actions.clear.dispatch('click');
  assert.deepEqual(h.changes, before); assert.equal(h.previews.length, 0); assert.equal(h.clears.length, 0);
});

test('devtools disposal clears and settles every play-all wait, with stale timer callbacks inert', async t => {
  const schedules = scheduler();
  // The characterization also catches the old ambient scheduler without waiting in real time.
  t.mock.method(globalThis, 'setTimeout', schedules.setTimeout);
  t.mock.method(globalThis, 'clearTimeout', schedules.clearTimeout);
  const h = devtoolsFixture(schedules);
  const first = h.actions['play-all'].dispatch('click'), second = h.actions['play-all'].dispatch('click');
  assert.equal(h.previews.length, 2); assert.equal(schedules.timeouts.size, 2);
  const late = [...schedules.timeouts.values()];
  h.devtools.dispose(); h.devtools.dispose();
  assert.equal(schedules.timeouts.size, 0);
  late.forEach(fn => fn()); await Promise.all([first, second]); await settle();
  assert.equal(h.previews.length, 2); assert.equal(schedules.timeouts.size, 0);
});

test('notebook disposal detaches pagehide, clears owned work, and is terminal', () => {
  const { document, get, view } = dom(), schedules = scheduler(), actions = [], stops = [];
  const notebook = createNotebookVisit({ document, ...schedules, calm: () => false,
    startAction: id => actions.push(id), stopAction: () => stops.push(true) });
  notebook.handle({ id: 'system.notebook-saved', at: 1 });
  const late = [...schedules.timeouts.values()][0];
  assert.equal(view.handlers('pagehide').length, 1);
  notebook.dispose(); notebook.dispose();
  assert.equal(view.handlers('pagehide').length, 0);
  assert.equal(schedules.timeouts.size, 0); assert.equal(schedules.intervals.size, 0);
  assert.equal(get('#stage').children.length, 0); assert.equal(document.body.dataset.notebook, undefined);
  late(); assert.equal(notebook.handle({ id: 'system.notebook-ready', at: 2 }), false);
  assert.deepEqual(actions, ['take-note']); assert.equal(stops.length, 1);
});

test('notebook replaced callbacks cannot change a newer phase or restart a repeating action', () => {
  const { document } = dom(), schedules = scheduler(), actions = [];
  const notebook = createNotebookVisit({ document, ...schedules, calm: () => false, startAction: id => actions.push(id), stopAction() {} });
  notebook.handle({ id: 'system.notebook-saved', at: 1 });
  const lateSaved = [...schedules.timeouts.values()][0];
  notebook.handle({ id: 'system.notebook-depart', at: 2 }); lateSaved();
  assert.equal(document.body.dataset.notebook, 'depart'); assert.equal(schedules.intervals.size, 0);
  notebook.handle({ id: 'system.notebook-ready', at: 3 });
  const lateRepeat = [...schedules.intervals.values()][0];
  notebook.handle({ id: 'system.notebook-arrive', at: 4 }); lateRepeat();
  assert.deepEqual(actions, ['take-note', 'take-note']); notebook.dispose();
});

test('food-menu removes replaced and closed button handlers while retaining reopen behavior', async () => {
  const h = menuFixture(); await h.menu.open();
  const old = h.button('berry'), late = old.handlers('click')[0];
  h.menu.update({ ...snapshot(), foodInventory: { berry: 3 } });
  assert.equal(old.handlers('click').length, 0);
  late({ stopPropagation() {} }); assert.equal(h.sent.length, 0);
  const closed = h.button('berry'), lateClosed = closed.handlers('click')[0];
  await h.menu.close(); assert.equal(closed.handlers('click').length, 0);
  lateClosed({ stopPropagation() {} }); assert.equal(h.sent.length, 0);
  await h.menu.open(); await h.button('berry').dispatch('click'); await settle();
  assert.equal(h.sent.length, 1); h.menu.dispose();
});

test('food-menu disposal cancels the focus frame, removes handlers, and never reopens', async () => {
  const h = menuFixture(); await h.menu.open();
  const button = h.button('berry'), lateClick = button.handlers('click')[0], lateFrame = [...h.schedules.frames.values()][0];
  h.menu.dispose(); h.menu.dispose();
  assert.equal(h.schedules.frames.size, 0); assert.equal(button.handlers('click').length, 0);
  assert.equal(h.get('foodPanel').classList.contains('show'), false);
  const counts = [h.opened.length, h.changed.length, h.reads()];
  lateFrame(); lateClick({ stopPropagation() {} });
  h.menu.update(snapshot()); h.menu.render(); await h.menu.open(); await h.menu.close();
  assert.deepEqual([h.opened.length, h.changed.length, h.reads()], counts);
  assert.equal(h.sent.length, 0); assert.equal(h.get('foodClose').focusCount, 0); assert.deepEqual(h.focused, []);
});

for (const phase of ['read', 'command-menu', 'expand']) test(`food-menu disposal during pending ${phase} leaves late continuations inert`, async () => {
  const pending = deferred(), overrides = {};
  if (phase === 'command-menu') overrides.closeCommandMenu = () => pending.promise;
  if (phase === 'expand') overrides.expand = () => pending.promise;
  const h = menuFixture(overrides);
  if (phase === 'read') h.setRead(() => pending.promise);
  const opening = h.menu.open(); await settle();
  h.menu.dispose(); const counts = [h.opened.length, h.changed.length, h.reads()];
  pending.resolve(phase === 'read' ? snapshot() : { side: 'left' }); await opening;
  await h.menu.open();
  assert.deepEqual([h.opened.length, h.changed.length, h.reads()], counts);
  assert.equal(h.schedules.frames.size, 0); assert.equal(h.get('foodPanel').classList.contains('show'), false);
  assert.equal(h.get('foodList').children.length, 0);
});

test('feeding disposal preserves an already-sent canonical receipt while suppressing all late effects', async () => {
  const h = feedingFixture(), pending = deferred(); h.setSend(() => pending.promise);
  const operation = h.feeding.feedPet('berry'), request = h.sent[0];
  h.feeding.dispose(); h.feeding.dispose(); assert.equal(h.feeding.busy('berry'), true);
  const result = { ok: true, animation: 'happy', reaction: 'late receipt' };
  pending.resolve(result); assert.equal(await operation, result); assert.equal(h.sent[0], request);
  assert.equal(h.feeding.busy('berry'), false); assert.equal(h.feeding.pending('berry'), false);
  assert.equal(h.busy.length, 1); assert.equal(h.reads(), 0);
  assert.deepEqual(h.accepted, []); assert.deepEqual(h.shown, []); assert.deepEqual(h.spoken, []);
  assert.deepEqual(await h.feeding.feedPet('berry'), { ignored: true }); assert.equal(h.sent.length, 1);
  assert.equal(h.feeding.start('happy', 'berry'), false);
  assert.equal(h.feeding.presentMeal({ automatic: true, foodId: 'berry' }), false);
  assert.equal(h.feeding.advance(), false); assert.equal(h.feeding.reconcile(), false);
});

test('feeding disposal invalidates a pending post-receipt read without changing its successful result', async () => {
  const h = feedingFixture(), pending = deferred(), result = { ok: true, animation: 'happy' };
  h.setSend(async () => result); h.setRead(() => pending.promise);
  const operation = h.feeding.feedPet('berry'); await settle(); assert.equal(h.reads(), 1);
  h.feeding.dispose(); const count = h.shown.length;
  pending.resolve(snapshot()); assert.equal(await operation, result);
  assert.equal(h.rendered.length, 0); assert.equal(h.shown.length, count);
});

test('feeding terminal disposal clears delayed reactions and owned speech once', () => {
  for (const speakFirst of [false, true]) {
    const h = feedingFixture();
    h.feeding.presentMeal({ automatic: true, foodId: 'berry', reaction: 'owned', animation: 'happy' });
    const late = [...h.schedules.timeouts.values()][0];
    if (speakFirst) { h.schedules.timeouts.clear(); late(); }
    h.feeding.dispose(); h.feeding.dispose(); const count = h.spoken.length;
    late(); assert.equal(h.spoken.length, count); assert.equal(h.schedules.timeouts.size, 0);
    assert.equal(h.speechCancelled(), speakFirst ? 1 : 0); assert.deepEqual(h.actions, ['start', 'cancel']);
  }
});

test('food-menu cannot enqueue focus if its opened notification disposes it', async () => {
  let menu;
  const h = menuFixture({ changed: () => menu.dispose() }); menu = h.menu;
  await menu.open();
  assert.equal(h.schedules.frames.size, 0); assert.equal(h.get('foodPanel').classList.contains('show'), false);
});

test('feeding releases a speech cancellation returned after synchronous disposal', () => {
  let feeding, cancellations = 0;
  const h = feedingFixture({ say: () => { feeding.dispose(); return () => { cancellations++; }; } });
  feeding = h.feeding;
  feeding.presentMeal({ automatic: true, foodId: 'berry', reaction: 'owned', animation: 'happy' });
  const callback = [...h.schedules.timeouts.values()][0];
  h.schedules.timeouts.clear(); callback(); feeding.dispose();
  assert.equal(cancellations, 1); assert.deepEqual(h.actions, ['start', 'cancel']);
});

test('feeding detaches ownership before a speech cancellation can synchronously dispose', () => {
  let feeding, cancellations = 0;
  const h = feedingFixture({ say: () => () => { cancellations++; if (cancellations === 1) feeding.dispose(); } });
  feeding = h.feeding;
  feeding.presentMeal({ automatic: true, foodId: 'berry', reaction: 'owned', animation: 'happy' });
  const callback = [...h.schedules.timeouts.values()][0];
  h.schedules.timeouts.clear(); callback(); feeding.cancel('hidden');
  assert.equal(cancellations, 1); assert.deepEqual(h.actions, ['start', 'cancel']);
});

test('a stale feeding reaction cannot erase a newer timer before terminal cleanup', () => {
  const h = feedingFixture();
  const meal = { automatic: true, foodId: 'berry', reaction: 'owned', animation: 'happy' };
  h.feeding.presentMeal(meal); const late = [...h.schedules.timeouts.values()][0];
  h.feeding.presentMeal(meal); assert.equal(h.schedules.timeouts.size, 1);
  late(); assert.equal(h.spoken.length, 0);
  h.feeding.dispose(); assert.equal(h.schedules.timeouts.size, 0);
});

for (const result of [{ ok: false, reason: 'out-of-stock' }, undefined]) {
  test(`feeding disposal keeps ${result ? 'terminal rejection' : 'unknown request identity'} independent of presentation`, async () => {
    const h = feedingFixture(), pending = deferred(); h.setSend(() => pending.promise);
    const operation = h.feeding.feedPet('berry'); h.feeding.dispose();
    pending.resolve(result); assert.equal(await operation, result);
    assert.equal(h.feeding.pending('berry'), result === undefined);
    assert.equal(h.busy.length, 1); assert.equal(h.reads(), 0); assert.equal(h.spoken.length, 0);
    assert.equal(h.sent.length, 1);
  });
}

test('notebook pagehide uses the same terminal disposal and removes its own pagehide listener', async () => {
  const { document, view } = dom(), schedules = scheduler(), actions = [];
  const notebook = createNotebookVisit({ document, ...schedules, calm: () => false, startAction: id => actions.push(id), stopAction() {} });
  notebook.handle({ id: 'system.notebook-ready', at: 1 });
  const callback = [...schedules.intervals.values()][0];
  await view.dispatch('pagehide'); callback();
  assert.equal(view.handlers('pagehide').length, 0); assert.equal(schedules.intervals.size, 0);
  assert.equal(notebook.handle({ id: 'system.notebook-ready', at: 2 }), false);
  assert.deepEqual(actions, ['take-note']);
});

test('a late expired feed receipt cannot begin a new refresh after terminal disposal', async () => {
  const h = feedingFixture(), pending = deferred(); h.setSend(() => pending.promise);
  const operation = h.feeding.feedPet('berry'); h.feeding.dispose();
  pending.resolve({ ok: false, reason: 'food-command-expired' }); await operation;
  assert.equal(h.reads(), 0); assert.equal(h.feeding.pending('berry'), true);
  assert.equal(h.sent.length, 1); assert.equal(h.busy.length, 1); assert.equal(h.spoken.length, 0);
});
