'use strict';
import { easing, clamp01, quadPoint } from './easing.mjs';
// Data-driven keyframe track. keys: [{ at, value, ease?, via? }], sorted by
// `at`. `ease` and `via` (quadratic control point) describe the segment that
// ENDS at that key. Before the first / after the last key the value holds.
function createTrack(keys) {
  if (!Array.isArray(keys) || !keys.length) throw new TypeError('track needs keys');
  const list = keys.map(key => Object.freeze({ at: key.at, value: key.value, curve: easing(key.ease), via: key.via || null }));
  for (let i = 1; i < list.length; i++) if (!(list[i].at >= list[i - 1].at)) throw new RangeError('track keys must be sorted');
  const scalar = !Array.isArray(list[0].value), width = scalar ? 1 : list[0].value.length;
  const scratch = [0, 0];
  function sample(progress, out = scalar ? undefined : new Array(width)) {
    const p = Number.isFinite(progress) ? progress : 0;
    let i = 1; while (i < list.length && p >= list[i].at) i++;
    if (i >= list.length || p <= list[0].at) {
      const v = (p <= list[0].at ? list[0] : list[list.length - 1]).value;
      if (scalar) return v; for (let n = 0; n < width; n++) out[n] = v[n]; return out;
    }
    const a = list[i - 1], b = list[i], k = b.curve(clamp01((p - a.at) / (b.at - a.at || 1)));
    if (scalar) return a.value + (b.value - a.value) * k;
    if (b.via && width === 2) { quadPoint(a.value, b.via, b.value, k, scratch); out[0] = scratch[0]; out[1] = scratch[1]; return out; }
    for (let n = 0; n < width; n++) out[n] = a.value[n] + (b.value[n] - a.value[n]) * k;
    return out;
  }
  return Object.freeze({ sample, keys: Object.freeze(list) });
}
export { createTrack };
