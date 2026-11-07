import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { createInputLeasePublisher } from '../../../../src/surfaces/pet/realtime/input-lease-publisher.mjs';
import { INPUT_LEASE_SCOPE } from '../../../../src/core/pet-input-lease.mjs';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const capability = { schemaVersion: 1, epoch: '00000000-0000-4000-8000-000000000001', viewRevision: 1,
  available: true, ttlMs: 300, renewMs: 100, scope: INPUT_LEASE_SCOPE };
function input(f) { const s = f.h.state; return { mode: s.mode, pointerId: s.pointerId, contactGeneration: s.contactGeneration,
  captured: s.captured, domCaptured: f.target.hasPointerCapture(s.pointerId) }; }
function cancel(f, generation = null) {
  if (generation === null && f.h.state.pointerId === null) f.h.discardUnownedInput();
  else if (f.h.state.pointerId !== null && (generation === null || f.h.state.contactGeneration === generation)) { f.h.suspend(); f.h.resume(); }
}
test('actual D2 contact generation belongs to admission and survives same-frame pointerId reuse and lifecycle reset', async () => {
  const f = await fixture();
  try {
    f.emit('pointerdown', .01); assert.equal(f.h.state?.contactGeneration ?? null, null); f.tick(.01);
    assert.equal(f.h.state.contactGeneration, 1);
    f.emit('pointerup', .02); f.emit('pointerdown', .02); f.tick(.02);
    assert.equal(f.h.state.pointerId, 1); assert.equal(f.h.state.contactGeneration, 2);
    assert.equal(f.h.discardUnownedInput(), false, 'cannot partially discard a currently-owned interaction');
    f.h.suspend(); f.h.resume(); f.emit('pointerdown', .03); f.tick(.03); assert.equal(f.h.state.contactGeneration, 3);
    f.h.dispose(); assert.equal(f.h.state.contactGeneration, null);
  } finally { f.h.dispose(); }
});
test('actual D2 late lease rejection and epoch revocation preserve released landing and queued-input discard preserves controller state', async () => {
  const f = await fixture(); let now = 0, resolve, request;
  const publisher = createInputLeasePublisher({ now: () => now,
    send(value) { request = value; return new Promise(done => { resolve = done; }); },
    cancelContact: generation => cancel(f, generation), cancelInput: () => cancel(f) });
  try {
    publisher.observe(capability);
    f.emit('pointerdown', .01); f.tick(.01); now = 10; publisher.update(input(f)); await flush();
    f.emit('pointermove', .08, { ...f.point(.8, 1.8) }); f.tick(.08);
    f.emit('pointerup', .2); f.tick(.2); now = 200; publisher.update(input(f));
    const released = structuredClone(f.h.state); assert.equal(released.mode, 'landing');
    resolve({ ok: false, request, capability, reason: 'revoked' }); await flush();
    assert.deepEqual(f.h.state, released, 'late rejection cannot reset an unowned landing');
    f.emit('pointerdown', .21); assert.equal(f.h.pendingCount, 1);
    publisher.observe({ ...capability, epoch: '00000000-0000-4000-8000-000000000002' });
    assert.equal(f.h.pendingCount, 0); assert.deepEqual(f.h.state, released, 'input-only queue discard is not an actor/face reset');
    assert.equal(f.tick(3).mode, 'idle'); assert.equal(f.h.pool.stats.active, 1);
  } finally { publisher.dispose(); f.h.dispose(); }
});
