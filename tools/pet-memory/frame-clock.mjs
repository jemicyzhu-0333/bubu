// rAF timestamps share a browser-frame time, which may precede performance.now()
// during setup. Never mix that setup instant into the animation clock.
export function createFrameClock() {
  let origin = null, previous = null;
  return Object.freeze({
    tick(timestamp) {
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('rAF timestamp must be finite and nonnegative');
      if (previous !== null && timestamp < previous) throw new RangeError('rAF timestamp moved backward');
      const first = origin === null;
      if (first) origin = timestamp;
      const result = { first, origin, elapsedMs: timestamp - origin,
        deltaMs: previous === null ? 0 : timestamp - previous };
      previous = timestamp;
      return result;
    }
  });
}
