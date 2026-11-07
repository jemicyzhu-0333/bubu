'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
  const environment = { window, document, crypto: options.noCrypto ? undefined : { randomUUID: () => options.instanceId ?? randomUUID() }, performance: { now: () => now },
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
    dispose() { this.disposals++; if (options.disposeError) throw new Error('cleanup unavailable'); }, snapshot: () => ({ state: { mode } }),
    readDiagnostics() {
      return { mode: this.disposals ? 'disposed' : mode, pointerId: null, captured: false, pendingCount: 0,
        renderedFrames: this.renders, errors: [], resources: { geometries: this.disposals ? 0 : 2, textures: 0 },
        pool: { actors: this.disposals ? 0 : 1, pending: 0, parts: { references: this.disposals ? 0 : 1 },
          budget: { residentBytes: this.disposals ? 0 : 100, claims: this.disposals ? 0 : 2 } },
        graphics: { renderer: 'test only; not GPU evidence' }, inputTargets: { body: { x: 12, y: 14 } } };
    } };
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

test('diagnostic read is closed, readonly and excludes business projections or raw actor state', async () => {
  const f = fixture({ instanceId: 'known-generation-id' }); await f.surface.start();
  f.emit('onPetSync', { contextRevision: 2, privateText: 'secret business text', appearanceItemIds: ['private-look'] });
  f.tick(16); f.tick(32); f.tick(48); await flush();
  const calls = f.calls.length, before = f.surface.snapshot(), first = f.surface.readDiagnostics({ limit: 1 });
  assert.deepEqual(Object.keys(first), ['schemaVersion', 'instanceId', 'ready', 'closed', 'time', 'frameScheduled', 'policy', 'frames', 'startup', 'stage', 'events', 'errors']);
  assert.equal(first.instanceId, 'known-generation-id'); assert.equal(first.schemaVersion, 1);
  assert.equal(first.frames.rows.length, 1); assert.equal(first.frames.rows[0].atMs, 32);
  assert.equal(first.frames.remaining, 1); assert.equal(first.stage.mode, 'idle');
  assert.equal('context' in first, false); assert.equal('state' in first.stage, false);
  assert.doesNotMatch(JSON.stringify(first), /secret business text|private-look|privateText|appearanceItemIds/);
  const second = f.surface.readDiagnostics({ afterSequence: first.frames.rows[0].sequence });
  assert.equal(second.frames.rows[0].atMs, 48);
  const unchanged = f.surface.readDiagnostics();
  first.events.rows[0].type = 'caller-mutation'; first.policy.hidden = true;
  assert.deepEqual(f.surface.readDiagnostics(), unchanged);
  assert.deepEqual(f.surface.snapshot(), before); assert.equal(f.calls.length, calls, 'reads must issue no IPC');
  for (const options of [null, [], { context: true }, { limit: 0 }, { afterSequence: 3 }]) {
    assert.throws(() => f.surface.readDiagnostics(options));
  }
  f.surface.dispose();
});

test('diagnostic generation identity changes for recreated surfaces and never guesses unavailable crypto', async () => {
  const first = fixture(), next = fixture(), unavailable = fixture({ noCrypto: true });
  assert.notEqual(first.surface.readDiagnostics().instanceId, next.surface.readDiagnostics().instanceId);
  assert.equal(unavailable.surface.readDiagnostics().instanceId, 'unavailable');
  assert.equal(first.surface.readDiagnostics().ready, false);
  for (const f of [first, next, unavailable]) f.surface.dispose();
});

test('diagnostic event audit is bounded, chronological and records no pointer moves or screen coordinates', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16);
  const baseline = f.surface.readDiagnostics().events.total;
  for (let i = 0; i < 1000; i++) f.elements.character.emit('pointermove', { pointerId: 2, screenX: 9000, screenY: 8000 });
  assert.equal(f.surface.readDiagnostics().events.total, baseline);
  for (let i = 0; i < 600; i++) {
    f.setNow(20 + i);
    f.elements.character.emit('pointerdown', { pointerId: i, screenX: 9000, clientX: 10, text: 'private', mode: 'forged' });
  }
  const events = f.surface.readDiagnostics().events;
  assert.equal(events.rows.length, 512); assert.equal(events.total, baseline + 600);
  assert.equal(events.overwritten, events.total - 512);
  assert.equal(events.rows[0].sequence, events.total - 511);
  assert.equal(events.rows.at(-1).sequence, events.total);
  assert.equal(events.rows.at(-1).pointerId, 599); assert.equal(events.rows.at(-1).isTrusted, false);
  for (const row of events.rows) assert.deepEqual(Object.keys(row), ['sequence', 'atMs', 'type', 'pointerId', 'isTrusted']);
  assert.doesNotMatch(JSON.stringify(events), /screenX|screenY|clientX|private|forged/);
  f.surface.dispose();
});

test('diagnostic audit observes actual mode and policy transitions once rather than every rendered frame', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16); f.tick(32);
  f.setMode('drag'); f.tick(48); f.tick(64);
  assert.deepEqual(f.surface.readDiagnostics().events.rows.filter(row => row.type === 'mode').map(row => row.mode), ['idle', 'drag']);
  f.surface.pause(true); f.tick(80); f.surface.pause(true); f.tick(96);
  const policies = f.surface.readDiagnostics().events.rows.filter(row => row.type === 'policy');
  assert.equal(policies.length, 2); assert.equal(policies.at(-1).mode, 'visible/paused/full');
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
    f.elements.character.emit(type, { pointerId: 3 });
    assert(f.surface.readDiagnostics().events.rows.some(row => row.type === type));
  }
  f.surface.dispose();
});

test('terminal diagnostics read final post-disposal counters without retaining graphics or input objects', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16); f.tick(32);
  assert.equal(f.surface.readDiagnostics().stage.pool.actors, 1);
  f.surface.dispose(); await flush();
  const final = f.surface.readDiagnostics();
  assert.equal(final.ready, false); assert.equal(final.closed, true);
  assert.equal(final.stage.mode, 'disposed'); assert.equal(final.stage.pendingCount, 0);
  assert.equal(final.stage.pool.actors, 0); assert.equal(final.stage.pool.parts.references, 0);
  assert.equal(final.stage.pool.budget.residentBytes, 0); assert.equal(final.stage.resources.geometries, 0);
  assert.equal(final.stage.renderedFrames, 2);
  assert.equal('graphics' in final.stage, false); assert.equal('inputTargets' in final.stage, false);
  assert.equal(final.events.rows.at(-1).type, 'disposed');
  const copied = JSON.parse(JSON.stringify(final));
  final.stage.pool.actors = 99;
  assert.deepEqual(f.surface.readDiagnostics(), copied, 'terminal counters are detached on every read');
});

test('late loaded stages update terminal diagnostic counters after cleanup without revival', async () => {
  const load = deferred(), f = fixture({ loadStage: () => load.promise });
  const start = f.surface.start(); f.surface.dispose();
  assert.equal(f.surface.readDiagnostics().stage, null);
  load.resolve(f.stage); await start;
  const value = f.surface.readDiagnostics();
  assert.equal(value.closed, true); assert.equal(value.ready, false);
  assert.equal(value.stage.pool.actors, 0); assert.equal(value.stage.pool.parts.references, 0);
  assert.equal(value.events.rows.filter(row => row.type === 'disposed').length, 1);
});


test('stable animation frames do not rewrite unchanged status text', async () => {
  const f = fixture();
  let text = '', writes = 0;
  Object.defineProperty(f.elements.status, 'textContent', {
    get: () => text, set(value) { text = value; writes++; },
  });
  await f.surface.start();
  for (let frame = 1; frame <= 144; frame++) f.tick(frame * 1000 / 144);
  assert.equal(f.stage.renders, 144);
  assert.equal(text, '开发角色 · 实时'); assert.equal(writes, 1);
  f.surface.pause(true); f.tick(1016);
  assert.equal(text, '开发角色 · 已暂停'); assert.equal(writes, 2);
  f.surface.pause(true); f.tick(1032); assert.equal(writes, 2);
  f.surface.pause(false); f.tick(1048);
  assert.equal(text, '开发角色 · 实时'); assert.equal(writes, 3);
  f.emit('onPetSync', { contextRevision: 2, motionMode: 'reduced' }); f.tick(1064);
  assert.equal(text, '开发角色 · 静态策略'); assert.equal(writes, 4);
  f.window.emit('focus'); f.tick(1080); assert.equal(writes, 4);
  f.surface.dispose();
});

test('disposal detaches the retired stage and keeps only copied terminal counters', async () => {
  for (const disposeError of [false, true]) {
    const f = fixture({ disposeError }); await f.surface.start(); f.tick(16);
    let diagnosticReads = 0;
    const read = f.stage.readDiagnostics.bind(f.stage);
    f.stage.readDiagnostics = () => { diagnosticReads++; return read(); };
    f.surface.dispose();
    assert.equal(diagnosticReads, 1);
    f.stage.snapshot = () => { throw new Error('retired stage must not be read'); };
    f.stage.readDiagnostics = () => { throw new Error('retired diagnostics must not be read'); };
    const final = f.surface.readDiagnostics();
    assert.equal(final.stage.pool.actors, 0); assert.equal(final.stage.mode, 'disposed');
    assert.equal(f.surface.snapshot().stage, null);
    f.surface.dispose(); f.surface.cancel(); f.surface.pause(false); f.tick(32);
    assert.deepEqual(f.surface.readDiagnostics(), final); assert.equal(f.stage.disposals, 1);
    if (disposeError) assert.match(final.errors.join(' '), /cleanup unavailable/);
  }
});

test('failed terminal diagnostics do not retain or revisit a retired stage', async () => {
  const f = fixture(); await f.surface.start(); f.tick(16);
  f.stage.readDiagnostics = () => { throw new Error('diagnostics unavailable'); };
  f.surface.dispose();
  f.stage.snapshot = () => { throw new Error('retired stage must not be read'); };
  assert.equal(f.surface.snapshot().stage, null);
  assert.equal(f.surface.readDiagnostics().stage, null);
  assert.match(f.surface.readDiagnostics().errors.join(' '), /Terminal diagnostics failed: diagnostics unavailable/);
  assert.equal(f.stage.disposals, 1);
});


test('startup timings retain the omitted first render without adding a fabricated interval', async () => {
  const load = deferred(), hydration = deferred();
  const f = fixture({ loadStage: () => load.promise, getState: () => hydration.promise });
  const started = f.surface.start(); await flush();
  f.setNow(100); load.resolve(f.stage); await flush();
  f.setNow(150); hydration.resolve({ contextRevision: 1, motionMode: 'full', stimulationMode: 'balanced' });
  await started;
  const update = f.stage.update.bind(f.stage), render = f.stage.render.bind(f.stage);
  f.stage.update = (...args) => { update(...args); f.setNow(170); };
  f.stage.render = () => { render(); f.setNow(800); };
  f.tick(160);
  const startup = f.surface.readDiagnostics().startup;
  assert.equal(startup.stageLoadMs, 100); assert.equal(startup.readyMs, 150);
  assert.deepEqual(startup.firstFrame, { callbackAtMs: 160, updateStartedAtMs: 160, renderFinishedAtMs: 800,
    callbackDelayMs: 0, updateMs: 10, renderSubmissionMs: 630, totalCpuMs: 640, readyToRenderFinishedMs: 650 });
  assert.equal(f.surface.readDiagnostics().frames.totalRecorded, 0);
  f.stage.update = update; f.stage.render = render; f.tick(810);
  assert.equal(f.surface.readDiagnostics().frames.rows[0].frameIntervalMs, 650);
  assert.equal(f.surface.readDiagnostics().frames.rows[0].renderSubmissionMs, 0);
  assert.deepEqual(f.surface.readDiagnostics().startup, startup);
  startup.firstFrame.renderSubmissionMs = -1;
  assert.equal(f.surface.readDiagnostics().startup.firstFrame.renderSubmissionMs, 630);
  f.surface.dispose(); assert.equal(f.surface.readDiagnostics().startup.firstFrame.renderSubmissionMs, 630);
});

test('reduced-motion first draw and failed or late stage loading report startup separately', async () => {
  const f = fixture({ getState: () => ({ motionMode: 'reduced' }) });
  await f.surface.start(); f.tick(16);
  assert.equal(f.surface.readDiagnostics().startup.firstFrame.callbackAtMs, 16);
  assert.equal(f.surface.readDiagnostics().frames.totalRecorded, 0); f.surface.dispose();
  const load = deferred(), late = fixture({ loadStage: () => load.promise });
  const started = late.surface.start(); await flush(); late.surface.dispose();
  late.setNow(100); load.resolve(late.stage); await started;
  assert.equal(late.surface.readDiagnostics().startup.stageLoadMs, 100);
  assert.equal(late.surface.readDiagnostics().startup.readyMs, null);
  assert.equal(late.surface.readDiagnostics().startup.firstFrame, null);
  const failed = fixture({ loadStage: async () => { throw new Error('failed'); } });
  await failed.surface.start();
  assert.equal(failed.surface.readDiagnostics().startup.stageLoadMs, null);
  assert.equal(failed.surface.readDiagnostics().startup.firstFrame, null);
});
