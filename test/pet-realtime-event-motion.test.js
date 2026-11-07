'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetPointerSpace } = require('../src/platform/electron/windows/pet-pointer-space');
const { createEventMotionSource } = require('../src/surfaces/pet/realtime/event-motion-source.mjs');
const { createPointerCoordinateReader } = require('../research/animation-0.1.0/animation-foundation-v1/body-runtime/pointer-coordinates.mjs');
const VERSIONS = { electron: '44.10.1', chrome: '152.0.7977.169' };
const DISPLAY = { id: 7, rotation: 0, bounds: { x: -1600, y: -200, width: 1600, height: 1000 }, scaleFactor: 1.25 };
function projection(displays = [DISPLAY], versions = VERSIONS, platform = 'win32') {
  return createPetPointerSpace({ screen: { getAllDisplays: () => displays }, platform, versions });
}
const event = changes => ({ type: 'pointermove', pointerType: 'mouse', pointerId: 1, isPrimary: true, isTrusted: true,
  timeStamp: 100, clientX: 30.5, clientY: 41.25, screenX: -1200.25, screenY: -100.5, ...changes });
function source() {
  let cancels = 0; const document = { pointerLockElement: null }, target = { hasPointerCapture: id => id === 1 };
  const value = createEventMotionSource({ document, target });
  return { value, document, cancels: () => cancels, cancel: () => { cancels++; } };
}
test('main projection admits only exact Windows runtime and one finite bounded display, without cursor reads', () => {
  const valid = projection()(); assert.equal(valid.kind, 'event-screen-dip'); assert.equal(valid.revision, 1);
  assert.deepEqual(valid.bounds, DISPLAY.bounds); assert.equal(valid.scaleFactor, 1.25);
  for (const displays of [[], [DISPLAY, { ...DISPLAY, id: 8 }], [{ ...DISPLAY, bounds: { ...DISPLAY.bounds, x: NaN } }],
    [{ ...DISPLAY, scaleFactor: 0 }], [{ ...DISPLAY, id: 'unverified' }]]) assert.equal(projection(displays)().kind, 'client');
  assert.equal(projection([DISPLAY], VERSIONS, 'darwin')().kind, 'client');
  assert.equal(projection([DISPLAY], { ...VERSIONS, chrome: '152.0.7977.170' })().kind, 'client');
  const fail = createPetPointerSpace({ platform: 'win32', versions: VERSIONS, screen: { getAllDisplays() { throw Error('unavailable'); },
    getCursorScreenPoint() { assert.fail('not an input/cursor poller'); } } });
  assert.equal(fail().reason, 'display-context-unavailable');
});
test('projection copies metadata and increments epoch only for native display/runtime identity changes', () => {
  const display = structuredClone(DISPLAY), displays = [display], read = projection(displays);
  const first = read(); first.bounds.x = 999; assert.equal(read().bounds.x, DISPLAY.bounds.x); assert.equal(read().revision, 1);
  display.id = 8; assert.equal(read().revision, 2);
  display.scaleFactor = 1.5; assert.equal(read().revision, 3);
  display.bounds.x -= 20; assert.equal(read().revision, 4);
  display.rotation = 180; assert.equal(read().revision, 5);
  displays.push({ ...DISPLAY, id: 9 }); assert.equal(read().revision, 6); assert.equal(read().kind, 'client');
});
test('one delivered event supplies unchanged fractional screen DIP while contact stays client CSS', () => {
  const f = source(), space = projection()(); f.value.setSpace(space, 50, f.cancel);
  const e = event(); Object.defineProperty(e, 'devicePixelRatio', { get() { assert.fail('DPR is render-only'); } });
  const read = createPointerCoordinateReader(value => { assert.equal(value, e); return f.value.read(value); });
  assert.deepEqual(read(e), { x: 30.5, y: 41.25, motionX: -1200.25, motionY: -100.5 });
  e.screenX = -1300;
  assert.equal(f.value.snapshot().rows[0].motion.x, -1200.25);
  const snapshot = f.value.snapshot(); snapshot.rows[0].motion.x = 5;
  assert.equal(f.value.snapshot().rows[0].motion.x, -1200.25);
  assert.equal(f.value.snapshot().scope, 'same-delivered-DOM-event-not-OS-provenance');
});
test('local movement and backing-window observations cannot be used as event-owned motion', () => {
  const f = source(); f.value.setSpace(projection()(), 0, f.cancel);
  const a = f.value.read(event()), b = f.value.read(event({ clientX: 250, clientY: 15, windowScreenX: 9000 }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(f.value.read(event({ screenX: -1150 })), a);
});
test('unsupported startup retains client source but activation cancels pending work before changing space', () => {
  const f = source(), p = { clientX: 1, clientY: 2 };
  assert.deepEqual(f.value.read(p), { x: 1, y: 2 });
  f.value.setSpace(projection([], VERSIONS)(), 0, f.cancel);
  assert.deepEqual(f.value.read(p), { x: 1, y: 2 });
  const screen = { ...projection()(), revision: 2 }; f.value.setSpace(screen, 90, f.cancel);
  assert.equal(f.cancels(), 2); assert.equal(f.value.read(event({ timeStamp: 89 })), null);
  assert.deepEqual(f.value.read(event({ timeStamp: 90 })), { x: -1200.25, y: -100.5 });
});
test('topology loss is permanent for this surface, never mixed fallback or late capability rearm', () => {
  const f = source(), initial = projection()(); f.value.setSpace(initial, 0, f.cancel);
  assert.equal(f.value.setSpace(initial, 80, f.cancel), false); assert.equal(f.cancels(), 1);
  f.value.setSpace({ schemaVersion: 1, kind: 'client', revision: 2 }, 100, f.cancel);
  assert.equal(f.value.snapshot().mode, 'revoked'); assert.equal(f.value.read(event()), null);
  assert.equal(f.value.setSpace(initial, 110, f.cancel), false, 'old epoch is ignored');
  f.value.setSpace({ ...initial, revision: 3 }, 120, f.cancel);
  assert.equal(f.value.snapshot().mode, 'revoked'); assert.equal(f.value.read(event({ timeStamp: 130 })), null);
});
test('pointer-lock revocation cancels once and does not rearm after lock exit', () => {
  const f = source(); f.value.setSpace(projection()(), 0, f.cancel);
  f.document.pointerLockElement = {};
  assert.equal(f.value.revoke(f.cancel), true); assert.equal(f.value.read(event()), null); assert.equal(f.value.revoke(f.cancel), false);
  f.document.pointerLockElement = null; assert.equal(f.value.read(event()), null); assert.equal(f.cancels(), 2);
});
test('unverified route, stale sample, outside display and invalid fields fail closed without client substitution', () => {
  const f = source(); f.value.setSpace(projection()(), 50, f.cancel);
  for (const change of [{ isTrusted: false }, { pointerType: 'pen' }, { isPrimary: false }, { type: 'click' },
    { timeStamp: 49 }, { timeStamp: NaN }, { screenX: 0 }, { screenY: 800 }, { screenX: -1601 }, { screenX: Infinity }]) {
    assert.equal(f.value.read(event(change)), null, JSON.stringify(change));
  }
  assert.deepEqual(f.value.read(event({ screenX: -1600, screenY: -200 })), { x: -1600, y: -200 });
});
test('malformed or changed capability cancels and revokes, while bounded receipts never imply OS provenance', () => {
  const f = source(); f.value.setSpace(projection()(), 0, f.cancel);
  for (let i = 0; i < 100; i++) f.value.read(event({ timeStamp: i }));
  const state = f.value.snapshot(); assert.equal(state.rows.length, 32); assert.equal(state.total, 100); assert.equal(state.dropped, 68);
  assert.equal(state.rows[0].sequence, 69); assert.equal(state.rows[0].domCaptured, true);
  f.value.setSpace({ ...projection()(), bounds: { x: NaN } }, 150, f.cancel);
  assert.equal(f.value.snapshot().mode, 'revoked'); assert.equal(f.value.read(event({ timeStamp: 200 })), null);
});


test('valid release retains its final event-owned endpoint; revoked release still exposes no replacement motion', () => {
  const f = source(); f.value.setSpace(projection()(), 0, f.cancel);
  assert.deepEqual(f.value.read(event({ type: 'pointerup', screenX: -1000.5, screenY: 200.25 })), { x: -1000.5, y: 200.25 });
  assert.equal(f.value.snapshot().rows.at(-1).type, 'pointerup'); assert.equal(f.value.snapshot().rejected, 0);
  f.value.revoke(f.cancel); assert.equal(f.value.read(event({ type: 'pointerup' })), null);
});

test('view barrier rejects pre-observation client and screen events without permanently revoking the source', () => {
  for (const screen of [false, true]) {
    const f = source(); if (screen) f.value.setSpace(projection()(), 0, f.cancel);
    f.value.observeView(150, true, f.cancel);
    assert.equal(f.value.read(event({ timeStamp: 149 })), null);
    assert.equal(f.value.snapshot().rows.at(-1).reason, 'prior-view-event');
    assert.equal(f.value.read(event({ timeStamp: NaN })), null);
    assert.deepEqual(f.value.read(event({ timeStamp: 150 })), screen ? { x: -1200.25, y: -100.5 } : { x: 30.5, y: 41.25 });
    f.value.observeView(200, false, f.cancel); assert.equal(f.value.read(event({ timeStamp: 210 })), null);
    assert.equal(f.value.snapshot().rows.at(-1).reason, 'view-unavailable');
    f.value.observeView(250, true, f.cancel); assert.equal(f.value.read(event({ timeStamp: 249 })), null);
    assert.notEqual(f.value.read(event({ timeStamp: 250 })), null);
    assert.equal(f.value.snapshot().mode, screen ? 'event-screen-dip' : 'client');
  }
});
test('view barrier cannot lower its time cutoff or revive permanently revoked screen space', () => {
  const f = source(); f.value.setSpace(projection()(), 0, f.cancel);
  f.value.observeView(200, true, f.cancel); f.value.observeView(100, true, f.cancel);
  assert.equal(f.value.read(event({ timeStamp: 150 })), null);
  f.value.revoke(f.cancel); f.value.observeView(300, true, f.cancel);
  assert.equal(f.value.read(event({ timeStamp: 400 })), null); assert.equal(f.value.snapshot().mode, 'revoked');
});
