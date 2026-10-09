'use strict';

const { PET_HIT_CSS_SIZE } = require('./pet-stage.mjs');

const bubuDockEdges = Object.freeze(['left', 'right', 'top', 'bottom']);

// 桌宠在屏幕上的可见尺寸。窗口比它大得多（透明画布要留出四肢与动作的余量），
// 所以吸附、注视、点击都得用这个矩形而不是窗口矩形。它与命中框必须同宽 ——
// 否则会出现“贴边贴的是画布、点击却落在别处”，因此尺寸只有 pet-stage 一个所有者。
const PET_VISUAL_SIZE = Object.freeze({ width: PET_HIT_CSS_SIZE, height: PET_HIT_CSS_SIZE });

function bubuFiniteRect(rect, name) {
  if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) {
    throw new TypeError(`${name} must be a finite rectangle`);
  }
  if (rect.width <= 0 || rect.height <= 0) throw new RangeError(`${name} must have positive dimensions`);
  return rect;
}

function petVisibleRect(windowBounds, visualSize) {
  const bounds = bubuFiniteRect(windowBounds, 'windowBounds');
  const size = bubuFiniteRect({ x: 0, y: 0, ...visualSize }, 'visualSize');
  const offsetX = visualSize.offsetX === undefined ? 0 : visualSize.offsetX;
  const offsetY = visualSize.offsetY === undefined ? 0 : visualSize.offsetY;
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new TypeError('visualSize offset must be finite');
  }
  return {
    x: bounds.x + (bounds.width - size.width) / 2 + offsetX,
    y: bounds.y + (bounds.height - size.height) / 2 + offsetY,
    width: size.width,
    height: size.height
  };
}

// The transparent window is much wider than any form. Preserve the old rule
// (visual CENTER stays at least 20px on screen) but shift it for a tall form
// whose ear-inclusive hitbox is no longer centered inside the window.
function clampPetWindowPosition({ target, windowBounds, visualSize, workArea, centerInset = 20 } = {}) {
  const bounds = bubuFiniteRect(windowBounds, 'windowBounds');
  const area = bubuFiniteRect(workArea, 'workArea');
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new TypeError('target must contain finite coordinates');
  }
  if (!Number.isFinite(centerInset) || centerInset < 0) {
    throw new RangeError('centerInset must be non-negative');
  }
  const visible = petVisibleRect({ ...bounds, x: 0, y: 0 }, visualSize);
  const centerX = visible.x + visible.width / 2;
  const centerY = visible.y + visible.height / 2;
  const clamp = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)));
  const minX = area.x + centerInset - centerX;
  const maxX = area.x + area.width - centerInset - centerX;
  const minY = area.y + centerInset - centerY;
  const maxY = area.y + area.height - centerInset - centerY;
  if (minX > maxX || minY > maxY) throw new RangeError('workArea is too small for the visual center inset');
  return Object.freeze({ x: clamp(target.x, minX, maxX), y: clamp(target.y, minY, maxY) });
}

function petEdgeDistances(visibleRect, workArea) {
  const pet = bubuFiniteRect(visibleRect, 'visibleRect');
  const area = bubuFiniteRect(workArea, 'workArea');
  return {
    left: pet.x - area.x,
    right: area.x + area.width - (pet.x + pet.width),
    top: pet.y - area.y,
    bottom: area.y + area.height - (pet.y + pet.height)
  };
}

function nearestPetDockEdge(distances) {
  // Prefer side edges at exact corners. They preserve more usable height and
  // avoid the macOS menu bar / Dock while remaining deterministic.
  return bubuDockEdges.reduce((best, edge) => (
    distances[edge] < distances[best] ? edge : best
  ), bubuDockEdges[0]);
}

function resolvePetDockEdge({
  visibleRect,
  workArea,
  currentEdge = null,
  enterThreshold = 14,
  leaveThreshold = 72
}) {
  if (leaveThreshold <= enterThreshold) throw new RangeError('leaveThreshold must exceed enterThreshold');
  const distances = petEdgeDistances(visibleRect, workArea);
  if (bubuDockEdges.includes(currentEdge) && distances[currentEdge] <= leaveThreshold) {
    return currentEdge;
  }
  const nearest = nearestPetDockEdge(distances);
  return distances[nearest] <= enterThreshold ? nearest : null;
}

module.exports = {
  DOCK_EDGES: bubuDockEdges,
  PET_VISUAL_SIZE,
  petVisibleRect,
  clampPetWindowPosition,
  petEdgeDistances,
  resolvePetDockEdge
};
