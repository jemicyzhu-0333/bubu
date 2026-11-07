import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { createEventMotionSource } from '../../../../src/surfaces/pet/realtime/event-motion-source.mjs';
const SPACE = { schemaVersion: 1, revision: 1, kind: 'event-screen-dip',
  runtime: { platform: 'win32', electron: '44.10.1', chromium: '152.0.7977.169' },
  bounds: { x: -1600, y: -200, width: 1600, height: 1000 }, scaleFactor: 1.25 };
async function setup() {
  let source;
  const f = await fixture({ readMotionPoint: e => source.read({ type: e.type, pointerId: e.pointerId,
    pointerType: 'mouse', isPrimary: e.isPrimary, isTrusted: true, timeStamp: e.sampleTime,
    clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY }) });
  // Trusted/time fields above are explicit simulated platform envelopes, not OS proof.
  f.doc.pointerLockElement = null;
  source = createEventMotionSource({ document: f.doc, target: f.target });
  const reset = () => { f.h.suspend(); f.h.resume(); };
  source.setSpace(SPACE, 0, reset);
  const emit = (type, t, more = {}) => f.emit(type, t, { sampleTime: t * 1000, screenX: -1200, screenY: 200, ...more });
  return { ...f, source, reset, emit };
}
test('real D2 owner consumes event-owned screen motion once while unchanged client hit preserves authored inertia/landing', async () => {
  const f = await setup();
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    f.emit('pointermove', .08, { screenX: -1180, screenY: 185 }); assert.equal(f.tick(.08).mode, 'drag');
    f.emit('pointermove', .12, { screenX: -1150, screenY: 175 }); f.tick(.12); const active = f.tick(.18);
    assert(Math.hypot(active.drag.lag.x, active.drag.lag.y) > .01);
    assert.equal(f.target.captured.size, 1); assert.equal(f.h.pool.stats.active, 1);
    const samples = f.source.snapshot().total;
    f.tick(.19); f.tick(.2); assert.equal(f.source.snapshot().total, samples, 'frames cannot resample event motion');
    f.emit('pointerup', .21, { screenX: NaN, screenY: NaN }); assert.equal(f.tick(.21).mode, 'landing');
    assert.equal(f.target.captured.size, 0); assert.equal(f.tick(3).mode, 'idle');
  } finally { f.h.dispose(); }
});
test('real D2 client-only travel retains pending/petting; foreign invalid pointer cannot cancel active contact', async () => {
  const f = await setup();
  try {
    f.emit('pointerdown', .01); f.tick(.01); const p = f.point();
    f.emit('pointermove', .1, { clientX: p.clientX + 10 }); assert.equal(f.tick(.1).mode, 'pending');
    const total = f.source.snapshot().total;
    f.emit('pointermove', .15, { pointerId: 2, screenX: NaN }); f.tick(.15);
    assert.equal(f.source.snapshot().total, total + 1); assert.equal(f.h.state.pointerId, 1);
    assert.equal(f.tick(.6).mode, 'petting');
  } finally { f.h.dispose(); }
});
test('real D2 topology barrier clears queued down/capture before permanent source revocation', async () => {
  const f = await setup();
  try {
    f.emit('pointerdown', .01); assert(f.h.pendingCount > 0);
    f.source.setSpace({ schemaVersion: 1, kind: 'client', revision: 2 }, 20, f.reset);
    assert.equal(f.h.pendingCount, 0); assert.equal(f.target.captured.size, 0);
    assert.equal(f.tick(.03).mode, 'idle');
    f.emit('pointerdown', .04); f.tick(.04); assert.equal(f.h.state.pointerId, null);
    assert.equal(f.source.snapshot().mode, 'revoked');
  } finally { f.h.dispose(); }
});
test('real D2 malformed motion cancels current gesture and still permits clean later valid regrab', async () => {
  const f = await setup();
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    f.emit('pointermove', .08, { screenX: -1180 }); assert.equal(f.tick(.08).mode, 'drag');
    f.emit('pointermove', .1, { screenX: 0 }); assert.equal(f.tick(.1).pointerId, null);
    assert.equal(f.target.captured.size, 0);
    f.tick(3); f.emit('pointerdown', 3.01); f.tick(3.01); assert.equal(f.h.state.pointerId, 1);
    f.emit('pointermove', 3.05, { buttons: 0, screenX: -1195 }); f.tick(3.05);
    assert.equal(f.h.state.pointerId, null); assert.equal(f.target.captured.size, 0);
  } finally { f.h.dispose(); }
});
