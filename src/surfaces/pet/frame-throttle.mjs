'use strict';
// Frame-rate cap on top of requestAnimationFrame. The draw schedule keeps the
// remainder (next due = previous due + interval), so a 144 Hz display capped
// at 60 fps draws 60 fps on average instead of every third vsync (48 fps).
// A small epsilon absorbs vsync jitter; after a pause (hidden/locked) or a
// long stall the schedule re-anchors to now instead of bursting to catch up.
const EPSILON_MS = 1;
function createFrameThrottle() {
  let due = null, lastFps = null;
  function shouldDraw(timestamp, fps) {
    const interval = 1000 / fps;
    if (due === null || fps !== lastFps) { lastFps = fps; due = timestamp + interval; return true; }
    if (timestamp + EPSILON_MS < due) return false;
    due += interval;
    if (timestamp - due >= interval) due = timestamp + interval; // stalled: re-anchor
    return true;
  }
  return Object.freeze({ shouldDraw, reanchor: () => { due = null; } });
}
export { createFrameThrottle, EPSILON_MS };
