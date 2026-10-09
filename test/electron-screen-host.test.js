'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenHost } = require('../src/platform/electron');

function createScreenHarness() {
  const primary = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 24, width: 1440, height: 876 },
    internal: 'must-not-escape'
  };
  const secondary = {
    id: 2,
    bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: -1920, y: 0, width: 1920, height: 1040 }
  };
  const calls = [];
  const screen = {
    getPrimaryDisplay: () => primary,
    getDisplayNearestPoint: point => {
      calls.push({ ...point });
      return point.x < 0 ? secondary : primary;
    },
    getCursorScreenPoint: () => ({ x: -80, y: 320, native: true })
  };
  return { calls, primary, screen };
}

test('screen host returns immutable geometry without leaking Electron display objects', () => {
  const harness = createScreenHarness();
  const host = createScreenHost({ screen: harness.screen });
  const display = host.primaryDisplay();

  assert.deepEqual(display, {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 24, width: 1440, height: 876 }
  });
  assert.equal(Object.isFrozen(display), true);
  assert.equal(Object.isFrozen(display.bounds), true);
  assert.equal(Object.isFrozen(display.workArea), true);
  assert.equal(Object.prototype.hasOwnProperty.call(display, 'internal'), false);

  harness.primary.workArea.height = 700;
  assert.equal(display.workArea.height, 876);
});

test('nearest-display and cursor queries copy their bounded inputs and outputs', () => {
  const harness = createScreenHarness();
  const host = createScreenHost({ screen: harness.screen });

  assert.deepEqual(host.cursorPoint(), { x: -80, y: 320 });
  assert.deepEqual(host.nearestDisplay({ x: -20, y: 10 }).id, 2);
  assert.deepEqual(harness.calls, [{ x: -20, y: 10 }]);
  assert.throws(() => host.nearestDisplay({ x: Number.NaN, y: 0 }), /finite x and y/);
});

test('screen host rejects an incomplete Electron screen implementation', () => {
  assert.throws(() => createScreenHost({ screen: {} }), /display and pointer queries/);
});

test('screen acquisition is deferred until a query after Electron readiness', () => {
  const harness = createScreenHarness();
  let ready = false;
  let acquisitions = 0;
  const host = createScreenHost({ loadScreen: () => {
    acquisitions += 1;
    if (!ready) throw new Error('screen unavailable before ready');
    return harness.screen;
  } });
  assert.equal(acquisitions, 0);
  assert.throws(() => host.primaryDisplay(), /before ready/);
  ready = true;
  assert.equal(host.primaryDisplay().id, 1);
  assert.equal(host.nearestDisplay({ x: -1, y: 0 }).id, 2);
  assert.equal(acquisitions, 2);
});
