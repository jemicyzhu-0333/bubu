'use strict';

// SVG pathLength measures distance along the ellipse, not its polar angle.
// One fixed local lookup keeps the star on the arc tip in every DOM backend.
// 1024 chords approximate the unchanged 56 × 11 ellipse within 0.01 CSS px.
const SEGMENTS = 1024;
const POINTS = [{ x: 62, y: 4, distance: 0 }];
for (let index = 1; index <= SEGMENTS; index++) {
  const angle = index * Math.PI * 2 / SEGMENTS;
  const x = 62 + 56 * Math.sin(angle), y = 15 - 11 * Math.cos(angle);
  const previous = POINTS[index - 1];
  POINTS.push({ x, y, distance: previous.distance + Math.hypot(x - previous.x, y - previous.y) });
}
const LENGTH = POINTS.at(-1).distance;

function orbitPointAtProgress(progress) {
  const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const target = fraction * LENGTH;
  let low = 0, high = SEGMENTS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (POINTS[middle].distance < target) low = middle;
    else high = middle;
  }
  const a = POINTS[low], b = POINTS[high];
  const t = (target - a.distance) / (b.distance - a.distance);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export { orbitPointAtProgress };
