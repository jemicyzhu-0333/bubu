'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresentationViewTracker, readPresentationView } = require('../src/core/pet-presentation-view.mjs');
const input = () => ({ logicalAnchor: { x: -400, y: 50, width: 220, height: 220 }, backingBounds: { x: -550, y: -20, width: 520, height: 360 },
  contentBounds: { x: -548, y: 2, width: 516, height: 336 }, geometry: { width: 520, height: 360, stageOffset: { x: 0, y: 0 } }, stableNativeRead: true });
test('presentation receipt copies actual logical/backing/content facts; revision changes only with facts', () => {
  const tracker = createPresentationViewTracker(), source = input(), a = tracker.record(source);
  assert.equal(a.available, true); assert.equal(a.revision, 1); assert.equal(a.scope, 'native-readback-not-renderer-or-compositor-ack');
  source.contentBounds.x = 999; source.geometry.stageOffset.x = 999;
  assert.equal(a.contentBounds.x, -548); assert.equal(a.geometry.stageOffset.x, 0);
  assert(Object.isFrozen(a) && Object.isFrozen(a.logicalAnchor) && Object.isFrozen(a.geometry.stageOffset));
  assert.equal(tracker.record(input()).revision, 1);
  const b = input(); b.backingBounds.x++; assert.equal(tracker.record(b).revision, 2);
  assert.equal(tracker.record(input()).revision, 3, 'restoration is a new observation, not an old receipt');
  const copy = readPresentationView(a); assert.deepEqual(copy, a); assert.notEqual(copy, a); assert.notEqual(copy.backingBounds, a.backingBounds);
});
test('missing or unstable native facts are explicitly unavailable; no logical bounds substitution', () => {
  for (const key of ['logicalAnchor', 'backingBounds', 'contentBounds', 'geometry']) {
    const value = input(); value[key] = null; const v = createPresentationViewTracker().record(value);
    assert.equal(v.available, false); assert.equal(v[key], null); assert.deepEqual(readPresentationView(v), v);
  }
  const value = input(); value.stableNativeRead = false;
  assert.equal(createPresentationViewTracker().record(value).available, false);
});
test('receipt parser rejects forged availability, extra fields and malformed geometry', () => {
  const receipt = createPresentationViewTracker().record(input());
  for (const patch of [{ revision: 0 }, { revision: Infinity }, { available: false }, { scope: 'accepted' }, { extra: true },
    { contentBounds: { ...receipt.contentBounds, x: NaN } }, { geometry: { ...receipt.geometry, stageOffset: { x: 0, y: Infinity } } },
    { backingBounds: { ...receipt.backingBounds, width: 0 } }, { stableNativeRead: false }]) {
    assert.equal(readPresentationView({ ...receipt, ...patch }), null);
  }
});
