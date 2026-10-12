'use strict';
// Per-frame memoization: body, contact and art all sample the same story at
// the same instant. A tiny keyed ring returns the identical result object for
// repeated calls, so a frame computes each sampler once and allocates nothing
// on cache hits. Keys must be primitives (numbers, strings, booleans, null).
function memoFrame(fn, { size = 4, key = (...args) => args } = {}) {
  const keys = new Array(size).fill(null), values = new Array(size).fill(null);
  let next = 0, hits = 0, misses = 0;
  function same(a, b) { if (!a || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true; }
  function memoized(...args) {
    const k = key(...args);
    for (let i = 0; i < size; i++) if (same(keys[i], k)) { hits++; return values[i]; }
    misses++;
    const value = fn(...args);
    keys[next] = k; values[next] = value; next = (next + 1) % size;
    return value;
  }
  memoized.stats = () => ({ hits, misses });
  memoized.clear = () => { keys.fill(null); values.fill(null); hits = 0; misses = 0; };
  return memoized;
}
export { memoFrame };
