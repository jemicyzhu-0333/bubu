import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('actual D2 body idle still observes the approved smile and face fade until gentle rest-face entry completes', async () => {
  const f = await fixture();
  try {
    f.tick(0); assert.equal(f.h.interactionTailActive, false);
    f.emit('pointerdown', .01); assert.equal(f.h.interactionTailActive, true); f.tick(.01);
    f.emit('pointermove', .1, f.point(.4, 2.4)); f.tick(.1);
    f.emit('pointerup', .2, f.point(.4, 2.4)); f.tick(.2);
    const observed = new Set(); let completed = null;
    for (let frame = 21; frame <= 600; frame++) {
      const state = f.tick(frame / 100), tail = f.h.interactionTailActive;
      assert.equal(typeof tail, 'boolean');
      assert.equal(f.h.state.time, frame / 100, 'tail read does not advance the actor clock');
      if (state.mode === 'idle' && state.drag.faceIntent === 'landingP2') {
        assert.equal(tail, true); observed.add('idle-smile');
      }
      if (state.mode === 'idle' && state.drag.faceIntent === null && state.face.owner === 'interaction'
        && state.face.candidate === 'landingP2' && state.face.path === 'P2' && state.face.phase === 'exit') {
        assert.equal(tail, true); observed.add('face-fade');
      }
      if (state.face.owner === 'p1_idle' && state.face.candidate === 'restR0' && state.face.phase === 'enter') {
        assert.equal(tail, true); observed.add('gentle-return');
      }
      if (!tail) { completed = state; break; }
    }
    assert.deepEqual([...observed], ['idle-smile', 'face-fade', 'gentle-return']);
    assert(completed, 'the existing controller/face transitions eventually complete');
    assert.equal(completed.mode, 'idle'); assert.equal(completed.drag.faceIntent, null);
    assert.equal(completed.face.owner, 'p1_idle'); assert.equal(completed.face.candidate, 'restR0');
    assert.equal(completed.face.phase, 'hold'); assert.equal(completed.face.path, 'R0'); assert.equal(completed.face.amount, 1);
    assert.equal(f.target.captured.size, 0); assert.equal(f.h.pendingCount, 0); assert(f.h.owner.assertCurrent());
    const before = structuredClone(f.h.state); for (let i = 0; i < 10; i++) assert.equal(f.h.interactionTailActive, false);
    assert.deepEqual(f.h.state, before, 'readonly diagnostic does not mutate face, pose or queue');
    f.h.dispose(); assert.equal(f.h.interactionTailActive, false);
  } finally { f.h.dispose(); }
});
