'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputLeasePublisher } = require('../src/surfaces/pet/realtime/input-lease-publisher.mjs');
const { INPUT_LEASE_SCOPE } = require('../src/core/pet-input-lease.mjs');
const { assertIpcPayload } = require('../src/application/ipc');
const { registerPetRuntimeIpc } = require('../src/bootstrap/pet-runtime');
const EPOCH = '00000000-0000-4000-8000-000000000001';
const cap = extra => ({ schemaVersion: 1, epoch: EPOCH, viewRevision: 1, available: true, ttlMs: 300, renewMs: 100, scope: INPUT_LEASE_SCOPE, ...extra });
const interaction = (generation = 1, extra = {}) => ({ mode: 'pending', pointerId: 1, contactGeneration: generation, captured: true, domCaptured: true, ...extra });
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
function fixture({ delayed = false } = {}) {
  let now = 0, current = null, capability = cap(), visual = 'idle'; const calls = [], pending = [], cancelled = [], errors = [];
  const publisher = createInputLeasePublisher({ now: () => now,
    send(request) { calls.push(request); if (!delayed) return { ok: true, request, capability, reason: null }; const gate = deferred(); pending.push({ ...gate, request }); return gate.promise; },
    cancelContact(id) { if (current?.contactGeneration === id && current.pointerId !== null) { cancelled.push(id); current = null; visual = 'idle'; } },
    cancelInput() { if (current?.pointerId != null) { cancelled.push(current.contactGeneration); current = null; visual = 'idle'; } },
    onError: error => errors.push(error.message) });
  publisher.observe(capability);
  return { publisher, calls, pending, cancelled, errors, at: t => { now = t; },
    setCapability(next) { capability = next; publisher.observe(next); },
    update(value, enabled = true) { current = value; if (value) visual = value.mode; publisher.update(value, enabled); },
    release(mode = 'landing') { current = null; visual = mode; publisher.update(null); },
    visual: () => visual,
    respond(index, ok = true, next = capability) { const entry = pending[index]; entry.resolve({ ok, request: entry.request, capability: next, reason: ok ? null : 'rejected' }); } };
}
test('same active contact renews across pending/petting/drag; release tail has no lease', async () => {
  const f = fixture(); f.update(interaction()); await flush(); assert.deepEqual(f.calls.map(x => x.phase), ['begin']);
  f.at(99); f.update(interaction(1, { mode: 'petting' })); await flush(); assert.equal(f.calls.length, 1);
  f.at(100); f.update(interaction(1, { mode: 'drag' })); await flush(); assert.equal(f.calls.at(-1).phase, 'renew');
  f.at(110); f.release(); await flush(); assert.equal(f.calls.at(-1).phase, 'end'); assert.equal(f.visual(), 'landing');
  f.at(200); f.update(interaction(1, { mode: 'petting', pointerId: null, captured: false, domCaptured: false })); await flush();
  assert.equal(f.calls.length, 3); assert.equal(f.publisher.snapshot().inFlight, false);
});
test('queued/unowned/uncaptured or paused contact cannot acquire', async () => {
  const f = fixture();
  for (const fields of [{ pointerId: null }, { contactGeneration: null }, { captured: false }, { domCaptured: false }, { mode: 'landing' }, { mode: 'idle' }]) f.update(interaction(1, fields));
  f.update(interaction(), false); await flush(); assert.equal(f.calls.length, 0);
});
test('release and same-pointer regrab retain terminal priority and immutable contact identity', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush();
  f.release(); f.update(interaction(2)); await flush(); assert.equal(f.calls.length, 1);
  f.respond(0); await flush(); assert.equal(f.calls[1].phase, 'end'); assert.equal(f.calls[1].contactGeneration, 1);
  f.respond(1); await flush(); assert.equal(f.calls[2].phase, 'begin'); assert.equal(f.calls[2].contactGeneration, 2);
  assert.deepEqual(f.calls.map(x => x.sequence), [1, 2, 3]); assert.deepEqual(f.cancelled, []);
  f.respond(2); await flush();
});
test('late rejected begin after release preserves approved landing and finishing expression', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.release('landing-smile');
  f.respond(0, false); await flush(); assert.equal(f.visual(), 'landing-smile'); assert.deepEqual(f.cancelled, []);
  assert.equal(f.publisher.snapshot().contactGeneration, null);
});
test('old contact rejection cannot cancel newer regrab sharing pointerId', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.release(); f.update(interaction(2));
  f.respond(0, false); await flush(); assert.equal(f.calls.at(-1).contactGeneration, 2); assert.deepEqual(f.cancelled, []);
  f.respond(1); await flush();
});
test('epoch changes clear input without relabelling an old pending begin after await', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush();
  const next = cap({ epoch: '00000000-0000-4000-8000-000000000002' }); f.setCapability(next);
  f.update(interaction(1)); assert.deepEqual(f.cancelled, [1]);
  f.respond(0); await flush(); assert.equal(f.calls[1].phase, 'end'); assert.equal(f.calls[1].epoch, EPOCH);
  f.respond(1); await flush(); assert.equal(f.calls.length, 2, 'same old contact cannot re-begin under new epoch');
  f.update(interaction(2)); await flush(); assert.equal(f.calls[2].epoch, next.epoch);
  f.respond(2); await flush();
});
test('never-settled request remains the sole in-flight; local frame expiry cancels without retries', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.at(300); f.update(interaction());
  f.at(500); f.update(interaction(2)); await flush(); assert.equal(f.calls.length, 1); assert.deepEqual(f.cancelled, [1, 2]);
  assert.equal(f.publisher.snapshot().expired, 1); assert.equal(f.publisher.snapshot().inFlight, true);
  f.respond(0); await flush(); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].phase, 'end');
  f.respond(1); await flush(); assert.equal(f.calls.length, 2);
});
test('unknown transport outcome sends one terminal request, never replays begin/renew', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.pending[0].reject(new Error('uncertain'));
  await flush(); assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.deepEqual(f.cancelled, [1]);
  f.pending[1].reject(new Error('terminal uncertain')); await flush(); assert.equal(f.calls.length, 2);
  f.update(interaction()); await flush(); assert.equal(f.calls.length, 2); assert.equal(f.errors.length, 2);
});
test('missing capability revokes owned input; recovery and backwards time require fresh contact', async () => {
  const f = fixture(); f.update(interaction()); await flush(); f.setCapability(null); await flush();
  f.setCapability(cap()); f.update(interaction()); await flush(); assert.equal(f.calls.filter(x => x.phase === 'begin').length, 1);
  f.at(200); f.update(interaction(2)); await flush(); f.at(100); f.update(interaction(2)); await flush();
  assert(f.cancelled.includes(2)); assert.equal(f.calls.at(-1).phase, 'end');
});
test('dispose drains terminal intent after an in-flight begin without retaining or cancelling a visual owner', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.release(); f.publisher.dispose();
  f.respond(0); await flush(); assert.equal(f.calls[1].phase, 'end'); f.respond(1); await flush();
  assert.equal(f.publisher.snapshot().closed, true); assert.equal(f.publisher.snapshot().inFlight, false); assert.equal(f.visual(), 'landing');
});
test('existing runtime codec admits only the closed optional lease and preserves original booleans', () => {
  const runtime = { visible: true, menuOpen: false, dragging: false, prefersReducedMotion: false };
  const request = { schemaVersion: 1, epoch: EPOCH, viewRevision: 1, contactGeneration: 1, sequence: 1, phase: 'begin' };
  assert.deepEqual(assertIpcPayload('pet:updateRuntime', runtime), runtime);
  const decoded = assertIpcPayload('pet:updateRuntime', { ...runtime, inputLease: request }); assert.deepEqual(decoded.inputLease, request);
  for (const patch of [{ deadline: 9000 }, { sequence: NaN }, { phase: 'capture' }, { contactGeneration: 0 }, { epoch: 'old' }])
    assert.throws(() => assertIpcPayload('pet:updateRuntime', { ...runtime, inputLease: { ...request, ...patch } }));
});
test('bootstrap delegates lease identity to current host and never stores lease metadata in runtime projection', () => {
  let handler; const applied = [], delegated = [], event = { sender: {} };
  const runtime = { visible: true, menuOpen: false, dragging: true, prefersReducedMotion: false };
  let host = { applyInputLease(e, r) { delegated.push([e, r]); return { ok: true, request: r }; } };
  registerPetRuntimeIpc({ registerIpc(name, fn) { assert.equal(name, 'pet:updateRuntime'); handler = fn; }, getWindow: () => host, applyRuntime: r => applied.push(r) });
  const inputLease = { phase: 'begin' }; assert.equal(handler(event, { ...runtime, inputLease }).ok, true);
  assert.deepEqual(delegated, [[event, inputLease]]); assert.deepEqual(applied, [runtime]);
  host = { applyInputLease: () => ({ ok: false, reason: 'stale-owner' }) }; handler(event, { ...runtime, inputLease }); assert.equal(applied.length, 1);
  host = {}; assert.equal(handler(event, { ...runtime, inputLease }).ok, false); handler(event, runtime); assert.equal(applied.length, 2);
});

test('terminal reply carrying a new epoch retires the session before observing capability, with no duplicate end', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  f.release(); await flush();
  f.respond(1, false, cap({ epoch: '00000000-0000-4000-8000-000000000002' })); await flush();
  assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.equal(f.publisher.snapshot().inFlight, false);
  assert.equal(f.visual(), 'landing');
});

test('malformed terminal acknowledgement is recorded as unconfirmed without retrying end', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  f.release(); await flush(); f.pending[1].resolve(undefined); await flush();
  assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.deepEqual(f.errors, ['input-lease-response-invalid']);
  assert.equal(f.publisher.snapshot().rejected, 1); assert.equal(f.publisher.snapshot().inFlight, false);
});
