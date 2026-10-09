'use strict';

// core/pet-expression.js 与 content/expressions.js 的单测：
// 32 个原创表达的闭合 schema、唯一性、回退、位姿采样有界，以及冻结后
// 渲染端不得污染配置。

const test = require('node:test');
const assert = require('node:assert/strict');

const petExpression = require('../src/core/pet-expression.mjs');
const expressions = require('../src/content/expressions.mjs');
const { resolvePetStage, petArtSafeArea } = require('../src/core/pet-stage.mjs');

const {
  EYE_MASKS,
  MOUTH_MASKS,
  LOOP_PRIMITIVES,
  EXPRESSION_ACCENTS,
  EXPRESSION_NAMESPACES,
  FALLBACK_ID,
  normalizeExpression,
  createExpressionRegistry,
  sampleExpressionPose
} = petExpression;

function validExpression(overrides = {}) {
  return {
    id: 'life.idle',
    group: 'life',
    label: '普通待机',
    face: { eyes: 'neutral', mouth: 'neutral' },
    body: { tone: 'normal' },
    blink: { minMs: 3600, maxMs: 7200, doubleChance: 0.08 },
    loops: [],
    enter: { durationMs: 0 },
    static: { face: { eyes: 'neutral', mouth: 'neutral' } },
    ...overrides
  };
}

test('通用表情入场保持身体尺寸，不添加隐式压缩', () => {
  const registry = createExpressionRegistry([validExpression({ enter: { durationMs: 400 } })]);
  for (const elapsedMs of [0, 50, 200, 399, 400, 800]) {
    const pose = sampleExpressionPose(registry, 'life.idle', elapsedMs);
    assert.equal(pose.body.scaleX, 1);
    assert.equal(pose.body.scaleY, 1);
  }
});

test('内置表达库恰好 32 个、唯一且分组数量符合合同', () => {
  const stats = expressions.assertExpressionLibrary();
  assert.equal(stats.total, 32);
  assert.deepEqual(stats.groupCounts, { life: 8, work: 10, react: 8, system: 6 });

  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  assert.equal(registry.size, 32);
  assert.equal(registry.errors.length, 0, `内置表达校验不应出错：${registry.errors.join('; ')}`);
  assert.equal(new Set(registry.ids()).size, 32, '32 个 ID 必须唯一');
  for (const ns of EXPRESSION_NAMESPACES) {
    assert.ok(registry.ids().some(id => id.startsWith(`${ns}.`)), `缺少命名空间 ${ns}`);
  }
});

test('内置表达库锁定设计文档中的精确 32 个语义 ID', () => {
  assert.deepEqual(
    [...expressions.EXPECTED_EXPRESSION_IDS].sort(),
    expressions.EXPRESSIONS.map(item => item.id).sort()
  );

  const replaced = expressions.EXPRESSIONS.map((item, index) => index === 0
    ? { ...item, id: 'life.alternate-idle' }
    : item);
  assert.throws(() => expressions.assertExpressionLibrary(replaced), /expression id contract/i,
    '同组内任意换名也必须破坏稳定 ID 合同');
});

test('每个表达都有独立静态位姿，且静态脸引用已知 mask', () => {
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  const seen = new Set();
  for (const config of registry.configs()) {
    assert.ok(config.static && config.static.face, `${config.id} 缺少静态位姿`);
    assert.ok(EYE_MASKS.includes(config.static.face.eyes), `${config.id} 静态眼形未知`);
    assert.ok(MOUTH_MASKS.includes(config.static.face.mouth), `${config.id} 静态嘴形未知`);
    const signature = `${config.static.face.eyes}|${config.static.face.mouth}`;
    assert.ok(!seen.has(signature), `${config.id} 的静态位姿与已有表达重复（${signature}）`);
    seen.add(signature);
  }
  assert.equal(seen.size, 32);
});

test('低能量、饥饿、准备与庆祝使用高辨识度视觉语汇', () => {
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  const drowsy = registry.get('life.drowsy');
  assert.equal(drowsy.face.eyes, 'droopy');
  assert.equal(drowsy.face.mouth, 'wavy');
  assert.equal(drowsy.accent, 'drowsy-zzz');
  assert.equal(drowsy.body.rotateDeg, 0);

  const sleep = registry.get('life.sleep');
  assert.equal(sleep.accent, 'sleep-zzz');

  const hungry = registry.get('react.hungry');
  assert.equal(hungry.face.eyes, 'pleading');
  assert.equal(hungry.face.mouth, 'wavy');
  assert.equal(hungry.face.eyeInsetX, 2, '饥饿眼应向脸部中心内收');
  assert.ok(hungry.body.scaleX < 1 && hungry.body.scaleY > 1, '饥饿身体应呈现收紧感');

  assert.equal(registry.get('work.ready').face.eyes, 'determined');
  assert.deepEqual(registry.get('react.celebrate').static.face, { eyes: 'sparkle', mouth: 'grin' });
});

test('无效 ID 回退 life.idle 并返回可测试错误，不产生空白', () => {
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  const miss = registry.resolve('react.does-not-exist');
  assert.equal(miss.ok, false);
  assert.equal(miss.error, 'unknown-expression');
  assert.equal(miss.value.id, FALLBACK_ID, '无效 ID 必须回退到 life.idle');

  const hit = registry.resolve('work.focus');
  assert.equal(hit.ok, true);
  assert.equal(hit.value.id, 'work.focus');
});

test('闭合 schema：未知字段被拒绝', () => {
  for (const extra of [
    { hack: true },
    { face: { eyes: 'neutral', mouth: 'neutral', pupil: 3 } },
    { body: { tone: 'normal', wobble: 1 } },
    { blink: { minMs: 100, maxMs: 200, triple: true } },
    { loops: [{ primitive: 'breath', jitter: 1 }] },
    { enter: { durationMs: 100, wiggle: true } },
    { static: { face: { eyes: 'closed', mouth: 'closed' }, glow: true } },
    { static: { face: { eyes: 'closed', mouth: 'closed', pupil: 1 } } },
    { static: { face: { eyes: 'closed', mouth: 'closed' }, body: { x: 0, wobble: 1 } } }
  ]) {
    const merged = { ...validExpression(), ...extra };
    if (extra.face) merged.face = extra.face;
    if (extra.body) merged.body = extra.body;
    if (extra.blink) merged.blink = extra.blink;
    if (extra.loops) merged.loops = extra.loops;
    if (extra.enter) merged.enter = extra.enter;
    if (extra.static) merged.static = extra.static;
    const result = normalizeExpression(merged);
    assert.equal(result.ok, false, `应拒绝未知字段：${JSON.stringify(extra)}`);
  }
});

test('静态身体位姿按闭合 schema 归一化、校验并冻结', () => {
  const result = normalizeExpression(validExpression({
    body: { tone: 'warm', x: 1, y: -1, scaleX: 1.02, scaleY: 0.98, rotateDeg: 2 },
    static: {
      face: { eyes: 'focused', mouth: 'closed' },
      body: { y: 2, scaleY: 0.95, rotateDeg: -3 }
    }
  }));
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.deepEqual(result.value.static.body, {
    tone: 'warm', x: 1, y: 2, scaleX: 1.02, scaleY: 0.95, rotateDeg: -3
  });
  assert.ok(Object.isFrozen(result.value.static.body));

  assert.equal(normalizeExpression(validExpression({
    static: { face: { eyes: 'neutral', mouth: 'neutral' }, body: { x: Number.NaN } }
  })).ok, false);
  assert.equal(normalizeExpression(validExpression({
    static: { face: { eyes: 'neutral', mouth: 'neutral' }, body: { rotateDeg: 90 } }
  })).ok, false);
});

test('闭合 schema：NaN、Infinity、越界数值与负时长被拒绝', () => {
  const cases = [
    validExpression({ id: Number.NaN }),
    validExpression({ face: { eyes: 'neutral', mouth: 'neutral', openness: Number.NaN } }),
    validExpression({ face: { eyes: 'neutral', mouth: 'neutral', openness: Number.POSITIVE_INFINITY } }),
    validExpression({ face: { eyes: 'neutral', mouth: 'neutral', eyeInsetX: 5 } }),
    validExpression({ face: { eyes: 'neutral', mouth: 'neutral', eyeInsetX: 0.5 } }),
    validExpression({ face: { eyes: 'neutral', mouth: 'neutral', gaze: { enabled: false, maxX: Number.NaN } } }),
    validExpression({ accent: 'floating-random-symbol' }),
    validExpression({ body: { tone: 'normal', x: Number.NaN } }),
    validExpression({ body: { tone: 'normal', x: 999 } }),
    validExpression({ body: { tone: 'normal', scaleX: 5 } }),
    validExpression({ body: { tone: 'normal', rotateDeg: 90 } }),
    validExpression({ blink: { minMs: -100, maxMs: 7200, doubleChance: 0 } }),
    validExpression({ blink: { minMs: 3600, maxMs: 7200, doubleChance: 3 } }),
    validExpression({ loops: [{ primitive: 'breath', periodMs: Number.POSITIVE_INFINITY }] }),
    validExpression({ enter: { durationMs: -5 } }),
    validExpression({ enter: { durationMs: 20000 } })
  ];
  for (const config of cases) {
    assert.equal(normalizeExpression(config).ok, false, `应拒绝：${JSON.stringify(config.body || config.face || config.enter)}`);
  }
});

test('闭合 schema：未知 mask、未知原语、未排序关键帧与空关键帧被拒绝', () => {
  assert.equal(normalizeExpression(validExpression({ face: { eyes: 'laser', mouth: 'neutral' } })).ok, false);
  assert.equal(normalizeExpression(validExpression({ face: { eyes: 'neutral', mouth: 'fangs' } })).ok, false);
  assert.equal(normalizeExpression(validExpression({ loops: [{ primitive: 'spin' }] })).ok, false);
  assert.equal(normalizeExpression(validExpression({
    enter: { durationMs: 200, frames: [{ atMs: 100, y: 0 }, { atMs: 50, y: 1 }] }
  })).ok, false, '未排序关键帧应被拒绝');
  assert.equal(normalizeExpression(validExpression({
    enter: { durationMs: 200, frames: [] }
  })).ok, false, '显式空关键帧应被拒绝');
  // 超过 8 帧被拒绝
  const manyFrames = Array.from({ length: 9 }, (_, i) => ({ atMs: i * 10, y: 0 }));
  assert.equal(normalizeExpression(validExpression({ enter: { durationMs: 200, frames: manyFrames } })).ok, false);
  // loops 超过 3 条被拒绝
  assert.equal(normalizeExpression(validExpression({
    loops: [
      { primitive: 'breath' }, { primitive: 'sway' }, { primitive: 'beat' }, { primitive: 'tremble' }
    ]
  })).ok, false);
  // id 命名空间与 group 不一致被拒绝
  assert.equal(normalizeExpression(validExpression({ id: 'work.idle', group: 'life' })).ok, false);
});

test('归一化补齐缺省并冻结，渲染端不能原地污染', () => {
  const registry = createExpressionRegistry([{
    id: 'life.idle',
    group: 'life',
    label: '测试',
    face: { eyes: 'neutral', mouth: 'neutral' },
    body: {},
    blink: { minMs: 1000, maxMs: 2000, doubleChance: 0 },
    loops: [],
    enter: { durationMs: 0 },
    static: { face: { eyes: 'neutral', mouth: 'neutral' } }
  }]);
  assert.equal(registry.errors.length, 0);
  const config = registry.get('life.idle');
  assert.equal(config.face.openness, 1, '缺省 openness 应为 1');
  assert.equal(config.face.eyeInsetX, 0, '缺省 eyeInsetX 应为 0');
  assert.equal(config.accent, 'none', '缺省 accent 应为 none');
  assert.equal(config.body.tone, 'normal', '缺省 tone 应为 normal');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.face));
  assert.ok(Object.isFrozen(config.body));
  assert.throws(() => { config.face.eyes = 'laser'; }, TypeError);
  assert.throws(() => { config.body.x = 99; }, TypeError);
  assert.equal(config.face.eyes, 'neutral');
});

test('位姿采样有限、确定且落在像素舞台安全区内', () => {
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const safe = petArtSafeArea(stage);
  for (const id of registry.ids()) {
    for (const t of [0, 120, 500, 1500, 5000]) {
      const pose = sampleExpressionPose(registry, id, t);
      assert.ok(pose, `${id}@${t} 采样不应为空`);
      for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotateDeg']) {
        assert.ok(Number.isFinite(pose.body[key]), `${id}@${t} body.${key} 非有限`);
      }
      assert.ok(Number.isFinite(pose.face.eyeOffsetX));
      assert.ok(Number.isInteger(pose.face.eyeInsetX));
      assert.ok(EXPRESSION_ACCENTS.includes(pose.accent));
      assert.ok(Number.isFinite(pose.face.openness));
      // 身体原点位移相对身体左上角，必须落在安全区内。
      assert.ok(pose.body.x >= safe.left && pose.body.x <= safe.right, `${id}@${t} body.x 越界`);
      assert.ok(pose.body.y >= safe.top && pose.body.y <= safe.bottom, `${id}@${t} body.y 越界`);
    }
    // 确定性：同一时间两次采样结果一致。
    const a = sampleExpressionPose(registry, id, 777);
    const b = sampleExpressionPose(registry, id, 777);
    assert.deepEqual(a, b, `${id} 采样必须确定`);
  }
});

test('循环原语白名单齐全且有界', () => {
  assert.deepEqual([...LOOP_PRIMITIVES], ['breath', 'sway', 'look-around', 'beat', 'tremble']);
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  for (const config of registry.configs()) {
    assert.ok(config.loops.length <= 3, `${config.id} loops 超过 3 条`);
    for (const loop of config.loops) {
      assert.ok(LOOP_PRIMITIVES.includes(loop.primitive));
      assert.ok(loop.periodMs >= 200 && loop.periodMs <= 10000);
    }
  }
});

test('P5：43 个行为与 12 个会话动作直接使用已注册 expression ID', () => {
  const registry = createExpressionRegistry(expressions.EXPRESSIONS);
  const behaviors = require('../src/content/behaviors.mjs');
  const sessions = require('../src/content/session-activities.mjs');
  assert.equal(Object.keys(behaviors.PET_ACTIONS).length, 43);
  assert.equal(Object.keys(sessions.SESSION_ACTIVITIES).length, 12);
  for (const action of Object.values(behaviors.PET_ACTIONS)) {
    assert.ok(registry.has(action.expression),
      `behavior ${action.id} 的 expression "${action.expression}" 未注册`);
  }
  for (const activity of Object.values(sessions.SESSION_ACTIVITIES)) {
    assert.ok(registry.has(activity.expression),
      `session ${activity.id} 的 expression "${activity.expression}" 未注册`);
  }
  assert.equal('resolveLegacyExpressionTag' in petExpression, false,
    'P5 完成后不应继续暴露旧六标签兼容入口');
});

test('mask 白名单覆盖扩展情绪词汇（16 眼形 / 9 嘴形）', () => {
  assert.equal(EYE_MASKS.length, 16);
  assert.equal(MOUTH_MASKS.length, 9);
  assert.equal(new Set(EYE_MASKS).size, 16);
  assert.equal(new Set(MOUTH_MASKS).size, 9);
  for (const name of ['droopy', 'pleading', 'determined', 'sparkle']) assert.ok(EYE_MASKS.includes(name));
  for (const name of ['wavy', 'grin']) assert.ok(MOUTH_MASKS.includes(name));
  assert.deepEqual([...EXPRESSION_ACCENTS], ['none', 'sleep-zzz', 'drowsy-zzz']);
});
