'use strict';
// Frame-rate cap on top of requestAnimationFrame. The draw schedule keeps the
// remainder (next due = previous due + interval), so a 144 Hz display capped
// at 60 fps draws 60 fps on average instead of every third vsync (48 fps).
// A small epsilon absorbs vsync jitter; after a pause (hidden/locked) or a
// long stall the schedule re-anchors to now instead of bursting to catch up.
const EPSILON_MS = 2; // absorbs typical vsync jitter (±1.5ms)
function createFrameThrottle() {
  // Same start as the previous throttle (clock origin 0, first draw one
  // interval in); after reanchor() the next frame draws immediately.
  let due = null, last = 0, lastFps = null, resume = false;
  function shouldDraw(timestamp, fps) {
    const interval = 1000 / fps;
    if (resume) { resume = false; lastFps = fps; last = timestamp; due = timestamp + interval; return true; }
    if (due === null || fps !== lastFps) { lastFps = fps; due = last + interval; }
    if (timestamp + EPSILON_MS < due) return false;
    due += interval; last = timestamp;
    if (timestamp - due >= 0) due = timestamp + interval; // stalled: re-anchor, no catch-up burst
    return true;
  }
  return Object.freeze({ shouldDraw, reanchor: () => { resume = due !== null; } });
}
export { createFrameThrottle, EPSILON_MS };
