'use strict';

// Paints rig shapes. Path strings are parsed once into Path2D objects and
// cached by string, so a posed frame costs only transforms and fills.
function defaultCreatePath(d) {
  return typeof Path2D === 'function' ? new Path2D(d) : null;
}

function createPathCache({ createPath = defaultCreatePath, limit = 4096 } = {}) {
  const cache = new Map();
  function get(d) {
    if (cache.has(d)) return cache.get(d);
    const path = createPath(d);
    if (!path) return null;
    if (cache.size >= limit) cache.delete(cache.keys().next().value);
    cache.set(d, path);
    return path;
  }
  return Object.freeze({ get, get size() { return cache.size; } });
}

function colorFor(value, shape, palette) {
  if (shape.palette !== null && palette?.[shape.palette]) return palette[shape.palette];
  return value;
}

function paintShape(ctx, shape, paths, palette) {
  const path = paths.get(shape.d);
  if (!path) return false;
  ctx.save();
  const [a, b, c, d, e, f] = shape.m;
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1 || e !== 0 || f !== 0) ctx.transform(a, b, c, d, e, f);
  if (shape.opacity < 1) ctx.globalAlpha *= shape.opacity;
  const fill = colorFor(shape.fill, shape, palette);
  if (fill && fill !== 'none') {
    ctx.fillStyle = fill;
    ctx.fill(path, shape.rule);
  }
  if (shape.stroke && shape.stroke !== 'none' && shape.width > 0) {
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = shape.width;
    ctx.lineCap = shape.cap;
    ctx.lineJoin = shape.join;
    ctx.stroke(path);
  }
  ctx.restore();
  return true;
}

function paintShapes(ctx, shapes, paths, palette, matrix = null) {
  if (!shapes?.length) return 0;
  ctx.save();
  if (matrix) ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  let painted = 0;
  for (const shape of shapes) if (paintShape(ctx, shape, paths, palette)) painted += 1;
  ctx.restore();
  return painted;
}

export { createPathCache, paintShape, paintShapes };
export default Object.freeze({ createPathCache, paintShape, paintShapes });
