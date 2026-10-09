'use strict';

import { BODY_GRIDS } from '../content/companion/dango-body.mjs';

const petArtApi = (() => {
// 小步 像素角色的共享绘制层。
//
// 生产桌宠与开发表达画廊都从这里读取同一身体网格、皮肤调色板和活动脸
// 合成函数，避免“画廊看起来正确、真正桌宠却画了另一套”的分叉。模块只
// 接收 Canvas 2D context 与纯数据，不读取 DOM、不启动计时器，也不发 IPC。

// Editable SVG is compiled offline into exact 33×33 palette-indexed cells.
// The runtime keeps the 66-art-unit stage and original integer pixel painter.
const petArtBodyGrids = BODY_GRIDS;
const petArtMonsterGrid = BODY_GRIDS.front;

const petArtPalettes = Object.freeze({
  pink: Object.freeze({ 1:'#1a1b26', 2:'#f7768e', 3:'#dc5069', 4:'#1a1b26', cheek:'#e45c74' }),
  forest: Object.freeze({ 1:'#0f1a12', 2:'#9ece6a', 3:'#528b41', 4:'#0f1a12', cheek:'#ffd0a6' }),
  ocean: Object.freeze({ 1:'#0a1421', 2:'#7dcfff', 3:'#3d59a1', 4:'#0a1421', cheek:'#f6b5c5' }),
  sakura: Object.freeze({ 1:'#2a1a24', 2:'#ffb3c8', 3:'#f7768e', 4:'#2a1a24', cheek:'#fff0f4' }),
  moon: Object.freeze({ 1:'#0f0a1a', 2:'#bb9af7', 3:'#7a5ed6', 4:'#0f0a1a', cheek:'#f2b8d5' }),
  flame: Object.freeze({ 1:'#1a0a0a', 2:'#ff7a5c', 3:'#c53b1a', 4:'#1a0a0a', cheek:'#ffd0a6' }),
  crown: Object.freeze({ 1:'#1a1408', 2:'#ffd558', 3:'#c07f26', 4:'#1a1408', cheek:'#ff9aa2' }),
  robot: Object.freeze({ 1:'#0a0a12', 2:'#a9b1d6', 3:'#565f89', 4:'#7dcfff', cheek:'#f3a6bd' }),
  woodsman: Object.freeze({ 1:'#1a1208', 2:'#c9986a', 3:'#8a5a2a', 4:'#1a1208', cheek:'#f3aa8b' }),
  bat: Object.freeze({ 1:'#050508', 2:'#3d59a1', 3:'#1a1b26', 4:'#f7768e', cheek:'#ff9db0' })
});

function petArtBodySpriteKey(skin, bodyTone = 'normal', bodyVariant = 'front') {
  const safeVariant = petArtBodyGrids[bodyVariant] ? bodyVariant : 'front';
  return `${skin}|${bodyTone}|${safeVariant}`;
}

function petArtPaintBodySprite(surface, palette, bodyTone, stage, bodyVariant = 'front') {
  if (!surface || typeof surface.getContext !== 'function') throw new TypeError('surface must provide a 2d context');
  if (!palette || !stage) throw new TypeError('palette and stage are required');
  // bodyTone 当前是离散缓存维度；具体色调仍由每套皮肤调色板决定。保留参数
  // 是为了后续增加 warm/cool 时不改变生产与画廊的调用协议。
  void bodyTone;
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, stage.bodySize, stage.bodySize);

  const grid = petArtBodyGrids[bodyVariant] || petArtBodyGrids.front;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const glyph = grid[y][x];
      if (glyph === '.') continue;
      const color = palette[Number.parseInt(glyph, 10)];
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(x * stage.cell, y * stage.cell, stage.cell, stage.cell);
    }
  }
}

function petArtDrawLiveFace(context, palette, face, isBlinking, options) {
  if (!context || !palette || !face || !options || !options.faceRig) {
    throw new TypeError('context, palette, face and faceRig are required');
  }
  const faceRig = options.faceRig;
  const view = options.view || 'front';
  if (view === 'back') return 'back';
  const layout = faceRig.VIEW_LAYOUTS?.[view] || {
    eyeAnchors: faceRig.EYE_ANCHORS,
    mouthAnchor: faceRig.MOUTH_ANCHOR,
    cheekAnchors: [[4, 16], [27, 16]]
  };
  const cell = options.cell;
  const offX = options.offX || 0;
  const offY = options.offY || 0;
  const openness = face.openness === undefined ? 1 : face.openness;
  const eyesName = (isBlinking || openness <= 0.15) ? 'closed' : face.eyes;
  const eyeGrid = faceRig.EYE_MASKS[eyesName] || faceRig.EYE_MASKS.neutral;
  const mouthGrid = faceRig.MOUTH_MASKS[face.mouth] || faceRig.MOUTH_MASKS.neutral;
  const eyeOffsetX = Math.round(face.eyeOffsetX || 0);
  const eyeOffsetY = Math.round(face.eyeOffsetY || 0);
  const eyeInsetX = Math.round(face.eyeInsetX || 0);

  const eyeColor = palette[4];
  const highlight = '#ffffff';
  const accent = palette[3];
  const outline = palette[1];
  const mouthInner = '#43212d';
  const eyeColorFor = ch => (ch === 'X' ? eyeColor : ch === 'W' ? highlight : ch === 'A' ? accent : null);
  const mouthColorFor = ch => (ch === 'X' ? outline : ch === 'W' ? mouthInner : ch === 'A' ? accent : null);

  for (const [side, anchor] of Object.entries(layout.eyeAnchors)) {
    const inwardOffset = side === 'left' ? eyeInsetX : -eyeInsetX;
    const eyeWidth = anchor.gridWidth || faceRig.EYE_GRID_WIDTH;
    for (let rowIndex = 0; rowIndex < eyeGrid.length; rowIndex++) {
      const row = eyeGrid[rowIndex];
      for (let column = 0; column < faceRig.EYE_GRID_WIDTH; column++) {
        const color = eyeColorFor(row[column]);
        if (!color) continue;
        context.fillStyle = color;
        context.fillRect(
          Math.round(offX + (anchor.gridX + Math.round(column * (eyeWidth - 1) / (faceRig.EYE_GRID_WIDTH - 1))) * cell + eyeOffsetX + inwardOffset),
          Math.round(offY + (anchor.gridY + rowIndex) * cell + eyeOffsetY),
          cell,
          cell
        );
      }
    }
  }
  for (let rowIndex = 0; rowIndex < mouthGrid.length; rowIndex++) {
    const row = mouthGrid[rowIndex];
    for (let column = 0; column < faceRig.MOUTH_GRID_WIDTH; column++) {
      const color = mouthColorFor(row[column]);
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(
        Math.round(offX + (layout.mouthAnchor.gridX + column) * cell),
        Math.round(offY + (layout.mouthAnchor.gridY + rowIndex) * cell),
        cell,
        cell
      );
    }
  }
  // 腮红只在亲和表情中出现；它属于脸部坐标，不跟随眼球 gaze 偏移。
  const hasCheeks = ['smile', 'open', 'chew', 'surprised'].includes(face.mouth)
    || ['shy', 'content'].includes(eyesName);
  if (hasCheeks && palette.cheek) {
    context.fillStyle = palette.cheek;
    for (const [cheekX, cheekYGrid] of layout.cheekAnchors) {
      context.fillRect(offX + cheekX * cell, offY + cheekYGrid * cell, 2 * cell, cell);
    }
  }
  return eyesName;
}

// 活动脸必须先在未变形的身体尺寸 surface 上合成为一张贴图，再与身体使用
// 完全相同的目标矩形一次 drawImage。若在 scale/rotate 后逐格 fillRect，格子边缘
// 会各自覆盖亚像素并在眼睛内部形成棋盘缝；合成后只有整张脸贴图的外缘参与采样。
function petArtPaintFaceSprite(surface, palette, face, isBlinking, options) {
  if (!surface || typeof surface.getContext !== 'function') {
    throw new TypeError('surface must provide a 2d context');
  }
  if (!options || !options.stage || !options.faceRig) {
    throw new TypeError('stage and faceRig are required');
  }
  const { stage, faceRig } = options;
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, stage.bodySize, stage.bodySize);
  return petArtDrawLiveFace(context, palette, face, isBlinking, {
    cell: stage.cell,
    offX: 0,
    offY: 0,
    faceRig,
    view: options.view || 'front'
  });
}

function petArtDrawPixelZ(context, x, y, scale, color) {
  if (!context) return;
  const unit = Math.max(1, Math.round(scale || 1));
  context.fillStyle = color || '#bb9af7';
  context.fillRect(Math.round(x), Math.round(y), unit * 5, unit);
  context.fillRect(Math.round(x + unit * 3), Math.round(y + unit), unit * 2, unit);
  context.fillRect(Math.round(x + unit * 2), Math.round(y + unit * 2), unit * 2, unit);
  context.fillRect(Math.round(x + unit), Math.round(y + unit * 3), unit * 2, unit);
  context.fillRect(Math.round(x), Math.round(y + unit * 4), unit * 5, unit);
}

function petArtDrawExpressionAccent(context, accent, elapsedMs, options = {}) {
  if (!context || !['sleep-zzz', 'drowsy-zzz'].includes(accent)) return 0;
  const count = accent === 'sleep-zzz' ? 3 : 2;
  const calmVisual = options.calmVisual === true;
  const cycle = ((Number.isFinite(elapsedMs) ? elapsedMs : 0) % 1500) / 1500;
  const offX = Number(options.offX) || 0;
  const offY = Number(options.offY) || 0;
  const color = options.color || '#bb9af7';
  context.save();
  for (let index = 0; index < count; index += 1) {
    const phase = calmVisual ? 0.4 : (cycle + index / count) % 1;
    context.globalAlpha = calmVisual ? 0.78 : Math.sin(phase * Math.PI);
    petArtDrawPixelZ(context, offX + 48 + index * 9, offY - 7 - phase * 12 - index * 3, 1, color);
  }
  context.restore();
  return count;
}

function petArtApplyBodyPose(context, poseBody, size, translate) {
  if (!poseBody) return;
  const translateBy = typeof translate === 'function'
    ? translate
    : (x, y) => context.translate(x, y);
  const hasOffset = poseBody.x !== 0 || poseBody.y !== 0;
  const hasRotate = poseBody.rotateDeg !== 0;
  const hasScale = poseBody.scaleX !== 1 || poseBody.scaleY !== 1;
  if (!hasOffset && !hasRotate && !hasScale) return;
  if (hasOffset) translateBy(poseBody.x, poseBody.y);
  if (hasRotate || hasScale) {
    const center = size / 2;
    translateBy(center, center);
    if (hasRotate) context.rotate(poseBody.rotateDeg * Math.PI / 180);
    if (hasScale) context.scale(poseBody.scaleX, poseBody.scaleY);
    translateBy(-center, -center);
  }
}

function petArtDrawBackDetails(context, palette) {
  // Back volume is in the authored body grid. No extra spinal stripe, block,
  // ring or false front-facing details are painted over the clean back view.
  return Boolean(context && palette);
}

return Object.freeze({
  MONSTER_GRID: petArtMonsterGrid,
  BODY_VARIANTS: petArtBodyGrids,
  PALETTES: petArtPalettes,
  bodySpriteKey: petArtBodySpriteKey,
  paintBodySprite: petArtPaintBodySprite,
  drawLiveFace: petArtDrawLiveFace,
  paintFaceSprite: petArtPaintFaceSprite,
  drawPixelZ: petArtDrawPixelZ,
  drawExpressionAccent: petArtDrawExpressionAccent,
  applyBodyPose: petArtApplyBodyPose,
  drawBackDetails: petArtDrawBackDetails
});

})();

export default petArtApi;
export const MONSTER_GRID = petArtApi.MONSTER_GRID;
export const BODY_VARIANTS = petArtApi.BODY_VARIANTS;
export const PALETTES = petArtApi.PALETTES;
export const bodySpriteKey = petArtApi.bodySpriteKey;
export const paintBodySprite = petArtApi.paintBodySprite;
export const drawLiveFace = petArtApi.drawLiveFace;
export const paintFaceSprite = petArtApi.paintFaceSprite;
export const drawPixelZ = petArtApi.drawPixelZ;
export const drawExpressionAccent = petArtApi.drawExpressionAccent;
export const applyBodyPose = petArtApi.applyBodyPose;
export const drawBackDetails = petArtApi.drawBackDetails;
