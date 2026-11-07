'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { probeOwnedMovement, bounds, targetFor } = require('../tools/pet-realtime-capture/movement-probe.cjs');
const { createOwnedWindowPort } = require('../tools/pet-realtime-capture/window-port.cjs');
const ORIGIN = { x: -800, y: 40, width: 520, height: 360 };
const AREA = { x: -1000, y: 0, width: 1920, height: 1080 };
const geometry = () => ({ instanceId: 'one', ready: true, closed: false, paused: true,
  pointerId: null, captured: false, domPointerCapture: false, pendingCount: 0,
  viewportRevision: 1, stageClientRect: { x: 150, y: 70, width: 220, height: 220 } });
function fixture(options = {}) {
  let current = { ...ORIGIN }, active = true, reads = 0, calls = 0;
  const moves = [];
  const ports = { identity: { instanceId: 'one', generation: 0 },
    assertCurrent({ cleanup = false } = {}) { if (!active || (!cleanup && options.abort)) throw new Error('invalidated'); },
    readNative: () => ({ ...current }), readWorkArea: () => AREA,
    move(x, y) { calls++; moves.push([x, y]); if (options.throwMove) throw new Error('failure');
      if (options.noop || (options.restoreClamped && calls === 2)) return;
      current = { ...current, x: x + (options.clamp && calls === 1 ? 2 : 0), y }; },
    async readRenderer() { reads++; if (options.failRead === reads) throw new Error('timeout');
      return { ...geometry(), ...(options.state ?? {}), ...(options.changeState && reads === 2 ? { captured: true } : {}) }; },
    async delay() { if (options.invalidate) active = false; if (options.abortAfterMove) options.abort = true;
      if (options.delayThrow) throw new Error('aborted'); } };
  return { ports, moves };
}
test('movement receipt distinguishes actual clamped displacement and independent renderer geometry from request', async () => {
  const f = fixture({ clamp: true }); const result = await probeOwnedMovement(f.ports);
  assert.equal(result.status, 'movement-observed'); assert.equal(result.restoration.confirmed, true);
  assert.deepEqual(result.receipts[0].actualDisplacement, { x: 26, y: 16 });
  assert.equal(result.receipts[0].requestedBoundsObserved, false);
  assert.equal(result.receipts[0].sameBoundsAcrossRendererRead, true);
  assert.equal(result.eventMatched, false); assert.equal(result.compositorAcknowledged, false);
  assert.equal(result.actorMotionConnected, false); assert.equal(f.moves.length, 2);
});
test('no-op platform is not reported as actual movement, even if restoring original position succeeds', async () => {
  const result = await probeOwnedMovement(fixture({ noop: true }).ports);
  assert.equal(result.status, 'no-movement-observed'); assert.equal(result.restoration.confirmed, true);
});
test('timeout, ordinary abort and failed command retain receipt and attempt owned restoration', async () => {
  for (const options of [{ failRead: 2 }, { delayThrow: true }, { abortAfterMove: true }, { throwMove: true }]) {
    const f = fixture(options), result = await probeOwnedMovement(f.ports);
    assert.equal(result.status, 'incomplete'); assert.equal(result.restoration.attempted, true);
    assert.equal(f.moves.length, 2);
    assert.equal(result.restoration.confirmed, !options.throwMove);
  }
});
test('revoked owner never receives a restoration command; clamped restore is unverified', async () => {
  const f = fixture({ invalidate: true }), result = await probeOwnedMovement(f.ports);
  assert.equal(f.moves.length, 1); assert.equal(result.restoration.confirmed, false);
  assert.equal(result.restoration.error, 'movement-restoration-unverified');
  const clamped = await probeOwnedMovement(fixture({ restoreClamped: true }).ports);
  assert.equal(clamped.restoration.attempted, true); assert.equal(clamped.restoration.confirmed, false);
});
test('missing pause, capture, pending or non-idle pointer rejects before any window mutation', async () => {
  for (const state of [{ paused: false }, { pointerId: 1 }, { captured: true }, { domPointerCapture: true }, { pendingCount: 1 }, { ready: false }, { closed: true }]) {
    const f = fixture({ state }), result = await probeOwnedMovement(f.ports);
    assert.equal(result.status, 'incomplete'); assert.equal(result.error, 'movement-renderer-not-quiescent'); assert.deepEqual(f.moves, []);
  }
  const result = await probeOwnedMovement(fixture({ changeState: true }).ports);
  assert.equal(result.status, 'incomplete'); assert.equal(result.restoration.confirmed, true);
});
test('integer native bounds and small inside-work-area target preserve dimensions and negative monitor origins', () => {
  assert.throws(() => bounds({ ...ORIGIN, x: NaN }), /invalid/);
  assert.throws(() => bounds({ ...ORIGIN, y: .5 }), /invalid/);
  assert.throws(() => bounds({ ...ORIGIN, width: 1000001 }), /invalid/);
  assert.throws(() => bounds({ ...ORIGIN, height: 0 }), /invalid/);
  for (const x of [-1000, -800, 400]) for (const y of [0, 40, 720]) {
    const origin = { ...ORIGIN, x, y }, target = targetFor(origin, AREA);
    assert.equal(target.width, origin.width); assert.equal(target.height, origin.height);
    assert(Math.hypot(target.x - x, target.y - y) <= 32);
    assert(target.x >= AREA.x && target.y >= AREA.y && target.x + target.width <= AREA.x + AREA.width
      && target.y + target.height <= AREA.y + AREA.height);
  }
  assert.throws(() => targetFor(ORIGIN, ORIGIN), /unavailable/);
  assert.throws(() => targetFor({ ...ORIGIN, x: -2000 }, AREA), /outside/);
});
function windowFixture(options = {}) {
  const contents = new EventEmitter(); let current = { ...ORIGIN }, reads = 0, url = pathToFileURL('/fixture/index.html').href;
  const moves = [];
  Object.assign(contents, { isDestroyed: () => false, getURL: () => url,
    executeJavaScript: async expression => {
      if (expression.includes('.readDiagnostics(')) return { instanceId: 'one' };
      assert(expression.includes('.readWindowGeometry(')); reads++;
      if (options.geometry) return options.geometry(contents, reads);
      return geometry();
    } });
  const window = { webContents: contents, isDestroyed: () => false, getBounds: () => ({ ...current }),
    setPosition(x, y, animate) { assert.equal(animate, false); moves.push([x, y]); current = { ...current, x, y }; options.onMove?.(contents, moves.length); } };
  const controller = new AbortController();
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true,
    readWorkArea: () => AREA, signal: controller.signal, timeoutMs: 1000, startupTimeoutMs: 1000 });
  return { port, contents, moves, controller, foreign: () => { url = 'https://foreign.invalid'; } };
}
test('real owned port serializes one-shot probe and removes observational listeners without adding IPC', async () => {
  const f = windowFixture(); await f.port.read({});
  const promise = f.port.probeMovement();
  await assert.rejects(f.port.probeMovement(), /busy/);
  assert.throws(() => f.port.pause(false), /busy/); assert.throws(() => f.port.reload('one'), /busy/);
  await assert.rejects(f.port.input('mouseDown', { x: 1, y: 1 }), /busy/);
  const result = await promise;
  assert.equal(result.status, 'movement-observed'); assert.equal(result.inputQuiescent, true);
  assert.equal(result.restoration.confirmed, true); assert.equal(f.contents.listenerCount('input-event'), 0);
  await assert.rejects(f.port.probeMovement(), /unavailable/);
  f.port.close(); assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
});
test('unknown native input contaminates, remains unpaired and bounded, without intercepting the event', async () => {
  const f = windowFixture({ onMove(contents, count) { if (count === 1)
    for (let n = 0; n < 200; n++) contents.emit('input-event', { preventDefault() { assert.fail('must not intercept'); } },
      { type: 'mouseMove', x: 2, globalX: -500, secret: 'not-exported', timestamp: 123 }); } });
  await f.port.read({}); const result = await f.port.probeMovement();
  assert.equal(result.status, 'incomplete'); assert.equal(result.restoration.confirmed, true);
  assert.equal(result.inputQuiescent, false); assert.equal(result.nativeObservations.rows.length, 128);
  assert.equal(result.nativeObservations.total, 200); assert.equal(result.nativeObservations.dropped, 72);
  assert.equal(result.nativeObservations.eventMatching, 'unmatched-independent-stream');
  assert.doesNotMatch(JSON.stringify(result.nativeObservations), /secret|timestamp|not-exported/);
  assert.equal(f.contents.listenerCount('input-event'), 0); f.port.close();
});
test('navigation during pending renderer receipt invalidates movement and old instance, even to the same URL', async () => {
  const f = windowFixture({ geometry(contents) { contents.emit('did-start-navigation', {}, pathToFileURL('/fixture/index.html').href, false, true); return geometry(); } });
  await f.port.read({}); const result = await f.port.probeMovement();
  assert.equal(result.status, 'incomplete'); assert.deepEqual(f.moves, []); f.port.close();
});
test('input while awaiting renderer idle check prevents the first movement', async () => {
  const f = windowFixture({ geometry(contents) { contents.emit('before-input-event', {}, { key: 'private-key' }); return geometry(); } });
  await f.port.read({}); const result = await f.port.probeMovement();
  assert.deepEqual(f.moves, []); assert.equal(result.inputQuiescent, false);
  assert.doesNotMatch(JSON.stringify(result), /private-key/); f.port.close();
});
test('abort after movement still restores own window, while close blocks stale movement/restore', async () => {
  let f = windowFixture({ onMove(_contents, count) { if (count === 1) f.controller.abort(); } });
  await f.port.read({}); let result = await f.port.probeMovement();
  assert.equal(result.status, 'incomplete'); assert.equal(result.restoration.confirmed, true); assert.equal(f.moves.length, 2); f.port.close();
  f = windowFixture({ onMove(_contents, count) { if (count === 1) f.port.close(); } });
  await f.port.read({}); result = await f.port.probeMovement();
  assert.equal(result.restoration.confirmed, false); assert.equal(f.moves.length, 1);
  assert.equal(f.contents.listenerCount('input-event'), 0);
});

test('probe cannot overtake earlier input awaiting focus, and stale navigation input never sends', async () => {
  for (const navigate of [false, true]) {
    const contents = new EventEmitter(); let focused = false, sent = 0;
    Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
      executeJavaScript: async () => ({ instanceId: 'one' }), sendInputEvent() { sent++; } });
    const window = { webContents: contents, isDestroyed: () => false, isFocused: () => focused,
      focus() { focused = true; }, getContentBounds: () => ({ width: 520, height: 360 }) };
    const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true,
      readWorkArea: () => AREA, timeoutMs: 1000 });
    await port.read({}); const input = port.input('mouseDown', { x: 10, y: 10 });
    await assert.rejects(port.probeMovement(), /busy/);
    if (navigate) contents.emit('did-start-navigation', {}, pathToFileURL('/fixture/index.html').href, false, true);
    if (navigate) { await assert.rejects(input, /late-input-generation/); assert.equal(sent, 0); }
    else { await input; assert.equal(sent, 1); }
    port.close();
  }
});

test('uncertain timed-out renderer mutation permanently blocks probe even if old execution later settles', async () => {
  const contents = new EventEmitter(); let resolvePause;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
    executeJavaScript(expression) { if (expression.includes('.pause(')) return new Promise(resolve => { resolvePause = resolve; });
      return Promise.resolve({ instanceId: 'one' }); } });
  const window = { webContents: contents, isDestroyed: () => false };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true,
    readWorkArea: () => AREA, timeoutMs: 5 });
  await port.read({}); await assert.rejects(port.pause(true), /timeout/);
  await assert.rejects(port.probeMovement(), /unavailable/); resolvePause(); await Promise.resolve();
  await assert.rejects(port.probeMovement(), /unavailable/); port.close();
});
test('canonical details-only main-frame navigation invalidates a pending geometry read', async () => {
  const f = windowFixture({ geometry(contents) { contents.emit('did-start-navigation', { isMainFrame: true }); return geometry(); } });
  await f.port.read({}); const result = await f.port.probeMovement();
  assert.equal(result.status, 'incomplete'); assert.equal(f.moves.length, 0); f.port.close();
});
