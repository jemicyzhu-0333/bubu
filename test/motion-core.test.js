'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/capabilities/companion/presentation/motion-core/index.mjs');
const { samplePaperReturn } = require('../src/capabilities/companion/presentation/paper-return-story.mjs');
const { sampleGroundedMoonwalk, sampleMoonwalkBody } = require('../src/capabilities/companion/presentation/grounded-moonwalk.mjs');
const { sampleHatStar } = require('../src/capabilities/companion/presentation/hat-star-path.mjs');
const { createPaperReturnExit } = require('../src/surfaces/pet/paper-return-exit.mjs');
const { ownsGround } = require('../src/surfaces/pet/body-presentation.mjs');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

test('easing: endpoints, monotone smooth, overshoot only where declared', () => {
  for (const name of ['linear', 'smooth', 'inOutCubic', 'outCubic', 'outBack', 'spring', 'standard']) {
    const f = core.EASINGS[name]; near(f(0), 0, 1e-3); near(f(1), 1, 1e-3); near(f(-5), f(0)); near(f(9), f(1));
  }
  let prev = -1; for (let i = 0; i <= 100; i++) { const v = core.smooth(i / 100); assert.ok(v >= prev); prev = v; }
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => core.outBack(i / 100))) > 1.05);
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => core.spring(i / 100))) > 1);
  const ease = core.cubicBezier(.25, .1, .25, 1); near(ease(.5), .8024, 2e-3);
  near(core.cubicBezier(0, 0, 1, 1)(.37), .37, 1e-4);
});
test('mix/cubic helpers write into out without allocating new arrays', () => {
  const out = [0, 0]; assert.equal(core.mix([0, 0], [10, 20], .5, core.linear, out), out); assert.deepEqual(out, [5, 10]);
  const tangent = core.cubicTangent([0, 0], [1, 0], [2, 0], [3, 0], .5); near(tangent[0], 3); near(tangent[1], 0);
});
test('track: holds outside keys, interpolates, honours per-segment easing and via arcs, rejects bad data', () => {
  const tr = core.createTrack([{ at: .2, value: [0, 0] }, { at: .6, value: [10, 0], ease: 'linear' }, { at: 1, value: [10, 10], via: [20, 5] }]);
  assert.deepEqual(tr.sample(0), [0, 0]); near(tr.sample(.4)[0], 5); near(tr.sample(.4)[1], 0); assert.deepEqual(tr.sample(1.5), [10, 10]);
  assert.ok(tr.sample(.8)[0] > 10, 'quadratic via bends the segment outward');
  const scalar = core.createTrack([{ at: 0, value: 0 }, { at: 1, value: 2, ease: 'linear' }]); near(scalar.sample(.25), .5);
  assert.throws(() => core.createTrack([{ at: .5, value: 0 }, { at: .1, value: 1 }]), RangeError);
  assert.throws(() => core.createTrack([]), TypeError);
  const out = [0, 0]; assert.equal(tr.sample(.4, out), out);
});
test('memoFrame: one computation per distinct frame key, identical object on hit, bounded ring', () => {
  let calls = 0; const f = core.memoFrame((a, b) => { calls++; return { a, b }; }, { size: 2 });
  const x = f(.5, false); assert.equal(f(.5, false), x); assert.equal(calls, 1);
  f(.6, false); f(.7, false); f(.5, false); assert.equal(calls, 4, 'evicted after ring wraps');
  assert.deepEqual(f.stats(), { hits: 1, misses: 4 });
  // Production samplers: body/contact/art asking at the same instant share one result.
  const before = sampleGroundedMoonwalk.stats().misses;
  const a = sampleGroundedMoonwalk(.4321), b = sampleGroundedMoonwalk(.4321); assert.equal(a, b);
  assert.equal(sampleGroundedMoonwalk.stats().misses, before + 1);
  assert.equal(samplePaperReturn(.55), samplePaperReturn(.55));
  assert.equal(samplePaperReturn(.55, false, { progress: .55, t: .2 }), samplePaperReturn(.55, false, { progress: .55, t: .2 }));
});
test('capability hooks replace action-id checks; content overrides merge', () => {
  assert.ok(core.motionCaps({ id: 'paper-return' }).interruptExit); assert.equal(core.motionCaps({ id: 'paper-return' }).interruptExit.durationMs, 420);
  assert.ok(core.motionCaps({ id: 'sip-tea' }).handoffRecovery); assert.deepEqual(core.motionCaps({ id: 'wave' }), {});
  assert.deepEqual(core.motionCaps(null), {});
  const custom = { id: 'custom', motionCaps: { ownsGround: true, interruptExit: { durationMs: 300, completeAt: .9 } } };
  assert.equal(core.motionCaps(custom), core.motionCaps(custom), 'merge cached per action object');
  assert.equal(ownsGround(custom, undefined, 'base'), true);
  // A new action declaring interruptExit gets the bridge without touching surface code.
  const bridge = createPaperReturnExit(), opts = (now, id) => ({ now, egg: { id, manual: true }, actionStartedAt: 0, form: { id: 'usagi' }, combinationContext: { state: { state: 'idle' } } });
  bridge.step({ actionConfig: custom, actionT: .5 }, opts(0, 'custom'));
  const exit = bridge.step({ actionConfig: { id: 'wave' }, actionT: 0 }, opts(150, 'wave'));
  assert.equal(exit.actionConfig.id, 'custom'); near(exit.actionConfig.interruptExit.t, 0);
  near(bridge.step({ actionConfig: { id: 'wave' }, actionT: 0 }, opts(300, 'wave')).actionConfig.interruptExit.t, .5);
  assert.equal(core.actionBodyPose({ id: 'wave' }, .5), null);
  assert.ok(core.actionBodyPose({ id: 'moonwalk' }, .5).ground);
});
test('per-form anchors: each form owns a table; normalized round trip', () => {
  const u = core.storyAnchors('paper-return', 'usagi'), d = core.storyAnchors('paper-return', 'dango');
  assert.notEqual(u, d); assert.deepEqual(u.release, [69, 43]);
  assert.equal(core.storyAnchors('paper-return', 'unknown-form'), u);
  assert.throws(() => core.storyAnchors('nope'), RangeError);
  assert.deepEqual(core.toSpace(u, core.toNormalized(u, [33, 66])), [33, 66]);
  assert.deepEqual(samplePaperReturn(.6, false, null, 'dango').grip, samplePaperReturn(.6, false, null, 'usagi').grip);
});
test('secondary spring: deterministic, lags a step, settles, disabled under reduced motion', () => {
  const step = ms => ms >= 0 ? 4 : 0;
  const a = core.springFollow(step, 50), b = core.springFollow(step, 50); assert.equal(a, b);
  assert.ok(a < 0, 'follower trails behind a step'); near(core.springFollow(step, 3000), 0, 1e-3);
  assert.equal(core.secondarySwing(step, 50, { reducedMotion: true }), 0);
  assert.ok(Math.abs(core.secondarySwing(step, 50, { gain: 10 })) <= .28);
});
test('accessory stacking: rules compose per occupant and leave unrelated slots alone', () => {
  const none = core.resolveAccessoryStack('usagi.earwear', new Set()); assert.deepEqual(none, { x: 0, y: 0, rotate: 0, scale: 1 });
  const phones = core.resolveAccessoryStack('usagi.earwear', core.occupantsFor({ artwork: { combinationAccessories: { headphones: { opacity: 1 } } } }));
  assert.ok(phones.y < 0 && phones.scale < 1);
  const both = core.resolveAccessoryStack('usagi.earwear', new Set(['headphones', 'usagi.headwear']));
  assert.ok(both.x > phones.x && both.rotate > phones.rotate);
  assert.deepEqual(core.resolveAccessoryStack('usagi.headwear', new Set(['headphones'])), none);
  assert.ok(core.occupantsFor({ appearance: { items: [{ exclusiveGroup: 'usagi.headwear' }] } }).has('usagi.headwear'));
});
test('migrated stories keep invariants and add polish', () => {
  // Plane pitches along its path mid-flight, level at release/catch.
  near(samplePaperReturn(.34).angle, 0); near(samplePaperReturn(.76).angle, 0);
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => Math.abs(samplePaperReturn(.35 + i / 100).angle))) > .3);
  // Moonwalk body leans back and sinks while pinned to the floor; calm is static.
  const body = sampleMoonwalkBody(.5); assert.ok(body.shear < 0 && body.ground && body.sy <= 1);
  assert.deepEqual(sampleMoonwalkBody(.5, true).shear, 0); near(sampleMoonwalkBody(0).shear, 0); near(sampleMoonwalkBody(1).shear, 0);
  // Paper-return recoil on throw, settle on catch, rest otherwise.
  const pr = core.actionBodyPose({ id: 'paper-return' }, .4); assert.ok(pr.x < 0);
  assert.ok(Math.abs(core.actionBodyPose({ id: 'paper-return' }, .8).sy - 1) > .005);
  near(core.actionBodyPose({ id: 'paper-return' }, .1).x, 0);
  // Hat star twinkles only while hovering at the reveal.
  assert.equal(sampleHatStar(.3).spin, 0); assert.ok(sampleHatStar(.63).spin > 0);
});
