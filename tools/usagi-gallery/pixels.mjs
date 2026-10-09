// Evidence measures actual raster output. A changed pixel is evidence of change,
// never proof that the motion conveys its advertised meaning or looks good.
export function pixels(canvas) {
  const { width, height } = canvas;
  const image = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  let hash = 2166136261, occupied = 0, edge = 0;
  const bounds = { left: width, top: height, right: -1, bottom: -1 };
  for (let i = 0; i < image.data.length; i += 4) {
    for (let c = 0; c < 4; c++) { hash ^= image.data[i + c]; hash = Math.imul(hash, 16777619) >>> 0; }
    if (image.data[i + 3] < 16) continue;
    occupied++;
    const x = i / 4 % width, y = Math.floor(i / 4 / width);
    bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edge++;
  }
  return { image, hash: hash.toString(16), occupied, edge, bounds };
}
export function difference(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  let changed = 0, delta = 0, active = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.max(a.data[i + 3], b.data[i + 3]) >= 16) active++;
    let pixelDelta = 0;
    for (let c = 0; c < 4; c++) pixelDelta += Math.abs(a.data[i + c] - b.data[i + c]);
    if (pixelDelta > 32) changed++;
    delta += pixelDelta;
  }
  return { changedPixels: changed, changedOfActive: active ? changed / active : 0,
    meanChannelDelta: delta / a.data.length };
}
export function summarize(samples) {
  return { frames: samples.length, uniqueFrames: new Set(samples.map(s => s.hash)).size,
    frozen: new Set(samples.map(s => s.hash)).size <= 1,
    blankFrames: samples.filter(s => s.occupied === 0).length,
    edgeTouchFrames: samples.filter(s => s.edge > 0).length,
    maxAdjacentChange: Math.max(0, ...samples.map(s => s.difference?.changedOfActive || 0)),
    note: 'Whole-body change may be only bobbing or blinking. Judge semantic action, facial articulation and prop contact from the strip/playback.' };
}
