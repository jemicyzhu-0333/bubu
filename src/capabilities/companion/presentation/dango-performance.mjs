'use strict';
import { sampleGroundedMoonwalk } from './grounded-moonwalk.mjs';
import { PART_GRIDS, BODY_ANCHORS, BODY_VERSION } from '../../../content/companion/dango-body.mjs';
import { sampleFaceChoreography } from './face-choreography.mjs';
const TAU = Math.PI * 2;
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

function footMatrix(anchor, pose) {
  const c = Math.cos(pose.r), s = Math.sin(pose.r);
  return Object.freeze([c, s, -s, c,
    anchor.x + pose.x - c * anchor.x + s * anchor.y,
    anchor.y + pose.y - s * anchor.x - c * anchor.y]);
}
function sampleFeet(motion, progress, view, calmVisual, authoredAnchors = null) {
  const anchors = authoredAnchors || BODY_ANCHORS[view] || BODY_ANCHORS.front;
  const p = Number.isFinite(progress) ? progress : 0;
  const rate = { walk: 1, dash: 6, glide: 2, moonwalk: 3, dance: 2, sway: 1, hop: 2, umbrella: 2, wag: 3 }[motion] || 0;
  const feet = {};
  if (motion === 'moonwalk') {
    const pose = sampleGroundedMoonwalk(p, calmVisual);
    return Object.freeze(Object.fromEntries(['foot-left', 'foot-right'].map((id, i) =>
      [id, calmVisual ? IDENTITY : footMatrix(anchors[id], pose.feet[i])])));
  }
  for (const [index, side] of ['foot-left', 'foot-right'].entries()) {
    let x = 0, y = 0, r = 0;
    if (!calmVisual && rate) {
      const phase = p * TAU * rate + index * Math.PI;
      const step = Math.sin(phase);
      const lift = Math.max(0, step);
      if (['walk', 'dash', 'moonwalk', 'glide'].includes(motion)) {
        x = step * (motion === 'dash' ? 2.3 : 1.7) * (motion === 'moonwalk' ? -1 : 1);
        y = -lift * (motion === 'dash' ? 2.6 : 1.7);
        r = step * (motion === 'moonwalk' ? -.16 : .12);
      } else if (motion === 'hop') {
        y = -(Math.sin(p * TAU * rate) ** 2) * 1.4;
        r = Math.sin(p * TAU * rate) * (index ? -.08 : .08);
      } else {
        y = -lift * .8; r = step * .08;
      }
    }
    feet[side] = calmVisual ? IDENTITY : footMatrix(anchors[side], { x, y, r });
  }
  return Object.freeze(feet);
}

function resolveDangoPerformance({ view = 'front', motion = 'idle', action, progress = 0, elapsedMs = 0,
  calmVisual = false, state, face, expressionId, expressionElapsedMs } = {}) {
  const stepping = !action && state === 'walking';
  const feet = sampleFeet(stepping ? 'walk' : motion,
    stepping ? (elapsedMs % 760) / 760 : progress, view, calmVisual || state === 'dragged');
  return Object.freeze({ kind: 'pixel-performance', key: `dango-parts@${BODY_VERSION}`, view,
    face: sampleFaceChoreography(face, { action, motion, progress, elapsedMs, calmVisual, expressionId, expressionElapsedMs }),
    footwearTransforms: feet, footGlints: action?.prop === 'sparkle-shoes',
    glintOpacity: calmVisual ? .75 : .65 + .35 * Math.sin(progress * TAU * 3) ** 2 });
}

function paintGrid(context, grid, palette, cell) {
  for (let y = 0; y < grid.length; y += 1) {
    let x = 0;
    while (x < grid[y].length) {
      const glyph = grid[y][x], start = x;
      while (x < grid[y].length && grid[y][x] === glyph) x += 1;
      const color = palette[Number(glyph)];
      if (glyph !== '.' && color) {
        context.fillStyle = color; context.fillRect(start * cell, y * cell, (x - start) * cell, cell);
      }
    }
  }
}
function paintPart(surface, grid, palette, stage) {
  const context = surface.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, stage.bodySize, stage.bodySize);
  paintGrid(context, grid, palette, stage.cell);
}
function paintTorsoSprite(surface, palette, stage, view) {
  paintPart(surface, (PART_GRIDS[view] || PART_GRIDS.front).torso, palette, stage);
}
function drawFeet(context, { artwork, palette, stage, offX, offY, layer, sprites }) {
  if (artwork?.kind !== 'pixel-performance') return false;
  if (layer === 'front') return drawFootGlints(context, { artwork, offX, offY });
  if (layer !== 'back') return false;
  const parts = PART_GRIDS[artwork.view] || PART_GRIDS.front;
  context.save(); context.translate(offX, offY);
  for (const side of ['foot-left', 'foot-right']) {
    const matrix = artwork.footwearTransforms[side];
    context.save(); context.transform(...matrix);
    if (sprites) {
      const key = `${artwork.key}|${artwork.view}|${side}|${palette[1]}|${palette[2]}|${palette[3]}`;
      const size = Math.ceil(stage.bodySize * stage.deviceScale);
      const sprite = sprites.acquire(key, { width: size, height: size,
        paint: surface => paintPart(surface, parts[side], palette, stage) });
      context.drawImage(sprite, 0, 0, stage.bodySize, stage.bodySize);
    } else paintGrid(context, parts[side], palette, stage.cell);
    context.restore();
  }
  context.restore(); return true;
}

// A glint decorates the authored foot/boot. It never supplies another shoe
// silhouette, and follows the exact same per-foot matrix as the wardrobe.
function drawFootGlints(context, { artwork, offX, offY }) {
  if (!artwork.footGlints) return false;
  const anchors = BODY_ANCHORS[artwork.view] || BODY_ANCHORS.front;
  context.save(); context.translate(offX, offY);
  context.globalAlpha *= artwork.glintOpacity;
  context.fillStyle = '#fff4c2';
  for (const side of ['foot-left', 'foot-right']) {
    const { x, y } = anchors[side];
    context.save(); context.transform(...artwork.footwearTransforms[side]);
    context.fillRect(x - 2, y + 3, 4, 2);
    context.fillRect(x - 1, y + 2, 2, 4);
    context.restore();
  }
  context.restore(); return true;
}
export { resolveDangoPerformance, sampleFeet, footMatrix, paintTorsoSprite, drawFeet };
