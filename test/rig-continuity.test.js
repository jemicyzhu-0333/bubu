'use strict';

// rig 引入后的渲染断层：六个动作（睡觉 / 读书 / 写字 / 喝水 / 啃咬 / 挖掘）的第一帧就是“保持的姿势”，
// 从待机切进去、切出来会在一帧内瞬移（啃咬的手臂一帧 52°）。艺术家只在动作或朝向变化的那一刻做一次
// 220 ms 的混合；稳定播放时姿势就是原始采样，幅度不变。这里守住每一条，并对所有动作随机切换做逐帧位移的扫描。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRig } = require('../src/capabilities/companion/presentation/rig/schema.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { sampleMotion, MOTION_NAMES } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { compileRig } = require('../tools/rig-build/build.mjs');
const vectorArt = require('../src/capabilities/companion/presentation/usagi-support.mjs').default;

const ROOT = path.resolve(__dirname, '..');
const sprout = compileRig(fs.readFileSync(path.join(ROOT, 'tools/rig-build/examples/sprout.rig.svg'), 'utf8')).doc;
const rig = validateRig(sprout).rig;

const artist = () => createRigArtist({ fallback: vectorArt, paths: createPathCache({ createPath: d => ({ d }) }) });
const armAngle = artwork => artwork.pose.world.arm_l ? Math.atan2(artwork.pose.world.arm_l[1], artwork.pose.world.arm_l[0]) : 0;
const frame = (a, options) => a.resolve(rig, { view: 'front', ...options });

test('starting a held pose eases in instead of snapping, and reaches the pose', () => {
  const a = artist();
  for (let t = 0; t <= 400; t += 16) frame(a, { motion: null, elapsedMs: t });            // idle for a while
  const before = armAngle(frame(a, { motion: null, elapsedMs: 416 }));
  const first = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 432 }));
  assert.ok(Math.abs(first - before) < 0.05, `the first frame of "read" must still be near idle (moved ${(first - before).toFixed(3)} rad)`);
  const half = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 432 + 110 }));
  const done = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 432 + 260 }));
  assert.ok(Math.abs(half) > Math.abs(first) && Math.abs(half) < Math.abs(done), 'partway through the blend');
  assert.ok(Math.abs(Math.abs(done) - 0.7) < 0.02, `full pose after the blend (arm_l ≈ 0.7 rad, got ${done.toFixed(3)})`);
});

test('leaving a held pose eases out to idle', () => {
  const a = artist();
  for (let t = 0; t <= 800; t += 16) frame(a, { motion: 'chew', progress: 0.3, elapsedMs: t });
  const held = armAngle(frame(a, { motion: 'chew', progress: 0.3, elapsedMs: 816 }));
  const next = armAngle(frame(a, { motion: null, elapsedMs: 832 }));
  assert.ok(Math.abs(next - held) < 0.09, `no snap on the way out (moved ${(next - held).toFixed(3)} rad, was 0.9 rad away from idle)`);
  const later = armAngle(frame(a, { motion: null, elapsedMs: 832 + 300 }));
  assert.ok(Math.abs(later) < 0.06, 'back at idle after the blend');
});

test('steady playback is the raw sample: the blend never damps a fast motion', () => {
  const a = artist();
  for (let t = 0; t <= 600; t += 16) frame(a, { motion: 'wave', progress: (t / 1200) % 1, elapsedMs: t });
  let worst = 0;
  for (let t = 616; t <= 3000; t += 16) {
    const progress = (t / 1200) % 1;
    const shown = frame(a, { motion: 'wave', progress, elapsedMs: t }).pose.world.arm_r;
    const raw = frame(artist(), { motion: 'wave', progress }).pose.world.arm_r;      // no clock: raw sample
    for (let i = 0; i < 6; i += 1) worst = Math.max(worst, Math.abs(shown[i] - raw[i]));
  }
  assert.ok(worst < 1e-9, `identical to the raw sample once the blend is over (differs by ${worst})`);
});

test('a frame gap (window hidden, throttled) or a clock that runs backwards aligns at once instead of blending a stale pose', () => {
  const a = artist();
  for (let t = 0; t <= 400; t += 16) frame(a, { motion: 'read', progress: 0, elapsedMs: t });
  const held = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 416 }));
  const afterGap = armAngle(frame(a, { motion: null, elapsedMs: 416 + 5000 }));
  // 期望值 = 同一时刻、全新的艺术家（第一帧永远直接对齐）算出来的待机姿势（待机自己有 ±0.04 rad 的呼吸）。
  assert.ok(Math.abs(afterGap - armAngle(frame(artist(), { motion: null, elapsedMs: 416 + 5000 }))) < 1e-9, 'after a long gap the new pose is used as it is');
  assert.ok(Math.abs(held) > 0.5);
  for (let t = 0; t <= 300; t += 16) frame(a, { motion: 'read', progress: 0, elapsedMs: 10000 + t });
  const rewound = armAngle(frame(a, { motion: null, elapsedMs: 100 }));
  assert.ok(Math.abs(rewound - armAngle(frame(artist(), { motion: null, elapsedMs: 100 }))) < 1e-9, 'a clock reset never leaves the pet half-blended');
});

test('a still portrait (no clock) gets the raw pose and cannot disturb the moving pet’s state', () => {
  const a = artist();
  for (let t = 0; t <= 400; t += 16) frame(a, { motion: 'read', progress: 0, elapsedMs: t });
  const held = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 416 }));
  const portrait = armAngle(frame(a, { motion: 'read', progress: 0, calmVisual: true }));    // no elapsedMs
  assert.ok(Math.abs(portrait) > 0.5, 'the portrait shows the held pose immediately');
  const still = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 432 }));
  assert.ok(Math.abs(still - held) < 0.02, 'the moving pet continued from where it was');
});

test('switching into reduced motion immediately holds the complete calm pose, even mid-transition', () => {
  const a = artist();
  for (let t = 0; t <= 400; t += 16) frame(a, { motion: 'umbrella', progress: t / 1000, elapsedMs: t });
  frame(a, { motion: 'read', progress: .2, elapsedMs: 416 });
  const held = frame(a, { motion: 'read', progress: .2, elapsedMs: 432, calmVisual: true });
  const raw = frame(artist(), { motion: 'read', progress: .2, calmVisual: true });
  assert.deepEqual(held.pose.world, raw.pose.world);
  for (let t = 448; t <= 900; t += 16) {
    assert.deepEqual(frame(a, { motion: 'read', progress: t / 1000, elapsedMs: t, calmVisual: true }).pose.world,
      held.pose.world, 'no residual transition drifts after reduced motion is enabled');
  }
});

test('separate channels blend independently', () => {
  const a = artist();
  for (let t = 0; t <= 400; t += 16) {
    frame(a, { motion: 'read', progress: 0, elapsedMs: t, channel: 'one' });
    frame(a, { motion: null, elapsedMs: t, channel: 'two' });
  }
  const one = armAngle(frame(a, { motion: 'read', progress: 0, elapsedMs: 416, channel: 'one' }));
  const two = armAngle(frame(a, { motion: null, elapsedMs: 416, channel: 'two' }));
  assert.ok(Math.abs(one) > 0.5 && Math.abs(two) < 0.1);
});

// 对每一对动作 A → B（每个朝向）：先稳定播放 A，再切到 B，逐帧看骨骼点的位移。
// 两条界限分开守：
//  - 切换的**第一帧**几乎不动（< 1.5 美术像素）——这是原来的 bug：不混合时啃咬的手臂一帧跳 9 像素；
//  - 整个过渡期间每帧位移有个上限（< 4.5）——最极端的一对（伸懒腰 −2.6 rad ↔ 喝水 +2.1 rad，差 4.7 rad）
//    也是被平滑地摆过去，而不是一帧瞬移。
function bonePoints(artwork, points) {
  const world = artwork.pose.world;
  return Object.fromEntries(points.map(([id, pivot]) => [id, world[id] ? applyPoint(world[id], pivot[0] + 6, pivot[1] + 6) : [0, 0]]));
}
const displacement = (a, b, points) => Math.max(...points.map(([id]) => Math.hypot(a[id][0] - b[id][0], a[id][1] - b[id][1])));

test('for every pair of motions, the first frame after a switch barely moves and no later frame whips', () => {
  const views = Object.keys(rig.views).filter(view => rig.views[view]);
  const results = { first: { d: 0 }, later: { d: 0 } };
  for (const view of views) {
    const points = Object.entries(rig.views[view].bones).map(([id, bone]) => [id, bone.pivot]);
    for (const from of MOTION_NAMES) for (const to of MOTION_NAMES) {
      if (from === to) continue;
      const a = artist();
      const act = (motion, t) => a.resolve(rig, { view, motion: motion === 'idle' ? null : motion, progress: (t / 1300) % 1, elapsedMs: t });
      let t = 0;
      let last;
      for (; t <= 600; t += 16) last = bonePoints(act(from, t), points);
      let previous = last;
      for (let step = 0; step < 40; step += 1, t += 16) {
        const now = bonePoints(act(to, t), points);
        const d = displacement(previous, now, points);
        const slot = step === 0 ? 'first' : 'later';
        if (d > results[slot].d) results[slot] = { d, from, to, view, step };
        previous = now;
      }
    }
  }
  assert.ok(results.first.d < 1.5, `first frame after a switch moved ${results.first.d.toFixed(2)} art px (${results.first.from} → ${results.first.to}, ${results.first.view})`);
  assert.ok(results.later.d < 4.5, `a later frame moved ${results.later.d.toFixed(2)} art px (${results.later.from} → ${results.later.to}, ${results.later.view}, step ${results.later.step})`);
});

test('without the blend the same sweep does jump (the test would catch a regression)', () => {
  const raw = (motion) => sampleMotion(motion, { view: 'front', progress: 0 }).bones;
  const idle = sampleMotion('idle', { view: 'front', progress: 0 }).bones;
  assert.ok(Math.abs((raw('chew').arm_l?.r ?? 0) - (idle.arm_l?.r ?? 0)) > 0.8, 'raw chew starts 0.9 rad away from idle: exactly what the blend hides');
});

test('rig:check flags a part drawn on the static body layer but bound to a moving bone', () => {
  const { coverageReport } = require('../tools/rig-build/coverage.mjs');
  const clean = coverageReport(rig, null);
  assert.ok(!clean.gaps.some(gap => /will not move/.test(gap)), 'the demo rig has no such part');

  const doc = structuredClone(sprout);
  const front = doc.views.front;
  const ear = front.parts.find(part => part.bone === 'ear_l');
  assert.ok(ear, 'the demo has a left ear part to break');
  ear.layer = 'body';
  const broken = coverageReport(validateRig(doc).rig, null);
  const gap = broken.gaps.find(entry => /will not move/.test(entry));
  assert.ok(gap, 'the ear on the body layer is reported');
  assert.match(gap, /front: .*ear_l/);
  assert.match(gap, /"back" or "front"/, 'and the report says what to do about it');
  assert.match(broken.text, /static parts on moving bones: ear_l/);

  // 躯干自己（body 骨骼）画在 body 层是正常的，不该报。
  const torso = structuredClone(sprout);
  assert.ok(torso.views.front.parts.some(part => part.layer === 'body' && part.bone === 'body'));
  assert.ok(!coverageReport(validateRig(torso).rig, null).gaps.some(entry => /will not move/.test(entry)));
});
