'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartupMetrics } = require('../src/surfaces/pet/realtime/startup-metrics.mjs');

test('startup metrics distinguish RAF timestamp, CPU submission and elapsed readiness', () => {
  const metrics = createStartupMetrics(10);
  metrics.stageStarted(12); metrics.stageReady(112); metrics.ready(120);
  metrics.frame(119, 122, 125, 700);
  const result = metrics.snapshot();
  assert.equal(result.stageLoadMs, 100); assert.equal(result.readyMs, 110);
  assert.deepEqual(result.firstFrame, { callbackAtMs: 119, updateStartedAtMs: 122, renderFinishedAtMs: 700,
    callbackDelayMs: 3, updateMs: 3, renderSubmissionMs: 575, totalCpuMs: 578, readyToRenderFinishedMs: 580 });
  metrics.frame(800, 801, 802, 803);
  assert.deepEqual(metrics.snapshot(), result, 'only the first completed render is retained');
  result.firstFrame.updateMs = -1; assert.equal(metrics.snapshot().firstFrame.updateMs, 3);
});

test('startup metrics keep missing or regressed timing unknown rather than manufacturing zero samples', () => {
  const metrics = createStartupMetrics(NaN);
  assert.equal(metrics.snapshot().firstFrame, null);
  metrics.stageStarted(12); metrics.stageReady(11); metrics.ready(20);
  metrics.frame(30, 29, NaN, 35);
  const result = metrics.snapshot();
  assert.equal(result.createdAtMs, null); assert.equal(result.stageLoadMs, null); assert.equal(result.readyMs, null);
  assert.equal(result.firstFrame.callbackDelayMs, null); assert.equal(result.firstFrame.updateMs, null);
  assert.equal(result.firstFrame.renderSubmissionMs, null); assert.equal(result.firstFrame.totalCpuMs, 6);
});
