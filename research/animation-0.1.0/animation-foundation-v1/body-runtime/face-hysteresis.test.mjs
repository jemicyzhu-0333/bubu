import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

// Real admitted D2 actor and unmodified browser/pointer host. No injected controller,
// expression owner or raycast. This checks the consumer, not just faceIntent.
test('actual D2 pointer host keeps one T05 request across 69/71 DIP jitter and enters hold', async () => {
  const f = await fixture();
  try {
    f.tick(0);
    f.emit('pointerdown', .01); f.tick(.01);
    const p = f.point(.4, 2.4);
    f.emit('pointermove', .1, p);
    f.tick(.1); p.clientX += 20; f.emit('pointermove', .2, p);
    let state = f.tick(.2);
    assert.equal(state.mode, 'drag');
    assert.equal(state.drag.faceIntent, 'T05');
    assert.equal(state.face.candidate, 'T05');
    const requestId = state.face.requestId;
    assert.ok(requestId);
    let sawHold = false;
    // <20 s: do not confuse deliberate long-hold renewal with a jitter restart.
    for (let i = 1; i <= 100; i++) {
      const t = .2 + i / 10;
      p.clientX += (i % 2 ? 69 : 71) / 10;
      f.emit('pointermove', t, p); state = f.tick(t);
      assert.equal(state.mode, 'drag');
      assert.equal(state.face.owner, 'interaction');
      assert.equal(state.face.candidate, 'T05');
      assert.equal(state.face.requestId, requestId, 'threshold noise must not request/restart the expression');
      sawHold ||= state.face.phase === 'hold';
    }
    assert.ok(sawHold, 'expression must progress beyond repeated enter phases');
    assert.ok(f.h.owner.assertCurrent());
  } finally { f.h.dispose(); }
});
