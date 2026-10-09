'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecordingContext } = require('../test-support/pet-recording-context');
const { createPetRuntimeFixture } = require('../test-support/pet-runtime-fixture');
const { PET_CONTENT_PAYLOAD, settle } = require('../test-support/pet-sync-fixture');

test('pet bounds recorder preserves affine multiplication, four corners and isolated transform snapshots', () => {
  const context = createRecordingContext('contract');
  context.translate(10, 20);
  context.scale(2, -3);
  context.transform(1, 2, 3, 4, 5, 6);
  assert.deepEqual(context.getTransform(), { a: 2, b: -6, c: 6, d: -12, e: 20, f: 2 });
  context.getTransform().a = 100;
  context.fillRect(1, 2, 3, 4);
  assert.deepEqual(context._calls.map(({ x, y }) => [x, y]), [[34, -28], [40, -46], [58, -76], [64, -94]]);
  assert.deepEqual(context._box, { minX: 34, minY: -94, maxX: 64, maxY: -28 });
  context.setTransform(1, 0, 0, 1, 0, 0);
  assert.equal(context._calls[0].matrix.a, 2);
  context.rotate(Math.PI / 2);
  const matrix = context.getTransform();
  assert.ok(Math.abs(matrix.a) < 1e-12);
  assert.ok(Math.abs(matrix.b - 1) < 1e-12);
  assert.ok(Math.abs(matrix.c + 1) < 1e-12);
});

test('pet bounds recorder stacks matrices only and deliberately retains alpha and styles across restore', () => {
  const context = createRecordingContext('contract');
  context.restore();
  context.translate(3, 4);
  context.globalAlpha = 0.2;
  context.fillStyle = 'red';
  context.strokeStyle = 'green';
  context.lineWidth = 2;
  context.font = '12px monospace';
  context.save();
  context.translate(5, 6);
  context.save();
  context.scale(2, 3);
  context.globalAlpha = 0.8;
  context.fillStyle = 'blue';
  context.strokeStyle = 'pink';
  context.lineWidth = 4;
  context.font = '20px monospace';
  context.restore();
  assert.deepEqual(context.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 8, f: 10 });
  context.restore();
  assert.deepEqual(context.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 });
  assert.deepEqual([context.globalAlpha, context.fillStyle, context.strokeStyle, context.lineWidth, context.font],
    [0.8, 'blue', 'pink', 4, '20px monospace']);
});

test('pet bounds recorder retains drawImage overloads, crop metadata differences and text/stroke bounds', () => {
  const context = createRecordingContext('contract');
  const image = { width: 8, height: 6, src: 'fixture.png' };
  context.drawImage(image, 2, 3);
  assert.deepEqual(context._box, { minX: 2, minY: 3, maxX: 10, maxY: 9 });
  assert.ok(context._calls.every(call => call.imageSrc === image.src));
  context._reset();
  context.drawImage(image, 2, 3, 4, 5);
  assert.deepEqual(context._box, { minX: 2, minY: 3, maxX: 6, maxY: 8 });
  context._reset();
  context.drawImage(image, 0, 0, 8, 6, 10, 20, 3, 4);
  assert.deepEqual(context._box, { minX: 10, minY: 20, maxX: 13, maxY: 24 });
  assert.ok(context._calls.every(call => !Object.hasOwn(call, 'imageSrc')));
  context._reset();
  context.lineWidth = 4;
  context.strokeRect(2, 3, 4, 5);
  assert.deepEqual(context._box, { minX: 0, minY: 1, maxX: 8, maxY: 10 });
  context._reset();
  context.font = '20px monospace';
  context.fillText('ab', 5, 30);
  assert.deepEqual(context._box, { minX: 5, minY: 10, maxX: 29.8, maxY: 30 });
  assert.throws(() => context.fillRect(Infinity, 0, 1, 1), /contract: fillRect.*非有限坐标/);
});

test('pet bounds recorder keeps a bounded recent trace without forgetting historic bounds', () => {
  const context = createRecordingContext('contract');
  for (let index = 0; index < 5001; index++) context.fillRect(index, 0, 1, 1);
  assert.equal(context._calls.length, 10004);
  assert.equal(context._calls[0].x, 2500);
  assert.deepEqual(context._box, { minX: 0, minY: 0, maxX: 5001, maxY: 1 });
  context.translate(7, 8);
  context._reset();
  assert.equal(context._calls.length, 0);
  assert.deepEqual(context._box, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  assert.deepEqual(context.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 7, f: 8 });
});

for (const live of [false, true]) {
  test(`pet runtime fixture preserves ${live ? 'sync live' : 'smoke inert'} media, content and style contracts`, async t => {
    const contentPayload = { ...PET_CONTENT_PAYLOAD, fixtureKind: live ? 'sync' : 'smoke' };
    const createHarness = createPetRuntimeFixture({ contentPayload, styleProperties: live, liveReducedMotion: live });
    const harness = createHarness({ deterministicRandom: true });
    t.after(() => harness.runtime.stop());
    await settle();
    assert.equal(await harness.window.imAdhder.pet_getContent(), contentPayload);
    const style = harness.document.getElementById('fixture-node').style;
    if (live) {
      style.setProperty('--probe', 12);
      assert.equal(style['--probe'], '12');
    } else assert.equal(Object.hasOwn(style, 'setProperty'), false);
    harness.document.documentElement.style.setProperty('--probe', 12);
    assert.equal(Object.hasOwn(harness.document.documentElement.style, '--probe'), false);
    const media = harness.window.matchMedia('(prefers-reduced-motion: reduce)');
    assert.equal(media.matches, false);
    const changes = [];
    const listener = event => changes.push(event.matches);
    media.addEventListener('change', listener);
    if (live) {
      assert.equal(harness.window.matchMedia('(prefers-reduced-motion: reduce)'), media);
      harness.window.setReducedMotion(true);
      assert.equal(media.matches, true);
      harness.window.setReducedMotion(false);
      assert.equal(media.matches, false);
      assert.deepEqual(changes, [true, false]);
      media.removeEventListener('change', listener);
      harness.window.setReducedMotion(true);
      assert.deepEqual(changes, [true, false]);
    } else {
      assert.equal(Object.hasOwn(harness.window, 'setReducedMotion'), false);
      assert.notEqual(harness.window.matchMedia('(prefers-reduced-motion: reduce)'), media);
      assert.deepEqual(changes, []);
    }
    assert.equal(harness.window.matchMedia('(resolution: 2dppx)').matches, false);
    assert.notEqual(harness.window.matchMedia('(resolution: 2dppx)'), harness.window.matchMedia('(resolution: 2dppx)'));
  });
}

test('pet runtime fixture keeps deterministic clocks, one-shot timeouts and its explicit teardown limits', async () => {
  const createHarness = createPetRuntimeFixture({ contentPayload: PET_CONTENT_PAYLOAD });
  const harness = createHarness({ deterministicRandom: true });
  try {
    await settle();
    const initial = harness.clockState.now;
    assert.equal(new Date(initial).getHours(), 14);
    harness.frame(2, 10);
    harness.frameBy(25, 3);
    assert.equal(harness.clockState.now, initial + 95);
    const fired = [];
    harness.timers.timeouts.set(1000, { fn: () => fired.push('once'), delay: 12345 });
    assert.equal(harness.fireTimeoutByDelay(12345), true);
    assert.equal(harness.fireTimeoutByDelay(12345), false);
    assert.deepEqual(fired, ['once']);
    const element = harness.document.getElementById('fixture-node');
    for (const target of [element, harness.document, harness.window]) {
      let calls = 0;
      const handler = () => calls++;
      target.addEventListener('fixture-event', handler);
      target.removeEventListener('fixture-event', handler);
      target.dispatch('fixture-event');
      assert.equal(calls, 1, 'general fake DOM removals are still no-ops, not teardown evidence');
    }
    const frames = [...harness.timers.rafCallbacks];
    const intervals = [...harness.timers.intervals];
    assert.ok(frames.length > 0);
    assert.ok(intervals.length > 0);
    harness.runtime.stop();
    assert.deepEqual(harness.timers.rafCallbacks, frames, 'fake rAF cancellation stays a no-op');
    assert.deepEqual(harness.timers.intervals, intervals, 'fake interval cancellation stays a no-op');
  } finally { harness.runtime.stop(); }
});
