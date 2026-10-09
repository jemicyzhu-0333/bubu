'use strict';

const assert = require('node:assert/strict');
const { pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
const { applyPoint, multiply } = require('../src/capabilities/companion/presentation/rig/pose.mjs');

// Conservative curve/control-point bounds, expanded by the actual stroke.
// These contact fixtures use straight/quadratic stroked paths. Reject new
// syntax rather than silently estimating it; un-stroked eye arcs use the
// existing conservative SVG bounds. Canvas verifies the complete flight.
function segmentsFor(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  const paths = []; let segments = [], point, start, command, i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    assert.ok(['M', 'L', 'H', 'V', 'Q', 'Z'].includes(command), `unsupported stroked contact path: ${command}`);
    if (command === 'M') {
      if (segments.length) paths.push({ segments, closed: false });
      point = [next(), next()]; start = point; segments = []; command = 'L'; continue;
    }
    const end = command === 'Z' ? start : command === 'H' ? [next(), point[1]]
      : command === 'V' ? [point[0], next()] : [next(), next()];
    const control = command === 'Q' ? end : null;
    const to = control ? [next(), next()] : end;
    if (point[0] !== to[0] || point[1] !== to[1] || control) {
      const fromDirection = control || to, toDirection = control || point;
      segments.push({ from: point, to, first: [fromDirection[0] - point[0], fromDirection[1] - point[1]],
        last: [to[0] - toDirection[0], to[1] - toDirection[1]] });
    }
    point = to;
    if (command === 'Z') { paths.push({ segments, closed: true }); segments = []; command = null; }
  }
  if (segments.length) paths.push({ segments, closed: false });
  return paths;
}

function inkBounds(shape, matrix = [1, 0, 0, 1, 0, 0]) {
  const transform = multiply(matrix, shape.m), box = pathBounds(shape.d, transform);
  assert.ok(box, 'the production shape must have measurable geometry');
  if (!shape.stroke || shape.stroke === 'none' || !(shape.width > 0)) return box;
  assert.ok(!shape.cap || ['butt', 'round'].includes(shape.cap), 'contact bounds require butt/round caps');
  const radius = shape.width / 2;
  const dx = radius * Math.hypot(transform[0], transform[2]);
  const dy = radius * Math.hypot(transform[1], transform[3]);
  box.minX -= dx; box.maxX += dx; box.minY -= dy; box.maxY += dy;
  if (shape.join && shape.join !== 'miter') return box;
  for (const { segments, closed } of segmentsFor(shape.d)) {
    for (let i = closed ? 0 : 1; i < segments.length; i++) {
      const before = segments[(i + segments.length - 1) % segments.length], after = segments[i];
      const aLength = Math.hypot(...before.last), bLength = Math.hypot(...after.first);
      assert.ok(aLength && bLength, 'stroked contact path needs a non-degenerate tangent');
      const a = before.last.map(n => n / aLength), b = after.first.map(n => n / bLength);
      const divisor = 1 + a[0] * b[0] + a[1] * b[1];
      if (divisor < 1e-12) continue; // Canvas bevels a reversing join.
      const miter = [-(a[1] + b[1]) * radius / divisor, (a[0] + b[0]) * radius / divisor];
      if (Math.hypot(...miter) > radius * 10) continue; // Canvas default miterLimit.
      for (const sign of [-1, 1]) {
        const [x, y] = applyPoint(transform, after.from[0] + sign * miter[0], after.from[1] + sign * miter[1]);
        box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return box;
}

function separated(a, b) {
  return a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;
}

module.exports = { inkBounds, separated };
