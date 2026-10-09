'use strict';
const { petVisibleRect, clampPetWindowPosition } = require('../../core/pet-docking');

// Both samples come from Electron screen.getCursorScreenPoint (DIP). Chromium
// screenX is not a portable global coordinate on Windows mixed-DPI desktops.
function createPetDragSession({ cursorPoint }) {
  let origin = null;
  function target(fallback) {
    if (!origin) return fallback;
    const pointer = cursorPoint();
    return {
      x: origin.bounds.x + pointer.x - origin.pointer.x,
      y: origin.bounds.y + pointer.y - origin.pointer.y
    };
  }
  return Object.freeze({
    begin(bounds) {
      origin = { bounds: { ...bounds }, pointer: cursorPoint() };
    },
    target,
    position({ bounds, requested, visualSize, workAreaAt }) {
      // A null axis means keep the current coordinate, never replay a stale y
      // from an autonomous horizontal walk while the user is dragging.
      const desired = target({ x: requested.x ?? bounds.x, y: requested.y ?? bounds.y });
      const visual = petVisibleRect({ ...bounds, ...desired }, visualSize);
      const workArea = workAreaAt({ x: Math.round(visual.x + visual.width / 2), y: Math.round(visual.y + visual.height / 2) });
      return clampPetWindowPosition({ target: desired, windowBounds: bounds, visualSize, workArea });
    },
    end() { origin = null; }
  });
}

module.exports = { createPetDragSession };
