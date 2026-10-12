// Pure pixel analysis shared by the matrix scanner and tests.
// a = render without the accessory, b = render with it (same frame/state).
const W = d => d.width, H = d => d.height;
function silhouette(img, threshold = 24) {
  const s = new Uint8Array(W(img) * H(img)); const p = img.data;
  for (let i = 0, j = 0; i < p.length; i += 4, j++) s[j] = p[i + 3] > threshold ? 1 : 0; return s;
}
function morph(mask, w, h, r, grow) {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = grow ? 0 : 1; for (let k = -r; k <= r && (grow ? !v : v); k++) { const xx = x + k; const m = xx < 0 || xx >= w ? 0 : mask[y * w + xx]; v = grow ? (v || m) : (v && m); } tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = grow ? 0 : 1; for (let k = -r; k <= r && (grow ? !v : v); k++) { const yy = y + k; const m = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]; v = grow ? (v || m) : (v && m); } out[y * w + x] = v; }
  return out;
}
const dilate = (m, w, h, r) => morph(m, w, h, r, true), erode = (m, w, h, r) => morph(m, w, h, r, false);
function analyseMask(a, b, { floats = false, faceErode = 14, detachRadius = 4, faceBand = [.3, .88] } = {}) {
  const w = W(a), h = H(a), pa = a.data, pb = b.data, n = w * h;
  const sa = silhouette(a), mask = new Uint8Array(n);
  let area = 0, bodyArea = 0, minX = w, minY = h, maxX = -1, maxY = -1, edge = false;
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    bodyArea += sa[j];
    const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]);
    if (d > 60) { mask[j] = 1; area++; const x = j % w, y = (j / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) edge = true; }
  }
  // Face/held-prop ink: dark pixels well inside the bare silhouette (outline excluded).
  // Restricted to the face band of the bare silhouette's bounding box, so the
  // head-top seam between the ears is not mistaken for a face feature.
  let sx0 = w, sy0 = h, sx1 = -1, sy1 = -1;
  for (let j = 0; j < n; j++) if (sa[j]) { const x = j % w, y = (j / w) | 0; if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
  const bandTop = sy0 + (sy1 - sy0) * faceBand[0], bandBottom = sy0 + (sy1 - sy0) * faceBand[1];
  const bandLeft = sx0 + (sx1 - sx0) * .12, bandRight = sx1 - (sx1 - sx0) * .12;
  const inner = erode(sa, w, h, faceErode); let ink = 0, inkCovered = 0; const flagPixels = [];
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    if (!inner[j] || pa[i + 3] <= 200 || pa[i] + pa[i + 1] + pa[i + 2] >= 240) continue;
    const x = j % w, y = (j / w) | 0; if (y < bandTop || y > bandBottom || x < bandLeft || x > bandRight) continue;
    ink++; if (mask[j]) { inkCovered++; flagPixels.push([x, y]); }
  }
  // Floating: accessory pixels far from the bare silhouette.
  const near = dilate(sa, w, h, detachRadius); let far = 0;
  for (let j = 0; j < n; j++) if (mask[j] && !near[j]) far++;
  const flags = [];
  if (inkCovered > 12) flags.push('covers-face-or-prop-ink');
  // Floating gap: the accessory never touches the (dilated) bare silhouette.
  if (!floats && area > 30 && far === area) flags.push('detached');
  if (edge && area > 0) flags.push('out-of-canvas');
  if (bodyArea && area / bodyArea > .75) flags.push('over-budget');
  if (flags.includes('detached') && !flagPixels.length) for (let j = 0; j < n; j += 7) if (mask[j] && !near[j]) flagPixels.push([j % w, (j / w) | 0]);
  return { metrics: { area, bodyArea, ink, inkCovered, far, bbox: area ? [minX, minY, maxX, maxY] : null }, flags, flagPixels };
}
export { analyseMask, silhouette, dilate, erode };

// v2: layer-aware fit analysis. Inputs are ImageData of the same frame:
//   bare / worn            – without / with the outfit
//   bareNoFront / wornNoFront – same, with the action FRONT pass omitted
//   bareBlink              – bare with eyes forced closed (eye mask source)
// Eyes come from the blink difference (real eye pixels, not a heuristic band);
// "front ink" is what the action front pass paints (held props, near paws).
// Because that pass is drawn after every garment, any garment pixel found on
// top of it is a genuine layering fault (cloth swallowing a paw or prop).
const diffMask = (a, b, t = 60) => {
  const n = a.width * a.height, m = new Uint8Array(n), pa = a.data, pb = b.data;
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]) > t) m[j] = 1;
  }
  return m;
};
const count = m => { let c = 0; for (let j = 0; j < m.length; j++) c += m[j]; return c; };
const and = (a, b) => { const m = new Uint8Array(a.length); for (let j = 0; j < a.length; j++) m[j] = a[j] & b[j]; return m; };
function analyseFit({ bare, worn, bareNoFront, wornNoFront, bareBlink }, { floats = false, detachRadius = 4, eyeMin = 6, propMin = 40 } = {}) {
  const w = bare.width, h = bare.height, n = w * h;
  const item = diffMask(bare, worn);
  const footprint = diffMask(bareNoFront, wornNoFront);
  for (let j = 0; j < n; j++) footprint[j] |= item[j];
  const eyes = dilate(diffMask(bare, bareBlink), w, h, 3);
  const front = diffMask(bare, bareNoFront);
  const sa = silhouette(bare);
  let area = 0, edge = false, minX = w, minY = h, maxX = -1, maxY = -1, bodyArea = 0;
  for (let j = 0; j < n; j++) {
    bodyArea += sa[j];
    if (!item[j]) continue; area++;
    const x = j % w, y = (j / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) edge = true;
  }
  const eyeCovered = count(and(item, eyes));
  const overlap = and(footprint, front), overlapArea = count(overlap);
  // A front-pass pixel is hidden when the final frame equals the frame
  // rendered without that pass (the garment, not the paw/prop, is visible).
  const frontVisible = diffMask(worn, wornNoFront);
  let onTop = 0; const hidden = new Uint8Array(n);
  for (let j = 0; j < n; j++) if (overlap[j] && item[j] && !frontVisible[j]) { hidden[j] = 1; onTop++; }
  const order = overlapArea >= propMin ? (onTop / overlapArea > .5 ? 'item' : 'prop') : null;
  const near = dilate(sa, w, h, detachRadius); let far = 0;
  for (let j = 0; j < n; j++) if (item[j] && !near[j]) far++;
  const flags = [], flagPixels = [];
  if (eyeCovered > eyeMin) flags.push('covers-eyes');
  if (order === 'item') flags.push('covers-prop');
  if (!floats && area > 30 && far === area) flags.push('detached');
  if (edge) flags.push('out-of-canvas');
  if (bodyArea && area / bodyArea > .75) flags.push('over-budget');
  if (flags.length) {
    const show = flags.includes('covers-eyes') ? and(item, eyes) : flags.includes('covers-prop') ? hidden : item;
    for (let j = 0; j < n; j += 3) if (show[j]) flagPixels.push([j % w, (j / w) | 0]);
  }
  return { metrics: { area, bodyArea, eyeCovered, overlapArea, onTop, order, far, bbox: area ? [minX, minY, maxX, maxY] : null }, flags, flagPixels };
}

// Z-order flip across a frame sequence: the item/prop order changes between
// consecutive measured frames (both orders must be confidently measured).
function zOrderFlips(orders) {
  const seen = orders.map((o, i) => [o, i]).filter(([o]) => o);
  const flips = [];
  for (let k = 1; k < seen.length; k++) if (seen[k][0] !== seen[k - 1][0]) flips.push([seen[k - 1][1], seen[k][1]]);
  return flips;
}
export { analyseFit, zOrderFlips, diffMask };
