import { multiply, applyPoint } from '../../src/capabilities/companion/presentation/rig/pose.mjs';

// SVG geometry helpers for the rig builder: transforms, basic shapes as path
// data, inherited paint style, and a conservative bounding box for path data.
const round = value => Math.round(value * 1000) / 1000;
const num = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parseTransform(text) {
  let matrix = [1, 0, 0, 1, 0, 0];
  if (!text) return matrix;
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let next;
    switch (match[1]) {
      case 'matrix': next = args.length === 6 ? args : [1, 0, 0, 1, 0, 0]; break;
      case 'translate': next = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; break;
      case 'scale': next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const angle = (args[0] || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const [cx = 0, cy = 0] = args.slice(1);
        next = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX': next = [1, 0, Math.tan((args[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      default: next = [1, Math.tan((args[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    }
    matrix = multiply(matrix, next);
  }
  return matrix;
}

function points(text) {
  const values = String(text || '').split(/[\s,]+/).filter(Boolean).map(Number);
  const pairs = [];
  for (let i = 0; i + 1 < values.length; i += 2) pairs.push(`${round(values[i])} ${round(values[i + 1])}`);
  return pairs;
}

function ellipsePath(cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) return null;
  return `M${round(cx - rx)} ${round(cy)}A${round(rx)} ${round(ry)} 0 1 0 ${round(cx + rx)} ${round(cy)}`
    + `A${round(rx)} ${round(ry)} 0 1 0 ${round(cx - rx)} ${round(cy)}Z`;
}

// Returns path data for a drawable element, or null for anything else.
function shapeToPath(element) {
  const a = element.attributes;
  switch (element.name) {
    case 'path': return (a.d || '').trim() || null;
    case 'circle': return ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r));
    case 'ellipse': return ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    case 'line': return `M${round(num(a.x1))} ${round(num(a.y1))}L${round(num(a.x2))} ${round(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const list = points(a.points);
      if (list.length < 2) return null;
      return `M${list.join('L')}${element.name === 'polygon' ? 'Z' : ''}`;
    }
    case 'rect': {
      const x = num(a.x); const y = num(a.y); const w = num(a.width); const h = num(a.height);
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx === undefined ? num(a.ry) : num(a.rx);
      let ry = a.ry === undefined ? rx : num(a.ry);
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${round(x)} ${round(y)}h${round(w)}v${round(h)}h${round(-w)}Z`;
      const arc = (dx, dy) => `a${round(rx)} ${round(ry)} 0 0 1 ${round(dx)} ${round(dy)}`;
      return `M${round(x + rx)} ${round(y)}h${round(w - 2 * rx)}${arc(rx, ry)}v${round(h - 2 * ry)}`
        + `${arc(-rx, ry)}h${round(-(w - 2 * rx))}${arc(-rx, -ry)}v${round(-(h - 2 * ry))}${arc(rx, -ry)}Z`;
    }
    default: return null;
  }
}

// Conservative bounds: every endpoint and control point, arcs padded by their
// radii. Used only for reporting and the stage safe-area check.
function pathBounds(d, matrix = [1, 0, 0, 1, 0, 0]) {
  const tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0; let command = null; let x = 0; let y = 0; let startX = 0; let startY = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (px, py) => {
    const [tx, ty] = applyPoint(matrix, px, py);
    box.minX = Math.min(box.minX, tx); box.maxX = Math.max(box.maxX, tx);
    box.minY = Math.min(box.minY, ty); box.maxY = Math.max(box.maxY, ty);
  };
  const next = () => Number(tokens[i++]);
  const arity = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    if (!command) break;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === 'Z') { x = startX; y = startY; command = null; continue; }
    if (i + arity[upper] > tokens.length) break;
    const bx = relative ? x : 0; const by = relative ? y : 0;
    if (upper === 'H') { x = bx + next(); add(x, y); continue; }
    if (upper === 'V') { y = by + next(); add(x, y); continue; }
    if (upper === 'A') {
      const rx = Math.abs(next()); const ry = Math.abs(next()); next(); next(); next();
      x = bx + next(); y = by + next();
      add(x - rx, y - ry); add(x + rx, y + ry); add(x, y);
      continue;
    }
    const values = [];
    for (let k = 0; k < arity[upper]; k += 2) values.push([bx + next(), by + next()]);
    for (const [px, py] of values) add(px, py);
    [x, y] = values[values.length - 1];
    if (upper === 'M') { startX = x; startY = y; command = relative ? 'l' : 'L'; }
  }
  return Number.isFinite(box.minX) ? box : null;
}

function unionBounds(a, b) {
  if (!a) return b; if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule',
  'fill-opacity', 'stroke-opacity', 'visibility'];

function ownStyle(attributes) {
  const style = {};
  for (const key of [...INHERITED, 'opacity', 'display']) if (attributes[key] !== undefined) style[key] = attributes[key];
  for (const declaration of String(attributes.style || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) style[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return style;
}

function inheritStyle(parent, element) {
  const own = ownStyle(element.attributes);
  const style = {};
  for (const key of INHERITED) style[key] = own[key] ?? parent[key];
  style.opacity = (parent.opacity ?? 1) * num(own.opacity, 1);
  style.display = own.display;
  return style;
}

function withAlpha(color, alpha) {
  if (!color || alpha >= 1 || color === 'none') return color;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const full = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16));
  return `rgba(${r},${g},${b},${round(alpha)})`;
}

export {
  round, num, parseTransform, shapeToPath, ellipsePath, pathBounds, unionBounds,
  inheritStyle, ownStyle, withAlpha, multiply, applyPoint
};
