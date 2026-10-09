'use strict';

import { resolveRigView, rigCacheKey } from './schema.mjs';
import { computeBoneWorld, IDENTITY, multiply, localMatrix } from './pose.mjs';
import { sampleMotion, idleProgress } from './motions.mjs';
import { resolveRigFace, rigEyeMatrix } from './face.mjs';
import { resolveRigProps, propLayer, PROP_PIVOTS } from './props.mjs';
import { createPathCache, paintShapes } from './paint.mjs';

// 动作与动作之间的过渡。有六个动作（睡觉、读书、写字、喝水、啃咬、挖掘）的第一帧就已经是“保持的姿势”：
// 啃咬的手臂一帧转 52°、读书 40°、写字 32°。从待机切进去（以及切出来）会在一帧内瞬移，看起来是渲染断层。
// 只在“动作或朝向变了”的那一刻做一次 220 ms 的 smoothstep 混合，稳定播放时姿势就是原始采样、幅度不变；
// 混合中途又被打断就从当前显示的姿势接着走。需要一个单调的时钟（elapsedMs）：没有时钟的调用方
// （静止的肖像）拿到原始姿势，也不会碰过渡状态。
// 过渡时长随两个姿势的差距增长：差 0.9 rad（啃咬）约 220 ms；从“伸懒腰”（手臂 −2.6 rad）切到“喝水”
// （+2.1 rad）差 4.7 rad，220 ms 内会以每帧约 20° 甩过去——没有跳变，但像甩了一下鞭子，所以最长放宽到 420 ms。
const MIN_TRANSITION_MS = 200;
const MAX_TRANSITION_MS = 420;
const TRANSITION_MS_PER_RAD = 110;
const TRANSITION_MS_PER_ART_UNIT = 9;
const STALE_GAP_MS = 500;                       // 帧停了这么久（窗口隐藏、节流）就直接对齐，不去混合过时的姿势
const REST = Object.freeze({ r: 0, x: 0, y: 0, sx: 1, sy: 1 });
const CHANNELS = Object.freeze(['r', 'x', 'y', 'sx', 'sy']);
const smoothstep = t => t * t * (3 - 2 * t);

function blendBones(from, to, weight) {
  const out = {};
  for (const bone of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const local = {};
    for (const channel of CHANNELS) {
      const a = from[bone]?.[channel];
      const b = to[bone]?.[channel];
      if (a === undefined && b === undefined) continue;
      const start = a ?? REST[channel];
      local[channel] = start + ((b ?? REST[channel]) - start) * weight;
    }
    out[bone] = Object.freeze(local);
  }
  return Object.freeze(out);
}

function largestTurn(from, to) {
  let largest = 0;
  for (const bone of new Set([...Object.keys(from), ...Object.keys(to)])) {
    largest = Math.max(largest, Math.abs((from[bone]?.r ?? 0) - (to[bone]?.r ?? 0)));
  }
  return largest;
}

function largestShift(from, to) {
  let largest = 0;
  for (const bone of new Set([...Object.keys(from), ...Object.keys(to)])) {
    largest = Math.max(largest, Math.hypot((from[bone]?.x || 0) - (to[bone]?.x || 0),
      (from[bone]?.y || 0) - (to[bone]?.y || 0)));
  }
  return largest;
}

function createPoseTransition() {
  let key = null;
  let at = -Infinity;
  let shown = {};
  let from = null;
  let started = 0;
  let duration = MIN_TRANSITION_MS;
  return {
    step({ key: nextKey, bones, now, immediate = false }) {
      if (immediate) { key = nextKey; at = now; from = null; shown = bones; return bones; }
      if (key === null || !(now >= at) || now - at > STALE_GAP_MS) from = null;
      else if (nextKey !== key) {
        from = shown;
        started = now;
        duration = Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, 90 + TRANSITION_MS_PER_RAD * largestTurn(shown, bones), 90 + TRANSITION_MS_PER_ART_UNIT * largestShift(shown, bones)));
      }
      key = nextKey;
      at = now;
      let weight = 1;
      if (from) {
        weight = smoothstep(Math.min(1, Math.max(0, (now - started) / duration)));
        if (weight >= 1) from = null;
      }
      shown = from ? blendBones(from, bones, weight) : bones;
      return shown;
    }
  };
}

// The rig artist speaks the same ARTIST_METHODS protocol as the vector
// painter (see form-art.mjs), so neither renderer learns about bones.
//
// Layering: `body` parts are cached in the body sprite at rest. `back` and
// `front` parts follow the posed bones and are painted live by the action
// layer (behind the body and after the face). Portraits have no action layer,
// so a `fit` body paints all three layers at rest.
function createRigArtist({ fallback, paths = createPathCache(), partLayer = part => part.layer } = {}) {
  if (!fallback) throw new TypeError('a fallback artist is required');
  const transitions = new Map();
  const transitionFor = channel => {
    if (!transitions.has(channel)) transitions.set(channel, createPoseTransition());
    return transitions.get(channel);
  };

  // channel：每个持续动画的画面一条独立的过渡状态（默认只有桌宠一个）。
  function resolve(rig, { view = 'front', motion = null, face = null, calmVisual = false,
    progress = 0, elapsedMs, channel = 'pet', action = null, prop } = {}) {
    const resolved = resolveRigView(rig, view);
    const acting = typeof motion === 'string' && motion !== 'idle';
    const rawSample = sampleMotion(acting ? motion : 'idle', {
      view: resolved.view, calmVisual, prop: prop ?? action?.prop,
      progress: acting ? progress : idleProgress(elapsedMs ?? 0)
    });
    const sample = fallback.prepareSample?.(rawSample, { data: resolved.data, view: resolved.view,
      progress, calmVisual, action }) || rawSample;
    const target = calmVisual && !acting ? {} : sample.bones;
    const bones = Number.isFinite(elapsedMs)
      ? transitionFor(channel).step({ key: `${sample.key}|${resolved.view}|${calmVisual ? 'calm' : 'live'}`, bones: target, now: elapsedMs, immediate: calmVisual })
      : target;
    const world = computeBoneWorld(resolved.data.bones, bones);
    return Object.freeze({
      kind: 'rig', rig, key: rigCacheKey(rig), view, drawnView: resolved.view,
      face, pose: Object.freeze({ sample, world })
    });
  }

  function viewData(artwork, view) {
    return resolveRigView(artwork.rig, view || artwork.view)?.data || null;
  }

  function paintParts(ctx, data, layer, world, palette, hiddenBones = [], artwork = null) {
    let painted = 0;
    for (const part of data.parts) {
      if (partLayer(part, artwork) !== layer || hiddenBones.includes(part.bone)) continue;
      // A form may replace one authored part with an integrated contact silhouette.
      // Every ordinary part and foreign rig retains the same painter and matrices.
      const custom = world && fallback.paintPart?.(ctx, { part, data, layer, world, artwork });
      painted += custom ? 1 : paintShapes(ctx, part.shapes, paths, palette, world ? world[part.bone] : null);
    }
    return painted;
  }

  function body(ctx, palette, view, artwork, { fit = false } = {}) {
    const data = viewData(artwork, view);
    if (!data) return fallback.body(ctx, palette, view);
    const hiddenBones = artwork.hiddenRigBones || [];
    if (fit) paintParts(ctx, data, 'back', null, palette, hiddenBones, artwork);
    paintParts(ctx, data, 'body', null, palette, hiddenBones, artwork);
    if (fit && !artwork.deferPortraitForeground) paintParts(ctx, data, 'front', null, palette, hiddenBones, artwork);
    return true;
  }

  function face(ctx, palette, expression, blinking, view, faceRig, artwork) {
    if (view === 'back') return 'back';
    const data = viewData(artwork, view);
    const resolved = resolveRigFace(data?.face, expression, blinking);
    if (!resolved) return fallback.face(ctx, palette, expression, blinking, view, faceRig);
    if (resolved.eyes) {
      for (const shape of resolved.eyes.entry.shapes) {
        paintShapes(ctx, [shape], paths, palette, rigEyeMatrix(shape, resolved, faceRig?.[view]));
      }
      for (const shape of resolved.eyes.entry.pupil || []) {
        paintShapes(ctx, [shape], paths, palette, rigEyeMatrix(shape, resolved, faceRig?.[view], true));
      }
    }
    if (resolved.mouth) paintShapes(ctx, resolved.mouth.entry.shapes, paths, palette);
    return resolved.mask;
  }

  function action(ctx, options) {
    const { artwork, layer = 'front', view, palette } = options;
    const data = viewData(artwork, view);
    if (!data) return fallback.action(ctx, options);
    const world = artwork.pose.world;
    let painted = fallback.connectors?.(ctx, { ...options, data, world }) ? 1 : 0;
    painted += paintParts(ctx, data, layer, world, palette, artwork.hiddenRigBones || [], artwork);
    const props = resolveRigProps(data, artwork.pose.sample, null);
    for (const { id, prop } of props.drawn) {
      if (propLayer(prop) !== layer) continue;
      const pose = artwork.pose.sample.propPoses?.[id];
      const pivot = prop.bone === 'root' ? PROP_PIVOTS[id] || [33, 52] : data.bones[prop.bone].pivot;
      const defaultMatrix = pose ? multiply(world[prop.bone], localMatrix(pivot, pose)) : world[prop.bone];
      const matrix = fallback.propMatrix?.(defaultMatrix, { id, artwork, data }) || defaultMatrix;
      ctx.save();
      if (Number.isFinite(options.action?.propOpacity)) ctx.globalAlpha *= Math.max(0, Math.min(1, options.action.propOpacity));
      if (pose?.opacity !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, pose.opacity));
      const custom = fallback.paintProp?.(ctx, { id, prop, artwork, data, matrix },
        (shapes, transform) => paintShapes(ctx, shapes, paths, palette, transform));
      painted += custom ? 1 : paintShapes(ctx, prop.shapes, paths, palette, matrix);
      ctx.restore();
    }
    // A prop the author has not drawn keeps the vector stand-in (book, cup…).
    if (layer === 'front' && props.missing.length && options.motion) {
      painted += fallback.action(ctx, { ...options, overlayOnly: true }) ? 1 : 0;
    }
    return painted > 0;
  }

  function appearance(ctx, options) {
    const { artwork, item, form, view = 'front' } = options;
    const data = artwork?.kind === 'rig' ? viewData(artwork, view) : null;
    const anchor = data?.anchors?.[item?.exclusiveGroup];
    if (!anchor) return fallback.appearance(ctx, options);
    // Draw at the rest anchor under the bone's world matrix: the accessory
    // then swings and turns with its ear, neck or back bone.
    const world = artwork.pose.world[anchor.bone] || IDENTITY;
    const slotAnchors = { ...(form.appearanceAnchors[item.exclusiveGroup] || {}), [view]: { x: anchor.x, y: anchor.y } };
    const posedForm = { ...form, appearanceAnchors: { ...form.appearanceAnchors, [item.exclusiveGroup]: slotAnchors } };
    ctx.save();
    ctx.transform(world[0], world[1], world[2], world[3], world[4], world[5]);
    try { return fallback.appearance(ctx, { ...options, form: posedForm }); } finally { ctx.restore(); }
  }

  function portraitForeground(ctx, palette, view, artwork) {
    const data = viewData(artwork, view);
    return data ? paintParts(ctx, data, 'front', null, palette, artwork.hiddenRigBones, artwork) : 0;
  }

  return Object.freeze({
    resolve, body, face, action, appearance, portraitForeground,
    motionOffset: fallback.motionOffset,
    applyMotionTransform: fallback.applyMotionTransform,
    expressionAccent: fallback.expressionAccent,
    statusEffect: fallback.statusEffect
  });
}

export { createRigArtist };
export default Object.freeze({ createRigArtist });
