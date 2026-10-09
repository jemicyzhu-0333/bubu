'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { placePopover, clampPopoverWidth } = require('../src/core/window-placement');

test('a wider timeline popover fits the current display without clipping narrow screens', () => {
  assert.equal(clampPopoverWidth({ width: 1440 }), 560);
  assert.equal(clampPopoverWidth({ width: 520 }), 504);
  assert.equal(clampPopoverWidth({ width: 360 }), 344);
  const workArea = { x: -1024, y: 24, width: 720, height: 780 };
  const width = clampPopoverWidth(workArea);
  const position = placePopover({
    trayBounds: { x: -1010, y: 0, width: 24, height: 24 },
    popoverBounds: { x: 0, y: 0, width, height: 720 },
    displayBounds: { x: -1024, y: 0, width: 720, height: 800 }, workArea
  });
  assert.ok(position.x >= workArea.x + 8);
  assert.ok(position.x + width <= workArea.x + workArea.width - 8);
});

test('opens below a top menu bar and keeps the popover inside the work area', () => {
  const result = placePopover({
    trayBounds: { x: 1400, y: 0, width: 24, height: 24 },
    popoverBounds: { x: 0, y: 0, width: 440, height: 760 },
    displayBounds: { x: 0, y: 0, width: 1512, height: 982 },
    workArea: { x: 0, y: 24, width: 1512, height: 958 }
  });
  assert.equal(result.direction, 'below');
  assert.equal(result.y, 32);
  assert.equal(result.x, 1064);
});

test('opens above a bottom tray', () => {
  const result = placePopover({
    trayBounds: { x: 500, y: 1056, width: 28, height: 24 },
    popoverBounds: { x: 0, y: 0, width: 440, height: 760 },
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1056 }
  });
  assert.equal(result.direction, 'above');
  assert.equal(result.y, 288);
});

test('supports secondary displays with negative coordinates', () => {
  const result = placePopover({
    trayBounds: { x: -1200, y: 0, width: 24, height: 24 },
    popoverBounds: { x: 0, y: 0, width: 440, height: 760 },
    displayBounds: { x: -1440, y: 0, width: 1440, height: 900 },
    workArea: { x: -1440, y: 24, width: 1440, height: 876 }
  });
  assert.equal(result.direction, 'below');
  assert.ok(result.x >= -1432);
  assert.ok(result.x + 440 <= -8);
});
