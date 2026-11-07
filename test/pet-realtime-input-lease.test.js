'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputLeasePublisher } = require('../src/surfaces/pet/realtime/input-lease-publisher.mjs');
const { INPUT_LEASE_SCOPE } = require('../src/core/pet-input-lease.mjs');
const { FIXTURE_TRANSPORT_SCOPE } = require('../src/core/pet-fixture-transport.mjs');
const { assertIpcPayload } = require('../src/application/ipc');
const { registerPetRuntimeIpc } = require('../src/bootstrap/pet-runtime');
const EPOCH = '00000000-0000-4000-8000-000000000001';
const PROBE = '00000000-0000-4000-8000-000000000100';
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
function fixtureTranslation(step = 1, extra = {}) {
  const view = (revision, x, y) => ({ schemaVersion: 1, revision, available: true,
    logicalAnchor: { x, y, width: 220, height: 220 }, backingBounds: { x, y, width: 400, height: 400 },
    contentBounds: { x: x + 2, y: y + 4, width: 396, height: 392 },
    geometry: { width: 400, height: 400, stageOffset: { x: 90, y: 90 } },
    stableNativeRead: true, scope: 'native-readback-not-renderer-or-compositor-ack' });
  return { schemaVersion: 1, scope: FIXTURE_TRANSPORT_SCOPE, probeId: PROBE, epoch: EPOCH,
    contactGeneration: 1, step, fromRevision: step, toRevision: step + 1,
    before: view(step, step === 1 ? 100 : 124, step === 1 ? 200 : 216),
    after: view(step + 1, step === 1 ? 124 : 100, step === 1 ? 216 : 200),
    delta: { x: step === 1 ? 24 : -24, y: step === 1 ? 16 : -16 }, ...extra };
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

test('fixture hold needs an acknowledged current contact and a closed copied identity', async () => {
  const f = fixture({ delayed: true }), hold = { probeId: PROBE, contactGeneration: 1 };
  assert.deepEqual(f.publisher.holdFixture(hold), { ok: false });
  f.update(interaction()); await flush();
  assert.deepEqual(f.publisher.holdFixture(hold), { ok: false }, 'pending begin is not an acknowledged lease');
  f.respond(0); await flush();
  for (const value of [null, { ...hold, extra: true }, { ...hold, probeId: 'bad' }, { ...hold, contactGeneration: 2 },
    { ...hold, contactGeneration: NaN }, { ...hold, [Symbol('hidden')]: true }]) assert.equal(f.publisher.holdFixture(value).ok, false);
  let touched = 0; const accessor = { ...hold };
  Object.defineProperty(accessor, 'probeId', { get() { touched++; return PROBE; } });
  assert.equal(f.publisher.holdFixture(accessor).ok, false); assert.equal(touched, 0);
  f.at(40);
  const result = f.publisher.holdFixture(hold);
  assert.deepEqual(result, { ok: true, epoch: EPOCH, viewRevision: 1, contactGeneration: 1, remainingMs: 260 });
  hold.probeId = 'changed'; result.viewRevision = 900;
  const snapshot = f.publisher.snapshot(); snapshot.fixtureHold.viewRevision = 800; snapshot.capability.viewRevision = 700;
  assert.deepEqual(f.publisher.snapshot().fixtureHold, { probeId: PROBE, epoch: EPOCH, viewRevision: 1, contactGeneration: 1, step: 0 });
  assert.equal(f.publisher.snapshot().capability.viewRevision, 1);
  assert.equal(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok, false, 'an existing hold cannot be replaced');
});

test('fixture hold suppresses renewals but preserves the original lease deadline', async () => {
  const f = fixture(); f.update(interaction()); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  for (const at of [100, 200, 299]) { f.at(at); f.update(interaction(1, { mode: 'drag' })); await flush(); }
  assert.deepEqual(f.calls.map(x => x.phase), ['begin']); assert.equal(f.publisher.snapshot().remainingMs, 1);
  assert.equal(f.publisher.snapshot().held, true);
  f.at(300); f.update(interaction()); await flush();
  assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.deepEqual(f.cancelled, [1]);
  assert.equal(f.publisher.snapshot().fixtureHold, null); assert.equal(f.publisher.snapshot().remainingMs, 0);
  assert.equal(f.publisher.snapshot().expired, 1);
  f.at(400); f.update(interaction()); await flush(); assert.equal(f.calls.length, 2);
});

test('two exact fixture steps migrate copied view identity without lease requests or deadline extension', async () => {
  const f = fixture(); f.update(interaction()); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  f.at(150); const first = fixtureTranslation(); assert.equal(f.publisher.migrateFixtureView(first), true);
  first.after.geometry.stageOffset.x = 999; first.toRevision = 500;
  assert.equal(f.publisher.snapshot().remainingMs, 150); assert.equal(f.publisher.snapshot().capability.viewRevision, 2);
  assert.equal(f.publisher.snapshot().capability.epoch, EPOCH); assert.equal(f.calls[0].viewRevision, 1);
  f.setCapability(cap({ viewRevision: 2 })); assert.deepEqual(f.cancelled, [], 'equal host publication does not revoke migrated lease');
  f.update(interaction(1, { mode: 'drag' })); await flush(); assert.equal(f.calls.length, 1);
  f.at(175); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation(2)), true);
  assert.equal(f.publisher.snapshot().remainingMs, 125); assert.equal(f.publisher.snapshot().fixtureHold.step, 2);
  f.setCapability(cap({ viewRevision: 3 }));
  assert.deepEqual(f.calls.map(x => x.phase), ['begin']);
  assert.equal(f.publisher.releaseFixtureHold('wrong-probe'), false); assert.equal(f.calls.length, 1);
  assert.equal(f.publisher.releaseFixtureHold(PROBE), true); await flush();
  assert.deepEqual(f.calls.map(x => [x.phase, x.sequence, x.viewRevision, x.epoch, x.contactGeneration]),
    [['begin', 1, 1, EPOCH, 1], ['renew', 2, 3, EPOCH, 1]]);
  assert.equal(f.publisher.snapshot().fixtureHold, null); assert.deepEqual(f.cancelled, []);
});

test('fixture migration rejects forged, mismatched, skipped and replayed receipts without relabelling', async () => {
  const f = fixture(); f.update(interaction()); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  const first = fixtureTranslation(), shifted = { ...first, fromRevision: 2, toRevision: 3,
    before: { ...first.before, revision: 2 }, after: { ...first.after, revision: 3 } };
  const wrong = [null, { ...first, extra: true }, { ...first, scope: 'OS-capture' },
    { ...first, epoch: PROBE }, { ...first, probeId: EPOCH }, { ...first, contactGeneration: 2 },
    { ...first, delta: { x: 23, y: 16 } }, { ...first, toRevision: 3 }, shifted, fixtureTranslation(2)];
  let touched = 0; const accessor = { ...first };
  Object.defineProperty(accessor, 'before', { get() { touched++; return first.before; } }); wrong.push(accessor);
  for (const value of wrong) {
    assert.equal(f.publisher.migrateFixtureView(value), false);
    assert.equal(f.publisher.snapshot().capability.viewRevision, 1); assert.equal(f.publisher.snapshot().fixtureHold.step, 0);
  }
  assert.equal(touched, 0); assert.equal(f.publisher.migrateFixtureView(first), true);
  assert.equal(f.publisher.migrateFixtureView(first), false, 'duplicate step cannot migrate twice');
  const brokenChain = fixtureTranslation(2);
  for (const side of ['before', 'after']) for (const bounds of ['logicalAnchor', 'backingBounds', 'contentBounds']) brokenChain[side][bounds].x++;
  assert.equal(f.publisher.migrateFixtureView(brokenChain), false, 'second step must start at first readback');
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation(2)), true);
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation(2)), false);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.cancelled, []);
});

test('fixture migration and hold release recheck expiry without needing a frame update', async () => {
  for (const operation of ['migrate', 'release', 'hold']) {
    const f = fixture(); f.update(interaction()); await flush(); f.at(299);
    if (operation !== 'hold') {
      assert.equal(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).remainingMs, 1);
      assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), true);
    }
    f.at(300);
    if (operation === 'migrate') assert.equal(f.publisher.migrateFixtureView(fixtureTranslation(2)), false);
    else if (operation === 'release') assert.equal(f.publisher.releaseFixtureHold(PROBE), true);
    else assert.equal(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok, false);
    await flush();
    assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.equal(f.publisher.snapshot().fixtureHold, null);
    assert.equal(f.publisher.snapshot().expired, 1); assert.deepEqual(f.cancelled, [1]);
  }
});

test('normal renewal can supply fresh time before hold, but fixture migration cannot renew it', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  f.at(100); f.update(interaction()); await flush();
  assert.equal(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok, false);
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false); assert.equal(f.calls[1].viewRevision, 1);
  f.at(125); f.respond(1); await flush();
  assert.equal(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).remainingMs, 275);
  f.at(399); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), true);
  assert.equal(f.publisher.snapshot().remainingMs, 1);
  f.at(400); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation(2)), false); await flush();
  assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'renew', 'end']); assert.equal(f.calls[2].sequence, 3);
});

test('early release has priority over fixture hold and a late translation cannot resurrect its lease or visual tail', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  f.at(110); f.release('landing-smile'); await flush();
  assert.equal(f.calls[1].phase, 'end'); assert.equal(f.calls[1].viewRevision, 1);
  assert.equal(f.publisher.snapshot().fixtureHold, null); assert.equal(f.publisher.snapshot().held, false);
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false);
  f.respond(1); await flush();
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false); assert.equal(f.publisher.releaseFixtureHold(PROBE), false);
  assert.equal(f.calls.length, 2); assert.equal(f.visual(), 'landing-smile'); assert.deepEqual(f.cancelled, []);
});

test('a held fixture does not alter terminal-before-newer-contact sequencing', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  f.release(); f.update(interaction(2)); await flush();
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false); assert.equal(f.calls.length, 2);
  f.respond(1); await flush();
  assert.deepEqual(f.calls.map(x => [x.phase, x.contactGeneration]), [['begin', 1], ['end', 1], ['begin', 2]]);
  assert.equal(f.publisher.snapshot().fixtureHold, null); assert.deepEqual(f.cancelled, []);
  f.respond(2); await flush(); assert.equal(f.publisher.snapshot().fixtureHold, null);
});

test('ordinary capability changes, pause and disposal clear fixture hold', async () => {
  for (const change of [f => f.setCapability(cap({ viewRevision: 2 })), f => f.setCapability(cap({ epoch: PROBE })),
    f => f.setCapability(cap({ available: false })), f => f.setCapability(null),
    f => f.update(interaction(), false), f => f.publisher.dispose()]) {
    const f = fixture(); f.update(interaction()); await flush();
    assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
    change(f); await flush();
    assert.equal(f.publisher.snapshot().fixtureHold, null); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false);
    assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']);
  }
});

test('bad fixture clocks clear the hold and end only the matching active contact', async () => {
  for (const at of [99, NaN, Infinity, -1]) {
    const f = fixture(); f.at(100); f.update(interaction()); await flush();
    assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
    f.at(at); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false); await flush();
    assert.equal(f.publisher.snapshot().fixtureHold, null); assert.equal(f.publisher.snapshot().remainingMs, 0);
    assert.deepEqual(f.calls.map(x => x.phase), ['begin', 'end']); assert.deepEqual(f.cancelled, [1]);
  }
});

test('snapshot reports remaining time without advancing clocks, expiring leases or dispatching requests', async () => {
  const f = fixture(); f.at(100); f.update(interaction()); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  f.at(200); assert.equal(f.publisher.snapshot().remainingMs, 200);
  f.at(500); assert.equal(f.publisher.snapshot().remainingMs, 0); assert.equal(f.publisher.snapshot().expired, 0);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.cancelled, []);
  f.at(150); assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), true, 'snapshot does not advance the state clock');
  assert.equal(f.publisher.snapshot().remainingMs, 250);
});

test('old renew acknowledgement after releasing fixture hold cannot restore it', async () => {
  const f = fixture({ delayed: true }); f.update(interaction()); await flush(); f.respond(0); await flush();
  assert(f.publisher.holdFixture({ probeId: PROBE, contactGeneration: 1 }).ok);
  f.at(100); assert.equal(f.publisher.releaseFixtureHold(PROBE), true); await flush();
  assert.equal(f.publisher.migrateFixtureView(fixtureTranslation()), false); assert.equal(f.calls[1].viewRevision, 1);
  f.release('landing-smile'); f.respond(1); await flush();
  assert.equal(f.calls[2].phase, 'end'); assert.equal(f.publisher.snapshot().fixtureHold, null);
  f.respond(2); await flush(); assert.equal(f.publisher.snapshot().fixtureHold, null);
  assert.equal(f.visual(), 'landing-smile'); assert.deepEqual(f.cancelled, []);
});
