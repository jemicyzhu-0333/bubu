/** Exact source-vertex witnesses for the declared private attachments.
 * Nonmatching attachments and finite patches are deliberately not certified.
 */
export function createRenderPinMeasure(coarse, pins, source) {
  if (source.length % 3 || !source.every(Number.isFinite)) throw Error('Invalid pin source');
  const witnesses = [];
  for (const pin of pins) {
    if (!Number.isInteger(pin) || pin < 0 || pin * 3 + 2 >= coarse.positions.length) throw Error('Invalid support');
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < source.length / 3; i++) {
      const gap = Math.hypot(...[0, 1, 2].map(k => source[i * 3 + k] - coarse.positions[pin * 3 + k]));
      if (gap < distance) { distance = gap; nearest = i; }
    }
    if (distance <= 1e-6) witnesses.push(Object.freeze({pin, vertex:nearest, sourceGap:distance,
      position:Object.freeze(Array.from(source.slice(nearest * 3, nearest * 3 + 3)))}));
  }
  if (!witnesses.length) throw Error('No matching rendered support witnesses');
  return Object.freeze({witnesses:Object.freeze(witnesses), unmatched:pins.length - witnesses.length,
    measure(positions) {
      if (positions.length !== source.length || !positions.every(Number.isFinite)) throw Error('Invalid pin output');
      return Math.max(...witnesses.map(w => Math.hypot(...w.position.map((p, k) => positions[w.vertex * 3 + k] - p))));
    },
  });
}
