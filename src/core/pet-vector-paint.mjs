'use strict';

// Native companion art remains paths all the way to the device-resolution
// canvas. Materials and grain are authored data, never a logical-cell raster.
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
function channels(value) {
  const hex = typeof value === 'string' && value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
  return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
}
function mixVectorColor(from, to, amount) {
  const a = channels(from), b = channels(to);
  if (!a || !b) return from;
  const t = clamp(amount);
  return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * t).toString(16).padStart(2, '0')).join('');
}
function vectorColor(value, palette = {}) {
  if (value && typeof value === 'object') {
    return mixVectorColor(vectorColor(value.from, palette), vectorColor(value.to, palette), value.amount);
  }
  const body = palette[2] || '#f7768e';
  return ({ ink: palette[1] || '#282338', body, shadow: palette[3] || '#dc5069',
    eye: palette[4] || palette[1] || '#282338', highlight: mixVectorColor(body, '#ffffff', .3),
    paper: '#fff7e9', white: '#ffffff' })[value] || value;
}
function createVectorPathCache({ createPath = d => typeof Path2D === 'function' ? new Path2D(d) : null,
  limit = 4096 } = {}) {
  const entries = new Map();
  return Object.freeze({
    get(d) {
      if (entries.has(d)) return entries.get(d);
      const path = createPath(d); if (!path) return null;
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      entries.set(d, path); return path;
    },
    get size() { return entries.size; }
  });
}
const defaultPaths = createVectorPathCache();

function materialFill(context, material, palette, fallback) {
  if (!material) return fallback;
  const radial = material.type === 'radial', count = radial ? 6 : 4;
  if (!['linear', 'radial'].includes(material.type) || !Array.isArray(material.coords)
    || material.coords.length !== count || material.coords.some(n => !Number.isFinite(n))
    || !Array.isArray(material.stops) || !material.stops.length) throw new TypeError('invalid vector material');
  const method = radial ? context.createRadialGradient : context.createLinearGradient;
  if (typeof method !== 'function') return fallback;
  const gradient = method.call(context, ...material.coords);
  for (const stop of material.stops) {
    if (!(Number.isFinite(stop.offset) && stop.offset >= 0 && stop.offset <= 1)) throw new TypeError('invalid material stop');
    const color = vectorColor(stop.color, palette), rgb = channels(color);
    const value = Number.isFinite(stop.opacity) && stop.opacity < 1 && rgb
      ? `rgba(${rgb.join(',')},${clamp(stop.opacity)})` : color;
    gradient.addColorStop(stop.offset, value);
  }
  return gradient;
}

function paintVectorShapes(context, shapes, palette, { materials = {}, paths = defaultPaths } = {}) {
  let painted = 0;
  for (const shape of shapes || []) {
    const path = paths.get(shape.d); if (!path) continue;
    context.save();
    const matrix = shape.m || IDENTITY;
    if (matrix.some((n, index) => n !== IDENTITY[index])) context.transform(...matrix);
    if (Number.isFinite(shape.opacity)) context.globalAlpha *= clamp(shape.opacity);
    const fill = vectorColor(shape.fillToken || shape.fill, palette);
    if (fill && fill !== 'none') {
      if (shape.material && !materials[shape.material]) throw new TypeError(`unknown vector material: ${shape.material}`);
      context.fillStyle = materialFill(context, materials[shape.material], palette, fill);
      context.fill(path, shape.rule || 'nonzero');
    }
    const stroke = vectorColor(shape.strokeToken || shape.stroke, palette);
    if (stroke && stroke !== 'none' && shape.width > 0) {
      context.strokeStyle = stroke; context.lineWidth = shape.width;
      context.lineCap = shape.cap || 'round'; context.lineJoin = shape.join || 'round';
      context.stroke(path);
    }
    context.restore(); painted += 1;
  }
  return painted;
}
export { paintVectorShapes, createVectorPathCache, vectorColor, mixVectorColor };
