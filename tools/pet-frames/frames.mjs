import * as content from '../../src/content/expressions.mjs';
import * as behaviors from '../../src/content/behaviors.mjs';
import * as sessionContent from '../../src/content/session-activities.mjs';
import * as sceneContent from '../../src/content/scenes.mjs';
import * as expressionEngine from '../../src/core/pet-expression.mjs';
import * as stageEngine from '../../src/core/pet-stage.mjs';
import * as faceRig from '../../src/core/pet-face.mjs';
import * as art from '../../src/core/pet-art.mjs';
import * as actionArt from '../../src/core/pet-action-art.mjs';
import * as sceneArt from '../../src/core/pet-scene-art.mjs';
import * as framePlan from './frame-plan.mjs';

'use strict';

const frameCapture = (() => {
// 0.1.3 视觉取帧工具。表达条带在 pet art canvas 上绘制；特殊行为、
// session 动作和场景在 220×220 生产舞台上合成。所有类别都调用生产的
// pet-art / pet-action-art / pet-scene-art，不在工具里重画一套“看起来差不多”的图。


if (!content || !behaviors || !sessionContent || !sceneContent || !expressionEngine
  || !stageEngine || !faceRig || !art || !actionArt || !sceneArt || !framePlan) {
  throw new Error('frame capture dependencies are incomplete');
}

const registry = expressionEngine.createExpressionRegistry(content.EXPRESSIONS);
if (registry.errors.length > 0 || registry.size !== content.EXPECTED_TOTAL) {
  throw new Error(`expression registry invalid: ${registry.errors.join('; ')}`);
}

// 固定 DPR 才能让两次直出可比；DPR=2 时 1 美术像素恰好是 3 个设备像素。
const CAPTURE_DPR = 2;
const STAGE_CSS_SIZE = 220;
const stage = stageEngine.resolvePetStage({ devicePixelRatio: CAPTURE_DPR });
const palette = art.PALETTES.pink;
const theme = Object.freeze({ accent: '#e0af68', primary: '#7dcfff' });
const petLayer = Object.freeze({
  x: (STAGE_CSS_SIZE - stage.cssWidth) / 2,
  // 与 pet.html 一致：相比几何居中再下移 2 CSS px。
  y: (STAGE_CSS_SIZE - stage.cssHeight) / 2 + 2,
  width: stage.cssWidth,
  height: stage.cssHeight
});

const expressionPlans = framePlan.planExpressionSheet(registry, content.EXPECTED_EXPRESSION_IDS);
const actionPlans = framePlan.planActionSheet(behaviors.PET_ACTIONS, 'action');
const sessionPlans = framePlan.planActionSheet(sessionContent.SESSION_ACTIVITIES, 'session');
const scenePlans = framePlan.planSceneSheet(sceneContent.SCENES);
const plans = Object.freeze([...expressionPlans, ...actionPlans, ...sessionPlans, ...scenePlans]);

const STRIP_BACKGROUND = '#1a1b26';
const STRIP_HEADER_HEIGHT = 44;
const STRIP_CAPTION_HEIGHT = 34;
const STRIP_GAP = 8;
const ALPHA_FLOOR = 8;

const bodySurfaces = new Map();
const captureFaceSurface = document.createElement('canvas');
captureFaceSurface.width = stage.bodySize * stage.deviceScale;
captureFaceSurface.height = stage.bodySize * stage.deviceScale;
const captureActionBackSurface = document.createElement('canvas');
const captureActionFrontSurface = document.createElement('canvas');
for (const surface of [captureActionBackSurface, captureActionFrontSurface]) {
  surface.width = stage.rasterWidth;
  surface.height = stage.rasterHeight;
}
function bodySurface(bodyTone) {
  const key = art.bodySpriteKey('pink', bodyTone);
  if (bodySurfaces.has(key)) return bodySurfaces.get(key);
  const surface = document.createElement('canvas');
  surface.width = stage.bodySize * stage.deviceScale;
  surface.height = stage.bodySize * stage.deviceScale;
  art.paintBodySprite(surface, palette, bodyTone, stage);
  bodySurfaces.set(key, surface);
  return surface;
}

function staticPose(config) {
  return {
    face: {
      eyes: config.static.face.eyes,
      mouth: config.static.face.mouth,
      eyeOffsetX: config.face.eyeOffsetX,
      eyeOffsetY: config.face.eyeOffsetY,
      eyeInsetX: config.face.eyeInsetX,
      openness: config.face.openness
    },
    body: config.static.body,
    accent: config.accent
  };
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function newPetCanvas() {
  return newCanvas(stage.rasterWidth, stage.rasterHeight);
}

function newStageCanvas() {
  return newCanvas(STAGE_CSS_SIZE * CAPTURE_DPR, STAGE_CSS_SIZE * CAPTURE_DPR);
}

function clearAndScale(context, canvas, scale) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = false;
}

function paintPetFrame(canvas, expressionId, frame, action = null) {
  const config = registry.get(expressionId);
  if (!config) throw new RangeError(`unknown expression: ${expressionId}`);
  const pose = frame.static
    ? staticPose(config)
    : expressionEngine.sampleExpressionPose(registry, expressionId, frame.elapsedMs);
  const progress = Number.isFinite(frame.progress) ? frame.progress : 0;
  const calmVisual = Boolean(frame.static);
  const context = canvas.getContext('2d');
  clearAndScale(context, canvas, stage.deviceScale);

  const offset = actionArt.bodyOffset(action, progress, {
    calmVisual,
    bodySize: stage.bodySize,
    facing: 1
  });
  const snap = value => stageEngine.snapToPetDevicePixel(value, stage.deviceScale);
  const translate = (x, y) => context.translate(snap(x), snap(y));
  const offX = snap(stage.bodyOrigin.x + offset.x);
  const offY = snap(stage.bodyOrigin.y + offset.y);

  context.save();
  actionArt.applyBodyTransform(context, action, progress, {
    calmVisual,
    size: stage.artWidth,
    bodySize: stage.bodySize,
    translate
  });
  art.applyBodyPose(context, pose.body, stage.artWidth, translate);
  if (action) {
    const backBounds = actionArt.paintActionLayer(captureActionBackSurface, action, progress, palette, {
      stage,
      layer: 'back',
      offX,
      offY,
      theme
    });
    actionArt.blitActionLayer(context, captureActionBackSurface, backBounds, stage);
  }
  context.drawImage(bodySurface(pose.body.tone), offX, offY, stage.bodySize, stage.bodySize);
  art.paintFaceSprite(captureFaceSurface, palette, pose.face, Boolean(frame.blinking), {
    stage,
    faceRig
  });
  context.drawImage(captureFaceSurface, offX, offY, stage.bodySize, stage.bodySize);
  if (action) {
    const frontBounds = actionArt.paintActionLayer(captureActionFrontSurface, action, progress, palette, {
      stage,
      layer: 'front',
      offX,
      offY,
      theme
    });
    actionArt.blitActionLayer(context, captureActionFrontSurface, frontBounds, stage);
  }
  context.restore();
  art.drawExpressionAccent(context, pose.accent, frame.elapsedMs, {
    offX,
    offY,
    calmVisual: frame.static
  });
  return pose;
}

function drawPetOnStage(context, petCanvas) {
  context.drawImage(petCanvas, petLayer.x, petLayer.y, petLayer.width, petLayer.height);
}

function paintExpressionFrame(config, frame) {
  const canvas = newPetCanvas();
  paintPetFrame(canvas, config.id, frame);
  return canvas;
}

function paintActionFrame(action, frame, kind) {
  const petCanvas = newPetCanvas();
  paintPetFrame(petCanvas, action.expression, frame, action);

  const canvas = newStageCanvas();
  const context = canvas.getContext('2d');
  clearAndScale(context, canvas, CAPTURE_DPR);
  if (kind === 'session') {
    context.save();
    context.globalAlpha = 0.56;
    sceneArt.drawSessionBackdrop(context, action.state, action, { calmVisual: frame.static });
    context.restore();
  }
  drawPetOnStage(context, petCanvas);
  if (kind === 'action') {
    actionArt.drawActionOverlay(context, action, frame.progress, {
      calmVisual: frame.static,
      petCanvas,
      stage
    });
  }
  return canvas;
}

function paintSceneFrame(scene, frame) {
  const canvas = newStageCanvas();
  const context = canvas.getContext('2d');
  clearAndScale(context, canvas, CAPTURE_DPR);
  context.save();
  // .scene-frame 在生产 CSS 中的透明度是 0.56；保留这一层，才能真实检查
  // “场景不抢宠物”，而不是把背景单独画得很艳。
  context.globalAlpha = 0.56;
  sceneArt.drawBackdrop(context, scene, { calmVisual: true });
  context.restore();

  if (frame.variant === 'composite') {
    const petCanvas = newPetCanvas();
    paintPetFrame(petCanvas, 'life.idle', { elapsedMs: 0, static: true, blinking: false });
    drawPetOnStage(context, petCanvas);
  }
  return canvas;
}

function paintPlannedFrame(plan, frame) {
  if (plan.kind === 'expression') return paintExpressionFrame(registry.get(plan.id), frame);
  if (plan.kind === 'action') return paintActionFrame(behaviors.PET_ACTIONS[plan.id], frame, plan.kind);
  if (plan.kind === 'session') return paintActionFrame(sessionContent.SESSION_ACTIVITIES[plan.id], frame, plan.kind);
  if (plan.kind === 'scene') return paintSceneFrame(sceneContent.SCENES[plan.id], frame);
  throw new RangeError(`unknown capture kind: ${plan.kind}`);
}

function measureFrame(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let opaquePixels = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hash = 0x811c9dc5;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    hash ^= data[index] ^ data[index + 1] ^ data[index + 2] ^ alpha;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    if (alpha < ALPHA_FLOOR) continue;
    opaquePixels += 1;
    const pixel = index / 4;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bounds = opaquePixels > 0
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { opaquePixels, width, height, bounds, signature: `f${hash.toString(16)}` };
}

function drawStripText(context, text, x, y, options = {}) {
  context.fillStyle = options.color || '#c0caf5';
  context.font = options.font || "16px 'SF Mono', Menlo, Monaco, monospace";
  context.textBaseline = options.baseline || 'top';
  context.textAlign = options.align || 'left';
  context.fillText(text, x, y);
}

function planSummary(plan) {
  if (plan.kind === 'expression') {
    return plan.animated
      ? `${plan.group} · 进入 ${plan.enterMs}ms · 循环 ${plan.periodMs}ms`
      : `${plan.group} · 单一位姿（无进入动画、无循环）`;
  }
  if (plan.kind === 'scene') return `${plan.group} · 生产场景 + idle 宠物`;
  return `${plan.group} · ${plan.expression} · ${plan.durationMs}ms`;
}

function renderStrip(plan, frameCanvases, samples) {
  const cellWidth = frameCanvases[0].width;
  const cellHeight = frameCanvases[0].height;
  const columns = frameCanvases.length;
  const strip = newCanvas(
    STRIP_GAP + columns * (cellWidth + STRIP_GAP),
    STRIP_HEADER_HEIGHT + cellHeight + STRIP_CAPTION_HEIGHT
  );
  const context = strip.getContext('2d');
  context.fillStyle = STRIP_BACKGROUND;
  context.fillRect(0, 0, strip.width, strip.height);
  context.imageSmoothingEnabled = false;

  drawStripText(context, `${plan.kind} / ${plan.id}  ${plan.label}`, STRIP_GAP, 10, {
    font: "20px 'SF Mono', Menlo, monospace"
  });
  drawStripText(context, planSummary(plan), strip.width - STRIP_GAP, 14, {
    align: 'right',
    color: '#7f88b3'
  });

  frameCanvases.forEach((frameCanvas, index) => {
    const x = STRIP_GAP + index * (cellWidth + STRIP_GAP);
    context.drawImage(frameCanvas, x, STRIP_HEADER_HEIGHT);
    const frame = plan.frames[index];
    const captionY = STRIP_HEADER_HEIGHT + cellHeight + 6;
    drawStripText(context, frame.label, x, captionY);
    const detail = frame.static ? 'static' : `${frame.elapsedMs}ms`;
    drawStripText(context, `${detail} · ${samples[index].opaquePixels}px`, x, captionY + 18, {
      color: '#7f88b3',
      font: "13px 'SF Mono', Menlo, monospace"
    });
  });
  return strip;
}

function renderEntry(index) {
  const plan = plans[index];
  if (!plan) throw new RangeError(`no capture plan at ${index}`);
  const frameCanvases = plan.frames.map(frame => paintPlannedFrame(plan, frame));
  const samples = frameCanvases.map(measureFrame);
  const health = framePlan.assessStripHealth(plan, samples);
  const strip = renderStrip(plan, frameCanvases, samples);
  const metadata = {
    kind: plan.kind,
    id: plan.id,
    group: plan.group,
    label: plan.label,
    expression: plan.expression || null,
    animated: plan.animated,
    enterMs: plan.enterMs || 0,
    periodMs: plan.periodMs || 0,
    durationMs: plan.durationMs || 0,
    frames: plan.frames.map((frame, frameIndex) => ({
      key: frame.key,
      label: frame.label,
      phase: frame.phase,
      elapsedMs: frame.elapsedMs,
      progress: Number.isFinite(frame.progress) ? frame.progress : null,
      variant: frame.variant || null,
      static: frame.static,
      blinking: frame.blinking,
      opaquePixels: samples[frameIndex].opaquePixels,
      bounds: samples[frameIndex].bounds,
      signature: samples[frameIndex].signature
    })),
    health: { ok: health.ok, faults: [...health.faults] }
  };
  return { metadata, strip, dataUrl: strip.toDataURL('image/png') };
}

const counts = Object.freeze(plans.reduce((result, plan) => {
  result[plan.kind] = (result[plan.kind] || 0) + 1;
  return result;
}, { expression: 0, action: 0, session: 0, scene: 0 }));
const plannedFrames = plans.reduce((total, plan) => total + plan.frames.length, 0);
let active = null;

document.querySelector('#status').textContent = [
  `取帧已就绪：${plans.length} 项 / ${plannedFrames} 帧`,
  `表达 ${counts.expression} · 特殊行为 ${counts.action} · 会话动作 ${counts.session} · 场景 ${counts.scene}`,
  `宠物光栅 ${stage.rasterWidth}×${stage.rasterHeight}，合成舞台 ${STAGE_CSS_SIZE * CAPTURE_DPR}×${STAGE_CSS_SIZE * CAPTURE_DPR}`
].join('\n');

// 惰性绘制：109 个条带若同时保留 base64，会制造数百 MB 的峰值。
// 主进程逐项 prepare/read/release，使内存只与最大的一张条带有关。
document.documentElement.dataset.captureReady = 'true';
return Object.freeze({
  total: plans.length,
  counts,
  plannedFrames,
  stage: Object.freeze({
    devicePixelRatio: CAPTURE_DPR,
    artWidth: stage.artWidth,
    artHeight: stage.artHeight,
    rasterWidth: stage.rasterWidth,
    rasterHeight: stage.rasterHeight,
    cssWidth: stage.cssWidth,
    cssHeight: stage.cssHeight,
    bodyCssSize: stage.bodyCssSize,
    compositionCssSize: STAGE_CSS_SIZE,
    compositionRasterSize: STAGE_CSS_SIZE * CAPTURE_DPR
  }),
  prepare(index) {
    active = { index, ...renderEntry(index) };
    return true;
  },
  metadata(index) {
    if (!active || active.index !== index) this.prepare(index);
    return active.metadata;
  },
  dataUrl(index) {
    if (!active || active.index !== index) this.prepare(index);
    return active.dataUrl;
  },
  release(index) {
    if (!active || active.index !== index) return;
    active.strip.width = 1;
    active.strip.height = 1;
    active = null;
  }
});

})();

export { frameCapture };
