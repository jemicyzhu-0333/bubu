'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { placePopover, clampPopoverHeight } = require('../src/core/window-placement');

test('popover height is clamped to the current display work area', () => {
  assert.equal(clampPopoverHeight({ height: 900 }), 680);
  assert.equal(clampPopoverHeight({ height: 700 }), 680);
  assert.equal(clampPopoverHeight({ height: 300 }), 284);
});

test('popover placement remains inside a short secondary display with negative coordinates', () => {
  const workArea = { x: -1280, y: -850, width: 1280, height: 700 };
  const height = clampPopoverHeight(workArea);
  const result = placePopover({
    trayBounds: { x: -700, y: -850, width: 24, height: 24 },
    popoverBounds: { x: 0, y: 0, width: 440, height },
    displayBounds: { x: -1280, y: -900, width: 1280, height: 750 },
    workArea
  });
  assert.ok(result.x >= workArea.x + 8);
  assert.ok(result.x + 440 <= workArea.x + workArea.width - 8);
  assert.ok(result.y >= workArea.y + 8);
  assert.ok(result.y + height <= workArea.y + workArea.height - 8);
});
