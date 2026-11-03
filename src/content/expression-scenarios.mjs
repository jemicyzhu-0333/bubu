'use strict';

// 场景 → 表情池注册表（表情轮播的唯一数据源）。
//
// 每个场景只声明“这个情境下可以出现哪些表情、各占多少权重、停留多久”，
// 选择逻辑统一由 core/expression-rotation.mjs 负责。新增场景的标准流程：
//   1. 在这里加一条场景（base = 常驻轮播；event = 一次性事件抽取）；
//   2. 在触发点只传场景 ID（renderer: base 场景键；main: presentation.scenario）；
//   3. 在 test/expression-rotation.test.mjs 的分布用例里补一行期望。
// 所有表情 ID 必须存在于 content/expressions.mjs；校验见 validateExpressionScenarios。
//
// base 场景：home 是“回家”表情，占主要时间；variants 轮流穿插，结束后回到 home。
// event 场景：每次事件从 pool 里加权抽取一个，并避开同场景上一次的结果。

const s = seconds => seconds * 1000;
const variant = (id, weight, holdMs) => Object.freeze({ id, weight, holdMs: Object.freeze(holdMs) });

const EXPRESSION_SCENARIOS = Object.freeze({
  // ---------- base：常驻轮播 ----------
  idle: Object.freeze({
    kind: 'base', home: 'life.idle', homeHoldMs: Object.freeze([s(15), s(35)]),
    variants: Object.freeze([
      variant('life.space', 3, [s(8), s(14)]),
      variant('react.satisfied', 2, [s(6), s(10)]),
      variant('react.happy', 2, [s(4), s(7)]),
      variant('react.encouraging', 1, [s(4), s(7)])
    ])
  }),
  'idle.late-night': Object.freeze({
    kind: 'base', home: 'life.drowsy', homeHoldMs: Object.freeze([s(40), s(80)]),
    variants: Object.freeze([
      variant('life.space', 2, [s(8), s(14)]),
      variant('react.relieved', 1, [s(6), s(10)])
    ])
  }),
  focus: Object.freeze({
    kind: 'base', home: 'work.focus', homeHoldMs: Object.freeze([s(40), s(90)]),
    variants: Object.freeze([
      variant('work.deep-focus', 3, [s(15), s(30)]),
      variant('system.processing', 1, [s(8), s(14)])
    ])
  }),
  rest: Object.freeze({
    kind: 'base', home: 'work.rest', homeHoldMs: Object.freeze([s(25), s(50)]),
    variants: Object.freeze([
      variant('react.relieved', 2, [s(6), s(10)]),
      variant('life.space', 2, [s(8), s(14)]),
      variant('react.satisfied', 1, [s(6), s(10)])
    ])
  }),
  paused: Object.freeze({
    kind: 'base', home: 'work.pause', homeHoldMs: Object.freeze([s(30), s(60)]),
    variants: Object.freeze([
      variant('life.space', 2, [s(8), s(14)]),
      variant('work.waiting', 1, [s(6), s(10)])
    ])
  }),
  sleeping: Object.freeze({ kind: 'base', home: 'life.sleep', homeHoldMs: Object.freeze([s(60), s(60)]), variants: Object.freeze([]) }),
  hungry: Object.freeze({ kind: 'base', home: 'react.hungry', homeHoldMs: Object.freeze([s(60), s(60)]), variants: Object.freeze([]) }),
  peeking: Object.freeze({ kind: 'base', home: 'life.peek', homeHoldMs: Object.freeze([s(60), s(60)]), variants: Object.freeze([]) }),

  // ---------- event：一次性事件 ----------
  'task.complete': Object.freeze({
    kind: 'event', fallback: 'react.celebrate',
    pool: Object.freeze([
      variant('react.celebrate', 3, []), variant('react.happy', 2, []),
      variant('react.satisfied', 2, []), variant('work.wrap-up', 1, [])
    ])
  }),
  'session.complete': Object.freeze({
    kind: 'event', fallback: 'react.celebrate',
    pool: Object.freeze([
      variant('react.celebrate', 3, []), variant('react.satisfied', 2, []),
      variant('react.relieved', 1, []), variant('react.happy', 2, [])
    ])
  }),
  'achievement.level-up': Object.freeze({
    kind: 'event', fallback: 'react.celebrate',
    pool: Object.freeze([
      variant('react.celebrate', 3, []), variant('react.happy', 2, []), variant('react.surprised', 1, [])
    ])
  }),
  'achievement.skin-unlock': Object.freeze({
    kind: 'event', fallback: 'react.surprised',
    pool: Object.freeze([variant('react.surprised', 2, []), variant('react.happy', 2, []), variant('react.celebrate', 1, [])])
  }),
  'achievement.bond-stage': Object.freeze({
    kind: 'event', fallback: 'react.petted',
    pool: Object.freeze([variant('react.petted', 2, []), variant('react.happy', 2, []), variant('react.satisfied', 1, [])])
  }),
  talking: Object.freeze({
    kind: 'event', fallback: 'react.happy',
    pool: Object.freeze([variant('react.happy', 3, []), variant('react.encouraging', 2, []), variant('life.attentive', 1, [])])
  })
});

// 返回错误数组；空数组表示注册表合法。
function validateExpressionScenarios(scenarios, knownIds) {
  const known = new Set(knownIds);
  const errors = [];
  for (const [key, scenario] of Object.entries(scenarios)) {
    const ids = scenario.kind === 'base'
      ? [scenario.home, ...scenario.variants.map(v => v.id)]
      : scenario.kind === 'event' ? [scenario.fallback, ...scenario.pool.map(v => v.id)] : null;
    if (!ids) { errors.push(`${key}: unknown kind`); continue; }
    for (const id of ids) if (!known.has(id)) errors.push(`${key}: unknown expression ${id}`);
    const entries = scenario.kind === 'base' ? scenario.variants : scenario.pool;
    for (const entry of entries) {
      if (!(entry.weight > 0)) errors.push(`${key}: ${entry.id} weight must be > 0`);
      if (scenario.kind === 'base' && !(entry.holdMs[0] > 0 && entry.holdMs[1] >= entry.holdMs[0])) {
        errors.push(`${key}: ${entry.id} holdMs invalid`);
      }
    }
    if (scenario.kind === 'base' && !(scenario.homeHoldMs[0] > 0 && scenario.homeHoldMs[1] >= scenario.homeHoldMs[0])) {
      errors.push(`${key}: homeHoldMs invalid`);
    }
    if (scenario.kind === 'event' && scenario.pool.length === 0) errors.push(`${key}: empty pool`);
  }
  return errors;
}

export { EXPRESSION_SCENARIOS, validateExpressionScenarios };
