'use strict';

// Window geometry for the desk pet while its menu, feeding panel or dev
// tools are open. The transparent pet window is small at rest (it swallows
// desktop clicks) and grows while a panel is open.
//
// It used to grow symmetrically around the pet and was never clamped: with
// the pet in its default bottom-right spot, half of the 520×360 window — and
// the menu items in it — landed off screen. The expanded window is now kept
// inside the display's work area, and the shift that clamping introduces is
// returned as `stageOffset` so the renderer moves its stage the other way:
// the pet stays exactly where it was on screen. The panel side is the one
// with more room on the display, not in the window.
//
// Closing restores the exact bounds the window had before it opened, so a
// round trip never drifts the pet by a rounding pixel.

function clamp(value, low, high) {
  return high < low ? low : Math.max(low, Math.min(high, value));
}

function validRect(rect) {
  return rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]));
}

function planOpen({ bounds, size, workArea }) {
  size = { w: Math.min(size.w, workArea.width), h: Math.min(size.h, workArea.height) };
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const desiredX = Math.round(cx - size.w / 2);
  const desiredY = Math.round(cy - size.h / 2);
  const x = clamp(desiredX, workArea.x, workArea.x + workArea.width - size.w);
  const y = clamp(desiredY, workArea.y, workArea.y + workArea.height - size.h);
  const roomRight = workArea.x + workArea.width - cx;
  const roomLeft = cx - workArea.x;
  return Object.freeze({
    bounds: Object.freeze({ x, y, width: size.w, height: size.h }),
    stageOffset: Object.freeze({ x: cx - x - size.w / 2, y: cy - y - size.h / 2 }),
    side: roomRight >= roomLeft ? 'right' : 'left'
  });
}

function planClose({ bounds, size, restore }) {
  if (validRect(restore) && restore.width === size.w && restore.height === size.h) {
    return Object.freeze({ bounds: Object.freeze({ ...restore }), stageOffset: Object.freeze({ x: 0, y: 0 }), side: 'right' });
  }
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return Object.freeze({
    bounds: Object.freeze({ x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2), width: size.w, height: size.h }),
    stageOffset: Object.freeze({ x: 0, y: 0 }),
    side: 'right'
  });
}

function createPetMenuExpansion({ petSize, menuSize } = {}) {
  if (!petSize || !menuSize) throw new TypeError('pet and menu sizes are required');
  let restore = null;
  let current = null;

  // `workAreaAt(point)` returns the work area of the display nearest a point.
  function plan({ bounds, open, workAreaAt }) {
    if (!validRect(bounds) || typeof workAreaAt !== 'function') {
      throw new TypeError('window bounds and a work area lookup are required');
    }
    const size = open ? menuSize : petSize;
    const expected = open && current ? { w: current.bounds.width, h: current.bounds.height } : size;
    const atSize = bounds.width === expected.w && bounds.height === expected.h;
    if (atSize && (open ? current : !current)) {
      return Object.freeze({ changed: false, bounds, geometry: geometryOf(current, bounds) });
    }
    let next;
    if (open) {
      restore = atSize ? null : { ...bounds };
      const center = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
      next = planOpen({ bounds, size, workArea: workAreaAt(center) });
      current = next;
    } else {
      next = planClose({ bounds, size, restore });
      restore = null;
      current = null;
    }
    const changed = ['x', 'y', 'width', 'height'].some(key => next.bounds[key] !== bounds[key]);
    return Object.freeze({ changed, bounds: next.bounds, geometry: geometryOf(current, next.bounds) });
  }

  return Object.freeze({ plan });
}

function geometryOf(planned, bounds) {
  return Object.freeze({
    side: planned ? planned.side : 'right',
    width: bounds.width,
    height: bounds.height,
    stageOffset: planned ? planned.stageOffset : Object.freeze({ x: 0, y: 0 })
  });
}

module.exports = { createPetMenuExpansion, planOpen, planClose };
