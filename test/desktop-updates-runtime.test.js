'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplicationUpdates } = require('../src/bootstrap/desktop-updates');
test('scheduled checks respect preference, only pending landings block restart, shutdown clears scheduling', async () => {
  const jobs = []; let enabled = false, checks = 0, installed = 0, verified = 0, storageOk = false;
  const state = { focusSession: { status: 'idle' }, quickStartDecision: { status: 'done' } };
  const runtime = createApplicationUpdates({ stateRepository: {
    get: () => ({ autoCheckUpdates: enabled }), snapshot: () => state,
    authoritativeWrites: { verify: () => { verified += 1; return { ok: storageOk, reason: 'config-write-unknown' }; } }
  }, appHost: { whenReady: async () => {} }, setTimer: (fn, ms) => { const job = { fn, ms }; jobs.push(job); return job; },
  clearTimer: job => { if (job) job.cancelled = true; }, now: () => 123,
  createTransport: () => ({ currentVersion: '1.0.0', transport: {
    check: async () => { checks += 1; return { available: true, version: '1.1.0' }; },
    download: () => ({ promise: Promise.resolve(), cancel() {} }), install: () => { installed += 1; }
  } }) });
  await Promise.resolve(); assert.equal(jobs[0].ms, 60000);
  await jobs[0].fn(); assert.equal(checks, 0); assert.equal(jobs[1].ms, 6 * 3600000);
  enabled = true; await jobs[1].fn(); assert.equal(checks, 1);
  await runtime.download(); state.quickStartDecision.status = 'pending';
  assert.equal(runtime.install().reason, 'pending-landing'); assert.equal(verified, 0);
  state.quickStartDecision.status = 'done';
  assert.equal(runtime.install().reason, 'storage-unavailable');
  storageOk = true; assert.equal(runtime.install().ok, true);
  assert.equal(verified, 3); assert.equal(installed, 1);
  runtime.close(); assert.equal(jobs.at(-1).cancelled, true);
  await jobs.at(-1).fn(); assert.equal(checks, 1);
});
