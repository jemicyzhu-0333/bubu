'use strict';

// A small-size application mark, not a scaled pet portrait. One closed outline
// retains Dango's short ears, round body and separated feet at 16 logical pixels.
const OUTLINE = [
  [3.3, 5], [2.4, 3.1, 2.9, 1.8, 4, 1.8], [5, 1.8, 5.5, 2.5, 5.8, 3.2],
  [7.2, 2.7, 8.8, 2.7, 10.2, 3.2], [10.5, 2.5, 11, 1.8, 12, 1.8],
  [13.1, 1.8, 13.6, 3.1, 12.7, 5], [14, 6.3, 14.2, 8.1, 13.8, 10],
  [13.5, 11.3, 12.6, 12, 11.4, 12.5], [11.9, 14.3, 9.5, 14.7, 9.1, 13],
  [8.4, 13.1, 7.6, 13.1, 6.9, 13], [6.5, 14.7, 4.1, 14.3, 4.6, 12.5],
  [3.4, 12, 2.5, 11.3, 2.2, 10], [1.8, 8.1, 2, 6.3, 3.3, 5]
];
function outlinePoints() {
  const points = [OUTLINE[0]];
  for (const curve of OUTLINE.slice(1)) {
    const [x, y] = points.at(-1);
    for (let step = 1; step <= 16; step++) {
      const t = step / 16, u = 1 - t;
      points.push([u ** 3 * x + 3 * u * u * t * curve[0] + 3 * u * t * t * curve[2] + t ** 3 * curve[4],
        u ** 3 * y + 3 * u * u * t * curve[1] + 3 * u * t * t * curve[3] + t ** 3 * curve[5]]);
    }
  }
  return points;
}
const POINTS = outlinePoints();
const MOUTH = [[6.8, 9.9], [7.3, 10.4], [8, 10], [8.7, 10.4], [9.2, 9.9]];
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function lineDistance(x, y, points) {
  let distance = Infinity;
  for (let i = 1; i < points.length; i++) distance = Math.min(distance, segmentDistance(x, y, points[i - 1], points[i]));
  return distance;
}
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = POINTS.length - 1; i < POINTS.length; j = i++) {
    const [a, b] = POINTS[i], [c, d] = POINTS[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
  }
  return hit;
}
function eyes(state) {
  return [5.7, 10.3].map(x => state === 'closed' ? [[x - .6, 8.1], [x + .6, 8.1]]
    : state === 'celebrate' ? [[x - .65, 8.1], [x, 7.45], [x + .65, 8.1]]
      : [[x, state === 'half' ? 7.8 : 7.5], [x, 8.25]]);
}
function rasterSymbol(size, state = 'neutral', template = false) {
  const data = Buffer.alloc(size * size * 4), eyeLines = eyes(state), samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = ((x + (sx + .5) / samples) * 16 / size - .5) / .9375;
      const py = ((y + (sy + .5) / samples) * 16 / size - .5) / .9375;
      const edge = lineDistance(px, py, POINTS);
      const face = eyeLines.some(line => lineDistance(px, py, line) <= .52) || lineDistance(px, py, MOUTH) <= .43;
      let color = null;
      if (template) { if (edge <= .65 || face) color = [0, 0, 0]; }
      else if (edge <= .62 || face) color = [27, 29, 38];
      else if (inside(px, py)) color = [255, 226, 232];
      else if (edge <= .95) color = [255, 255, 255];
      if (color) { for (let c = 0; c < 3; c++) sum[c] += color[c]; sum[3]++; }
    }
    const i = (y * size + x) * 4;
    if (sum[3]) for (let c = 0; c < 3; c++) data[i + c] = Math.round(sum[c] / sum[3]);
    data[i + 3] = Math.round(sum[3] * 255 / samples ** 2);
  }
  return { width: size, height: size, data };
}
function symbolSvg(state = 'neutral', template = false) {
  const path = `M${OUTLINE[0].join(' ')} ${OUTLINE.slice(1).map(c => `C${c.join(' ')}`).join(' ')}Z`;
  const eyePaths = eyes(state).map(line => `<polyline points="${line.map(p => p.join(',')).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">\n<g transform="translate(.5 .5) scale(.9375)">\n`
    + (!template ? `<path d="${path}" fill="none" stroke="white" stroke-width="1.9"/>\n` : '')
    + `<path d="${path}" fill="${template ? 'none' : '#ffe2e8'}" stroke="${template ? 'black' : '#1b1d26'}" stroke-width="1.3"/>\n`
    + `<g fill="none" stroke="${template ? 'black' : '#1b1d26'}" stroke-width="1.04" stroke-linecap="round" stroke-linejoin="round">${eyePaths}</g>\n`
    + `<polyline points="${MOUTH.map(p => p.join(',')).join(' ')}" fill="none" stroke="${template ? 'black' : '#1b1d26'}" stroke-width=".86" stroke-linecap="round" stroke-linejoin="round"/>\n</g></svg>\n`;
}
module.exports = { rasterSymbol, symbolSvg };
