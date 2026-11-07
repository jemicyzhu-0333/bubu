'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { probeHeldTransport } = require('../tools/pet-realtime-capture/held-transport-probe.cjs');
const { captureTransportHandoff } = require('../tools/pet-realtime-capture/transport-handoff.cjs');
const { createOwnedWindowPort } = require('../tools/pet-realtime-capture/window-port.cjs');
const { createPresentationViewTracker } = require('../src/core/pet-presentation-view.mjs');
const { FIXTURE_TRANSPORT_SCOPE: scope } = require('../src/core/pet-fixture-transport.mjs');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const probeId = uuid(1), epoch = uuid(2), setupId = uuid(3);
function harness(options = {}) {
  const tracker = createPresentationViewTracker(); let time = 0, step = 0, paused = true;
  let finished = false, releaseObserved = false, highWater = 0, tailAt = null, terminalQueued = false, tailIdleRecorded = false, tailReset = false;
  let held = false, captured = false, fixture = false, mode = 'idle', pendingCount = 0, frames = 1, total = 0, active = true;
  let native = { x: -800, y: -30, width: 520, height: 360 }, grip = { x: 170, y: 160 };
  const makeView = () => tracker.record({ logicalAnchor: { ...native, width: 220, height: 220 }, backingBounds: { ...native },
    contentBounds: { ...native }, geometry: { width: 220, height: 220, stageOffset: { x: 150, y: 70 } }, stableNativeRead: true });
  let view = makeView(); const origin = view, calls = [], deadlines = [], rows = [];
  const motion = () => ({ mode: options.unavailable ? 'client' : 'event-screen-dip', total, revision: 1, capability: { revision: 1 }, rows: [...rows] });
  const lease = () => ({ held, inFlight: false, pendingEnd: false, remainingMs: 280 - time,
    capability: { available: true }, fixtureHold: fixture ? { probeId, step, epoch, contactGeneration: options.newContact && step === 1 ? 2 : 1, viewRevision: view.revision } : null });
  const diagnostics = () => ({ instanceId: 'one', ready: true, closed: false,
    inputLease: lease(), stage: { mode, contactGenerationHighWater: highWater, interactionTailActive: options.missingTail ? undefined : !tailReset && tailAt !== null && time < tailAt + 80, pointerId: captured || terminalQueued ? 1 : null, captured, pendingCount, renderedFrames: frames,
      contactGeneration: options.newContact && step === 1 ? 2 : captured || terminalQueued ? 1 : null, inputMotion: motion(), inputTargets: { body: { x: 140, y: 180 } } } });
  function beginTerminal() {
    if (tailAt !== null) return;
    tailAt = options.stuckTail ? Infinity : time + 80;
    terminalQueued = true; captured = false; pendingCount = 1;
  }
  const ok = fields => ({ ok: true, scope, ...fields });
  const ports = { identity: { instanceId: 'one', generation: 0 }, probeId, now: () => time,
    assertCurrent() { if (!active) throw Error('owner-changed'); }, readNative: () => ({ ...native }),
    async delay(ms) {
      time += ms; pendingCount = 0; frames++;
      if (tailAt !== null) {
        terminalQueued = false; held = false; captured = false; mode = time >= tailAt ? 'idle' : 'landing';
        if (options.resetTail && time >= tailAt - 40) {
          if (!tailReset) calls.push(['tail', 'reset']);
          tailReset = true; mode = 'idle'; finished = false; releaseObserved = false;
        }
        if (mode === 'idle' && time >= tailAt + 80 && !tailIdleRecorded) {
          calls.push(['tail', 'idle']); tailIdleRecorded = true;
          if (options.fleetingContact) { highWater++; finished = false; releaseObserved = false; }
        }
      }
    },
    async renderer(method, arg, ms) {
      calls.push(['renderer', method]); deadlines.push(ms); time++;
      if (options.newDocument === method) active = false;
      if (options.throwRenderer === method) throw Error('late-receipt');
      if (method === 'readDiagnostics') return diagnostics();
      if (method === 'readWindowGeometry') return { instanceId: 'one', ready: true, closed: false, paused,
        pointerId: captured ? 1 : null, captured, domPointerCapture: captured, pendingCount, presentationView: view };
      if (method === 'pause') { paused = arg; if (paused) { captured = false; held = false; fixture = false; pendingCount = 0; } return; }
      if (method === 'prepareFixtureTransport') { fixture = true;
        return ok({ probeId, epoch, contactGeneration: 1, viewRevision: view.revision, gripClient: { ...grip }, remainingMs: 250, view }); }
      if (method === 'readFixtureTransport') {
        if (options.earlyTerminal === 'before-native' && total >= 3 || options.earlyTerminal && step === 1) beginTerminal();
        if (options.expire && step === 1) time = 500;
        return ok({ probeId, step, finished, domCaptured: options.failedDOMRelease && releaseObserved ? true : captured, releaseObserved: options.missingReleaseReceipt ? false : releaseObserved, contactGenerationHighWater: highWater, terminal: tailAt !== null, gripClient: { ...grip }, view,
          pendingCount, renderedFrames: frames, inputLease: lease(), inputMotion: motion() });
      }
      if (method === 'finishFixtureTransport') { fixture = false; finished = true; return ok({ probeId, gripClient: { ...grip } }); }
      if (method === 'cancelFixtureTransport') { captured = false; held = false; fixture = false; return ok({ probeId }); }
      throw Error(method);
    },
    async host(method, arg, ms) {
      calls.push(['host', method, arg]); deadlines.push(ms); time++;
      if (options.throwHost === method) throw Error('unknown');
      if (method === 'prepareFixture') { native = { ...native, x: -750, y: 32 }; view = makeView(); return ok({ setupId, before: origin, prepared: view }); }
      if (method === 'arm') return ok({ probeId, delta: { x: 24, y: 16 }, originView: view });
      if (method === 'translate') {
        if (options.earlyTerminal === 'native-rejection') { beginTerminal(); return { ok: false, scope, attempted: false }; }
        const before = view, d = arg.step === 1 ? { x: 24, y: 16 } : { x: -24, y: -16 };
        native = { ...native, x: native.x + d.x + (options.clamp ? 1 : 0), y: native.y + d.y };
        view = makeView(); step = arg.step;
        if (options.newContact && step === 1) highWater++;
        if (options.earlyTerminal === 'native-return-pending') beginTerminal();
        if (options.gripSlip) grip = { x: grip.x + 24, y: grip.y + 16 };
        if (options.returnFailure) return { ok: false, scope, attempted: true, view };
        return ok({ probeId, step, view, receipt: { schemaVersion: 1, scope, probeId, epoch, contactGeneration: 1,
          step, fromRevision: before.revision, toRevision: view.revision, delta: d, before, after: view } });
      }
      if (method === 'finish' || method === 'abort') return ok({ probeId, view });
      if (method === 'restoreFixture') { native = { ...origin.backingBounds }; view = makeView(); return ok({ setupId, confirmed: true, view }); }
      throw Error(method);
    },
    async input(type, client) {
      calls.push(['input', type, { ...client }]); time++; pendingCount = 1; total++;
      rows.push({ sequence: total, type: type === 'mouseMove' ? 'pointermove' : type === 'mouseDown' ? 'pointerdown' : 'pointerup',
        source: 'event-screen-dip', reason: null, domCaptured: true, client: { ...client }, motion: { x: native.x + client.x, y: native.y + client.y } });
      if (type === 'mouseDown') { highWater++; held = true; captured = true; mode = 'pending'; }
      if (type === 'mouseMove') mode = 'drag';
      if (type === 'mouseUp') {
        held = false; captured = false; releaseObserved = !options.noReleaseActivity;
        if (options.noReleaseActivity) mode = 'idle'; else beginTerminal();
      }
      return { local: { ...client }, global: { x: native.x + client.x, y: native.y + client.y }, coordinateSource: 'caller-supplied-controlled-fixture-not-OS' };
    } };
  return { ports, calls, deadlines };
}
test('held actor fixture records actual grip/global displacement once per fixed native leg and restores staging', async () => {
  const h = harness(), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'completed', r.reason); assert.equal(r.cleanup.confirmed, true);
  assert.equal(r.releaseObserved.naturalTailSettled, true); assert.equal(r.releaseObserved.releaseObserved, true); assert.equal(r.releaseObserved.domCaptured, false); assert.equal(r.releaseObserved.contactGenerationHighWater, 1);
  assert.equal(r.releaseObserved.landingObserved, true); assert.equal(r.releaseObserved.interactionTailObserved, true);
  assert.deepEqual(r.legs.map(v => v.actualGlobalDisplacement), [{ x: 24, y: 16 }, { x: -24, y: -16 }]);
  assert(r.legs.every(v => v.localGripPreserved && v.singleGlobalDisplacement));
  assert.deepEqual(h.calls.filter(c => c[0] === 'input').map(c => c[2]),
    [{ x: 140, y: 180 }, { x: 168, y: 148 }, { x: 194, y: 176 }, { x: 146, y: 144 }, { x: 170, y: 160 }]);
  assert.equal(r.pointerDriven, false); assert.equal(r.OSInputProven, false); assert.equal(r.compositorAcknowledged, false);
  assert.equal(h.calls.filter(c => c[1] === 'restoreFixture').length, 1);
  assert(h.deadlines.every(n => n > 0 && n <= 2000));
});
test('unsupported event runtime defers without preparing native fixture or injecting input', async () => {
  const h = harness({ unavailable: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'unavailable'); assert.equal(r.requiresDispose, false);
  assert.equal(h.calls.length, 1);
});
test('known early up keeps its queued frame and natural tail before cancellation or restoration', async () => {
  for (const earlyTerminal of ['before-native', 'native-return-pending', 'between-steps', 'native-rejection']) {
    const h = harness({ earlyTerminal }), r = await probeHeldTransport(h.ports);
    assert.equal(r.status, 'incomplete'); assert.equal(r.cleanup.confirmed, true);
    assert.equal(r.earlyTerminal.tailQuiescentObserved, true); assert.equal(Object.hasOwn(r.earlyTerminal, 'naturalTailSettled'), false); assert.equal(r.earlyTerminal.interactionTailActive, false);
    assert.equal(h.calls.filter(c => c[1] === 'translate').length, earlyTerminal === 'before-native' ? 0 : 1);
    assert.equal(h.calls.filter(c => c[1] === 'mouseUp').length, 0);
    const idle = h.calls.findIndex(c => c[0] === 'tail'); assert(idle >= 0);
    assert(h.calls.findIndex(c => c[1] === 'cancelFixtureTransport') > idle);
    assert(h.calls.findIndex(c => c[1] === 'abort') > idle);
    assert(h.calls.findIndex(c => c[1] === 'restoreFixture') > idle);
  }
});
test('observed early tail followed by lifecycle reset reports only quiescence, never natural completion', async () => {
  const h = harness({ earlyTerminal: 'between-steps', resetTail: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete');
  assert(h.calls.some(c => c[0] === 'tail' && c[1] === 'reset'));
  assert.equal(r.earlyTerminal.tailQuiescentObserved, true);
  assert.equal(r.earlyTerminal.landingObserved, true);
  assert.equal(r.earlyTerminal.interactionTailObserved, true);
  assert.equal(Object.hasOwn(r.earlyTerminal, 'naturalTailSettled'), false);
});
test('early terminal whose tail never settles remains incomplete without resetting or restoring it', async () => {
  const h = harness({ earlyTerminal: 'between-steps', stuckTail: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(r.requiresDispose, true); assert.equal(r.cleanup.confirmed, false);
  assert.equal(h.calls.filter(c => c[1] === 'cancelFixtureTransport' || c[1] === 'restoreFixture').length, 0);
});
test('missing tail observation cannot claim normal landing settled', async () => {
  const h = harness({ missingTail: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(r.releaseObserved, undefined);
});
test('newer contact during held roundtrip receives no old cancellation, abort or restoration', async () => {
  const h = harness({ newContact: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(r.requiresDispose, true);
  assert.equal(h.calls.filter(c => ['cancelFixtureTransport', 'abort', 'restoreFixture'].includes(c[1])).length, 0);
});
test('completed newer contact between tail polls blocks old restoration even when active contact is null', async () => {
  const h = harness({ fleetingContact: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(r.requiresDispose, true);
  assert.equal(h.calls.filter(c => ['cancelFixtureTransport', 'abort', 'restoreFixture'].includes(c[1])).length, 0);
});
test('idle alone and missing genuine up receipt never prove a completed natural release', async () => {
  for (const options of [{ noReleaseActivity: true }, { missingReleaseReceipt: true }]) {
    const h = harness(options), r = await probeHeldTransport(h.ports);
    assert.equal(r.status, 'incomplete'); assert.equal(r.releaseObserved, undefined);
  }
});
test('genuine up and idle cannot complete when original DOM capture release failed', async () => {
  const h = harness({ failedDOMRelease: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete');
  assert.equal(r.reason, 'held-transport-finished-owner-unverified');
  assert.equal(r.releaseObserved, undefined);
  assert.equal(h.calls.filter(c => c[1] === 'mouseUp').length, 1);
});
test('actual clamp or independent grip slip cannot pass as a requested pure displacement', async () => {
  for (const options of [{ clamp: true }, { gripSlip: true }]) {
    const h = harness(options), r = await probeHeldTransport(h.ports);
    assert.equal(r.status, 'incomplete'); assert.equal(h.calls.filter(c => c[1] === 'translate').length, 1);
  }
});
test('original TTL expires without any retry or second leg and reads use bounded remaining budgets', async () => {
  const h = harness({ expire: true }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(h.calls.filter(c => c[1] === 'translate').length, 1);
  assert(h.deadlines.some(n => n < 250));
});
test('throwing native mutation or attempted failure never causes implicit restoration or a second command', async () => {
  for (const options of [{ throwHost: 'translate' }, { returnFailure: true }]) {
    const h = harness(options), r = await probeHeldTransport(h.ports);
    assert.equal(r.status, 'incomplete'); assert.equal(r.mutationOutcomeUnknown, true); assert.equal(r.requiresDispose, true);
    assert.equal(h.calls.filter(c => c[1] === 'translate').length, 1);
    assert.equal(h.calls.filter(c => c[1] === 'restoreFixture' || c[1] === 'abort').length, 0);
  }
});
test('lost renderer mutator receipt and unknown cleanup are not retried', async () => {
  for (const options of [{ throwRenderer: 'prepareFixtureTransport' }, { throwHost: 'restoreFixture' }]) {
    const h = harness(options), r = await probeHeldTransport(h.ports);
    assert.equal(r.status, 'incomplete'); assert.equal(r.requiresDispose, true); assert.equal(r.mutationOutcomeUnknown, true);
    assert.equal(h.calls.filter(c => c[1] === (options.throwRenderer ?? options.throwHost)).length, 1);
  }
});
test('new document during preparation prevents all stale cleanup mutations', async () => {
  const h = harness({ newDocument: 'prepareFixtureTransport' }), r = await probeHeldTransport(h.ports);
  assert.equal(r.status, 'incomplete'); assert.equal(r.requiresDispose, true);
  assert.equal(h.calls.filter(c => c[1] === 'arm' || c[1] === 'restoreFixture' || c[1] === 'cancelFixtureTransport').length, 0);
});
function mainPort() { return Object.freeze(Object.fromEntries(['prepareFixture', 'arm', 'translate', 'read', 'finish', 'abort', 'restoreFixture'].map(k => [k, () => {}]))); }
test('native handoff captures pre-load configure emission from exact window and cleans all listeners', () => {
  const app = new EventEmitter(), window = new EventEmitter(), other = new EventEmitter(), handoff = captureTransportHandoff(app), port = mainPort();
  app.emit('browser-window-created', {}, window); window.emit('bubu:fixture-transport-port', port);
  assert.equal(handoff.take(window).port, port); assert.throws(() => handoff.take(other), /window-mismatch/);
  const retained = handoff.take(window); window.emit('bubu:fixture-transport-port', port);
  assert.throws(() => retained.assertCurrent(), /handoff-invalid/); handoff.close();
  assert.equal(app.listenerCount('browser-window-created'), 0); assert.equal(window.listenerCount('bubu:fixture-transport-port'), 0);
});
test('absent handoff is unavailable while duplicate and malformed handoff reject', () => {
  for (const mode of ['missing', 'malformed', 'duplicate-window']) {
    const app = new EventEmitter(), window = new EventEmitter(), h = captureTransportHandoff(app);
    app.emit('browser-window-created', {}, window);
    if (mode === 'malformed') window.emit('bubu:fixture-transport-port', { ...mainPort() });
    if (mode === 'duplicate-window') app.emit('browser-window-created', {}, window);
    if (mode === 'missing') assert.equal(h.take(window), null);
    else assert.throws(() => h.take(window), /handoff/); h.close();
  }
});
test('owned port rejects missing handoff as unavailable and consumes its single attempt', async () => {
  const contents = new EventEmitter(); Object.assign(contents, { isDestroyed: () => false,
    getURL: () => pathToFileURL('/fixture/index.html').href, executeJavaScript: async () => ({ instanceId: 'one' }) });
  const window = { webContents: contents, isDestroyed: () => false };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true });
  await port.read({}); const r = await port.probeHeldTransport();
  assert.equal(r.status, 'unavailable'); assert.equal(r.reason, 'capture-transport-handoff-missing');
  await assert.rejects(port.probeHeldTransport(), /unavailable/); port.close();
});

function windowHarness(options = {}) {
  const h = harness(), contents = new EventEmitter(); let resolve, disposed = false, awaitingMutation = false;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
    async executeJavaScript(expression) {
      const [, method, json] = /module\.surface\.(\w+)\((.*)\)\)/.exec(expression);
      const argument = json ? JSON.parse(json) : undefined;
      if (method === options.pendingMethod) { awaitingMutation = true; return new Promise(yes => { resolve = yes; }); }
      if (method === 'dispose') { disposed = true; return; }
      await h.ports.delay(1);
      const result = await h.ports.renderer(method, argument, 1000);
      if (awaitingMutation && options.fleetingBeforeDispose && method === 'readDiagnostics')
        result.stage = { ...result.stage, pointerId: null, captured: false, contactGeneration: null, contactGenerationHighWater: 2 };
      if (options.navigateMethod === method) contents.emit('did-start-navigation', { isMainFrame: true });
      if (result && typeof result === 'object') return { ...result, instanceId: 'one', ...(disposed ? { closed: true } : {}) };
      return result;
    },
    sendInputEvent(event) { h.ports.input(event.type, { x: event.x, y: event.y }); }
  });
  const window = { webContents: contents, isDestroyed: () => false, isFocused: () => true,
    getBounds: h.ports.readNative, getContentBounds: h.ports.readNative };
  const nativePort = Object.freeze(Object.fromEntries(['prepareFixture', 'arm', 'translate', 'read', 'finish', 'abort', 'restoreFixture']
    .map(method => [method, arg => h.ports.host(method, arg, 1000)])));
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true, timeoutMs: 20,
    transportHandoff: { window, port: nativePort, assertCurrent() {} } });
  return { ...h, port, contents, resolve: value => resolve(value), disposed: () => disposed };
}
test('held port excludes concurrent mutation and poisons late mutator receipt without retry', async () => {
  const h = windowHarness({ pendingMethod: 'prepareFixtureTransport' }); await h.port.read({});
  const pending = h.port.probeHeldTransport();
  await assert.rejects(h.port.input('mouseDown', { x: 1, y: 1 }), /busy/);
  assert.throws(() => h.port.pause(false), /busy/);
  await assert.rejects(h.port.probeMovement(), /busy/);
  const result = await pending;
  assert.equal(result.status, 'incomplete'); assert.equal(result.mutationOutcomeUnknown, true);
  assert.equal(result.disposal.confirmed, true); assert.equal(h.disposed(), true);
  h.resolve({ instanceId: 'one', ok: true, scope }); await Promise.resolve();
  await assert.rejects(h.port.probeHeldTransport(), /unavailable/);
  await assert.rejects(h.port.probeMovement(), /unavailable/); h.port.close();
});
test('new document during held port preparation never receives old dispose or native cleanup', async () => {
  const h = windowHarness({ navigateMethod: 'prepareFixtureTransport' }); await h.port.read({});
  const result = await h.port.probeHeldTransport();
  assert.equal(result.status, 'incomplete'); assert.equal(h.disposed(), false);
  assert.equal(h.calls.filter(c => c[1] === 'restoreFixture' || c[1] === 'arm').length, 0);
  h.port.close(); assert.equal(h.contents.listenerCount('did-start-navigation'), 0);
});

test('uncertain mutation does not dispose a newer contact which already ended before cleanup read', async () => {
  const h = windowHarness({ pendingMethod: 'prepareFixtureTransport', fleetingBeforeDispose: true }); await h.port.read({});
  const result = await h.port.probeHeldTransport();
  assert.equal(result.status, 'incomplete'); assert.equal(result.mutationOutcomeUnknown, true);
  assert.equal(result.disposal.attempted, false); assert.equal(h.disposed(), false);
  h.resolve({ instanceId: 'one', ok: false, scope }); await Promise.resolve(); h.port.close();
});
