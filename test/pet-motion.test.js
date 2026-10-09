'use strict';

// core/pet-motion.js 的单测：帧率无关时钟、弹簧、缓动、关键帧采样、
// 速率累加器、确定性随机与眨眼调度。所有时间都用注入值驱动。

const test = require('node:test');
const assert = require('node:assert/strict');

const petMotion = require('../src/core/pet-motion.mjs').default;

test('帧时钟：正常步长累积动画时间，大步长被 maxStepMs 截断', () => {
  const clock = petMotion.createMotionClock({ maxStepMs: 250 });
  const first = clock.step(1000);
  assert.equal(first.dtMs, 0, '首帧只锚定不推进');
  assert.equal(first.nowMs, 0);

  const second = clock.step(1016.7);
  assert.ok(Math.abs(second.dtMs - 16.7) < 1e-9);
  assert.ok(Math.abs(clock.elapsedMs - 16.7) < 1e-9);

  // 模拟页面隐藏 10 秒后恢复：只能前进一个上限步长，不补播。
  const afterGap = clock.step(1016.7 + 10_000);
  assert.equal(afterGap.dtMs, 250);
  assert.ok(Math.abs(clock.elapsedMs - (16.7 + 250)) < 1e-9);
});

test('帧时钟：负间隔与非有限时间戳不倒拨、不产生 NaN', () => {
  const clock = petMotion.createMotionClock({ maxStepMs: 250 });
  clock.step(500);
  const before = clock.elapsedMs;
  assert.equal(clock.step(400).dtMs, 0, '时间戳回退按停帧处理');
  assert.equal(clock.elapsedMs, before);
  assert.equal(Number.isNaN(clock.step(Number.NaN).dtMs), false);
  assert.equal(clock.elapsedMs, before);
  assert.equal(clock.step(Number.POSITIVE_INFINITY).dtMs, 0);
  assert.equal(clock.elapsedMs, before);
});

test('帧时钟：reset 重新锚定后不产生巨幅步长', () => {
  const clock = petMotion.createMotionClock({ maxStepMs: 250 });
  clock.step(100);
  clock.step(200);
  clock.reset(50_000);
  const after = clock.step(50_050);
  assert.equal(after.dtMs, 50, 'reset 后的第一帧应从新锚点计步');
});

test('帧时钟：非法配置被拒绝', () => {
  assert.throws(() => petMotion.createMotionClock({ maxStepMs: 0 }), RangeError);
  assert.throws(() => petMotion.createMotionClock({ maxStepMs: Number.NaN }), RangeError);
});

test('弹簧：闭式步进收敛到目标且任意步长轨迹一致', () => {
  for (const stepMs of [5, 16.7, 33.3, 100]) {
    const spring = petMotion.createSpring({ omega: 10, value: 0 });
    spring.setTarget(10);
    for (let t = 0; t < 3000; t += stepMs) spring.step(stepMs);
    assert.ok(Math.abs(spring.value - 10) < 1e-3, `step=${stepMs} 应收敛到 10，实际 ${spring.value}`);
    assert.ok(Math.abs(spring.velocity) < 1e-3);
    assert.ok(spring.isSettled(0.01));
  }
});

test('弹簧：从静止出发无过冲、全程有界', () => {
  const spring = petMotion.createSpring({ omega: 8, value: -20 });
  spring.setTarget(15);
  let seenMin = Infinity;
  let seenMax = -Infinity;
  for (let t = 0; t < 5000; t += 7) {
    spring.step(7);
    seenMin = Math.min(seenMin, spring.value);
    seenMax = Math.max(seenMax, spring.value);
  }
  assert.ok(seenMin >= -20 - 1e-9, '从静止出发的临界阻尼弹簧不应低于起点');
  assert.ok(seenMax <= 15 + 1e-9, '从静止出发的临界阻尼弹簧不应越过目标');
});

test('弹簧：大步长与极端输入不产生 NaN/Infinity', () => {
  const spring = petMotion.createSpring({ omega: 20, value: 100, velocity: -500 });
  spring.setTarget(-100);
  for (const dt of [1000, 5000, 0.5, 16.7, Number.NaN, Number.POSITIVE_INFINITY, -5]) {
    const value = spring.step(dt);
    assert.ok(Number.isFinite(value), `dt=${dt} 产生了非有限值 ${value}`);
  }
  assert.ok(Number.isFinite(spring.velocity));
  spring.step(10_000);
  assert.ok(Math.abs(spring.value + 100) < 1e-3, '大步长后仍应收敛到目标');
});

test('弹簧：非法参数被拒绝', () => {
  assert.throws(() => petMotion.createSpring({ omega: 0 }), RangeError);
  assert.throws(() => petMotion.createSpring({ omega: Number.NaN }), RangeError);
  assert.throws(() => petMotion.createSpring({ value: Number.NaN }), RangeError);
  const spring = petMotion.createSpring({});
  assert.throws(() => spring.setTarget(Number.NaN), RangeError);
});

test('缓动：端点、单调与非法输入钳制', () => {
  for (const [name, fn] of Object.entries(petMotion.easing)) {
    assert.equal(fn(0), 0, `${name}(0) 应为 0`);
    assert.equal(fn(1), 1, `${name}(1) 应为 1`);
    assert.equal(fn(Number.NaN), 0, `${name}(NaN) 应钳到 0`);
    assert.equal(fn(-3), 0, `${name} 负输入应钳到 0`);
    assert.equal(fn(7), 1, `${name} 超 1 输入应钳到 1`);
    let previous = 0;
    for (let i = 0; i <= 20; i++) {
      const value = fn(i / 20);
      assert.ok(value >= previous - 1e-9, `${name} 在 [0,1] 上应单调不减`);
      previous = value;
    }
  }
  assert.equal(petMotion.clamp01(0.4), 0.4);
  assert.equal(petMotion.clamp01(Number.NaN), 0);
});

test('关键帧采样：边界、中间值与末帧保持', () => {
  const sampler = petMotion.createSequenceSampler({
    durationMs: 200,
    frames: [
      { atMs: 0, value: 0 },
      { atMs: 100, value: 10 },
      { atMs: 200, value: -5 }
    ]
  });
  assert.equal(sampler.sample(0), 0);
  assert.equal(sampler.sample(50), 5);
  assert.equal(sampler.sample(100), 10);
  assert.equal(sampler.sample(150), 2.5);
  assert.equal(sampler.sample(200), -5);
  assert.equal(sampler.sample(5000), -5, '超过时长后应停在末帧值');
  assert.equal(sampler.sample(Number.NaN), 0, '非法时间按 0 处理');
});

test('关键帧采样：缓动段与循环模式', () => {
  const sampler = petMotion.createSequenceSampler({
    durationMs: 100,
    frames: [
      { atMs: 0, value: 0, ease: 'easeOutQuad' },
      { atMs: 100, value: 8 }
    ]
  });
  assert.ok(sampler.sample(50) > 4, 'easeOutQuad 前半段应先快后慢');
  const looped = petMotion.createSequenceSampler({
    durationMs: 200,
    loop: true,
    frames: [
      { atMs: 0, value: 0 },
      { atMs: 100, value: 10 },
      { atMs: 200, value: 0 }
    ]
  });
  assert.equal(looped.sample(250), looped.sample(50));
  assert.equal(looped.sample(400), looped.sample(0));
});

test('关键帧采样：同一时间点不同帧率采样结果一致（末帧与中途稳定）', () => {
  const make = () => petMotion.createSequenceSampler({
    durationMs: 500,
    frames: [
      { atMs: 0, value: 0 },
      { atMs: 250, value: 12 },
      { atMs: 500, value: 3 }
    ]
  });
  for (const probe of [0, 77, 125, 250, 333, 500, 900]) {
    const a = make();
    const b = make();
    // 模拟两种帧率：一路每 16.7ms 采样一次，一路每 100ms 采样一次，
    // 最后在同一时间点取值必须相同。
    for (let t = 0; t <= probe; t += 16.7) a.sample(t);
    for (let t = 0; t <= probe; t += 100) b.sample(t);
    assert.equal(a.sample(probe), b.sample(probe), `t=${probe} 两种采样密度结果不一致`);
    assert.equal(a.sample(probe), make().sample(probe), '采样历史不应影响纯函数结果');
  }
});

test('关键帧：非法配置被拒绝', () => {
  assert.throws(() => petMotion.createSequenceSampler({ durationMs: 100, frames: [] }), TypeError);
  assert.throws(() => petMotion.createSequenceSampler({ durationMs: 0, frames: [{ atMs: 0, value: 1 }] }), RangeError);
  assert.throws(
    () => petMotion.createSequenceSampler({
      durationMs: 100,
      frames: [{ atMs: 60, value: 1 }, { atMs: 20, value: 2 }]
    }),
    RangeError,
    '乱序关键帧应被拒绝'
  );
  assert.throws(
    () => petMotion.createSequenceSampler({
      durationMs: 100,
      frames: [{ atMs: 0, value: 1 }, { atMs: 0, value: 2 }]
    }),
    RangeError,
    '相同时间点应被拒绝'
  );
  assert.throws(
    () => petMotion.createSequenceSampler({
      durationMs: 100,
      frames: [{ atMs: 0, value: Number.NaN }]
    }),
    RangeError
  );
  assert.throws(
    () => petMotion.createSequenceSampler({
      durationMs: 100,
      frames: [{ atMs: 0, value: 0 }, { atMs: 300, value: 1 }]
    }),
    RangeError,
    '超出 duration 的关键帧应被拒绝'
  );
  assert.throws(
    () => petMotion.createSequenceSampler({
      durationMs: 100,
      frames: [{ atMs: 0, value: 0, ease: 'wobble' }]
    }),
    RangeError,
    '未知缓动名应被拒绝'
  );
});

test('关键帧播放器：开始、边界、末帧、取消语义', () => {
  const player = petMotion.createSequencePlayer({
    durationMs: 200,
    frames: [
      { atMs: 0, value: 0 },
      { atMs: 200, value: 20 }
    ]
  });
  assert.equal(player.sample(500).active, false, '未开始时不采样');
  assert.equal(player.sample(500).value, null);

  player.start(1000);
  const atStart = player.sample(1000);
  assert.equal(atStart.active, true);
  assert.equal(atStart.value, 0);
  assert.equal(player.sample(1100).value, 10);
  assert.equal(player.sample(999).value, 0, '早于开始时间按 0 处理');

  const finished = player.sample(1201);
  assert.equal(finished.active, false);
  assert.equal(finished.done, true);
  assert.equal(finished.value, 20, '结束后停在末帧值');
  assert.equal(player.sample(5000).value, 20);

  player.cancel();
  const afterCancel = player.sample(1250);
  assert.equal(afterCancel.active, false);
  assert.equal(afterCancel.done, false);
  assert.equal(afterCancel.value, null, '取消后不再出值');

  player.start(2000);
  assert.equal(player.sample(2100).value, 10, '重新开始后恢复采样');
});

test('速率累加器：6/30/60 FPS 下同一时长的发射总数一致', () => {
  const totalMs = 5000;
  const rate = 6;
  const totals = [];
  for (const fps of [6, 30, 60]) {
    const emitter = petMotion.createRateEmitter({ ratePerSecond: rate });
    const stepMs = 1000 / fps;
    let emitted = 0;
    for (let t = 0; t < totalMs; t += stepMs) emitted += emitter.update(stepMs);
    assert.equal(emitted, emitter.total);
    totals.push(emitted);
  }
  for (const total of totals) {
    assert.ok(Math.abs(total - rate * (totalMs / 1000)) <= 1, `发射总数 ${total} 偏离期望 30 超过容差`);
  }
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1, '不同帧率的发射总数差应 <= 1');
});

test('速率累加器：小数速率、零速率与非法输入', () => {
  const slow = petMotion.createRateEmitter({ ratePerSecond: 0.5 });
  let emitted = 0;
  for (let t = 0; t < 10_000; t += 1000 / 60) emitted += slow.update(1000 / 60);
  assert.ok(Math.abs(emitted - 5) <= 1);

  const zero = petMotion.createRateEmitter({ ratePerSecond: 0 });
  assert.equal(zero.update(100), 0);
  assert.equal(zero.update(Number.NaN), 0);

  const emitter = petMotion.createRateEmitter({ ratePerSecond: 2 });
  emitter.update(1000);
  assert.equal(emitter.total, 2);
  emitter.reset();
  assert.equal(emitter.total, 0);
  assert.equal(emitter.update(500), 1);

  assert.throws(() => petMotion.createRateEmitter({ ratePerSecond: -1 }), RangeError);
  assert.throws(() => petMotion.createRateEmitter({ ratePerSecond: Number.NaN }), RangeError);
});

test('确定性随机：同 seed 同序列，输出在 [0,1) 内', () => {
  const a = petMotion.createSeededRandom(20260901);
  const b = petMotion.createSeededRandom(20260901);
  for (let i = 0; i < 50; i++) {
    const x = a();
    const y = b();
    assert.equal(x, y, `第 ${i} 次抽取不一致`);
    assert.ok(x >= 0 && x < 1);
  }
  const c = petMotion.createSeededRandom(9999);
  const same = Array.from({ length: 20 }, () => c());
  const d = petMotion.createSeededRandom(9999);
  assert.deepEqual(Array.from({ length: 20 }, () => d()), same);
});

test('确定性随机：choice / range / int 稳定且落在边界内', () => {
  const colors = ['#e0af68', '#f7768e', '#7dcfff', '#bb9af7'];
  const a = petMotion.createSeededRandom(7);
  const b = petMotion.createSeededRandom(7);
  const picksA = Array.from({ length: 30 }, () => petMotion.seededChoice(a, colors));
  const picksB = Array.from({ length: 30 }, () => petMotion.seededChoice(b, colors));
  assert.deepEqual(picksA, picksB);
  for (const pick of picksA) assert.ok(colors.includes(pick));

  const ranged = petMotion.createSeededRandom(11);
  for (let i = 0; i < 100; i++) {
    const value = petMotion.seededRange(ranged, -3, 9);
    assert.ok(value >= -3 && value < 9);
  }
  const ints = petMotion.createSeededRandom(13);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const value = petMotion.seededInt(ints, 2, 5);
    assert.ok(Number.isInteger(value) && value >= 2 && value <= 5);
    seen.add(value);
  }
  assert.equal(seen.size, 4, '闭区间 [2,5] 的每个整数都应能取到');

  assert.throws(() => petMotion.seededChoice(a, []), RangeError);
  assert.throws(() => petMotion.seededRange(a, 5, 1), RangeError);
  assert.throws(() => petMotion.seededInt(a, 1.5, 3), RangeError);
  assert.throws(() => petMotion.seededIndex(a, 0), RangeError);
});

test('离散重力积分：拆分步长与整段推进完全可组合', () => {
  const start = { position: 10, velocity: -2 };
  const acceleration = 0.15;
  const wholePosition = petMotion.advanceDiscretePosition(
    start.position, start.velocity, acceleration, 10
  );
  const splitPosition = petMotion.advanceDiscretePosition(
    petMotion.advanceDiscretePosition(start.position, start.velocity, acceleration, 4),
    start.velocity + acceleration * 4,
    acceleration,
    6
  );
  assert.ok(Math.abs(wholePosition - splitPosition) < 1e-12);

  let legacyPosition = start.position;
  let legacyVelocity = start.velocity;
  for (let index = 0; index < 10; index++) {
    legacyPosition += legacyVelocity;
    legacyVelocity += acceleration;
  }
  assert.ok(Math.abs(wholePosition - legacyPosition) < 1e-12,
    '整数步长必须保持旧 60 FPS 的先位移后加速语义');
  assert.throws(() => petMotion.advanceDiscretePosition(0, 0, 1, -1), RangeError);
});

test('眨眼调度：绝对时间表在 6/30/60 FPS 下计数完全一致', () => {
  const totalMs = 5000;
  const counts = [];
  for (const fps of [6, 30, 60]) {
    const scheduler = petMotion.createBlinkScheduler({
      random: petMotion.createSeededRandom(4242),
      minMs: 667,
      maxMs: 2333,
      blinkMs: 100
    });
    const stepMs = 1000 / fps;
    for (let t = 0; t <= totalMs; t += stepMs) scheduler.update(t);
    counts.push(scheduler.blinkCount);
  }
  assert.ok(counts[0] > 0, '5 秒内至少应眨一次眼');
  assert.equal(counts[0], counts[1]);
  assert.equal(counts[1], counts[2], '同一随机序列的眨眼次数与帧率无关');
});

test('眨眼调度：闭合窗口持续时长与可见性', () => {
  // 用 1ms 细网格验证单次眨眼恰好持续 blinkMs。
  const scheduler = petMotion.createBlinkScheduler({
    random: petMotion.createSeededRandom(1),
    minMs: 300,
    maxMs: 300,
    blinkMs: 100
  });
  let blinking = false;
  let currentRun = 0;
  const runs = [];
  for (let t = 0; t <= 2000; t += 1) {
    const result = scheduler.update(t);
    if (result.blinking && !blinking) currentRun = 1;
    else if (result.blinking && blinking) currentRun += 1;
    else if (!result.blinking && blinking) runs.push(currentRun);
    blinking = result.blinking;
  }
  assert.ok(runs.length >= scheduler.blinkCount - 1);
  for (const run of runs) {
    assert.ok(Math.abs(run - 100) <= 1, `眨眼持续 ${run}ms，应约等于 100ms`);
  }

  // 低帧率（250ms 间隔）下窗口可能整段落空，调度器必须在追上的帧补显：
  // 任何一次“追上新眨眼”的 update 都必须返回 blinking。
  const slow = petMotion.createBlinkScheduler({
    random: petMotion.createSeededRandom(5),
    minMs: 320,
    maxMs: 480,
    blinkMs: 100
  });
  let startedTotal = 0;
  let missed = 0;
  for (let t = 0; t <= 10_000; t += 250) {
    const result = slow.update(t);
    startedTotal += result.started;
    if (result.started > 0 && !result.blinking) missed += 1;
  }
  assert.equal(missed, 0, '追上眨眼的帧必须闭眼，低帧率下不能静默丢眨眼');
  assert.equal(startedTotal, slow.blinkCount, 'started 累计应等于总眨眼次数');
});

test('眨眼调度：非法配置被拒绝，reset 可重新排程', () => {
  assert.throws(() => petMotion.createBlinkScheduler({ minMs: 0 }), RangeError);
  assert.throws(() => petMotion.createBlinkScheduler({ minMs: 500, maxMs: 400 }), RangeError);
  assert.throws(() => petMotion.createBlinkScheduler({ blinkMs: 0 }), RangeError);
  assert.throws(() => petMotion.createBlinkScheduler({ doubleChance: -0.1 }), RangeError);
  assert.throws(() => petMotion.createBlinkScheduler({ doubleChance: 1.1 }), RangeError);

  const scheduler = petMotion.createBlinkScheduler({
    random: petMotion.createSeededRandom(9),
    minMs: 100,
    maxMs: 100,
    blinkMs: 50
  });
  for (let t = 0; t <= 1000; t += 16) scheduler.update(t);
  assert.ok(scheduler.blinkCount > 3);
  scheduler.reset(1000);
  assert.equal(scheduler.blinkCount, 0);
  assert.ok(scheduler.nextBlinkAt > 1000);
  assert.equal(scheduler.update(1010).blinking, false);
});

test('眨眼调度：doubleChance 生成独立的第二次闭眼且可由 retune 更新', () => {
  const scheduler = petMotion.createBlinkScheduler({
    random: () => 0,
    minMs: 500,
    maxMs: 500,
    blinkMs: 100,
    doubleGapMs: 80,
    doubleChance: 0
  });
  scheduler.update(0);
  scheduler.retune({ doubleChance: 1 });

  assert.equal(scheduler.update(500).started, 1, '先开始第一下眨眼');
  assert.equal(scheduler.nextBlinkAt, 680, '第二下应排在闭眼结束后的短间隔');
  assert.equal(scheduler.update(679).started, 0);
  assert.equal(scheduler.update(680).started, 1, 'double blink 的第二下必须独立发生');
  assert.equal(scheduler.blinkCount, 2);
  assert.equal(scheduler.nextBlinkAt, 1280, '下一组眨眼从双眨完整结束后重新计时');
});

test('弹簧 + 时钟组合：后台恢复的大间隔不会打飞弹簧', () => {
  const clock = petMotion.createMotionClock({ maxStepMs: 250 });
  const spring = petMotion.createSpring({ omega: 14, value: 0 });
  spring.setTarget(30);
  clock.step(0);
  for (let t = 16; t <= 2000; t += 16) {
    spring.step(clock.step(t).dtMs);
  }
  const before = spring.value;
  // 模拟切后台 60 秒再回来。
  const resumed = clock.step(2000 + 60_000);
  assert.equal(resumed.dtMs, 250);
  spring.step(resumed.dtMs);
  assert.ok(Number.isFinite(spring.value));
  assert.ok(Math.abs(spring.value - before) < 10, '恢复帧只应推进一小步，而不是跳到终点或飞散');
});

test('导出面：API 冻结且与渲染全局名约定一致', () => {
  assert.ok(Object.isFrozen(petMotion));
  const expected = [
    'MS_PER_LEGACY_FRAME',
    'createMotionClock',
    'createSpring',
    'easing',
    'clamp01',
    'createSequenceSampler',
    'createSequencePlayer',
    'createRateEmitter',
    'advanceDiscretePosition',
    'createSeededRandom',
    'seededIndex',
    'seededChoice',
    'seededRange',
    'seededInt',
    'createBlinkScheduler'
  ];
  for (const key of expected) {
    assert.ok(key in petMotion, `缺少导出 ${key}`);
  }
  assert.ok(Math.abs(petMotion.MS_PER_LEGACY_FRAME - 1000 / 60) < 1e-12);
});
