'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixtureTransport } = require('../src/surfaces/pet/realtime/fixture-transport.mjs');
const { createPresentationViewTracker } = require('../src/core/pet-presentation-view.mjs');
const { FIXTURE_TRANSPORT_SCOPE: scope } = require('../src/core/pet-fixture-transport.mjs');
const { INPUT_LEASE_SCOPE } = require('../src/core/pet-input-lease.mjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const probeId = id(1), epoch = id(2), capability = { schemaVersion: 1, scope, available: true };
function fixture() {
  const tracker = createPresentationViewTracker();
  const geometry = { width: 520, height: 360, stageOffset: { x: 0, y: 0 } };
  function view(x, y) { return tracker.record({ logicalAnchor: { x: x + 150, y: y + 70, width: 220, height: 220 },
    backingBounds: { x, y, width: 520, height: 360 }, contentBounds: { x, y, width: 520, height: 360 }, geometry, stableNativeRead: true }); }
  const source = { schemaVersion: 1, revision: 1, kind: 'event-screen-dip', runtime: { platform: 'win32', electron: '44.10.1', chromium: '152.0.7977.169' },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
  let now = 20, hold = false, migrated = 0, cancels = 0, ends = 0, observed = 0, finished = 0;
  let lease = { schemaVersion: 1, scope: INPUT_LEASE_SCOPE, epoch, viewRevision: 1, available: true, ttlMs: 300, renewMs: 100 };
  const grip = { ok: true, probeId, contactGeneration: 1, pendingCount: 0, mode: 'drag', captured: true, domCaptured: true,
    stamp: [0, 0, 220, 220, 1, 2], terminal: false, gripClient: { x: 260, y: 160 } };
  const state = { enabled: true, blocked: false, view: view(40, 40), pointerSpace: source,
    stage: { readInteraction: () => ({ mode: grip.mode, contactGeneration: 1 }),
      readDiagnostics: () => ({ renderedFrames: 4, inputMotion: { mode: 'event-screen-dip', capability: { kind: source.kind, ...source } } }),
      prepareFixtureGrip: () => structuredClone(grip), readFixtureGrip: () => structuredClone(grip),
      finishFixtureGrip(_id, value) { assert.equal(value.eventNotBefore, now); finished++; return { ok: true, gripClient: { ...grip.gripClient } }; },
      cancelFixtureGrip() { cancels++; grip.terminal = true; grip.captured = false; } } };
  const publisher = {
    holdFixture() { hold = true; return { ok: true, epoch, contactGeneration: 1, viewRevision: state.view.revision, remainingMs: 280 }; },
    migrateFixtureView(receipt) { if (!hold) return false; migrated++; lease = { ...lease, viewRevision: receipt.toRevision }; return true; },
    releaseFixtureHold() { hold = false; return true; }, update() { ends++; }, observe() { observed++; },
    snapshot: () => ({ capability: { ...lease }, held: hold, remainingMs: 280, fixtureHold: hold ? { probeId } : null }) };
  const transport = createFixtureTransport({ now: () => now, readState: () => state, inputLease: publisher });
  transport.observeCapability(capability);
  function packet(step) {
    const before = state.view, d = step === 1 ? { x: 24, y: 16 } : { x: -24, y: -16 };
    const after = view(before.backingBounds.x + d.x, before.backingBounds.y + d.y);
    return { presentationView: after, pointerSpace: source, fixtureTransport: capability, inputLease: { ...lease, viewRevision: after.revision },
      fixtureTranslation: { schemaVersion: 1, scope, probeId, epoch, contactGeneration: 1, step,
        fromRevision: before.revision, toRevision: after.revision, delta: d, before, after } };
  }
  function apply(value) { const accepted = transport.acceptViewport(value); if (accepted) state.view = value.presentationView; return accepted; }
  return { transport, state, grip, publisher, packet, apply, prepare: () => transport.prepare({ probeId }),
    counts: () => ({ migrated, cancels, ends, observed, finished }), time: value => { now = value; } };
}
test('strict captured roundtrip updates one geometry transaction without a second actor writer', () => {
  const f = fixture(); assert.equal(f.prepare().ok, true);
  const origin = f.state.view;
  assert(f.apply(f.packet(1))); assert.deepEqual(f.transport.read({ probeId }).gripGlobal, { x: 324, y: 216 });
  assert.equal(f.transport.finish({ probeId }).ok, false);
  assert(f.apply(f.packet(2))); assert.deepEqual(f.state.view.backingBounds, origin.backingBounds);
  const done = f.transport.finish({ probeId }); assert(done.ok); assert.deepEqual(done.gripClient, { x: 260, y: 160 });
  assert.deepEqual(f.counts(), { migrated: 2, cancels: 0, ends: 0, observed: 0, finished: 1 });
  assert.equal(f.prepare().ok, false, 'one shot even after successful finish');
});
test('closed gate, unavailable source and malformed probe cannot arm grip or lease', () => {
  for (const mutate of [f => f.transport.observeCapability(null), f => { f.state.enabled = false; },
    f => { f.state.pointerSpace.kind = 'client'; }, f => { f.state.blocked = true; },
    f => { f.grip.mode = 'idle'; }, f => { f.state.stage.readDiagnostics = () => ({ inputMotion: { mode: 'revoked' } }); }]) {
    const f = fixture(); mutate(f); assert.equal(f.prepare().ok, false); assert.deepEqual(f.counts(), { migrated: 0, cancels: 0, ends: 0, observed: 0, finished: 0 });
  }
  const f = fixture(); let getters = 0;
  assert.equal(f.transport.prepare({ get probeId() { getters++; return probeId; } }).ok, false); assert.equal(getters, 0);
  assert.equal(f.transport.prepare({ probeId, extra: true }).ok, false);
});
test('receipt identity, sequence, actual mapping and capability conflicts never get a geometry exception', () => {
  for (const mutate of [p => { p.fixtureTranslation.probeId = id(9); }, p => { p.fixtureTranslation.step = 2; },
    p => { p.fixtureTranslation.contactGeneration = 2; }, p => { p.fixtureTranslation.epoch = id(9); },
    p => { p.pointerSpace = { ...p.pointerSpace, revision: 2 }; }, p => { p.inputLease.epoch = id(9); },
    p => { p.presentationView = { ...p.presentationView, revision: 9 }; }, p => { p.fixtureTransport = null; },
    p => { p.fixtureTranslation.delta.x = 25; }, p => { p.fixtureTranslation.extra = true; }]) {
    const f = fixture(); f.prepare(); const p = structuredClone(f.packet(1)); mutate(p);
    assert.equal(f.apply(p), false); assert.equal(f.counts().migrated, 0);
  }
});
test('DOM/camera changes, lifecycle loss and newer actor cannot inherit the expected translation', () => {
  for (const mutate of [f => { f.grip.stamp[0]++; }, f => { f.grip.stamp[5]++; },
    f => { f.grip.contactGeneration = 2; }, f => { f.state.enabled = false; }, f => { f.state.blocked = true; }]) {
    const f = fixture(); f.prepare(); mutate(f); assert.equal(f.apply(f.packet(1)), false);
  }
  const f = fixture(); f.prepare(); f.transport.invalidate(); assert.equal(f.apply(f.packet(1)), false);
  assert.equal(f.transport.finish({ probeId }).ok, false); assert.equal(f.counts().cancels, 1);
});
test('known late translation preserves queued terminal and released tail without lease revival', () => {
  for (const pendingCount of [0, 1, 3]) {
    const f = fixture(); f.prepare(); f.grip.terminal = true; f.grip.captured = false; f.grip.domCaptured = false;
    f.grip.pendingCount = pendingCount; f.grip.mode = pendingCount ? 'drag' : 'landing';
    assert(f.apply(f.packet(1))); assert(f.transport.read({ probeId }).terminal);
    assert(f.apply(f.packet(2))); assert.equal(f.counts().migrated, 0);
    assert.equal(f.counts().cancels, 0); assert.equal(f.counts().observed, 0); assert.equal(f.counts().ends, 0);
    if (pendingCount) assert.equal(f.transport.finish({ probeId }).ok, false);
    f.grip.pendingCount = 0; assert(f.transport.finish({ probeId }).ok);
  }
});
test('pending same-contact motion is observed, never silently discarded for pure translation', () => {
  const f = fixture(); f.prepare(); f.grip.pendingCount = 2;
  assert(f.transport.read({ probeId }).ok); assert(f.apply(f.packet(1)));
  assert.equal(f.transport.read({ probeId }).pendingCount, 2);
});
test('redundant verified publication does not re-migrate or reset the active clock', () => {
  const f = fixture(); f.prepare(); const packet = f.packet(1); assert(f.apply(packet));
  assert(f.apply(packet)); assert.equal(f.counts().migrated, 1);
  const plain = { ...packet }; delete plain.fixtureTranslation; assert(f.apply(plain));
  const forged = structuredClone(packet); forged.fixtureTranslation.probeId = id(9); assert.equal(f.apply(forged), false);
});
test('unknown outcome retains fence, forbids finish/new probe, and disposal is idempotent', () => {
  const f = fixture(); f.prepare(); assert.equal(f.transport.cancel({ probeId: id(9) }).ok, false);
  assert(f.transport.cancel({ probeId }).ok); assert.equal(f.transport.read({ probeId }).ok, false);
  assert.equal(f.prepare().ok, false); assert.equal(f.transport.finish({ probeId }).ok, false);
  f.transport.dispose(); f.transport.dispose(); assert.equal(f.counts().cancels, 1); assert.equal(f.transport.read({ probeId }).ok, false);
});

test('actor cancellation failure cannot retain the fixture lease or reopen admission', () => {
  const f = fixture(); f.prepare(); f.state.stage.cancelFixtureGrip = () => { throw Error('actor cleanup failed'); };
  assert(f.transport.cancel({ probeId }).ok);
  assert.equal(f.counts().ends, 1); assert.equal(f.publisher.snapshot().fixtureHold, null);
  assert.equal(f.transport.read({ probeId }).ok, false); f.transport.dispose();
});

test('completion observation preserves failed DOM release instead of inferring from terminal ownership', () => {
  const f = fixture(); f.prepare(); assert(f.apply(f.packet(1))); assert(f.apply(f.packet(2)));
  assert(f.transport.finish({ probeId }).ok); f.grip.terminal = true; f.grip.captured = false; f.grip.domCaptured = true;
  f.grip.releaseObserved = true;
  const value = f.transport.read({ probeId }); assert(value.ok); assert(value.releaseObserved);
  assert.equal(value.domCaptured, true); assert.equal(value.gripObservation, 'lock-completion-snapshot');
});
