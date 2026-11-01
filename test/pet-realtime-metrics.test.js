'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFrameMetrics } = require('../src/surfaces/pet/realtime/frame-metrics.mjs');

test('realtime metrics: empty measurements remain unknown, not a zero-duration pass', () => {
  const value = createFrameMetrics().snapshot();
  assert.equal(value.samples, 0);
  assert.equal(value.totalRecorded, 0);
  assert.equal(value.runtime, null);
  for (const key of ['frameIntervalMs', 'updateMs', 'renderSubmissionMs']) {
    assert.deepEqual(value[key], { count: 0, p50: null, p95: null, p99: null, max: null, overTargetCount: 0 });
  }
  assert.equal('accepted' in value, false);
  assert.match(value.sources.renderSubmissionMs, /not GPU execution/);
  assert.match(value.sources.frameIntervalMs, /not displayed-frame/);
});

test('realtime metrics: exact nearest-rank quantiles and separate stage durations', () => {
  const metrics = createFrameMetrics();
  for (let i = 1; i <= 100; i++) metrics.record(i, i / 10, i / 2);
  const value = metrics.snapshot();
  assert.deepEqual(value.frameIntervalMs, { count: 100, p50: 50, p95: 95, p99: 99, max: 100, overTargetCount: 84 });
  assert.deepEqual(value.updateMs, { count: 100, p50: 5, p95: 9.5, p99: 9.9, max: 10, overTargetCount: 0 });
  assert.deepEqual(value.renderSubmissionMs, { count: 100, p50: 25, p95: 47.5, p99: 49.5, max: 50, overTargetCount: 67 });
});

test('realtime metrics: ring retains only most recent samples with fixed capacity', () => {
  const metrics = createFrameMetrics({ capacity: 3 });
  for (let i = 1; i <= 10_000; i++) metrics.record(i, 1, 0);
  const value = metrics.snapshot();
  assert.equal(value.capacity, 3);
  assert.equal(value.samples, 3);
  assert.equal(value.totalRecorded, 10_000);
  assert.deepEqual(value.frameIntervalMs, { count: 3, p50: 9999, p95: 10000, p99: 10000, max: 10000, overTargetCount: 3 });
});

test('realtime metrics: threshold is strict and zero duration is valid', () => {
  const metrics = createFrameMetrics({ capacity: 2, frameTargetMs: 10 });
  metrics.record(0, 10, 10.001);
  assert.equal(metrics.snapshot().frameIntervalMs.max, 0);
  assert.equal(metrics.snapshot().updateMs.overTargetCount, 0);
  assert.equal(metrics.snapshot().renderSubmissionMs.overTargetCount, 1);
});

test('realtime metrics: invalid observations fail atomically', () => {
  const metrics = createFrameMetrics();
  metrics.record(16, 2, 3);
  const before = metrics.snapshot();
  for (const invalid of [NaN, Infinity, -Infinity, -1, undefined, '2', null]) {
    for (let column = 0; column < 3; column++) {
      const values = [16, 2, 3]; values[column] = invalid;
      assert.throws(() => metrics.record(...values), TypeError);
      assert.deepEqual(metrics.snapshot(), before);
    }
  }
});

test('realtime metrics: reset removes old maxima, counts and quantiles', () => {
  const metrics = createFrameMetrics({ capacity: 1 });
  metrics.record(1000, 999, 998);
  metrics.reset(); metrics.reset();
  assert.equal(metrics.snapshot().totalRecorded, 0);
  assert.equal(metrics.snapshot().frameIntervalMs.max, null);
  metrics.record(1, 2, 3);
  assert.equal(metrics.snapshot().frameIntervalMs.max, 1);
  assert.equal(metrics.snapshot().totalRecorded, 1);
});

test('realtime metrics: illegal capacity and target configuration are rejected', () => {
  for (const capacity of [0, -1, 1.5, 3601, NaN, Infinity, '3', null]) {
    assert.throws(() => createFrameMetrics({ capacity }), RangeError);
  }
  for (const frameTargetMs of [0, -1, NaN, Infinity, '3', null]) {
    assert.throws(() => createFrameMetrics({ frameTargetMs }), RangeError);
  }
  assert.equal(createFrameMetrics({ capacity: 3600 }).snapshot().capacity, 3600);
});

test('realtime metrics: externally supplied runtime labels are copied without hardware inference', () => {
  const runtime = { runtime: 'Electron test', graphics: 'SwiftShader', nativeGPU: false, dpr: 2, hardware: null };
  const metrics = createFrameMetrics({ runtime });
  runtime.graphics = 'changed';
  const value = metrics.snapshot();
  assert.equal(value.runtime.graphics, 'SwiftShader');
  assert.equal(value.runtime.hardware, null);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.runtime));
  assert.ok(Object.isFrozen(value.updateMs));
});

test('realtime metrics: runtime labels reject retained objects or unbounded metadata', () => {
  for (const runtime of [[], 'Electron', { hardware: {} }, { name: 'a'.repeat(1025) }, { value: NaN },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i, 'label']))]) {
    assert.throws(() => createFrameMetrics({ runtime }), TypeError);
  }
});
