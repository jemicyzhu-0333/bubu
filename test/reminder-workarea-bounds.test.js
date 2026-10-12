'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cornerLayout, convergencePositions } = require('../src/platform/electron/windows/nudge-window');

function inside(bounds, point, area) {
  assert.ok(point.x >= area.x && point.y >= area.y);
  assert.ok(point.x + bounds.width <= area.x + area.width);
  assert.ok(point.y + bounds.height <= area.y + area.height);
}
test('initial corners and L3 convergence fit small and negative-coordinate work areas', () => {
  for (const width of [1, 40, 120, 320, 1920]) for (const height of [1, 40, 120, 240, 1080]) {
    const workArea = { x: -1920, y: -200, width, height };
    for (const level of [2, 3]) {
      const layout = cornerLayout({ workArea, level });
      assert.ok(layout.width >= 1 && layout.height >= 1);
      for (const point of layout.positions) inside(layout, point, workArea);
      for (const point of convergencePositions({ workArea, ...layout, count: 4 })) inside(layout, point, workArea);
    }
  }
});
test('corner layout keeps level and low-stimulation delivery counts unchanged', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 800 };
  assert.equal(cornerLayout({ workArea, level: 2 }).positions.length, 1);
  assert.equal(cornerLayout({ workArea, level: 3 }).positions.length, 4);
  assert.equal(cornerLayout({ workArea, level: 3, lowStimulation: true }).positions.length, 1);
});
