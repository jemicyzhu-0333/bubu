'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PET_VISUAL_SIZE,
  petVisibleRect,
  petEdgeDistances,
  resolvePetDockEdge,
  clampPetWindowPosition
} = require('../src/core/pet-docking');
const { PET_HIT_CSS_SIZE } = require('../src/core/pet-stage.mjs');

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

// 吸附按可见矩形算，点击按命中框算，两者一旦分叉就会出现“贴边正常、点却点不到”。
// 所以这里比的是两个模块给出的值，而不是各自复述一遍 105。
test('the visible pet size is the pet-stage hit box instead of a second copy of it', () => {
  assert.deepEqual(PET_VISUAL_SIZE, { width: PET_HIT_CSS_SIZE, height: PET_HIT_CSS_SIZE });
  assert.throws(() => petVisibleRect({ x: 0, y: 0, width: 220, height: 220 }), /visualSize/);
});

test('docking measures the centered visible pet instead of the transparent window', () => {
  const visible = petVisibleRect({ x: -90, y: 300, width: 220, height: 220 }, PET_VISUAL_SIZE);
  assert.deepEqual(visible, { x: -32.5, y: 357.5, width: 105, height: 105 });
  assert.deepEqual(petEdgeDistances(visible, workArea), {
    left: -32.5,
    right: 1367.5,
    top: 332.5,
    bottom: 437.5
  });
  assert.equal(resolvePetDockEdge({ visibleRect: visible, workArea }), 'left');
});

test('docking uses hysteresis and releases only after the pet clearly leaves the edge', () => {
  const nearLeft = { x: 10, y: 300, width: 105, height: 105 };
  const hysteresisBand = { x: 55, y: 300, width: 105, height: 105 };
  const released = { x: 73, y: 300, width: 105, height: 105 };
  assert.equal(resolvePetDockEdge({ visibleRect: nearLeft, workArea }), 'left');
  assert.equal(resolvePetDockEdge({ visibleRect: hysteresisBand, workArea }), null);
  assert.equal(resolvePetDockEdge({ visibleRect: hysteresisBand, workArea, currentEdge: 'left' }), 'left');
  assert.equal(resolvePetDockEdge({ visibleRect: released, workArea, currentEdge: 'left' }), null);
});

test('docking handles offset displays and deterministic corner ties', () => {
  const secondary = { x: -1920, y: -40, width: 1920, height: 1080 };
  assert.equal(resolvePetDockEdge({
    visibleRect: { x: -1925, y: -45, width: 105, height: 105 },
    workArea: secondary
  }), 'left');
  assert.equal(resolvePetDockEdge({
    visibleRect: { x: -1815, y: -45, width: 105, height: 105 },
    workArea: secondary,
    currentEdge: 'top'
  }), 'top');
});

test('docking rejects invalid geometry and threshold ordering', () => {
  assert.throws(() => petVisibleRect({ x: 0, y: 0, width: 0, height: 220 }), /positive/);
  assert.throws(() => resolvePetDockEdge({
    visibleRect: { x: 0, y: 0, width: 105, height: 105 },
    workArea,
    enterThreshold: 80,
    leaveThreshold: 20
  }), /leaveThreshold/);
});

test('non-centered long ears follow their visual center during docking and drag clamping', () => {
  const bounds = { x: 0, y: 0, width: 220, height: 220 };
  const ears = { width: 105, height: 144, offsetX: 0, offsetY: -17.5 };
  const area = { x: 10, y: 30, width: 500, height: 300 };
  assert.deepEqual(petVisibleRect(bounds, ears), { x: 57.5, y: 20.5, width: 105, height: 144 });
  const top = clampPetWindowPosition({ target: { x: 160, y: -999 }, windowBounds: bounds, visualSize: ears, workArea: area });
  const bottom = clampPetWindowPosition({ target: { x: 160, y: 999 }, windowBounds: bounds, visualSize: ears, workArea: area });
  assert.ok(Math.abs(petVisibleRect({ ...bounds, ...top }, ears).y + ears.height / 2 - (area.y + 20)) <= 0.5);
  assert.ok(Math.abs(petVisibleRect({ ...bounds, ...bottom }, ears).y + ears.height / 2
    - (area.y + area.height - 20)) <= 0.5);
  assert.equal(resolvePetDockEdge({ visibleRect: petVisibleRect({ ...bounds, ...top }, ears), workArea: area }), 'top');
  assert.throws(() => petVisibleRect(bounds, { ...ears, offsetY: Number.NaN }), /offset/);
});
