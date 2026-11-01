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

test('realtime metrics: raw rows preserve optional timestamps and immutable ascending sequence', () => {
  const metrics = createFrameMetrics({ capacity: 4 });
  metrics.record(16, 2, 3);
  metrics.record(17, 4, 5, 0);
  metrics.record(18, 6, 7, 102.5);
  const result = metrics.readSince();
  assert.deepEqual(result, { schemaVersion: 1, rows: [
    { sequence: 1, atMs: null, frameIntervalMs: 16, updateMs: 2, renderSubmissionMs: 3 },
    { sequence: 2, atMs: 0, frameIntervalMs: 17, updateMs: 4, renderSubmissionMs: 5 },
    { sequence: 3, atMs: 102.5, frameIntervalMs: 18, updateMs: 6, renderSubmissionMs: 7 }
  ], epoch: 0, totalRecorded: 3, firstRetainedSequence: 1, lastSequence: 3,
  overwrittenSinceCursor: 0, remaining: 0, windowCapacity: 4 });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
  assert.ok(result.rows.every(Object.isFrozen));
  assert.throws(() => { result.rows[0].atMs = 99; }, TypeError);
});

test('realtime metrics: wrapped ring returns paged rows and explicit overwritten counts', () => {
  const metrics = createFrameMetrics({ capacity: 3 });
  for (let i = 1; i <= 7; i++) metrics.record(i, i * 2, i * 3, i * 10);
  const first = metrics.readSince({ limit: 2 });
  assert.deepEqual(first.rows.map(row => row.sequence), [5, 6]);
  assert.deepEqual(first.rows.map(row => row.atMs), [50, 60]);
  assert.deepEqual(first.rows.map(row => row.updateMs), [10, 12]);
  assert.equal(first.totalRecorded, 7);
  assert.equal(first.firstRetainedSequence, 5);
  assert.equal(first.lastSequence, 7);
  assert.equal(first.overwrittenSinceCursor, 4);
  assert.equal(first.remaining, 1);
  const next = metrics.readSince({ afterSequence: 6, limit: 1 });
  assert.deepEqual(next.rows.map(row => row.sequence), [7]);
  assert.equal(next.overwrittenSinceCursor, 0);
  assert.equal(next.remaining, 0);
  assert.deepEqual(metrics.readSince({ afterSequence: 7 }).rows, []);
  assert.equal(metrics.readSince({ afterSequence: 2 }).overwrittenSinceCursor, 2);
});

test('realtime metrics: reads never consume rows or mutate quantiles, sequences or cursors', () => {
  const metrics = createFrameMetrics({ capacity: 2 });
  for (let i = 1; i <= 5; i++) metrics.record(i, i, i, i);
  const before = metrics.snapshot(), result = metrics.readSince();
  assert.deepEqual(metrics.readSince(), result);
  metrics.readSince({ afterSequence: 4, limit: 1 });
  assert.deepEqual(metrics.snapshot(), before);
  metrics.record(6, 6, 6, 6);
  assert.deepEqual(result.rows.map(row => row.sequence), [4, 5], 'returned snapshots cannot alias the overwritten ring');
  assert.deepEqual(metrics.readSince().rows.map(row => row.sequence), [5, 6]);
});

test('realtime metrics: raw reads use a closed, bounded cursor contract', () => {
  const metrics = createFrameMetrics(); metrics.record(1, 2, 3);
  for (const options of [null, [], 4, 'cursor', { extra: true }, { [Symbol('extra')]: true }]) {
    assert.throws(() => metrics.readSince(options), TypeError);
  }
  for (const afterSequence of [-1, 0.5, NaN, Infinity, '0', null, Number.MAX_SAFE_INTEGER + 1, 2]) {
    assert.throws(() => metrics.readSince({ afterSequence }), RangeError);
  }
  for (const limit of [0, -1, 0.5, 3601, NaN, Infinity, '1', null]) {
    assert.throws(() => metrics.readSince({ limit }), RangeError);
  }
  assert.equal(metrics.readSince({ limit: 3600 }).rows.length, 1);
});

test('realtime metrics: reset clears window and counters but never reuses sequence identities', () => {
  const metrics = createFrameMetrics({ capacity: 3 });
  for (let i = 1; i <= 4; i++) metrics.record(i, 0, 0, i);
  metrics.reset();
  const cleared = metrics.readSince({ afterSequence: 2 });
  assert.deepEqual(cleared.rows, []);
  assert.equal(cleared.epoch, 1);
  assert.equal(cleared.totalRecorded, 0);
  assert.equal(cleared.lastSequence, 4);
  assert.equal(cleared.firstRetainedSequence, null);
  assert.equal(cleared.overwrittenSinceCursor, 2, 'reset-cleared recorded rows are explicitly missing');
  assert.equal(cleared.remaining, 0);
  metrics.record(10, 1, 2, 1);
  const fresh = metrics.readSince({ afterSequence: 2 });
  assert.deepEqual(fresh.rows.map(row => row.sequence), [5]);
  assert.equal(fresh.rows[0].atMs, 1, 'timestamps are supplied observations, not sequence identities');
  assert.equal(fresh.overwrittenSinceCursor, 2);
  assert.equal(fresh.firstRetainedSequence, 5);
  assert.equal(fresh.totalRecorded, 1);
  assert.equal(metrics.snapshot().lastSequence, 5);
  assert.equal(metrics.snapshot().totalRecorded, 1);
  metrics.reset(); metrics.reset();
  assert.equal(metrics.readSince({ afterSequence: 5 }).overwrittenSinceCursor, 0);
  assert.equal(metrics.readSince().epoch, 3, 'even an empty reset is observable');
  metrics.record(11, 1, 1);
  assert.equal(metrics.readSince().rows[0].sequence, 6);
});

test('realtime metrics: invalid timestamp or duration cannot consume a sequence or overwrite raw rows', () => {
  const metrics = createFrameMetrics({ capacity: 1 }); metrics.record(1, 2, 3, 10);
  const before = metrics.readSince(), snapshot = metrics.snapshot();
  for (const atMs of [-1, NaN, Infinity, -Infinity, '10', {}, false]) {
    assert.throws(() => metrics.record(1, 2, 3, atMs), TypeError);
    assert.deepEqual(metrics.readSince(), before);
    assert.deepEqual(metrics.snapshot(), snapshot);
  }
  assert.throws(() => metrics.record(1, NaN, 3, 11), TypeError);
  assert.deepEqual(metrics.readSince(), before);
  metrics.record(4, 5, 6, null);
  assert.equal(metrics.readSince().rows[0].sequence, 2);
  assert.equal(metrics.readSince().rows[0].atMs, null);
});

test('realtime metrics: first empty read has no invented samples or missing sequences', () => {
  const result = createFrameMetrics().readSince();
  assert.deepEqual(result, { schemaVersion: 1, rows: [], epoch: 0, totalRecorded: 0,
    firstRetainedSequence: null, lastSequence: 0, overwrittenSinceCursor: 0,
    remaining: 0, windowCapacity: 600 });
});
