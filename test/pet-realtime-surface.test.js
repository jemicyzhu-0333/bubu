'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealtimePetSurface } = require('../src/surfaces/pet/realtime/surface.mjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
class Target extends EventTarget {
  constructor() { super(); this.dataset = {}; this.textContent = ''; this.listeners = new Map(); this.style = { setProperty: (key, value) => { this.style[key] = value; } }; }
  addEventListener(type, fn, options) { super.addEventListener(type, fn, options); this.listeners.set(fn, type); }
  removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.listeners.delete(fn); }
  emit(type, fields = {}) { const event = new Event(type, { cancelable: true }); Object.assign(event, fields); this.dispatchEvent(event); return event; }
}
function fixture(options = {}) {
  const window = new Target(), document = new Target(), media = new Target(); media.matches = false;
  const elements = Object.fromEntries(['character', 'status', 'pause', 'cancel', 'panel'].map(id => [id, new Target()]));
  document.hidden = false; document.body = new Target(); document.documentElement = new Target(); document.getElementById = id => elements[id];
  window.matchMedia = () => media;
  const frames = new Map(), callbacks = [], subscriptions = new Map(), calls = [];
  let next = 0, now = 0, mode = 'idle';
  const environment = { window, document, performance: { now: () => now },
    requestAnimationFrame(fn) { frames.set(++next, fn); callbacks.push(fn); return next; }, cancelAnimationFrame(id) { frames.delete(id); } };
  const clients = { pet_getState: options.getState || (() => ({ contextRevision: 1, motionMode: 'full', stimulationMode: 'balanced' })),
    pet_updateRuntime: value => { calls.push(['runtime', value]); }, pet_ackCue: value => { calls.push(['ack', value]); },
    pet_openPanel: () => { calls.push(['panel']); if (options.panelError) throw new Error('panel unavailable'); } };
  for (const name of ['onPetSync', 'onPetDock', 'onPetCue', 'onPetViewport']) clients[name] = fn => {
    if (!subscriptions.has(name)) subscriptions.set(name, new Set()); subscriptions.get(name).add(fn);
    return () => subscriptions.get(name).delete(fn);
  };
  const stage = { updates: [], renders: 0, suspends: 0, cancels: 0, disposals: 0, resizes: 0,
    update(time, policy) { this.updates.push({ time, policy }); if (options.updateError) throw new Error('update unavailable'); },
    render() { this.renders++; }, suspend() { this.suspends++; mode = 'idle'; }, cancel() { this.cancels++; mode = 'idle'; }, resize() { this.resizes++; },
    dispose() { this.disposals++; if (options.disposeError) throw new Error('cleanup unavailable'); }, snapshot: () => ({ state: { mode } }) };
  const surface = createRealtimePetSurface({ environment, clients, loadStage: options.loadStage || (() => Promise.resolve(stage)) });
  return { surface, stage, window, document, media, elements, frames, callbacks, calls,
    setMode: value => { mode = value; }, setNow: value => { now = value; },
    emit(name, value) { for (const fn of [...(subscriptions.get(name) || [])]) fn(value); },
    subscriptions: () => [...subscriptions.values()].reduce((sum, set) => sum + set.size, 0),
    listeners: () => [window, document, media, ...Object.values(elements)].reduce((sum, target) => sum + target.listeners.size, 0),
    tick(time) { now = time; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(time); } };
}
test('actual surface owns one frame clock and bounded observations, not another body writer', async () => {
  const f = fixture(); assert.equal(await f.surface.start(), true); assert.equal(await f.surface.start(), true);
  f.tick(16); f.tick(32); f.tick(48);
  assert.equal(f.stage.updates.length, 3); assert.equal(f.stage.renders, 3); assert.equal(f.frames.size, 1);
  assert.equal(f.surface.snapshot().time, .048); assert.equal(f.surface.snapshot().metrics.samples, 2);
  f.surface.dispose(); assert.equal(await f.surface.start(), false);
});
test('pause freezes time and stops recurring idle draws; resume does not catch up elapsed wall time', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16); f.surface.pause(true); f.tick(40);
  const time = f.surface.snapshot().time, renders = f.stage.renders;
  f.tick(20000); assert.equal(f.surface.snapshot().time, time); assert.equal(f.stage.renders, renders); assert.equal(f.frames.size, 0);
  f.setNow(20000); f.surface.pause(false); f.tick(20016);
  assert(Math.abs(f.surface.snapshot().time - time - .016) < 1e-9); f.surface.dispose();
});
test('context hydration cannot overwrite a newer live policy, and low-motion draws once', async () => {
  const hydration = deferred(), f = fixture({ getState: () => hydration.promise }); const started = f.surface.start();
  await flush(); f.emit('onPetSync', { contextRevision: 3, motionMode: 'reduced' });
  hydration.resolve({ contextRevision: 2, motionMode: 'full', stimulationMode: 'balanced' }); await started;
  f.tick(16); assert.equal(f.surface.snapshot().policy.reducedMotion, true); assert.equal(f.frames.size, 0);
  assert.equal(f.stage.updates[0].policy.reducedMotion, true); f.surface.dispose();
});
test('lock, visibility and dock cancel capture; visible resume never advances hidden elapsed time', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16);
  for (const toggle of [value => f.emit('onPetSync', { screenLocked: value }), value => { f.document.hidden = value; f.document.emit('visibilitychange'); },
    value => f.emit('onPetDock', { edge: value ? 'right' : null })]) {
    const before = f.surface.snapshot().time; toggle(true); f.tick(10000); assert.equal(f.frames.size, 0); assert.equal(f.surface.snapshot().time, before);
    toggle(false); f.tick(10016); assert.equal(f.surface.snapshot().time, before + .016);
  }
  assert(f.stage.suspends >= 3); f.surface.dispose();
});
test('ordinary desktop blur cancels active gesture but does not stop visible idle animation', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16); f.setMode('drag'); f.window.emit('blur'); f.tick(32);
  assert.equal(f.stage.cancels, 1); assert.equal(f.surface.snapshot().policy.hidden, false); assert.equal(f.frames.size, 1);
  f.window.emit('focus'); f.tick(48); assert.equal(f.stage.cancels, 1); f.surface.dispose();
});
test('Escape/button cancel uses same actor reset and remains repeatable', async () => {
  const f = fixture(); await f.surface.start();
  assert.equal(f.window.emit('keydown', { key: 'Escape' }).defaultPrevented, true); f.elements.cancel.emit('click');
  assert.equal(f.stage.cancels, 2); f.setMode('drag'); f.tick(16); await flush();
  assert(f.calls.some(([kind, value]) => kind === 'runtime' && value.dragging)); f.surface.dispose();
});
test('viewport subscription is released by explicit dispose and pagehide; stale callbacks are inert', async () => {
  for (const pagehide of [false, true]) {
    const f = fixture(); await f.surface.start(); f.emit('onPetViewport', { width: 520, height: 360, stageOffset: { x: -110, y: 70 } });
    assert.equal(f.document.documentElement.style['--stage-dx'], '-110px'); assert.equal(f.stage.resizes, 1);
    if (pagehide) f.window.emit('pagehide'); else f.surface.dispose();
    const snapshot = f.surface.snapshot(); assert.equal(f.subscriptions(), 0); assert.equal(f.listeners(), 0); assert.equal(f.frames.size, 0);
    f.emit('onPetViewport', { stageOffset: { x: 1, y: 1 } }); for (const fn of f.callbacks) fn(10000);
    f.surface.dispose(); assert.deepEqual(f.surface.snapshot(), snapshot); assert.equal(f.stage.disposals, 1);
  }
});
test('dispose during asset loading cleans late stage without reviving surface or listeners', async () => {
  const load = deferred(), f = fixture({ loadStage: () => load.promise }); const start = f.surface.start(); await flush();
  f.surface.dispose(); load.resolve(f.stage); assert.equal(await start, false); assert.equal(f.stage.disposals, 1);
  assert.equal(f.subscriptions(), 0); assert.equal(f.frames.size, 0); assert.equal(f.surface.snapshot().stage, null);
});
test('late cleanup exceptions remain recorded rather than silently lost', async () => {
  const load = deferred(), f = fixture({ loadStage: () => load.promise, disposeError: true }); const start = f.surface.start();
  f.surface.dispose(); load.resolve(f.stage); assert.equal(await start, false);
  assert.match(f.surface.snapshot().errors[0], /Late stage cleanup failed/); assert.equal(f.surface.snapshot().stage, null);
});
test('early hydration rejection is handled while asset construction is pending', async () => {
  const load = deferred(), f = fixture({ loadStage: () => load.promise, getState: () => Promise.reject(new Error('hydrate unavailable')) });
  const start = f.surface.start(); await flush(); load.resolve(f.stage); assert.equal(await start, false);
  assert.match(f.surface.snapshot().error, /hydrate unavailable/); assert.equal(f.stage.disposals, 1); assert.equal(f.subscriptions(), 0);
});
test('asset failure and frame failure close admission and dispose every owned resource', async () => {
  for (const options of [{ loadStage: () => Promise.reject(new Error('asset unavailable')) }, { updateError: true }]) {
    const f = fixture(options); await f.surface.start(); f.tick(16);
    assert.equal(f.surface.snapshot().closed, true); assert.equal(f.subscriptions(), 0); assert.equal(f.frames.size, 0);
    assert.match(f.surface.snapshot().error, /unavailable/); if (options.updateError) assert.equal(f.stage.disposals, 1);
  }
});
test('unsupported cues use closed ACK payload; synchronous panel failures are captured', async () => {
  const f = fixture({ panelError: true }); await f.surface.start(); f.emit('onPetCue', { decisionId: 'test-cue' }); f.elements.panel.emit('click'); await flush();
  assert.deepEqual(f.calls.find(([kind]) => kind === 'ack')[1], { decisionId: 'test-cue', status: 'rejected' });
  assert(f.surface.snapshot().errors.some(message => /panel unavailable/.test(message))); f.surface.dispose();
});
test('context loss freezes and restore resumes with no duplicate scheduling', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16);
  assert.equal(f.elements.character.emit('webglcontextlost').defaultPrevented, true); f.tick(32); assert.equal(f.frames.size, 0);
  f.setNow(10000); f.elements.character.emit('webglcontextrestored'); f.tick(10016); assert.equal(f.frames.size, 1);
  assert.equal(f.surface.snapshot().time, .032); f.surface.dispose();
});

test('leave/失捕 and outside-window release sample the same real clock before body input admission', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16);
  f.setNow(32); f.elements.character.emit('pointerleave'); assert.equal(f.surface.snapshot().time, .032);
  f.setNow(48); f.elements.character.emit('lostpointercapture'); assert.equal(f.surface.snapshot().time, .048);
  f.setNow(64); f.window.emit('pointerup'); assert.equal(f.surface.snapshot().time, .064);
  f.setNow(80); f.window.emit('pointercancel'); assert.equal(f.surface.snapshot().time, .080);
  f.tick(96); assert.equal(f.surface.snapshot().time, .096); f.surface.dispose();
});

test('terminal disposal withdraws published visibility and dragging once without a business write', async () => {
  const f = fixture(); await f.surface.start(); f.setMode('drag'); f.tick(16); await flush();
  f.surface.dispose(); f.surface.dispose(); await flush();
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'runtime').at(-1)[1],
    { visible: false, menuOpen: false, dragging: false, prefersReducedMotion: false });
  assert.equal(f.calls.filter(([kind, value]) => kind === 'runtime' && !value.visible).length, 2);
});
