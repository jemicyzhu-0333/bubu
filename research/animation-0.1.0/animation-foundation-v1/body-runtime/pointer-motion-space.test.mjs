import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const pose = state => ({ mode: state.mode, drag: state.drag, pet: state.pet,
  pivot: state.body.pivot, joints: state.body.jointQuaternions });

test('actual D2: default client DIP is unchanged by an explicit identical motion source', async () => {
  const a = await fixture(), b = await fixture({ readMotionPoint: event => ({ x: event.clientX, y: event.clientY }) });
  try {
    for (const [type, time, dx, dy] of [
      ['pointerdown', .01, 0, 0], ['pointermove', .08, 12, -10],
      ['pointermove', .12, 25, -15], ['pointermove', .16, 0, -15],
      ['pointerup', .2, -10, -10]
    ]) {
      for (const f of [a, b]) { const p = f.point(); f.emit(type, time, { clientX: p.clientX + dx, clientY: p.clientY + dy }); }
      assert.deepEqual(a.tick(time), b.tick(time));
    }
    for (const t of [.4, .8, 1.2, 2]) assert.deepEqual(a.tick(t), b.tick(t));
  } finally { a.h.dispose(); b.h.dispose(); }
});

test('actual D2: constant client point still carries native DIP movement and inertia without duplicate body travel', async () => {
  let motion = { x: -1300, y: 400 };
  const f = await fixture({ readMotionPoint: () => motion });
  try {
    f.emit('pointerdown', .01); const initial = f.tick(.01);
    motion = { x: -1288, y: 390 }; f.emit('pointermove', .08); const first = f.tick(.08);
    assert.equal(first.mode, 'drag', 'motion space, not unchanged local coordinates, qualifies drag');
    motion = { x: -1255, y: 380 }; f.emit('pointermove', .12); f.tick(.12);
    const moving = f.tick(.18);
    assert(Math.hypot(moving.drag.lag.x, moving.drag.lag.y) > .01, 'actual controller receives moving-input inertia');
    assert.equal(f.h.pool.stats.active, 1, 'no second actor or skeletal owner');
    // Same real surface anchor follows the unchanged canvas point. It does not
    // also translate by the global 45 DIP already assigned to the native window.
    assert(Math.abs(moving.body.root[0] - initial.body.root[0]) < .1);
    f.emit('pointerup', .2); const released = f.tick(.2);
    assert.equal(released.mode, 'landing'); assert.equal(released.pointerId, null);
    assert.equal(f.target.captured.size, 0); assert.equal(f.tick(3).mode, 'idle');
    f.h.owner.assertCurrent();
  } finally { f.h.dispose(); }
});

test('actual D2: local coordinate movement alone cannot create native motion or early longpress drag', async () => {
  const motion = { x: -1500, y: -200 }, f = await fixture({ readMotionPoint: () => motion });
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    const p = f.point();
    f.emit('pointermove', .15, { clientX: p.clientX + 10, clientY: p.clientY,
      screenX: 99999, screenY: -99999, devicePixelRatio: 2.5 });
    assert.equal(f.tick(.15).mode, 'pending');
    assert.equal(f.tick(.6).mode, 'petting', 'same skin contact and stationary motion retain qualification');
    assert.equal(f.h.pool.stats.active, 1);
  } finally { f.h.dispose(); }
});

test('actual D2: uncoordinated large viewport change still cancels pending contact rather than guessing a rebase', async () => {
  const f = await fixture({ readMotionPoint: () => ({ x: 0, y: 0 }) });
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    f.target.rect.left = 80; f.target.rect.top = -35;
    const p = f.point();
    f.emit('pointermove', .15, { clientX: p.clientX + 80, clientY: p.clientY - 35 });
    assert.equal(f.tick(.15).mode, 'idle'); assert.equal(f.h.state.pointerId, null);
    assert.equal(f.target.captured.size, 0);
  } finally { f.h.dispose(); }
});

test('actual D2: equal DIP travel gives equal inertia across local offsets and fake render DPR changes', async () => {
  let motion = { x: -1200, y: -400 };
  const a = await fixture({ readMotionPoint: () => motion }), b = await fixture({ readMotionPoint: () => motion });
  try {
    for (const f of [a, b]) { f.emit('pointerdown', .01); f.tick(.01); }
    for (const [time, dx, dy] of [[.08, 12, -4], [.12, 25, -8], [.16, 5, -12]]) {
      motion = { x: -1200 + dx, y: -400 + dy };
      const p = a.point(); a.emit('pointermove', time, { clientX: p.clientX + dx, clientY: p.clientY + dy });
      b.emit('pointermove', time, { devicePixelRatio: 2.5, screenX: 99999, screenY: -99999 });
      const sa = a.tick(time), sb = b.tick(time);
      assert.deepEqual(pose(sa), pose(sb), 'window-local travel changes contact placement, not the authored acting/inertia');
    }
    assert.deepEqual(pose(a.tick(.2)), pose(b.tick(.2)));
  } finally { a.h.dispose(); b.h.dispose(); }
});

test('actual D2: ray location cannot be replaced by valid motion coordinates or forged eligibility', async () => {
  const f = await fixture({ readMotionPoint: () => ({ x: 0, y: 0 }) });
  try {
    f.emit('pointerdown', .01, { clientX: -5000, clientY: -5000, eligible: true });
    assert.equal(f.tick(.01).pointerId, null);
    assert.equal(f.h.state.mode, 'idle');
    f.emit('pointerdown', .02); assert.equal(f.tick(.02).mode, 'pending');
  } finally { f.h.dispose(); }
});

test('actual D2: motion samples are copied before frame and are not resampled by RAF', async () => {
  let sample = { x: 0, y: 0 }, calls = 0;
  const f = await fixture({ readMotionPoint: () => { calls++; return sample; } });
  try {
    f.emit('pointerdown', .01); sample.x = 500;
    f.tick(.01);
    sample = { x: 2, y: 0 }; f.emit('pointermove', .02); sample.x = 1000;
    assert.equal(f.tick(.02).mode, 'pending');
    f.tick(.3); assert.equal(calls, 2);
  } finally { f.h.dispose(); }
});

test('actual D2: unavailable motion cancels only its own pointer, then permits regrab with a new origin', async () => {
  let sample = { x: 0, y: 0 };
  const f = await fixture({ readMotionPoint: () => sample });
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    sample = { x: 12, y: 0 }; f.emit('pointermove', .08); assert.equal(f.tick(.08).mode, 'drag');
    sample = null; f.emit('pointermove', .09, { pointerId: 2 });
    assert.equal(f.tick(.09).pointerId, 1, 'an invalid unrelated pointer cannot revoke ownership');
    f.emit('pointermove', .1); const cancelled = f.tick(.1);
    assert.equal(cancelled.pointerId, null); assert.equal(cancelled.mode, 'landing');
    assert.equal(f.target.captured.size, 0); assert.equal(f.h.diagnostics.rejected, 2);
    f.tick(3);
    sample = { x: 500, y: -200 }; f.emit('pointerdown', 3.01); f.tick(3.01);
    sample = { x: 502, y: -200 }; f.emit('pointermove', 3.02);
    assert.equal(f.tick(3.02).mode, 'pending', 'new gesture must not inherit previous global motion origin');
  } finally { f.h.dispose(); }
});

test('actual D2: missing-motion move after queued down and missing-motion up cannot retain capture', async () => {
  let sample = { x: 0, y: 0 };
  const f = await fixture({ readMotionPoint: () => sample });
  try {
    f.emit('pointerdown', .01); sample = null; f.emit('pointermove', .02);
    assert.equal(f.tick(.03).pointerId, null); assert.equal(f.target.captured.size, 0);
    sample = { x: 100, y: 50 }; f.emit('pointerdown', .1); f.tick(.1);
    sample = { x: 120, y: 40 }; f.emit('pointermove', .2); f.tick(.2);
    sample = null; f.emit('pointerup', .21); const release = f.tick(.21);
    assert.equal(release.mode, 'landing'); assert.equal(release.pointerId, null);
    assert.equal(f.target.captured.size, 0); assert.equal(f.tick(3).mode, 'idle');
  } finally { f.h.dispose(); }
});

test('actual D2: malformed client and sealed-time moves retain atomic rejection before optional motion sampling', async () => {
  let calls = 0;
  const f = await fixture({ readMotionPoint: () => { calls++; return { x: 0, y: 0 }; } });
  try {
    f.emit('pointerdown', .01); const before = f.tick(.01);
    f.emit('pointermove', .01);
    f.emit('pointermove', .02, { clientX: 100001 });
    assert.equal(calls, 1); assert.equal(f.h.pendingCount, 0);
    assert.deepEqual(f.h.state, before); assert.equal(f.h.diagnostics.rejected, 2);
    f.emit('pointerup', .01, { clientX: NaN });
    assert.equal(f.h.state.pointerId, null, 'same-time terminal barrier still releases without sampling');
    assert.equal(f.target.captured.size, 0); assert.equal(calls, 1);
  } finally { f.h.dispose(); }
});
