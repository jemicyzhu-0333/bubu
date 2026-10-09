'use strict';

const petFramePlanApi = (() => {
// 表情取帧计划。这是开发诊断工具，不属于产品代码：整个 `tools/` 目录都在
// electron-builder 的发布白名单（`src/**/*`、`assets/**/*`、`package.json`）
// 之外，所以它不会被打进 ASAR，也不出现在任何生产启动路径上。
//
// 它回答一个问题：要确认某个动作画得对不对，应该在哪几个时刻各截一张？
//
// 计划必须是确定性的纯数据。随机或按墙钟取样的截图既无法互相比较，也说不清
// “这一张是动作的哪一刻”，而那恰恰是看图时唯一想知道的事。
//
// 三类时刻各有各的用途，缺一类就会看漏一类缺陷：
//   - 进入段：只在这一段出现的形变（弹入、下压）画错时，稳定态是正常的。
//   - 循环相位：呼吸、摇摆这类动效只能靠跨相位对比才看得出“有没有在动”。
//   - 静态停帧：低刺激档位真正会显示的那一帧，它走的是另一条取值路径。
//
// 眨眼单独占一帧，原因是个具体的坑：生产绘制里眨眼由
// `elapsedMs % blinkPeriod < 100` 触发，采样点一旦碰巧落进那 100ms，条带上
// 就会出现一张闭眼图，而看图的人会把它当成“眼睛没画出来”。所以主体帧一律
// 强制不眨眼，眨眼另给一帧、明确标注。

const LOOP_PHASES = Object.freeze([0, 0.25, 0.5, 0.75]);
const ACTION_PHASES = Object.freeze([0, 0.18, 0.43, 0.7, 0.9]);
const DEFAULT_LOOP_PERIOD_MS = 2400;

function petFramePlanIsObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 一个动作可能挂多条 loop。取最长周期而不是求最小公倍数：LCM 常常是几十秒，
 * 在那种长度上取四个相位，相邻两张几乎一样，反而看不出动效。最长周期能保证
 * 跑得最慢的那条 loop 被完整走过一遍，更快的那些自然被覆盖。
 */
function petFramePlanLoopPeriodMs(loops) {
  if (!Array.isArray(loops) || loops.length === 0) return 0;
  let longest = 0;
  for (const loop of loops) {
    const period = petFramePlanIsObject(loop) && Number.isFinite(loop.periodMs) && loop.periodMs > 0
      ? loop.periodMs
      : DEFAULT_LOOP_PERIOD_MS;
    if (period > longest) longest = period;
  }
  return longest;
}

function petFramePlanFrame(spec) {
  const frame = {
    key: spec.key,
    label: spec.label,
    phase: spec.phase,
    elapsedMs: spec.elapsedMs,
    static: Boolean(spec.static),
    blinking: Boolean(spec.blinking)
  };
  if (Number.isFinite(spec.progress)) frame.progress = spec.progress;
  if (typeof spec.variant === 'string') frame.variant = spec.variant;
  return Object.freeze(frame);
}

/**
 * Sampling points for one expression. Ten of the 32 expressions hold a single
 * pose with no enter animation and no loops; for those, extra "phases" would be
 * identical copies, so they get one settled frame instead. `animated` records
 * that distinction because the health check must not report a still expression
 * as broken for failing to move.
 */
function planExpressionFrames(config) {
  if (!petFramePlanIsObject(config) || typeof config.id !== 'string' || config.id.length === 0) {
    throw new TypeError('an expression config with an id is required');
  }
  const enterMs = petFramePlanIsObject(config.enter) && Number.isFinite(config.enter.durationMs)
    ? Math.max(0, config.enter.durationMs)
    : 0;
  const periodMs = petFramePlanLoopPeriodMs(config.loops);
  const frames = [];

  if (enterMs > 0) {
    // 起点与中点。终点不单独取：它与循环相位的 0 点重合（采样函数在
    // durationMs 处收敛到基础位姿），多截一张只是重复。
    frames.push(petFramePlanFrame({ key: 'enter-start', label: '进入 0ms', phase: 'enter', elapsedMs: 0 }));
    frames.push(petFramePlanFrame({
      key: 'enter-mid',
      label: `进入 ${Math.round(enterMs / 2)}ms`,
      phase: 'enter',
      elapsedMs: Math.round(enterMs / 2)
    }));
  }

  if (periodMs > 0) {
    for (const ratio of LOOP_PHASES) {
      frames.push(petFramePlanFrame({
        key: `loop-${Math.round(ratio * 100)}`,
        label: `循环 ${Math.round(ratio * 100)}%`,
        phase: 'loop',
        elapsedMs: enterMs + Math.round(periodMs * ratio)
      }));
    }
  } else {
    frames.push(petFramePlanFrame({
      key: 'settled',
      label: enterMs > 0 ? '进入结束' : '稳定态',
      phase: 'settled',
      elapsedMs: enterMs
    }));
  }

  frames.push(petFramePlanFrame({
    key: 'blink',
    label: '眨眼',
    phase: 'blink',
    elapsedMs: enterMs + Math.round(periodMs / 2),
    blinking: true
  }));
  // 静态停帧不读时间轴：低刺激档位取的是 `static` 那份位姿，与 elapsed 无关。
  frames.push(petFramePlanFrame({ key: 'static', label: '静态停帧', phase: 'static', elapsedMs: 0, static: true }));

  return Object.freeze({
    kind: 'expression',
    id: config.id,
    group: config.group || null,
    label: config.label || config.id,
    enterMs,
    periodMs,
    animated: enterMs > 0 || periodMs > 0,
    frames: Object.freeze(frames)
  });
}

function planActionFrames(action, kind = 'action') {
  if (!petFramePlanIsObject(action) || typeof action.id !== 'string' || action.id.length === 0) {
    throw new TypeError('an action with an id is required');
  }
  const durationMs = Number(action.durationMs || action.duration);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError(`invalid duration for ${action.id}`);
  const staticProgress = Number.isFinite(action.staticProgress) ? action.staticProgress : 0.5;
  if (staticProgress < 0 || staticProgress > 1) throw new RangeError(`invalid static progress for ${action.id}`);
  const frames = ACTION_PHASES.map((progress, index) => petFramePlanFrame({
    key: `phase-${Math.round(progress * 100)}`,
    label: `动作 ${Math.round(progress * 100)}%`,
    phase: 'action',
    elapsedMs: Math.round(durationMs * progress),
    progress
  }));
  // Reduce Motion / 低刺激实际显示的是动作身份不变、身体运动冻结在中点的静态帧。
  frames.push(petFramePlanFrame({
    key: 'static',
    label: '静态降级',
    phase: 'static',
    elapsedMs: Math.round(durationMs * staticProgress),
    progress: staticProgress,
    static: true
  }));
  return Object.freeze({
    kind,
    id: action.id,
    group: action.state || (kind === 'session' ? 'session' : 'action'),
    label: action.name || action.label || action.id,
    expression: action.expression,
    durationMs,
    animated: true,
    frames: Object.freeze(frames)
  });
}

function planActionSheet(actions, kind = 'action') {
  if (!petFramePlanIsObject(actions)) throw new TypeError('an action map is required');
  return Object.freeze(Object.values(actions).map(action => planActionFrames(action, kind)));
}

function planSceneSheet(scenes) {
  if (!petFramePlanIsObject(scenes)) throw new TypeError('a scene map is required');
  return Object.freeze(Object.values(scenes).map(scene => Object.freeze({
    kind: 'scene',
    id: scene.id,
    group: scene.periods.join('/'),
    label: scene.name,
    animated: false,
    // 场景是充满并由 CSS mask 羽化的氛围层；像 camp 的地面本来
    // 就会画到 scene canvas 边缘，不能把这种有意的 full-bleed 当成道具裁切。
    allowEdgeTouch: true,
    frames: Object.freeze([
      petFramePlanFrame({
        key: 'backdrop', label: '背景全景', phase: 'static', elapsedMs: 0, static: true, variant: 'backdrop'
      }),
      petFramePlanFrame({
        key: 'composite', label: '场景 + 宠物', phase: 'static', elapsedMs: 0, static: true, variant: 'composite'
      })
    ])
  })));
}

/**
 * The whole sheet, in registry order. Order is part of the contract: the strips
 * get read side by side, and a shuffled sheet cannot be compared with the last
 * run by eye.
 */
function planExpressionSheet(registry, ids) {
  if (!registry || typeof registry.get !== 'function') {
    throw new TypeError('a registry with get() is required');
  }
  const list = Array.isArray(ids) ? [...ids] : [];
  if (list.length === 0) throw new TypeError('at least one expression id is required');
  return Object.freeze(list.map(id => {
    const config = registry.get(id);
    if (!config) throw new RangeError(`unknown expression: ${id}`);
    return planExpressionFrames(config);
  }));
}

/**
 * Deterministic rendering faults, judged from the per-frame pixel measurements
 * the renderer hands back. This deliberately reports only what cannot be a
 * matter of taste — a blank frame, paint escaping the canvas, or an animated
 * expression whose sampled frames are identical. Whether a pose *looks* right
 * stays a human call, which is what the strips are for.
 */
function assessStripHealth(plan, samples) {
  if (!petFramePlanIsObject(plan) || !Array.isArray(plan.frames)) {
    throw new TypeError('a frame plan is required');
  }
  if (!Array.isArray(samples) || samples.length !== plan.frames.length) {
    throw new TypeError(`expected ${plan.frames.length} samples for ${plan.id}`);
  }
  const faults = [];
  const movingSignatures = new Set();

  plan.frames.forEach((frame, index) => {
    const sample = samples[index];
    if (!petFramePlanIsObject(sample)) {
      faults.push(`${frame.key}: 缺少像素测量`);
      return;
    }
    if (!Number.isFinite(sample.opaquePixels) || sample.opaquePixels <= 0) {
      faults.push(`${frame.key}: 整帧没有画出任何像素`);
      return;
    }
    // 触边比“画歪了”更值得自动报：它意味着有内容被画布裁掉，而被裁掉的部分
    // 在图上根本看不见，肉眼复核不可能发现。
    if (!plan.allowEdgeTouch && petFramePlanIsObject(sample.bounds)) {
      const { minX, minY, maxX, maxY } = sample.bounds;
      const measurements = [minX, minY, maxX, maxY, sample.width, sample.height];
      if (measurements.some(value => !Number.isFinite(value))) {
        faults.push(`${frame.key}: 像素边界测量不完整`);
      } else if (minX <= 0 || minY <= 0 || maxX >= sample.width - 1 || maxY >= sample.height - 1) {
        faults.push(`${frame.key}: 画面触到画布边缘，可能已被裁切`);
      }
    }
    // 眨眼帧与静态帧不参与“有没有在动”的判断：前者本就该与主体帧不同，
    // 后者根本不读时间轴。
    if (frame.phase !== 'static' && frame.phase !== 'blink' && typeof sample.signature === 'string') {
      movingSignatures.add(sample.signature);
    }
  });

  // 只有声明了动效的动作才需要“动起来”。另外 10 个动作是单一位姿，对它们报
  // 这条会是 10 个假警报，而假警报会让整份体检失去意义。
  if (plan.animated && movingSignatures.size === 1) {
    faults.push('声明了进入动画或循环，但所有取样帧完全一致');
  }

  return Object.freeze({ id: plan.id, ok: faults.length === 0, faults: Object.freeze(faults) });
}

return Object.freeze({
  LOOP_PHASES,
  ACTION_PHASES,
  DEFAULT_LOOP_PERIOD_MS,
  loopPeriodMs: petFramePlanLoopPeriodMs,
  planExpressionFrames,
  planExpressionSheet,
  planActionFrames,
  planActionSheet,
  planSceneSheet,
  assessStripHealth
});

})();

export default petFramePlanApi;
export const { LOOP_PHASES, ACTION_PHASES, DEFAULT_LOOP_PERIOD_MS, loopPeriodMs, planExpressionFrames, planExpressionSheet, planActionFrames, planActionSheet, planSceneSheet, assessStripHealth } = petFramePlanApi;
