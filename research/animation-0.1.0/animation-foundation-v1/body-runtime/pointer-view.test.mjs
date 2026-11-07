import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { readPointerView, samePointerView } from './pointer-view.mjs';

test('actual D2: queued down under an old translated view is purged before raycast or capture', async () => {
  const f = await fixture();
  try {
    f.emit('pointerdown', .01); assert.equal(f.h.pendingCount, 1);
    f.target.rect.left += 1; const state = f.tick(.02);
    assert.equal(state.mode, 'idle'); assert.equal(state.pointerId, null); assert.equal(f.h.pendingCount, 0);
    assert.equal(f.target.captured.size, 0); assert.equal(f.h.diagnostics.viewInvalidations, 1);
  } finally { f.h.dispose(); }
});
test('actual D2: frame-time camera or rect changes cancel capture even without another pointer event', async () => {
  for (const mutate of [f => { f.target.rect.top -= .25; }, f => { f.camera.position.x += .01; }, f => { f.camera.zoom = 1.01; f.camera.updateProjectionMatrix(); }]) {
    const f = await fixture();
    try {
      f.emit('pointerdown', .01); assert.equal(f.tick(.01).mode, 'pending'); assert.equal(f.target.captured.size, 1);
      mutate(f); assert.equal(f.tick(.02).mode, 'idle'); assert.equal(f.target.captured.size, 0);
      assert.equal(f.h.diagnostics.viewInvalidations, 1); assert.equal(f.h.pendingCount, 0);
    } finally { f.h.dispose(); }
  }
});
test('actual D2: same-time queued motion/release is discarded together when view changes', async () => {
  const f = await fixture();
  try {
    f.emit('pointerdown', .01); f.tick(.01);
    f.emit('pointermove', .02, { clientX: f.point().clientX + 20 }); f.emit('pointerup', .02);
    assert.equal(f.h.pendingCount, 2); f.target.rect.left += 2;
    const state = f.tick(.02); assert.equal(state.mode, 'idle'); assert.equal(state.pointerId, null);
    assert.equal(f.h.pendingCount, 0); assert.equal(f.target.captured.size, 0);
    f.emit('pointerdown', .021, { clientX: f.point().clientX + 2 }); assert.equal(f.tick(.021).mode, 'pending', 'new view admits a genuinely newer gesture');
  } finally { f.h.dispose(); }
});
test('actual D2: DPR/backbuffer-only changes preserve mapping and do not resample event motion', async () => {
  let samples = 0; const f = await fixture({ readMotionPoint: e => { samples++; return { x: e.clientX, y: e.clientY }; } });
  try {
    const view = readPointerView(f.target, f.camera); f.emit('pointerdown', .01); f.tick(.01);
    f.target.width = 960; f.target.height = 960; f.target.devicePixelRatio = 2.5;
    assert.equal(samePointerView(view, readPointerView(f.target, f.camera)), true);
    assert.equal(f.tick(.02).mode, 'pending'); assert.equal(f.h.diagnostics.viewInvalidations, 0); assert.equal(samples, 1);
    f.camera.position.x++; assert.equal(samePointerView(view, readPointerView(f.target, f.camera)), false);
    assert(Object.isFrozen(view));
  } finally { f.h.dispose(); }
});
test('actual D2: invalid view still releases on terminal input without coordinates and can recover', async () => {
  const f = await fixture();
  try {
    f.emit('pointerdown', .01); f.tick(.01); f.target.rect.width = 0;
    f.emit('pointerup', .02, { clientX: NaN, clientY: NaN });
    assert.equal(f.target.captured.size, 0); assert.equal(f.h.state.pointerId, null); assert.equal(f.h.pendingCount, 0);
    f.target.rect.width = 384; f.emit('pointerdown', .03); assert.equal(f.tick(.03).mode, 'pending');
  } finally { f.h.dispose(); }
});
test('actual D2: view barrier at sealed time uses the lifecycle clock without epsilon or replay', async () => {
  const f = await fixture();
  try {
    f.emit('pointerdown', .01); const before = f.tick(.01); f.target.rect.left++;
    const after = f.tick(.01); assert.equal(after.pointerId, null); assert.equal(after.time, before.time);
    assert.equal(f.h.diagnostics.viewInvalidations, 1); f.emit('pointerdown', .01);
    assert.equal(f.h.pendingCount, 0); assert.equal(f.h.state.pointerId, null);
  } finally { f.h.dispose(); }
});
