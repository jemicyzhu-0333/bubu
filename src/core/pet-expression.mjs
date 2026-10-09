'use strict';

// 表情注册表的闭合 schema、归一化与位姿采样。
//
// 本模块是“展示什么”的事实层：它校验并冻结 32 套原创表情配置，按
// expression + 绝对时间采样出脸部与身体的位姿。它不决定“为什么展示”
// （那是 pet-presentation.mjs 的导演职责），不读 store，也不直接绘图。
//
// 配置是闭合、有限、可验证的数据：未知字段、NaN/Infinity、负时长、
// 空关键帧、未排序时间、未知 face mask 一律拒绝；归一化后冻结，
// 渲染端不得原地修改。无效 ID 回退 life.idle 并返回可测试的错误。

// ---------- 白名单 ----------
// 原创眼形（16 种）与嘴形（9 种）是语义 ID，实际 mask 由形态画笔解析。
// 多个表情可以共享同一 mask，但各自的语义与静态位姿必须完整。
const EYE_MASKS = Object.freeze([
  'neutral',  // 中性
  'smile',    // 笑眼
  'wide',     // 圆睁
  'closed',   // 闭眼
  'half',     // 半睁
  'focused',  // 专注
  'curious',  // 好奇
  'shy',      // 害羞
  'content',  // 满足
  'surprised',// 惊讶
  'waiting',  // 等待
  'sleepy',   // 困倦
  'droopy',   // 低垂
  'pleading', // 恳求
  'determined', // 坚定
  'sparkle'   // 星光
]);

const MOUTH_MASKS = Object.freeze([
  'neutral',  // 中性
  'smile',    // 微笑
  'open',     // 开心
  'talk',     // 轻声说话
  'surprised',// 惊讶
  'chew',     // 咀嚼
  'closed',   // 闭合
  'wavy',     // 疲惫波浪嘴
  'grin'      // 大笑
]);

// 身体离散色调（进 sprite 缓存键，必须是有限集）。
const BODY_TONES = Object.freeze(['normal', 'warm', 'cool']);

// 常驻微动作原语：全部由绝对 elapsed time 计算，不读 frame。
const LOOP_PRIMITIVES = Object.freeze(['breath', 'sway', 'look-around', 'beat', 'tremble']);

// 表达级辅助符号。它属于“展示什么”的数据，而不是 renderer 对 expression ID
// 的猜测；减少动效时仍可降级为静态身份标记。
const EXPRESSION_ACCENTS = Object.freeze(['none', 'sleep-zzz', 'drowsy-zzz']);

// 命名空间。32 个内置 ID 必须落在其一。
const EXPRESSION_NAMESPACES = Object.freeze(['life', 'work', 'react', 'system']);

// 安全 ID 风格（与项目现有约束一致）。
const EXPRESSION_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}\.[a-z0-9][a-z0-9._-]{0,47}$/;

// ---------- 数值范围 ----------
// 位移相对身体原点，收在 ±8 美术像素内，远小于像素舞台 ±24 的安全区，
// 保证采样位姿必然落在安全区里。
const MAX_BODY_OFFSET = 8;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;
const ROTATE_MAX = 15;
const MAX_EYE_OFFSET = 3;
const MAX_EYE_INSET = 4;
const MAX_GAZE = 3;
const MAX_LOOPS = 3;
const MAX_ENTER_FRAMES = 8;
const MAX_SEGMENT_MS = 10_000;
const BLINK_MAX_MS = 10_000;
const FALLBACK_ID = 'life.idle';

function petExpressionIsObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function petExpressionFinite(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

// ---------- 归一化与校验 ----------
// 成功返回 { ok, value(冻结) }；失败返回 { ok: false, errors[] }。
// 归一化会补齐缺省字段并整体冻结，渲染端拿到的是不可变快照。
function normalizeExpression(input) {
  const errors = [];
  if (!petExpressionIsObject(input)) {
    return { ok: false, errors: ['expression must be an object'] };
  }

  const known = ['id', 'group', 'label', 'face', 'body', 'blink', 'loops', 'enter', 'static', 'accent'];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) errors.push(`unknown field "${key}"`);
  }

  // id / group / label
  const id = input.id;
  if (typeof id !== 'string' || !EXPRESSION_ID_PATTERN.test(id)) errors.push('id is invalid');
  else {
    const ns = id.split('.')[0];
    if (!EXPRESSION_NAMESPACES.includes(ns)) errors.push(`id namespace "${ns}" is not allowed`);
  }
  const group = input.group;
  if (typeof group !== 'string' || !EXPRESSION_NAMESPACES.includes(group)) errors.push('group is invalid');
  else if (typeof id === 'string' && id.split('.')[0] !== group) errors.push('id namespace must match group');
  if (typeof input.label !== 'string' || input.label.length === 0 || input.label.length > 40) {
    errors.push('label must be a non-empty string (<=40 chars)');
  }
  const accent = input.accent === undefined ? 'none' : input.accent;
  if (!EXPRESSION_ACCENTS.includes(accent)) errors.push(`accent "${accent}" is not allowed`);

  // face
  const faceIn = input.face;
  let face = null;
  if (!petExpressionIsObject(faceIn)) {
    errors.push('face must be an object');
  } else {
    const faceKeys = ['eyes', 'mouth', 'eyeOffsetX', 'eyeOffsetY', 'eyeInsetX', 'openness', 'gaze'];
    for (const key of Object.keys(faceIn)) {
      if (!faceKeys.includes(key)) errors.push(`face has unknown field "${key}"`);
    }
    if (!EYE_MASKS.includes(faceIn.eyes)) errors.push(`face.eyes "${faceIn.eyes}" is not a known eye mask`);
    if (!MOUTH_MASKS.includes(faceIn.mouth)) errors.push(`face.mouth "${faceIn.mouth}" is not a known mouth mask`);
    const eyeOffsetX = faceIn.eyeOffsetX === undefined ? 0 : faceIn.eyeOffsetX;
    const eyeOffsetY = faceIn.eyeOffsetY === undefined ? 0 : faceIn.eyeOffsetY;
    const eyeInsetX = faceIn.eyeInsetX === undefined ? 0 : faceIn.eyeInsetX;
    if (!petExpressionFinite(eyeOffsetX, -MAX_EYE_OFFSET, MAX_EYE_OFFSET)) errors.push('face.eyeOffsetX out of range');
    if (!petExpressionFinite(eyeOffsetY, -MAX_EYE_OFFSET, MAX_EYE_OFFSET)) errors.push('face.eyeOffsetY out of range');
    if (!Number.isInteger(eyeInsetX) || eyeInsetX < 0 || eyeInsetX > MAX_EYE_INSET) errors.push('face.eyeInsetX out of range');
    const openness = faceIn.openness === undefined ? 1 : faceIn.openness;
    if (!petExpressionFinite(openness, 0, 1)) errors.push('face.openness must be within [0,1]');
    let gaze = { enabled: false, maxX: 0, maxY: 0 };
    if (faceIn.gaze !== undefined) {
      if (!petExpressionIsObject(faceIn.gaze)) {
        errors.push('face.gaze must be an object');
      } else {
        for (const key of Object.keys(faceIn.gaze)) {
          if (!['enabled', 'maxX', 'maxY'].includes(key)) errors.push(`face.gaze has unknown field "${key}"`);
        }
        if (typeof faceIn.gaze.enabled !== 'boolean') errors.push('face.gaze.enabled must be boolean');
        else {
          const gx = faceIn.gaze.maxX === undefined ? 0 : faceIn.gaze.maxX;
          const gy = faceIn.gaze.maxY === undefined ? 0 : faceIn.gaze.maxY;
          if (!Number.isInteger(gx) || gx < 0 || gx > MAX_GAZE) errors.push('face.gaze.maxX out of range');
          if (!Number.isInteger(gy) || gy < 0 || gy > MAX_GAZE) errors.push('face.gaze.maxY out of range');
          if (faceIn.gaze.enabled) {
            gaze = { enabled: true, maxX: gx, maxY: gy };
          }
        }
      }
    }
    if (errors.length === 0 || errors.every(e => !e.startsWith('face'))) {
      face = Object.freeze({
        eyes: faceIn.eyes,
        mouth: faceIn.mouth,
        eyeOffsetX,
        eyeOffsetY,
        eyeInsetX,
        openness,
        gaze: Object.freeze(gaze)
      });
    }
  }

  // body
  const bodyIn = input.body;
  let body = null;
  if (!petExpressionIsObject(bodyIn)) {
    errors.push('body must be an object');
  } else {
    const bodyKeys = ['tone', 'x', 'y', 'scaleX', 'scaleY', 'rotateDeg'];
    for (const key of Object.keys(bodyIn)) {
      if (!bodyKeys.includes(key)) errors.push(`body has unknown field "${key}"`);
    }
    const tone = bodyIn.tone === undefined ? 'normal' : bodyIn.tone;
    if (!BODY_TONES.includes(tone)) errors.push(`body.tone "${tone}" is not allowed`);
    const x = bodyIn.x === undefined ? 0 : bodyIn.x;
    const y = bodyIn.y === undefined ? 0 : bodyIn.y;
    const scaleX = bodyIn.scaleX === undefined ? 1 : bodyIn.scaleX;
    const scaleY = bodyIn.scaleY === undefined ? 1 : bodyIn.scaleY;
    const rotateDeg = bodyIn.rotateDeg === undefined ? 0 : bodyIn.rotateDeg;
    if (!petExpressionFinite(x, -MAX_BODY_OFFSET, MAX_BODY_OFFSET)) errors.push('body.x out of range');
    if (!petExpressionFinite(y, -MAX_BODY_OFFSET, MAX_BODY_OFFSET)) errors.push('body.y out of range');
    if (!petExpressionFinite(scaleX, SCALE_MIN, SCALE_MAX)) errors.push('body.scaleX out of range');
    if (!petExpressionFinite(scaleY, SCALE_MIN, SCALE_MAX)) errors.push('body.scaleY out of range');
    if (!petExpressionFinite(rotateDeg, -ROTATE_MAX, ROTATE_MAX)) errors.push('body.rotateDeg out of range');
    body = Object.freeze({ tone, x, y, scaleX, scaleY, rotateDeg });
  }

  // blink
  const blinkIn = input.blink;
  let blink = null;
  if (!petExpressionIsObject(blinkIn)) {
    errors.push('blink must be an object');
  } else {
    for (const key of Object.keys(blinkIn)) {
      if (!['minMs', 'maxMs', 'doubleChance'].includes(key)) errors.push(`blink has unknown field "${key}"`);
    }
    const minMs = blinkIn.minMs;
    const maxMs = blinkIn.maxMs;
    const doubleChance = blinkIn.doubleChance === undefined ? 0 : blinkIn.doubleChance;
    if (!petExpressionFinite(minMs, 1, BLINK_MAX_MS)) errors.push('blink.minMs out of range');
    if (!petExpressionFinite(maxMs, 1, BLINK_MAX_MS)) errors.push('blink.maxMs out of range');
    if (Number.isFinite(minMs) && Number.isFinite(maxMs) && maxMs < minMs) errors.push('blink.maxMs must be >= minMs');
    if (!petExpressionFinite(doubleChance, 0, 1)) errors.push('blink.doubleChance must be within [0,1]');
    blink = Object.freeze({ minMs, maxMs, doubleChance });
  }

  // loops
  let loops = [];
  if (input.loops === undefined) {
    loops = [];
  } else if (!Array.isArray(input.loops)) {
    errors.push('loops must be an array');
  } else if (input.loops.length > MAX_LOOPS) {
    errors.push(`loops must contain at most ${MAX_LOOPS} entries`);
  } else {
    const built = [];
    input.loops.forEach((loop, index) => {
      if (!petExpressionIsObject(loop)) { errors.push(`loops[${index}] must be an object`); return; }
      for (const key of Object.keys(loop)) {
        if (!['primitive', 'amplitude', 'periodMs'].includes(key)) errors.push(`loops[${index}] has unknown field "${key}"`);
      }
      if (!LOOP_PRIMITIVES.includes(loop.primitive)) {
        errors.push(`loops[${index}].primitive "${loop.primitive}" is not a known primitive`);
        return;
      }
      const periodMs = loop.periodMs === undefined ? 2400 : loop.periodMs;
      if (!petExpressionFinite(periodMs, 200, MAX_SEGMENT_MS)) { errors.push(`loops[${index}].periodMs out of range`); return; }
      const amplitude = loop.amplitude === undefined ? 1 : loop.amplitude;
      if (!petExpressionFinite(amplitude, 0, 4)) { errors.push(`loops[${index}].amplitude out of range`); return; }
      built.push(Object.freeze({ primitive: loop.primitive, amplitude, periodMs }));
    });
    loops = built;
  }

  // enter
  let enter = Object.freeze({ durationMs: 0, frames: Object.freeze([]) });
  if (input.enter !== undefined) {
    if (!petExpressionIsObject(input.enter)) {
      errors.push('enter must be an object');
    } else {
      for (const key of Object.keys(input.enter)) {
        if (!['durationMs', 'frames'].includes(key)) errors.push(`enter has unknown field "${key}"`);
      }
      const durationMs = input.enter.durationMs === undefined ? 0 : input.enter.durationMs;
      if (!petExpressionFinite(durationMs, 0, MAX_SEGMENT_MS)) {
        errors.push('enter.durationMs out of range');
      } else {
        const hasFrames = input.enter.frames !== undefined;
        const framesIn = hasFrames ? input.enter.frames : [];
        if (hasFrames && Array.isArray(framesIn) && framesIn.length === 0) {
          // 显式给出空关键帧列表视为无效配置；省略 frames 才是“纯时长进入”。
          errors.push('enter.frames must not be an empty array');
        } else if (!Array.isArray(framesIn)) {
          errors.push('enter.frames must be an array');
        } else if (framesIn.length > MAX_ENTER_FRAMES) {
          errors.push(`enter.frames must contain at most ${MAX_ENTER_FRAMES} keyframes`);
        } else if (framesIn.length === 0) {
          enter = Object.freeze({ durationMs, frames: Object.freeze([]) });
        } else {
          const frames = [];
          let previousAt = -Infinity;
          let framesValid = true;
          framesIn.forEach((frame, index) => {
            if (!petExpressionIsObject(frame)) { errors.push(`enter.frames[${index}] must be an object`); framesValid = false; return; }
            const frameKeys = ['atMs', 'x', 'y', 'scaleX', 'scaleY', 'rotateDeg'];
            for (const key of Object.keys(frame)) {
              if (!frameKeys.includes(key)) { errors.push(`enter.frames[${index}] has unknown field "${key}"`); framesValid = false; }
            }
            const atMs = frame.atMs;
            if (!petExpressionFinite(atMs, 0, durationMs)) { errors.push(`enter.frames[${index}].atMs out of range`); framesValid = false; return; }
            if (atMs <= previousAt) { errors.push('enter.frames must be strictly sorted by atMs'); framesValid = false; return; }
            previousAt = atMs;
            const clean = { atMs };
            for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotateDeg']) {
              if (frame[key] !== undefined) {
                const bound = key === 'scaleX' || key === 'scaleY' ? [SCALE_MIN, SCALE_MAX]
                  : key === 'rotateDeg' ? [-ROTATE_MAX, ROTATE_MAX]
                  : [-MAX_BODY_OFFSET, MAX_BODY_OFFSET];
                if (!petExpressionFinite(frame[key], bound[0], bound[1])) { errors.push(`enter.frames[${index}].${key} out of range`); framesValid = false; return; }
                clean[key] = frame[key];
              }
            }
            frames.push(Object.freeze(clean));
          });
          if (framesValid) enter = Object.freeze({ durationMs, frames: Object.freeze(frames) });
        }
      }
    }
  }

  // static（静态降级位姿，必须存在且自洽）
  let staticPose = null;
  if (!petExpressionIsObject(input.static)) {
    errors.push('static pose is required');
  } else {
    for (const key of Object.keys(input.static)) {
      if (!['face', 'body'].includes(key)) errors.push(`static has unknown field "${key}"`);
    }
    const sf = input.static.face;
    if (!petExpressionIsObject(sf)) {
      errors.push('static.face must be an object');
    } else {
      for (const key of Object.keys(sf)) {
        if (!['eyes', 'mouth'].includes(key)) errors.push(`static.face has unknown field "${key}"`);
      }
      if (!EYE_MASKS.includes(sf.eyes)) errors.push('static.face.eyes is not a known eye mask');
      if (!MOUTH_MASKS.includes(sf.mouth)) errors.push('static.face.mouth is not a known mouth mask');

      const sb = input.static.body;
      const baseStaticBody = body || Object.freeze({
        tone: 'normal', x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0
      });
      let staticBody = baseStaticBody;
      if (sb !== undefined) {
        if (!petExpressionIsObject(sb)) {
          errors.push('static.body must be an object');
        } else {
          const staticBodyKeys = ['tone', 'x', 'y', 'scaleX', 'scaleY', 'rotateDeg'];
          for (const key of Object.keys(sb)) {
            if (!staticBodyKeys.includes(key)) errors.push(`static.body has unknown field "${key}"`);
          }
          const tone = sb.tone === undefined ? baseStaticBody.tone : sb.tone;
          const x = sb.x === undefined ? baseStaticBody.x : sb.x;
          const y = sb.y === undefined ? baseStaticBody.y : sb.y;
          const scaleX = sb.scaleX === undefined ? baseStaticBody.scaleX : sb.scaleX;
          const scaleY = sb.scaleY === undefined ? baseStaticBody.scaleY : sb.scaleY;
          const rotateDeg = sb.rotateDeg === undefined ? baseStaticBody.rotateDeg : sb.rotateDeg;
          if (!BODY_TONES.includes(tone)) errors.push(`static.body.tone "${tone}" is not allowed`);
          if (!petExpressionFinite(x, -MAX_BODY_OFFSET, MAX_BODY_OFFSET)) errors.push('static.body.x out of range');
          if (!petExpressionFinite(y, -MAX_BODY_OFFSET, MAX_BODY_OFFSET)) errors.push('static.body.y out of range');
          if (!petExpressionFinite(scaleX, SCALE_MIN, SCALE_MAX)) errors.push('static.body.scaleX out of range');
          if (!petExpressionFinite(scaleY, SCALE_MIN, SCALE_MAX)) errors.push('static.body.scaleY out of range');
          if (!petExpressionFinite(rotateDeg, -ROTATE_MAX, ROTATE_MAX)) errors.push('static.body.rotateDeg out of range');
          staticBody = Object.freeze({ tone, x, y, scaleX, scaleY, rotateDeg });
        }
      }
      staticPose = Object.freeze({
        face: Object.freeze({ eyes: sf.eyes, mouth: sf.mouth }),
        body: staticBody
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: Object.freeze({
      id,
      group,
      label: input.label,
      accent,
      face,
      body,
      blink,
      loops: Object.freeze(loops),
      enter,
      static: staticPose
    })
  };
}

// ---------- 注册表 ----------
// 通用注册表：校验每一项、强制唯一、提供查找与回退。32 个内置表达式的
// “恰好 32 个、分组数量”由 content/expressions.mjs 的打包校验负责。
function createExpressionRegistry(expressions) {
  const list = Array.isArray(expressions) ? expressions : [];
  const byId = new Map();
  const errors = [];
  list.forEach((raw, index) => {
    const result = normalizeExpression(raw);
    if (!result.ok) {
      errors.push(`expressions[${index}] (${raw && raw.id}): ${result.errors.join('; ')}`);
      return;
    }
    const config = result.value;
    if (byId.has(config.id)) errors.push(`duplicate expression id: ${config.id}`);
    else byId.set(config.id, config);
  });

  function resolve(id) {
    if (typeof id === 'string' && byId.has(id)) {
      return { ok: true, value: byId.get(id) };
    }
    const fallback = byId.get(FALLBACK_ID) || null;
    if (!fallback) {
      // 区分“注册表为空”与“非空但缺少 life.idle 兜底”两种失败模式。
      return { ok: false, error: byId.size === 0 ? 'registry-empty' : 'fallback-unavailable', value: null };
    }
    return { ok: false, error: 'unknown-expression', value: fallback };
  }

  return Object.freeze({
    get size() { return byId.size; },
    ids: () => [...byId.keys()],
    has: (id) => byId.has(id),
    get: (id) => byId.get(id) || null,
    resolve,
    configs: () => [...byId.values()],
    errors: Object.freeze([...errors])
  });
}

// ---------- 位姿采样 ----------
// 从 expression + 绝对 elapsed time 采样位姿。纯函数：同一配置同一时间
// 结果确定；结果有限且收在安全范围内。
function petExpressionClamp(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function petExpressionLerp(a, b, t) {
  return a + (b - a) * t;
}

function petExpressionEaseOutCubic(t) {
  const c = petExpressionClamp(t, 0, 1);
  const inv = 1 - c;
  return 1 - inv * inv * inv;
}

// 进入序列：把身体从“起始位”缓动到基础位姿。若配置了关键帧，则按关键帧
// 插值（末尾隐式补一个 durationMs 处的基础位姿帧，保证平滑收尾）。
function petExpressionSampleEnterBody(enter, baseBody, elapsedMs) {
  if (!enter || enter.durationMs <= 0 || elapsedMs >= enter.durationMs) return baseBody;
  const t = petExpressionClamp(elapsedMs / enter.durationMs, 0, 1);
  const frames = enter.frames;
  if (!frames || frames.length === 0) {
    const eased = petExpressionEaseOutCubic(t);
    return {
      tone: baseBody.tone,
      x: petExpressionClamp(petExpressionLerp(0, baseBody.x, eased), -MAX_BODY_OFFSET, MAX_BODY_OFFSET),
      y: petExpressionClamp(petExpressionLerp(baseBody.y + 3, baseBody.y, eased), -MAX_BODY_OFFSET, MAX_BODY_OFFSET),
      scaleX: baseBody.scaleX,
      scaleY: baseBody.scaleY,
      rotateDeg: petExpressionClamp(petExpressionLerp(0, baseBody.rotateDeg, eased), -ROTATE_MAX, ROTATE_MAX)
    };
  }
  // 关键帧路径：补齐每个帧缺失的通道为基础值，并在 durationMs 处补基础帧。
  const channels = ['x', 'y', 'scaleX', 'scaleY', 'rotateDeg'];
  const full = frames.map(frame => {
    const merged = { atMs: frame.atMs };
    for (const ch of channels) merged[ch] = frame[ch] === undefined ? baseBody[ch] : frame[ch];
    return merged;
  });
  full.push({ atMs: enter.durationMs, x: baseBody.x, y: baseBody.y, scaleX: baseBody.scaleX, scaleY: baseBody.scaleY, rotateDeg: baseBody.rotateDeg });
  // 找到当前区间
  let a = full[0];
  let b = full[full.length - 1];
  for (let i = 0; i < full.length - 1; i++) {
    if (elapsedMs >= full[i].atMs && elapsedMs <= full[i + 1].atMs) { a = full[i]; b = full[i + 1]; break; }
  }
  const span = b.atMs - a.atMs;
  const local = span > 0 ? petExpressionClamp((elapsedMs - a.atMs) / span, 0, 1) : 1;
  const eased = petExpressionEaseOutCubic(local);
  const result = { tone: baseBody.tone };
  for (const ch of channels) {
    const lo = ch === 'scaleX' || ch === 'scaleY' ? SCALE_MIN : ch === 'rotateDeg' ? -ROTATE_MAX : -MAX_BODY_OFFSET;
    const hi = ch === 'scaleX' || ch === 'scaleY' ? SCALE_MAX : ch === 'rotateDeg' ? ROTATE_MAX : MAX_BODY_OFFSET;
    result[ch] = petExpressionClamp(petExpressionLerp(a[ch], b[ch], eased), lo, hi);
  }
  return result;
}

// 常驻循环：每个原语都是绝对时间的有界周期函数。
function petExpressionApplyLoops(loops, body, face, elapsedMs) {
  let x = body.x;
  let y = body.y;
  let scaleX = body.scaleX;
  let scaleY = body.scaleY;
  let rotateDeg = body.rotateDeg;
  let eyeOffsetX = face.eyeOffsetX;
  for (const loop of loops) {
    const period = loop.periodMs > 0 ? loop.periodMs : 2400;
    const phase = ((elapsedMs % period) / period) * Math.PI * 2;
    const amp = loop.amplitude;
    switch (loop.primitive) {
      case 'breath': {
        const breath = 1 + Math.sin(phase) * 0.012 * amp;
        scaleX = petExpressionClamp(scaleX * breath, SCALE_MIN, SCALE_MAX);
        scaleY = petExpressionClamp(scaleY / breath, SCALE_MIN, SCALE_MAX);
        break;
      }
      case 'sway':
        rotateDeg = petExpressionClamp(rotateDeg + Math.sin(phase) * 1.6 * amp, -ROTATE_MAX, ROTATE_MAX);
        break;
      case 'beat': {
        const pulse = 1 + Math.abs(Math.sin(phase)) * 0.02 * amp;
        scaleX = petExpressionClamp(scaleX * pulse, SCALE_MIN, SCALE_MAX);
        scaleY = petExpressionClamp(scaleY * pulse, SCALE_MIN, SCALE_MAX);
        break;
      }
      case 'tremble':
        x = petExpressionClamp(x + Math.sin(phase * 3) * 0.6 * amp, -MAX_BODY_OFFSET, MAX_BODY_OFFSET);
        break;
      case 'look-around':
        eyeOffsetX = petExpressionClamp(eyeOffsetX + Math.sin(phase) * 1.2 * amp, -MAX_EYE_OFFSET, MAX_EYE_OFFSET);
        break;
      default:
        break;
    }
  }
  return {
    body: { tone: body.tone, x, y, scaleX, scaleY, rotateDeg },
    eyeOffsetX
  };
}

// 采样某表情在 elapsedMs 时的完整位姿。返回 { face, body, gaze, blinkingWindow }，
// 全部有限且收在安全范围。无效 ID 回退到 fallback（resolve 已处理）。
function sampleExpressionPose(registry, id, elapsedMs) {
  const resolved = registry.resolve(id);
  const config = resolved.value;
  if (!config) return null;
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;

  const enteredBody = petExpressionSampleEnterBody(config.enter, config.body, t);
  const looped = petExpressionApplyLoops(config.loops, enteredBody, config.face, t);

  return Object.freeze({
    expressionId: config.id,
    accent: config.accent,
    face: Object.freeze({
      eyes: config.face.eyes,
      mouth: config.face.mouth,
      eyeOffsetX: looped.eyeOffsetX,
      eyeOffsetY: config.face.eyeOffsetY,
      eyeInsetX: config.face.eyeInsetX,
      openness: config.face.openness
    }),
    body: Object.freeze({
      tone: looped.body.tone,
      x: petExpressionClamp(looped.body.x, -MAX_BODY_OFFSET, MAX_BODY_OFFSET),
      y: petExpressionClamp(looped.body.y, -MAX_BODY_OFFSET, MAX_BODY_OFFSET),
      scaleX: petExpressionClamp(looped.body.scaleX, SCALE_MIN, SCALE_MAX),
      scaleY: petExpressionClamp(looped.body.scaleY, SCALE_MIN, SCALE_MAX),
      rotateDeg: petExpressionClamp(looped.body.rotateDeg, -ROTATE_MAX, ROTATE_MAX)
    }),
    gaze: Object.freeze({
      enabled: config.face.gaze.enabled,
      maxX: config.face.gaze.maxX,
      maxY: config.face.gaze.maxY
    }),
    blink: config.blink,
    staticPose: config.static
  });
}

const petExpressionApi = Object.freeze({
  EYE_MASKS,
  MOUTH_MASKS,
  BODY_TONES,
  LOOP_PRIMITIVES,
  EXPRESSION_ACCENTS,
  EXPRESSION_NAMESPACES,
  EXPRESSION_ID_PATTERN,
  FALLBACK_ID,
  MAX_BODY_OFFSET,
  MAX_EYE_INSET,
  normalizeExpression,
  createExpressionRegistry,
  sampleExpressionPose
});



export default petExpressionApi;
export { EYE_MASKS, MOUTH_MASKS, BODY_TONES, LOOP_PRIMITIVES, EXPRESSION_ACCENTS, EXPRESSION_NAMESPACES, EXPRESSION_ID_PATTERN };
export { FALLBACK_ID, MAX_BODY_OFFSET, MAX_EYE_INSET, normalizeExpression, createExpressionRegistry, sampleExpressionPose };
