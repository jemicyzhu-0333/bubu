import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('actual D2: sub-threshold body moves retain one contact until drag and release', async () => {
  const f = await fixture();
  try {
    const p = f.point(0, .8);
    f.emit('pointerdown', .01, p);
    const down = f.tick(.01);
    assert.equal(down.mode, 'pending');
    assert.equal(down.pet.phase, 'idle', 'body hit has no head-petting qualification');
    assert.equal(down.captured, true);
    for (const [time, dx] of [[.1, 1], [.2, 4], [.6, 8]]) {
      f.emit('pointermove', time, { ...p, clientX: p.clientX + dx });
      const s = f.tick(time);
      assert.equal(s.pointerId, down.pointerId, `${dx} DIP must retain the admitted body contact`);
      assert.equal(s.contactGeneration, down.contactGeneration);
      assert.equal(s.mode, 'pending', 'the existing strict >8 DIP threshold is unchanged');
      assert.equal(s.pet.phase, 'idle');
      assert.equal(s.face.path, null);
      assert.equal(s.captured, true);
    }
    f.emit('pointermove', .7, { ...p, clientX: p.clientX + 12, clientY: p.clientY - 20 });
    const drag = f.tick(.7);
    assert.equal(drag.mode, 'drag');
    assert.equal(drag.contactGeneration, down.contactGeneration);
    assert.equal(f.h.pool.stats.active, 1);
    f.emit('pointerup', .8, { ...p, clientX: p.clientX + 12, clientY: p.clientY - 20 });
    const release = f.tick(.8);
    assert.equal(release.mode, 'landing');
    assert.equal(release.pointerId, null);
    assert.equal(f.target.captured.size, 0);
    assert.equal(f.tick(4).mode, 'idle');
  } finally { f.h.dispose(); }
});

test('actual D2: body drift without DOM capture can still start drag while on skin', async () => {
  const f = await fixture();
  try {
    f.target.setPointerCapture = () => { throw Error('capture unavailable'); };
    const p = f.point(0, .8);
    f.emit('pointerdown', .01, p);
    const down = f.tick(.01);
    assert.equal(down.pointerId, 1);
    assert.equal(down.captured, false);
    f.emit('pointermove', .1, { ...p, clientX: p.clientX + 2 });
    assert.equal(f.tick(.1).pointerId, 1);
    f.emit('pointermove', .2, { ...p, clientX: p.clientX + 10 });
    assert.equal(f.tick(.2).mode, 'drag');
    f.emit('pointerleave', .3);
    assert.equal(f.tick(.3).pointerId, null);
  } finally { f.h.dispose(); }
});

test('actual D2: body down cannot gain petting eligibility by sliding client onto the head with fixed motion', async () => {
  const f = await fixture({ readMotionPoint: () => ({ x: 0, y: 0 }) });
  const owner = f.h.owner;
  try {
    f.emit('pointerdown', .01, f.point(0, .8));
    const down = f.tick(.01);
    assert.equal(down.mode, 'pending');
    assert.equal(down.pointerId, 1);
    assert.equal(down.pet.phase, 'idle');
    assert(Number.isSafeInteger(down.contactGeneration));
    const head = f.point(0, 1.4);
    f.emit('pointermove', .1, head);
    for (const t of [.1, .5, 1.1, 2.1, 3.1]) {
      const s = f.tick(t);
      assert.equal(s.mode, 'pending', 'three seconds over the head do not requalify a body-origin gesture');
      assert.equal(s.pointerId, down.pointerId);
      assert.equal(s.contactGeneration, down.contactGeneration);
      assert.equal(s.captured, true);
      assert.equal(s.pet.phase, 'idle');
      assert.equal(s.pet.held, false);
      assert.equal(s.face.path, null);
      assert.strictEqual(f.h.owner, owner);
      assert.equal(f.h.pool.stats.active, 1);
      owner.assertCurrent();
    }
    f.emit('pointerup', 3.2, { ...head, buttons: 0 });
    const released = f.tick(3.2);
    assert.equal(released.mode, 'idle');
    assert.equal(released.pointerId, null);
    assert.equal(released.contactGeneration, null);
    assert.equal(f.target.captured.size, 0);
    assert.strictEqual(f.h.owner, owner);
    // A fresh down at the same client point proves that it really hits the head;
    // the earlier lack of petting was not caused by a missed ray or invalid input.
    f.emit('pointerdown', 3.3, head);
    const next = f.tick(3.3);
    assert.equal(next.pet.phase, 'pending');
    assert.equal(next.contactGeneration, down.contactGeneration + 1);
    assert.equal(f.tick(3.8).mode, 'petting');
    assert.strictEqual(f.h.owner, owner);
    f.emit('pointerup', 3.9, { ...head, buttons: 0 });
    assert.equal(f.tick(3.9).pointerId, null);
    assert.equal(f.target.captured.size, 0);
    assert.equal(f.tick(6).mode, 'idle');
  } finally { f.h.dispose(); }
});

for (const terminal of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'buttons-zero', 'blur', 'hidden']) {
  test(`actual D2: pending body drift still terminates on ${terminal}`, async () => {
    const f = await fixture();
    try {
      const p = f.point(0, .8);
      f.emit('pointerdown', .01, p); f.tick(.01);
      f.emit('pointermove', .1, { ...p, clientX: p.clientX + 2 });
      assert.equal(f.tick(.1).pointerId, 1);
      f.at(.2);
      if (terminal === 'blur') f.win.emit('blur');
      else if (terminal === 'hidden') { f.doc.hidden = true; f.doc.emit('visibilitychange'); }
      else f.emit(terminal === 'buttons-zero' ? 'pointermove' : terminal, .2, { ...p, buttons: 0 });
      f.tick(.2);
      const s = f.h.state;
      assert.equal(s.pointerId, null);
      assert.equal(s.pet.phase, 'idle');
      assert.equal(s.face.path, null);
      assert.equal(f.target.captured.size, 0);
    } finally { f.h.dispose(); }
  });
}

test('actual D2: a pending body contact still cancels when the ray misses skin below motion threshold', async () => {
  const f = await fixture({ readMotionPoint: () => ({ x: 0, y: 0 }) });
  try {
    f.emit('pointerdown', .01, f.point(0, .8)); f.tick(.01);
    f.emit('pointermove', .1, { clientX: -100, clientY: -100 });
    const s = f.tick(.1);
    assert.equal(s.pointerId, null);
    assert.equal(s.mode, 'idle');
    assert.equal(f.target.captured.size, 0);
  } finally { f.h.dispose(); }
});

test('actual D2: losing head eligibility still cancels a pending pet instead of retaining body drag', async () => {
  const f = await fixture({ readMotionPoint: () => ({ x: 0, y: 0 }) });
  try {
    f.emit('pointerdown', .01);
    assert.equal(f.tick(.01).pet.phase, 'pending');
    f.emit('pointermove', .1, f.point(0, .8));
    const s = f.tick(.1);
    assert.equal(s.pointerId, null);
    assert.equal(s.pet.phase, 'idle');
    assert.equal(s.face.path, null);
    assert.equal(f.target.captured.size, 0);
  } finally { f.h.dispose(); }
});
