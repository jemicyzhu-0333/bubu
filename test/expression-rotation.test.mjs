import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPRESSIONS, EXPECTED_EXPRESSION_IDS } from '../src/content/expressions.mjs';
import { EXPRESSION_SCENARIOS, validateExpressionScenarios } from '../src/content/expression-scenarios.mjs';
import { createExpressionRotation } from '../src/core/expression-rotation.mjs';
import { sampleDangoFace } from '../src/capabilities/companion/presentation/dango-face.mjs';
import petMotion from '../src/core/pet-motion.mjs';

const known = new Set(EXPECTED_EXPRESSION_IDS);
const faceOf = id => EXPRESSIONS.find(e => e.id === id).face;

// 模拟 renderer 每 50ms 一帧：base 由轮播器给出，脸由 dango 画笔采样。
function simulate(key, { minutes = 60, seed = 7, calm = false } = {}) {
  const rotation = createExpressionRotation({ scenarios: EXPRESSION_SCENARIOS,
    random: petMotion.createSeededRandom(seed), has: id => known.has(id) });
  const expressions = new Map(), looks = new Map();
  let current = null, startedAt = 0, switches = 0;
  for (let t = 0; t < minutes * 60_000; t += 50) {
    const id = rotation.resolveBase(key, t, { calm });
    if (id !== current) { current = id; startedAt = t; switches += 1; }
    expressions.set(id, (expressions.get(id) || 0) + 1);
    const f = sampleDangoFace(faceOf(id), { expressionId: id, motion: 'idle', expressionElapsedMs: t - startedAt });
    const look = `${f.openness <= .15 ? 'closed' : f.eyes}/${f.mouth}`;
    looks.set(look, (looks.get(look) || 0) + 1);
  }
  return { expressions, looks, switches };
}

test('scenario registry only references real expressions', () => {
  assert.deepEqual(validateExpressionScenarios(EXPRESSION_SCENARIOS, EXPECTED_EXPRESSION_IDS), []);
});

test('root cause: a fixed life.idle base on dango only shows two looks', () => {
  const looks = new Map();
  for (let t = 0; t < 3_600_000; t += 50) {
    const f = sampleDangoFace(faceOf('life.idle'), { expressionId: 'life.idle', motion: 'idle', expressionElapsedMs: t });
    looks.set(`${f.eyes}/${f.mouth}`, (looks.get(`${f.eyes}/${f.mouth}`) || 0) + 1);
  }
  const top2 = [...looks.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
  assert.ok(top2 / 72_000 > 0.9, 'old idle phrase is dominated by two faces');
});

for (const key of ['idle', 'focus', 'rest', 'paused', 'idle.late-night']) {
  test(`${key}: rotation visits every pooled expression and many looks`, () => {
    const { expressions, looks, switches } = simulate(key);
    const scenario = EXPRESSION_SCENARIOS[key];
    for (const id of [scenario.home, ...scenario.variants.map(v => v.id)]) {
      assert.ok(expressions.has(id), `${key} never showed ${id}`);
    }
    const homeShare = expressions.get(scenario.home) / [...expressions.values()].reduce((a, b) => a + b, 0);
    assert.ok(homeShare > 0.5 && homeShare < 0.95, `${key} home share ${homeShare}`);
    assert.ok(looks.size >= 4, `${key} looks: ${[...looks.keys()]}`);
    assert.ok(switches > 20, `${key} switches ${switches}`);
  });
}

test('calm policy keeps the home expression', () => {
  const { expressions } = simulate('idle', { calm: true, minutes: 10 });
  assert.deepEqual([...expressions.keys()], ['life.idle']);
});

test('variants never collapse into a two-face loop', () => {
  const rotation = createExpressionRotation({ scenarios: EXPRESSION_SCENARIOS,
    random: petMotion.createSeededRandom(3), has: id => known.has(id) });
  const order = [];
  let last = null;
  for (let t = 0; t < 4 * 3_600_000; t += 500) {
    const id = rotation.resolveBase('idle', t);
    if (id !== last && id !== 'life.idle') order.push(id);
    last = id;
  }
  const variants = EXPRESSION_SCENARIOS.idle.variants.length;
  for (let i = 0; i + variants <= order.length; i += variants) {
    assert.equal(new Set(order.slice(i, i + variants)).size, variants, 'each round shows every variant once');
  }
});

for (const key of ['task.complete', 'session.complete', 'achievement.level-up', 'achievement.skin-unlock', 'achievement.bond-stage', 'talking']) {
  test(`${key}: event expressions fire, vary and avoid immediate repeats`, () => {
    const rotation = createExpressionRotation({ scenarios: EXPRESSION_SCENARIOS,
      random: petMotion.createSeededRandom(11), has: id => known.has(id) });
    const picks = Array.from({ length: 200 }, () => rotation.pickEvent(key, 'life.idle'));
    const pool = EXPRESSION_SCENARIOS[key].pool.map(v => v.id);
    assert.ok(picks.every(id => pool.includes(id)));
    assert.equal(new Set(picks).size, pool.length);
    for (let i = 1; i < picks.length; i += 1) assert.notEqual(picks[i], picks[i - 1]);
  });
}

test('unknown scenario or missing expression falls back safely', () => {
  const rotation = createExpressionRotation({ scenarios: EXPRESSION_SCENARIOS, has: id => id === 'life.idle' });
  assert.equal(rotation.pickEvent('nope', 'react.celebrate'), 'react.celebrate');
  assert.equal(rotation.resolveBase('nope', 0, { fallback: 'work.focus' }), 'work.focus');
  assert.equal(rotation.resolveBase('idle', 10_000_000), 'life.idle');
});

test('restart returns the base to home after another presentation took over', () => {
  const rotation = createExpressionRotation({ scenarios: EXPRESSION_SCENARIOS,
    random: petMotion.createSeededRandom(5), has: id => known.has(id) });
  let t = 0;
  while (rotation.resolveBase('idle', t) === 'life.idle') t += 500;
  rotation.restart();
  assert.equal(rotation.resolveBase('idle', t), 'life.idle');
});
