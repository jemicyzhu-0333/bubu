import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBone, elbowAngle, createLimbFilter, resolveLimbIntent, nearestFrame } from '../src/capabilities/companion/presentation/motion-core/limbs.mjs';
import { USAGI_LIMB_RIG, USAGI_LIMB_INTENTS } from '../src/content/companion/usagi-limbs.mjs';
import { DANGO_LIMB_RIG } from '../src/content/companion/dango-limbs.mjs';
import { attachDangoLimbs } from '../src/capabilities/companion/presentation/dango-limbs.mjs';
import { traceLimbs } from '../tools/limb-check/trace.mjs';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('two-bone IK keeps both bone lengths fixed, bends outward and clamps reach', () => {
  for (const target of [[60, 50], [70, 44], [40, 60], [90, 90]]) {
    const c = solveTwoBone([54, 44], target, { upper: 8, lower: 8, bend: 1, maxBend: 1 });
    assert.ok(Math.abs(dist(c.root, c.elbow) - 8) < 1e-9 && Math.abs(dist(c.elbow, c.wrist) - 8) < 1e-9);
    assert.ok(dist(c.root, c.wrist) <= 16 + 1e-9, 'never stretched');
    if (dist([54, 44], target) > 16) assert.equal(c.reached, false);
  }
  const a = solveTwoBone([0, 0], [10, 0], { upper: 8, lower: 8, bend: 1, maxBend: 1 });
  const b = solveTwoBone([0, 0], [10, 0], { upper: 8, lower: 8, bend: -1, maxBend: 1 });
  assert.ok(a.elbow[1] > 0 && b.elbow[1] < 0, 'bend side is explicit');
  assert.ok(elbowAngle(a) > 0 && elbowAngle(a) < 180);
});

test('bounded elbow: a close target retracts the chain root instead of folding', () => {
  const c = solveTwoBone([0, 0], [3, 0], { upper: 8, lower: 8, maxBend: .1 });
  assert.ok(c.bendHeight <= .1 * 16 + 1e-9);
  assert.ok(c.retract > 0);
});

test('elbow filter is stateless without a clock and speed-limited with one', () => {
  const f = createLimbFilter({ speed: .05 });
  assert.deepEqual(f.filter('k', [10, 0]), [10, 0]);
  f.filter('c', [0, 0], 0);
  const p = f.filter('c', [10, 0], 20);
  assert.ok(Math.abs(p[0] - 1) < 1e-9, 'moves speed*dt');
  assert.deepEqual(f.filter('c', [10, 0], 20), p, 'same frame is idempotent');
  assert.deepEqual(f.filter('c', [10, 0], 2000), [10, 0], 'long gaps reset');
});

test('limb intents are data keyed by pose motion and props, never by action id', () => {
  const keys = new Set(USAGI_LIMB_INTENTS.flatMap(rule => Object.keys(rule)));
  for (const key of keys) assert.ok(['motion', 'motions', 'props', 'anyProps', 'side', 'notContact', 'contact', 'gesture', 'event', 'intent'].includes(key), key);
  for (const rule of USAGI_LIMB_INTENTS) assert.ok(['grip', 'gesture', 'support'].includes(rule.intent.kind));
  for (const rule of USAGI_LIMB_INTENTS) assert.ok(USAGI_LIMB_RIG.bends[rule.intent.bend], rule.intent.bend);
  const sample = { motion: 'type', props: ['keyboard'], contactAction: 'x' };
  assert.equal(resolveLimbIntent(USAGI_LIMB_INTENTS, { sample, side: 'l' }).kind, 'grip');
  assert.equal(resolveLimbIntent(USAGI_LIMB_INTENTS, { sample, side: 'l', declared: { l: null } }), null, 'action caps override');
  for (const view of ['front', 'three-quarter', 'profile', 'back']) for (const side of ['l', 'r'])
    assert.equal(USAGI_LIMB_RIG.sockets[view][side].length, 2);
});

test('dango contact hands get the same socket/IK chain; frames come from a limbs.json manifest', () => {
  const anchors = { 'shoulder-left': { x: 7.4, y: 39.7 }, 'shoulder-right': { x: 58.6, y: 39.7 } };
  const contact = { hands: [{ side: 'left', points: [[7, 40], [8, 45], [12, 48]] }, { side: 'right', points: [[58, 40], [60, 45], [62, 50]] }] };
  attachDangoLimbs(contact, anchors);
  for (const hand of contact.hands) {
    assert.equal(hand.limb.source, 'legacy-sprite');
    const c = hand.limb.chain;
    assert.ok(Math.abs(dist(c.root, c.elbow) - DANGO_LIMB_RIG.arm.upper) < 1e-9);
  }
  const limbs = { schema: 'dango-limbs/1', bones: { arm: { upper: 4, fore: 4 } },
    segments: { 'arm-upper-l': { frames: [{ angle: 0 }, { angle: 90 }] }, 'arm-fore-l': { frames: [{ angle: 45 }] }, 'arm-upper-r': { frames: [] }, 'arm-fore-r': { frames: [] } },
    paws: { grip: { views: { front: [{ angle: 45 }, { angle: 90 }] } } } };
  attachDangoLimbs(contact, anchors, { limbs });
  assert.equal(contact.hands[0].limb.source, 'limbs.json');
  assert.ok(contact.hands[0].limb.frames.upper);
  assert.equal(nearestFrame([{ angle: 0 }, { angle: 90 }], 80).angle, 90);
  assert.equal(nearestFrame([{ angle: 10 }, { angle: 300 }], 355).angle, 10);
});

test('every action and session limb trace is free of painter pops, unexplained stretch and over-reach', async () => {
  const report = await traceLimbs();
  assert.ok(Object.keys(report.targets).length >= 200);
  assert.deepEqual(report.failures, []);
});
