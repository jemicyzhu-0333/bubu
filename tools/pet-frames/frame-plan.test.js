'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOOP_PHASES,
  ACTION_PHASES,
  loopPeriodMs,
  planExpressionFrames,
  planExpressionSheet,
  planActionFrames,
  planActionSheet,
  planSceneSheet,
  assessStripHealth
} = require('./frame-plan.mjs');
// 计划必须按真实注册表来验，而不是按手捏的假数据：这个工具存在的意义就是
// 覆盖那 32 个动作，而“少覆盖一个”正是它唯一不能出的错。
const expressions = require('../../src/content/expressions.mjs');
const behaviors = require('../../src/content/behaviors.mjs');
const sessionActivities = require('../../src/content/session-activities.mjs');
const scenes = require('../../src/content/scenes.mjs');
const { createExpressionRegistry } = require('../../src/core/pet-expression.mjs');

const registry = createExpressionRegistry(expressions.EXPRESSIONS);
const sheet = planExpressionSheet(registry, expressions.EXPECTED_EXPRESSION_IDS);

function healthySamples(plan, options = {}) {
  const signatures = options.signatures || plan.frames.map((frame, index) => `sig-${index}`);
  return plan.frames.map((frame, index) => ({
    opaquePixels: 128,
    width: 100,
    height: 100,
    bounds: { minX: 10, minY: 10, maxX: 80, maxY: 80 },
    signature: signatures[index]
  }));
}

test('the sheet covers every registered expression exactly once, in registry order', () => {
  assert.equal(sheet.length, expressions.EXPECTED_TOTAL);
  assert.deepEqual(sheet.map(plan => plan.id), [...expressions.EXPECTED_EXPRESSION_IDS]);
  assert.equal(new Set(sheet.map(plan => plan.id)).size, expressions.EXPECTED_TOTAL);
  assert.throws(() => planExpressionSheet(registry, ['no.such.expression']), RangeError);
});

test('the extended sheet covers all 43 behaviors, 12 session actions, and 25 scenes', () => {
  const actions = planActionSheet(behaviors.PET_ACTIONS, 'action');
  const sessions = planActionSheet(sessionActivities.SESSION_ACTIVITIES, 'session');
  const sceneSheet = planSceneSheet(scenes.SCENES);

  assert.equal(actions.length, Object.keys(behaviors.PET_ACTIONS).length);
  assert.ok(actions.some(plan => plan.id === 'take-note'));
  assert.equal(sessions.length, 12);
  assert.equal(sceneSheet.length, 25);
  assert.deepEqual(actions.map(plan => plan.id), Object.keys(behaviors.PET_ACTIONS));
  assert.deepEqual(sessions.map(plan => plan.id), Object.keys(sessionActivities.SESSION_ACTIVITIES));
  assert.deepEqual(sceneSheet.map(plan => plan.id), Object.keys(scenes.SCENES));
  assert.ok(actions.every(plan => plan.kind === 'action'));
  assert.ok(sessions.every(plan => plan.kind === 'session'));
  assert.ok(sceneSheet.every(plan => plan.kind === 'scene' && plan.allowEdgeTouch));
});

test('action plans sample the full gesture and include the real static fallback', () => {
  const action = behaviors.PET_ACTIONS['dig-treasure'];
  const plan = planActionFrames(action);
  assert.deepEqual(
    plan.frames.filter(frame => !frame.static).map(frame => frame.progress),
    [...ACTION_PHASES]
  );
  assert.equal(plan.frames.at(-1).progress, 0.75);
  assert.equal(plan.frames.at(-1).static, true);
  assert.equal(plan.durationMs, action.duration);
  assert.equal(plan.expression, action.expression);
  assert.throws(() => planActionFrames({ id: 'broken', duration: 0 }), RangeError);
});

test('every expression gets a static frame and at least one played frame', () => {
  for (const plan of sheet) {
    const statics = plan.frames.filter(frame => frame.static);
    assert.equal(statics.length, 1, `${plan.id} 必须恰好有一张静态停帧`);
    // 静态停帧是低刺激档位真正显示的那一帧，漏掉它就等于没验证那条路径。
    assert.equal(statics[0].key, 'static');
    assert.ok(plan.frames.some(frame => !frame.static), `${plan.id} 必须有播放态帧`);
    // 眨眼独立成帧，主体帧一律不眨眼 —— 否则条带上会出现一张让人误判成
    // “眼睛没画”的闭眼图。
    const blinking = plan.frames.filter(frame => frame.blinking);
    assert.equal(blinking.length, 1, `${plan.id} 只应有一帧眨眼`);
    assert.equal(blinking[0].key, 'blink');
  }
});

test('a still expression is planned as still instead of getting duplicate phases', () => {
  // 饥饿增加了收紧呼吸后，32 个表达里剩 9 个既无进入动画也无循环。给它们排四个
  // “相位”只会得到四张一样的图，而那会把体检里“动作没动”判据变成假警报。
  const still = sheet.filter(plan => !plan.animated);
  assert.equal(still.length, 9);
  for (const plan of still) {
    assert.equal(plan.enterMs, 0);
    assert.equal(plan.periodMs, 0);
    assert.deepEqual(plan.frames.map(frame => frame.key), ['settled', 'blink', 'static']);
  }
});

test('enter frames stay inside the enter window and loop phases spread across one period', () => {
  const wake = sheet.find(plan => plan.id === 'life.wake');
  assert.equal(wake.enterMs, 420);
  const enterFrames = wake.frames.filter(frame => frame.phase === 'enter');
  assert.deepEqual(enterFrames.map(frame => frame.elapsedMs), [0, 210]);
  for (const frame of enterFrames) assert.ok(frame.elapsedMs < wake.enterMs);

  const idle = sheet.find(plan => plan.id === 'life.idle');
  assert.equal(idle.periodMs, 3200);
  const loopFrames = idle.frames.filter(frame => frame.phase === 'loop');
  assert.equal(loopFrames.length, LOOP_PHASES.length);
  // 相位必须互不相同，否则“跨相位对比”看不出任何动效。
  assert.deepEqual(loopFrames.map(frame => frame.elapsedMs), [0, 800, 1600, 2400]);
  assert.equal(new Set(loopFrames.map(frame => frame.elapsedMs)).size, LOOP_PHASES.length);
});

test('loop period takes the slowest loop rather than a least common multiple', () => {
  assert.equal(loopPeriodMs([]), 0);
  assert.equal(loopPeriodMs(undefined), 0);
  // LCM(900, 3200) 是 28800ms —— 在那种长度上取四个相位，相邻两张几乎一样。
  assert.equal(loopPeriodMs([{ periodMs: 900 }, { periodMs: 3200 }]), 3200);
  assert.equal(loopPeriodMs([{ primitive: 'breath' }]), 2400, '缺省周期与采样器一致');
});

test('the health check reports blank frames and paint that reaches the canvas edge', () => {
  const plan = sheet.find(plan => plan.id === 'life.idle');

  assert.equal(assessStripHealth(plan, healthySamples(plan)).ok, true);

  const blank = healthySamples(plan);
  blank[0] = { ...blank[0], opaquePixels: 0 };
  const blankResult = assessStripHealth(plan, blank);
  assert.equal(blankResult.ok, false);
  assert.match(blankResult.faults.join(' '), /没有画出任何像素/);

  // 触边意味着有内容被画布裁掉，而被裁掉的部分在图上看不见 —— 这正是肉眼
  // 复核抓不到、必须自动报的一类。
  const clipped = healthySamples(plan);
  clipped[1] = { ...clipped[1], bounds: { minX: 0, minY: 10, maxX: 80, maxY: 80 } };
  const clippedResult = assessStripHealth(plan, clipped);
  assert.equal(clippedResult.ok, false);
  assert.match(clippedResult.faults.join(' '), /触到画布边缘/);

  assert.throws(() => assessStripHealth(plan, [{ opaquePixels: 1 }]), /expected \d+ samples/);
});

test('full-bleed scenes allow intentional edge paint but still reject blank frames', () => {
  const plan = planSceneSheet(scenes.SCENES).find(item => item.id === 'star-camp');
  assert.deepEqual(plan.frames.map(frame => frame.variant), ['backdrop', 'composite']);
  const edgeSample = healthySamples(plan);
  edgeSample[0] = { ...edgeSample[0], bounds: { minX: 0, minY: 0, maxX: 99, maxY: 99 } };
  assert.equal(assessStripHealth(plan, edgeSample).ok, true);
  edgeSample[0] = { ...edgeSample[0], opaquePixels: 0 };
  assert.equal(assessStripHealth(plan, edgeSample).ok, false);
});

test('identical frames are a fault for an animated expression and normal for a still one', () => {
  const animated = sheet.find(plan => plan.id === 'life.idle');
  const frozen = assessStripHealth(animated, healthySamples(animated, {
    signatures: animated.frames.map(() => 'same')
  }));
  assert.equal(frozen.ok, false);
  assert.match(frozen.faults.join(' '), /所有取样帧完全一致/);

  // 同样的“全部一致”对静止动作是正确行为，不能报错。
  const still = sheet.find(plan => !plan.animated);
  const quiet = assessStripHealth(still, healthySamples(still, {
    signatures: still.frames.map(() => 'same')
  }));
  assert.deepEqual(quiet.faults, []);
  assert.equal(quiet.ok, true);
});

test('the blink frame never decides whether an expression counts as moving', () => {
  const animated = sheet.find(plan => plan.id === 'life.idle');
  // 主体帧全同、只有眨眼帧不同 —— 那仍然是“没动”，不能被眨眼掩盖过去。
  const signatures = animated.frames.map(frame => (frame.phase === 'blink' ? 'blink-differs' : 'same'));
  const result = assessStripHealth(animated, healthySamples(animated, { signatures }));
  assert.equal(result.ok, false);
  assert.match(result.faults.join(' '), /所有取样帧完全一致/);
});
