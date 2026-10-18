import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixture.mjs';

test('qualified held target is stable without repeated surface queries', async () => {
  const f = await fixture();
  try {
    const point = f.point();
    f.emit('pointerdown', 0.01, point);
    f.tick(0.01);
    f.tick(0.7);
    assert.equal(f.h.state.mode, 'petting');
    const skin = f.h.body.skin;
    const original = skin.raycast;
    let calls = 0;
    skin.raycast = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    try {
      for (let i = 1; i <= 90; i++) {
        f.tick(0.7 + i / 30);
        assert.equal(f.h.state.mode, 'petting');
      }
      assert.equal(calls, 0);
      f.emit('pointermove', 3.71, { ...point, clientX: point.clientX + 1 });
      f.tick(3.71);
      assert(calls > 0, 'user movement must revalidate actual surface');
      f.emit('pointercancel', 3.72);
      f.tick(3.72);
      assert.equal(f.h.state.pointerId, null);
    } finally {
      skin.raycast = original;
    }
  } finally {
    f.h.dispose();
  }
});
