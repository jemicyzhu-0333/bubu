'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPointerCoordinateReader } = require('../research/animation-0.1.0/animation-foundation-v1/body-runtime/pointer-coordinates.mjs');

test('pointer spaces keep CSS contact and stable DIP motion separate, ignoring screen/DPR fields', () => {
  const event = { clientX: 24.5, clientY: 90, screenX: 123456, screenY: -123456, devicePixelRatio: 4 };
  assert.deepEqual(createPointerCoordinateReader()(event), { x: 24.5, y: 90, motionX: 24.5, motionY: 90 });
  const sample = { x: -1200.25, y: -100.5 };
  let calls = 0;
  const read = createPointerCoordinateReader(value => { calls++; assert.equal(value, event); return sample; });
  const received = read(event); sample.x = 0;
  assert.deepEqual(received, { x: 24.5, y: 90, motionX: -1200.25, motionY: -100.5 });
  assert.equal(calls, 1, 'one sample is copied for this exact event, not read again during frame execution');
});

test('motion coordinates fail closed without falling back to local coordinates', () => {
  const event = { clientX: 40, clientY: 30 };
  for (const value of [null, undefined, [], 0, { x: 1 }, { x: 1, y: 2, eligible: true },
    { x: NaN, y: 2 }, { x: 1, y: Infinity }, { x: 100001, y: 2 }, { x: 1, y: -100001 },
    Promise.resolve({ x: 1, y: 2 })]) {
    assert.equal(createPointerCoordinateReader(() => value)(event), null);
  }
  assert.equal(createPointerCoordinateReader(() => { throw Error('unavailable'); })(event), null);
  assert.throws(() => createPointerCoordinateReader(null), /synchronous event reader/);
  assert.equal(createPointerCoordinateReader(() => ({ x: 1, y: 2 }))({ clientX: NaN, clientY: 2 }), null);
});
