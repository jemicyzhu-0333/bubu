'use strict';

// 帧率无关的桌宠运动时间基础。
//
// 此前（截至 0.1.2），眨眼、常驻浮动、睡眠 z、庆祝星和不少粒子都靠 `frame++` 计数：
// 同一套配置在 6/30/60 FPS 下的真实速度相差 10 倍，后台恢复时还会一次性补播。
// 本模块提供统一的替代原语：带步长上限的单调时钟、临界阻尼弹簧、缓动、
// 关键帧采样、速率累加器和确定性随机。所有函数都不读 DOM、不读业务状态、
// 不创建粒子，时间全部由调用方注入。
//
// 遗留动画常量是按 60 FPS 调的：`MS_PER_LEGACY_FRAME` 用于把“帧数”口径
// 无损换算成毫秒，保证迁移后在 60 FPS 下观感不变。

const petMotionLegacyFrameMs = 1000 / 60;

function petMotionFinite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
  return value;
}

// ---------- 帧时钟 ----------
// 渲染循环每画一帧调用一次 step(rafTimestamp)。页面隐藏时不出帧、时钟不走；
// 从后台恢复的第一帧，原始间隔可能高达数秒，步长被 maxStepMs 截断，
// 弹簧和粒子不会一步被打飞，也不补播后台期间的装饰动画。
function createMotionClock(options = {}) {
  const maxStepMs = options.maxStepMs === undefined ? 250 : options.maxStepMs;
  if (!Number.isFinite(maxStepMs) || maxStepMs <= 0) {
    throw new RangeError('maxStepMs must be a positive finite number');
  }
  let lastAt = null;
  let elapsedMs = 0;

  function step(at) {
    if (!Number.isFinite(at)) return { dtMs: 0, nowMs: elapsedMs };
    if (lastAt === null) {
      lastAt = at;
      return { dtMs: 0, nowMs: elapsedMs };
    }
    const raw = at - lastAt;
    lastAt = at;
    // 负间隔（时间戳回退）按停帧处理，绝不倒拨累计时间。
    const dtMs = raw <= 0 ? 0 : Math.min(raw, maxStepMs);
    elapsedMs += dtMs;
    return { dtMs, nowMs: elapsedMs };
  }

  function reset(at) {
    lastAt = Number.isFinite(at) ? at : null;
  }

  return Object.freeze({
    step,
    reset,
    get elapsedMs() { return elapsedMs; },
    get maxStepMs() { return maxStepMs; }
  });
}

// ---------- 临界阻尼弹簧 ----------
// 使用闭式解而不是欧拉积分：任意步长（包括后台恢复的大步长）都精确稳定，
// 不会震荡发散，也不会因为步长变化改变收敛轨迹的形状。
function createSpring(options = {}) {
  const omega = options.omega === undefined ? 12 : options.omega;
  if (!Number.isFinite(omega) || omega <= 0) {
    throw new RangeError('omega must be a positive finite number');
  }
  const initial = options.value === undefined ? (options.target === undefined ? 0 : options.target) : options.value;
  let target = petMotionFinite(options.target === undefined ? initial : options.target, 'target');
  let value = petMotionFinite(initial, 'value');
  let velocity = petMotionFinite(options.velocity === undefined ? 0 : options.velocity, 'velocity');

  function step(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return value;
    const dt = dtMs / 1000;
    const displacement = value - target;
    const decay = Math.exp(-omega * dt);
    const c2 = velocity + omega * displacement;
    value = target + (displacement + c2 * dt) * decay;
    velocity = (c2 - omega * (displacement + c2 * dt)) * decay;
    // 理论上闭式解恒有限；这里做防御性兜底，保证渲染路径永远拿不到
    // NaN/Infinity。
    if (!Number.isFinite(value) || !Number.isFinite(velocity)) {
      value = target;
      velocity = 0;
    }
    return value;
  }

  function setTarget(next) {
    target = petMotionFinite(next, 'target');
    return target;
  }

  function set(nextValue, nextVelocity = 0) {
    value = petMotionFinite(nextValue, 'value');
    velocity = petMotionFinite(nextVelocity, 'velocity');
  }

  function snap(next) {
    target = petMotionFinite(next, 'value');
    value = target;
    velocity = 0;
  }

  function isSettled(epsilon = 0.01) {
    const eps = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 0.01;
    return Math.abs(value - target) <= eps && Math.abs(velocity) <= eps;
  }

  return Object.freeze({
    step,
    setTarget,
    set,
    snap,
    isSettled,
    get value() { return value; },
    get velocity() { return velocity; },
    get target() { return target; },
    get omega() { return omega; }
  });
}

// ---------- 缓动 ----------
function petMotionClamp01(t) {
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}

const petMotionEasing = Object.freeze({
  linear: (t) => petMotionClamp01(t),
  easeInQuad: (t) => { t = petMotionClamp01(t); return t * t; },
  easeOutQuad: (t) => { t = petMotionClamp01(t); return t * (2 - t); },
  easeInOutQuad: (t) => {
    t = petMotionClamp01(t);
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  },
  easeOutCubic: (t) => { t = petMotionClamp01(t); const inv = 1 - t; return 1 - inv * inv * inv; },
  easeInOutCubic: (t) => {
    t = petMotionClamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  smoothstep: (t) => { t = petMotionClamp01(t); return t * t * (3 - 2 * t); }
});

// ---------- 关键帧序列 ----------
// 关键帧按 atMs 升序；采样只依赖绝对 elapsed，与帧数无关：
// 同一时间点无论被采样多少次、帧率如何变化，结果都相同。
function petMotionNormalizeFrames(frames, durationMs) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new TypeError('frames must be a non-empty array');
  }
  let previousAt = -Infinity;
  const normalized = frames.map((frame, index) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new TypeError(`frames[${index}] must be an object`);
    }
    const atMs = petMotionFinite(frame.atMs, `frames[${index}].atMs`);
    const value = petMotionFinite(frame.value, `frames[${index}].value`);
    if (atMs < 0 || atMs > durationMs) {
      throw new RangeError(`frames[${index}].atMs must be within [0, durationMs]`);
    }
    if (atMs <= previousAt) {
      throw new RangeError('frames must be strictly sorted by atMs');
    }
    previousAt = atMs;
    const ease = frame.ease === undefined ? 'linear' : frame.ease;
    if (!Object.prototype.hasOwnProperty.call(petMotionEasing, ease)) {
      throw new RangeError(`frames[${index}].ease is not a known easing name`);
    }
    return Object.freeze({ atMs, value, ease });
  });
  return Object.freeze(normalized);
}

function createSequenceSampler(options = {}) {
  const durationMs = petMotionFinite(options.durationMs, 'durationMs');
  if (durationMs <= 0) throw new RangeError('durationMs must be positive');
  const loop = options.loop === true;
  const frames = petMotionNormalizeFrames(options.frames, durationMs);

  function sample(elapsedMs) {
    let elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    if (loop) elapsed %= durationMs;
    if (elapsed <= frames[0].atMs) return frames[0].value;
    const last = frames[frames.length - 1];
    if (elapsed >= last.atMs) return last.value;
    for (let i = 0; i < frames.length - 1; i++) {
      const from = frames[i];
      const to = frames[i + 1];
      if (elapsed >= from.atMs && elapsed < to.atMs) {
        const local = (elapsed - from.atMs) / (to.atMs - from.atMs);
        const eased = petMotionEasing[from.ease](local);
        return from.value + (to.value - from.value) * eased;
      }
    }
    return last.value;
  }

  return Object.freeze({
    sample,
    get durationMs() { return durationMs; },
    get loop() { return loop; },
    get frames() { return frames; }
  });
}

// 播放层：开始/取消/结束语义。取消后不再采样出值；非循环序列到期后
// 停在末帧值上（“末帧稳定”），而不是跳回起点或返回空。
function createSequencePlayer(options = {}) {
  const sampler = createSequenceSampler(options);
  const durationMs = sampler.durationMs;
  const loop = sampler.loop;
  let startedAt = null;
  let cancelled = false;

  function start(atMs) {
    startedAt = petMotionFinite(atMs, 'atMs');
    cancelled = false;
    return startedAt;
  }

  function cancel() {
    cancelled = true;
    startedAt = null;
  }

  function sample(atMs) {
    if (cancelled || startedAt === null || !Number.isFinite(atMs)) {
      return { active: false, done: false, value: null, elapsedMs: 0, progress: 0 };
    }
    const elapsedMs = Math.max(0, atMs - startedAt);
    if (!loop && elapsedMs >= durationMs) {
      return {
        active: false,
        done: true,
        value: sampler.sample(durationMs),
        elapsedMs,
        progress: 1
      };
    }
    return {
      active: true,
      done: false,
      value: sampler.sample(elapsedMs),
      elapsedMs,
      progress: Math.min(1, elapsedMs / durationMs)
    };
  }

  return Object.freeze({
    start,
    cancel,
    sample,
    get durationMs() { return durationMs; },
    get loop() { return loop; }
  });
}

// ---------- 速率累加器 ----------
// 粒子发射的帧率无关形式：配置“每秒速率”，每帧按 dt 累积，整数部分立即
// 发射、小数部分结转。同一总时长在 6/30/60 FPS 下的发射总数只差浮点舍入
// （±1 以内），不再依赖“每帧 Math.random() < chance”抽签。
function createRateEmitter(options = {}) {
  const ratePerSecond = options.ratePerSecond === undefined ? 0 : options.ratePerSecond;
  if (!Number.isFinite(ratePerSecond) || ratePerSecond < 0) {
    throw new RangeError('ratePerSecond must be a non-negative finite number');
  }
  let carry = 0;
  let total = 0;

  function update(dtMs) {
    if (ratePerSecond === 0 || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
    carry += ratePerSecond * (dtMs / 1000);
    // 微小容差避免 2.9999999 被 floor 成 2；多发的部分由负的结转量自动抵扣。
    const count = Math.floor(carry + 1e-6);
    if (count > 0) {
      carry -= count;
      total += count;
    }
    return count;
  }

  function reset() {
    carry = 0;
    total = 0;
  }

  return Object.freeze({
    update,
    reset,
    get total() { return total; },
    get ratePerSecond() { return ratePerSecond; }
  });
}

// ---------- 确定性随机 ----------
// mulberry32：体积小、可复现。同 seed 必然同序列，供眨眼调度、粒子生成
// 等需要确定性回归测试的路径使用；绘制函数不得逐帧调用它改颜色。
function createSeededRandom(seed) {
  let state = Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededIndex(rng, length) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError('length must be a positive integer');
  }
  return Math.min(length - 1, Math.floor(rng() * length));
}

function seededChoice(rng, array) {
  if (!Array.isArray(array) || array.length === 0) {
    throw new RangeError('array must be a non-empty array');
  }
  return array[seededIndex(rng, array.length)];
}

function seededRange(rng, min, max) {
  petMotionFinite(min, 'min');
  petMotionFinite(max, 'max');
  if (max < min) throw new RangeError('max must be >= min');
  return min + rng() * (max - min);
}

function seededInt(rng, min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new RangeError('min and max must be integers');
  }
  if (max < min) throw new RangeError('max must be >= min');
  return min + seededIndex(rng, max - min + 1);
}

// 把旧版“每帧先位移、再加速度”的离散轨迹延拓到任意帧步长。该闭式公式
// 满足分段组合律，因此 6/30/60 FPS 在同一真实时刻得到相同位置，同时保留
// 原来 60 FPS 整数帧上的视觉轨迹。
function advanceDiscretePosition(position, velocity, acceleration, frameSteps) {
  petMotionFinite(position, 'position');
  petMotionFinite(velocity, 'velocity');
  petMotionFinite(acceleration, 'acceleration');
  petMotionFinite(frameSteps, 'frameSteps');
  if (frameSteps < 0) throw new RangeError('frameSteps must be non-negative');
  return position + velocity * frameSteps
    + 0.5 * acceleration * frameSteps * (frameSteps - 1);
}

// ---------- 眨眼调度 ----------
// 眨眼使用绝对时间调度：下一次眨眼发生在“当前时间 + [minMs, maxMs) 区间内
// 的一个随机间隔”，闭合持续 blinkMs。调度结果与帧率无关；低帧率下整个闭合
// 窗口落在两帧之间时，由第一个追上的帧补显一次，保证已调度的眨眼不丢。
function createBlinkScheduler(options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  let minMs = options.minMs === undefined ? 2400 : options.minMs;
  let maxMs = options.maxMs === undefined ? 6000 : options.maxMs;
  let blinkMs = options.blinkMs === undefined ? 120 : options.blinkMs;
  let doubleChance = options.doubleChance === undefined ? 0 : options.doubleChance;
  const doubleGapMs = options.doubleGapMs === undefined ? 100 : options.doubleGapMs;
  if (!Number.isFinite(minMs) || minMs < 1) throw new RangeError('minMs must be >= 1');
  if (!Number.isFinite(maxMs) || maxMs < minMs) throw new RangeError('maxMs must be >= minMs');
  if (!Number.isFinite(blinkMs) || blinkMs <= 0) throw new RangeError('blinkMs must be positive');
  if (!Number.isFinite(doubleChance) || doubleChance < 0 || doubleChance > 1) {
    throw new RangeError('doubleChance must be within [0,1]');
  }
  if (!Number.isFinite(doubleGapMs) || doubleGapMs < 0) throw new RangeError('doubleGapMs must be non-negative');

  let nextBlinkAt = null;
  let pendingDoubleAt = null;
  let currentBlink = null;
  let blinkCount = 0;

  // 按当前表情重调眨眼节奏（各表情有自己的 minMs/maxMs/blinkMs）。
  // 只影响“下一次”眨眼的间隔，不打断已排程/进行中的那一次。
  function retune(next = {}) {
    const candidateMin = next.minMs === undefined ? minMs : next.minMs;
    const candidateMax = next.maxMs === undefined ? maxMs : next.maxMs;
    const candidateBlink = next.blinkMs === undefined ? blinkMs : next.blinkMs;
    const candidateDoubleChance = next.doubleChance === undefined ? doubleChance : next.doubleChance;
    if (!Number.isFinite(candidateMin) || candidateMin < 1) return;
    if (!Number.isFinite(candidateMax) || candidateMax < candidateMin) return;
    if (!Number.isFinite(candidateBlink) || candidateBlink <= 0) return;
    if (!Number.isFinite(candidateDoubleChance) || candidateDoubleChance < 0 || candidateDoubleChance > 1) return;
    minMs = candidateMin;
    maxMs = candidateMax;
    blinkMs = candidateBlink;
    doubleChance = candidateDoubleChance;
  }

  function nextIntervalMs() {
    const span = maxMs - minMs;
    return minMs + (span > 0 ? random() * span : 0);
  }

  function update(nowMs) {
    if (!Number.isFinite(nowMs)) return { blinking: false, started: 0, blinkCount };
    if (nextBlinkAt === null) nextBlinkAt = nowMs + nextIntervalMs();
    let started = 0;
    // 正常帧间隔远小于最短眨眼间隔，循环一般只走一次；大步长下把错过的
    // 眨眼全部计入数量，但只保留最近一次的窗口用于显示。
    while (true) {
      const secondIsNext = pendingDoubleAt !== null && pendingDoubleAt < nextBlinkAt;
      const eventAt = secondIsNext ? pendingDoubleAt : nextBlinkAt;
      if (eventAt > nowMs) break;
      currentBlink = Object.freeze({ start: eventAt, end: eventAt + blinkMs });
      blinkCount += 1;
      started += 1;
      if (secondIsNext) {
        pendingDoubleAt = null;
      } else {
        const doubleBlink = doubleChance > 0 && random() < doubleChance;
        pendingDoubleAt = doubleBlink ? eventAt + blinkMs + doubleGapMs : null;
        const clusterEnd = pendingDoubleAt === null ? eventAt + blinkMs : pendingDoubleAt + blinkMs;
        nextBlinkAt = clusterEnd + nextIntervalMs();
      }
    }
    let blinking = currentBlink !== null && nowMs < currentBlink.end;
    // 整个闭合窗口落在两帧之间时，由第一个追上的帧补显一次闭合，
    // 保证已调度的眨眼在低帧率下不会被静默吞掉。
    if (started > 0 && !blinking) blinking = true;
    return { blinking, started, blinkCount };
  }

  function reset(nowMs) {
    blinkCount = 0;
    currentBlink = null;
    pendingDoubleAt = null;
    nextBlinkAt = Number.isFinite(nowMs) ? nowMs + nextIntervalMs() : null;
  }

  return Object.freeze({
    update,
    reset,
    retune,
    get blinkCount() { return blinkCount; },
    get nextBlinkAt() {
      return pendingDoubleAt === null ? nextBlinkAt : Math.min(nextBlinkAt, pendingDoubleAt);
    }
  });
}

// 渲染进程以 classic <script> 共享全局词法作用域加载本文件，
// 顶层标识符必须是本文件专属，否则同页面的后续脚本会在编译期整体失败。
const petMotionApi = Object.freeze({
  MS_PER_LEGACY_FRAME: petMotionLegacyFrameMs,
  createMotionClock,
  createSpring,
  easing: petMotionEasing,
  clamp01: petMotionClamp01,
  createSequenceSampler,
  createSequencePlayer,
  createRateEmitter,
  createSeededRandom,
  seededIndex,
  seededChoice,
  seededRange,
  seededInt,
  advanceDiscretePosition,
  createBlinkScheduler
});



export default petMotionApi;
