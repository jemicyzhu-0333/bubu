'use strict';

function copyPoint(point, label = 'point') {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must contain finite x and y coordinates`);
  }
  return Object.freeze({ x: point.x, y: point.y });
}

function copyRectangle(rectangle, label) {
  if (!rectangle
      || !Number.isFinite(rectangle.x)
      || !Number.isFinite(rectangle.y)
      || !Number.isFinite(rectangle.width)
      || !Number.isFinite(rectangle.height)) {
    throw new TypeError(`${label} must contain finite geometry`);
  }
  return Object.freeze({
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height
  });
}

function snapshotDisplay(display) {
  if (!display || !Object.prototype.hasOwnProperty.call(display, 'id')) {
    throw new TypeError('display must expose an id');
  }
  return Object.freeze({
    id: display.id,
    bounds: copyRectangle(display.bounds, 'display bounds'),
    workArea: copyRectangle(display.workArea, 'display work area')
  });
}

function validateScreen(screen) {
  if (!screen
      || typeof screen.getPrimaryDisplay !== 'function'
      || typeof screen.getDisplayNearestPoint !== 'function'
      || typeof screen.getCursorScreenPoint !== 'function') {
    throw new TypeError('screen must expose display and pointer queries');
  }
  return screen;
}

function createScreenHost({ screen, loadScreen = () => require('electron').screen } = {}) {
  if (typeof loadScreen !== 'function') throw new TypeError('screen loader must be a function');
  let activeScreen = screen === undefined ? null : validateScreen(screen);

  function nativeScreen() {
    if (!activeScreen) activeScreen = validateScreen(loadScreen());
    return activeScreen;
  }

  return Object.freeze({
    primaryDisplay: () => snapshotDisplay(nativeScreen().getPrimaryDisplay()),
    nearestDisplay: point => snapshotDisplay(nativeScreen().getDisplayNearestPoint(copyPoint(point))),
    cursorPoint: () => copyPoint(nativeScreen().getCursorScreenPoint(), 'cursor point')
  });
}

module.exports = { createScreenHost };
