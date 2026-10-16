export const SELECTED_FACE_IDS = Object.freeze(['01','04','05','07','08']);
export const LEGACY_FACE_TARGETS = Object.freeze(['Surprise','Content','BlinkEighth','BlinkQuarter','BlinkHalf','BlinkThreeQuarter','BlinkClosed']);
// The controller owns transition timing. It must route state changes through rest.
// Never add two selected states or combine these with legacy S/B/C targets.
export function selectedFaceWeights(logical = {}) {
  const active = [];
  for (const id of SELECTED_FACE_IDS) {
    const value = logical[id] ?? 0;
    if (!Number.isFinite(value) || value < -1e-8 || value > 1 + 1e-8) throw new RangeError(`Invalid ${id} intensity`);
    if (value > 1e-8) active.push([id, Math.max(0, Math.min(1, value))]);
  }
  if (active.length > 1) throw new RangeError('Selected faces require a continuous rest bridge; simultaneous faces are not attachment-safe');
  const weights = Object.fromEntries(LEGACY_FACE_TARGETS.map(name => [name, 0]));
  for (const id of SELECTED_FACE_IDS) for (let k = 1; k <= 8; k++) weights[`Face${id}_${String(k).padStart(2,'0')}`] = 0;
  if (!active.length) return weights;
  const [id, a] = active[0];
  if (a >= 1) weights[`Face${id}_08`] = 1;
  else {
    const i = Math.min(7, Math.floor(a * 8));
    const t = a * 8 - i;
    if (i > 0) weights[`Face${id}_${String(i).padStart(2,'0')}`] = 1 - t;
    weights[`Face${id}_${String(i+1).padStart(2,'0')}`] = t;
  }
  return weights;
}
