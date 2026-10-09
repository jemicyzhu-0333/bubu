'use strict';

import { localMatrix, multiply } from './rig/pose.mjs';
import { pivotFor } from './dango-raster-pose.mjs';
import { paintRasterPaws } from './dango-raster-paws.mjs';
import { paintBrowseLid } from './dango-raster-browse.mjs';
import { paintMirrorRearProps } from './dango-raster-mirror.mjs';
import { withRasterGroundClip, paintRasterHole } from './dango-raster-ground.mjs';
const translation = (x, y) => [1, 0, 0, 1, x, y];

function toolMatrix(item, sprite) {
  let matrix = translation(item.x, item.y);
  if (item.scale) matrix = multiply(matrix, [item.scale, 0, 0, item.scale, 0, 0]);
  if (item.pivot) matrix = multiply(matrix, localMatrix(item.pivot, { r: item.rotate || 0 }));
  if (item.flip) matrix = multiply(matrix, [-1, 0, 0, 1, sprite.rect[2], 0]);
  return matrix;
}

function connectorMatrix(sprite, start, end) {
  const [rx, ry, width, height] = sprite.rect;
  const from = sprite.anchors?.start || [rx, ry + height / 2];
  const to = sprite.anchors?.end || [rx + width, ry + height / 2];
  const sourceLength = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (sourceLength < .01 || length < .01) return null;
  const rotation = angle => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
  let matrix = translation(...start);
  matrix = multiply(matrix, rotation(Math.atan2(end[1] - start[1], end[0] - start[0])));
  matrix = multiply(matrix, [length / sourceLength, 0, 0, 1, 0, 0]);
  matrix = multiply(matrix, rotation(-Math.atan2(to[1] - from[1], to[0] - from[0])));
  return multiply(matrix, translation(-from[0], -from[1]));
}

function paintConnector(context, sprite, points, palette, painter, attached = false) {
  if (!sprite || !points || points.length < 2) return false;
  if (!attached) {
    const matrix = connectorMatrix(sprite, points.at(-2), points.at(-1));
    return matrix ? painter.paint(context, sprite, palette, matrix) : false;
  }
  const root = points.at(-2), target = points.at(-1);
  const dx = target[0] - root[0], dy = target[1] - root[1];
  const distance = Math.hypot(dx, dy) || 1;
  const wrist = [target[0] - dx / distance * 3.1, target[1] - dy / distance * 3.1];
  const thick = { ...sprite, rect: [sprite.rect[0], -3, sprite.rect[2], 6], anchors: { start: [-1.5, 0], end: [3, 0] } };
  const matrix = connectorMatrix(thick, root, wrist);
  if (!matrix) return false;
  context.save(); context.transform(...matrix);
  context.beginPath(); context.rect(-1.5, -4, 5, 8); context.clip();
  const painted = painter.paint(context, thick, palette);
  context.restore(); return painted;
}

// Details are independent raster elements in the prop's sampled coordinates.
// They retain contact timing without redrawing old procedural equipment.
function paintDetail(context, detail, contact, manifest, palette, painter, calmVisual) {
  const sprite = manifest.effects?.[detail.type]; if (!sprite) return false;
  const [x, y] = detail.at, amount = Number.isFinite(detail.amount) ? detail.amount : 1;
  if (['flash', 'page', 'water', 'soil', 'star-glow', 'look-back'].includes(detail.type) && amount <= .01) return false;
  const pivot = pivotFor(sprite);
  const at = (px, py, scaleX = 1, scaleY = scaleX, opacity = 1, rotation = 0) => painter.paint(context, sprite, palette,
    multiply(translation(px - pivot[0], py - pivot[1]), localMatrix(pivot, { sx: scaleX, sy: scaleY, r: rotation })), opacity);
  switch (detail.type) {
    case 'water': {
      let painted = false;
      for (let i = 0; i < 5; i++) {
        const t = (i / 5 + (calmVisual ? 0 : contact.phase * 3)) % 1;
        painted = at(x + (detail.end[0] - x) * t, y + (detail.end[1] - y) * t + Math.sin(t * Math.PI) * 2,
          .65, .65, amount) || painted;
      }
      return painted;
    }
    case 'run-dust': case 'soil': {
      let painted = false;
      for (let i = 0; i < 3; i++) {
        const t = (i / 3 + (calmVisual ? .2 : detail.cycle ?? contact.phase * 5)) % 1;
        painted = at(x - t * (detail.type === 'run-dust' ? 17 : 9), y - 2 - Math.sin(t * Math.PI) * 4,
          .6 + t * .4, .6 + t * .4, (1 - t) * amount * .65) || painted;
      }
      return painted;
    }
    case 'steam': {
      if (calmVisual) return at(x, y, 1, 1, .62);
      let painted = false;
      for (const offset of [0, .5]) {
        const age = (contact.phase * 2 + offset) % 1;
        painted = at(x, y - age * 4, 1, 1, (1 - age) * .62) || painted;
      }
      return painted;
    }
    case 'page': return at(x - Math.sin(amount * Math.PI) * 4, y + 4,
      .5 + Math.sin(amount * Math.PI) * .5, 1, 1, -amount * .24);
    case 'thread': {
      if (!detail.end) return false;
      const matrix = connectorMatrix(sprite, detail.at, detail.end);
      return matrix ? painter.paint(context, sprite, palette, matrix) : false;
    }
    case 'scroll': return at(x + 8, y + 1 - (calmVisual ? 0 : Math.sin(contact.phase * Math.PI * 2) * 2));
    case 'ink': return at(x + amount * 6, y, .5 + amount * .5, 1);
    case 'keypress': return at(x, y + 3, 1, 1, amount > .3 ? amount * .7 : 0);
    case 'flash': return at(x, y, 1, 1, calmVisual ? 0 : amount);
    case 'reflection': return at(x + 5, y + 4);
    case 'headband': return painter.paint(context, sprite, palette, [2.3, 0, 0, 2.3, 33, 8.5]);
    case 'laser': {
      // A tracking target is a small luminous point, not the saved trail streak.
      context.save();
      for (const [radius, color] of [[3.1, 'rgba(255,75,103,.25)'], [1.9, '#ff4b67'], [.7, '#fff1ef']]) {
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = color; context.fill();
      }
      context.restore(); return true;
    }
    case 'look-back': return at(x, y, 1, 1, amount);
    default: return at(x, y, 1, 1, detail.type === 'plane-trail' ? amount * .6 : 1);
  }
}

function drawRasterActions(context, options, { manifest, painter }) {
  const { artwork, layer = 'front', palette, action } = options;
  if (!artwork?.layeredReady) return false;
  const { data, matrices } = artwork;
  let painted = false;
  const contact = artwork.actionReady ? artwork.contact : null;
  if (layer === 'back') painted = paintMirrorRearProps(context, artwork, action, palette, { manifest, painter, toolMatrix });
  const hole = contact?.details.find(detail => detail.type === 'hole');
  if (hole && layer === 'back' && manifest.effects?.hole) {
    painted = paintRasterHole(context, manifest.effects.hole, hole, palette, painter);
  }
  if (layer === 'back') for (const key of ['ear-left', 'ear-right', 'foot-left', 'foot-right']) {
    if (!artwork.hiddenParts?.includes(key)) painted = withRasterGroundClip(context, artwork,
      () => painter.paint(context, data.parts[key], palette, matrices[key])) || painted;
  }
  if (layer === 'back') for (const hand of contact?.hands || []) {
    if (!hand.integrated && hand.connector !== false && hand.attachedArm) {
      painted = withRasterGroundClip(context, artwork, () =>
        paintConnector(context, data.parts.arm, [hand.points[0], hand.points[1]], palette, painter, true)) || painted;
    }
  }
  if (layer === 'front') painted = paintRasterPaws(context, artwork, palette, { manifest, painter }, 'before-tools') || painted;
  const tools = contact?.tools.filter(item => !item.surface && !item.behindAnatomy && (item.layer || contact.layer) === layer) || [];
  for (const item of tools) {
    const sprite = manifest.tools?.[item.key]; if (!sprite) continue;
    const opacity = (item.opacity ?? 1) * (item.persistent ? 1 : action?.propOpacity ?? 1);
    painted = painter.paint(context, item.bodyColor ? { ...sprite, tint: 'body' } : sprite,
      palette, toolMatrix(item, sprite), opacity) || painted;
  }
  if (contact) for (const detail of contact.details) if (detail.type !== 'hole' && (detail.layer || 'front') === layer) {
    painted = paintDetail(context, detail, contact, manifest, palette, painter, artwork.calmVisual) || painted;
  }
  const covered = new Set(tools.map(item => item.coversPaw).filter(Boolean));
  for (const side of ['left', 'right']) {
    const pose = contact?.hands.find(hand => hand.side === side);
    // The approved standing silhouette has no side paws. Only an authored
    // contact/gesture reveals them; idle and neutral portraits stay exact.
    if (!pose || pose.pawSprite) continue;
    const integrated = pose.integrated && Boolean(data.rootJoins);
    const targetLayer = integrated ? 'back' : pose?.layer || (artwork.view === 'back' ? 'back' : 'front');
    if (targetLayer !== layer || covered.has(side)) continue;
    const matrix = !artwork.actionReady && artwork.contact ? null : matrices[`hand-${side}`];
    context.save(); context.globalAlpha *= pose?.opacity ?? 1;
    painted = withRasterGroundClip(context, artwork, () => {
      const connected = !integrated && pose.connector !== false && paintConnector(context, data.parts.arm, pose.points, palette, painter, pose.attachedArm);
      return painter.paint(context, data.parts[`hand-${side}`], palette, matrix) || connected;
    }) || painted;
    context.restore();
  }
  if (layer === 'front') painted = paintRasterPaws(context, artwork, palette, { manifest, painter }) || painted;
  if (layer === 'front') painted = paintBrowseLid(context, artwork, palette, { manifest, painter, toolMatrix }, action) || painted;
  if (hole && layer === 'front' && manifest.effects?.hole) {
    painted = paintRasterHole(context, manifest.effects.hole, hole, palette, painter, true) || painted;
  }
  return painted;
}

export { drawRasterActions, toolMatrix, paintDetail, connectorMatrix };
