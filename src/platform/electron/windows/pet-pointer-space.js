'use strict';
// ARCHITECTURE「V2 动画研究底座」: read-only capability, not an input or cursor sampler.
// Chromium's exact Windows event-owned DIP route is deliberately single-display only.
const RUNTIME = Object.freeze({ platform: 'win32', electron: '44.10.1', chromium: '152.0.7977.169' });
function createPetPointerSpace({ screen, platform = process.platform, versions = process.versions }) {
  let revision = 0, previous = null;
  return () => {
    let value, identity = null;
    try {
      const runtime = { platform, electron: versions.electron, chromium: versions.chrome };
      if (Object.keys(RUNTIME).some(key => runtime[key] !== RUNTIME[key])) value = { kind: 'client', reason: 'runtime-unverified' };
      else {
        const displays = screen.getAllDisplays();
        if (!Array.isArray(displays) || displays.length !== 1) value = { kind: 'client', reason: 'display-topology-unverified' };
        else {
          const display = displays[0], b = display.bounds;
          if (!b || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(b[key]) && Math.abs(b[key]) <= 100000)
              || b.width <= 0 || b.height <= 0 || !Number.isFinite(display.scaleFactor)
              || display.scaleFactor < .5 || display.scaleFactor > 4 || !Number.isSafeInteger(display.id)
              || ![0, 90, 180, 270].includes(display.rotation)) throw new Error('invalid display');
          identity = [display.id, display.rotation];
          value = { kind: 'event-screen-dip', runtime, bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, scaleFactor: display.scaleFactor };
        }
      }
    } catch { value = { kind: 'client', reason: 'display-context-unavailable' }; }
    const key = JSON.stringify([identity, value]);
    if (key !== previous) { revision++; previous = key; }
    return { schemaVersion: 1, revision, ...value };
  };
}
module.exports = { createPetPointerSpace };
