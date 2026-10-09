// Deterministic, dependency-free SVG-to-logical-pixel compiler. The authoring
// subset is deliberately small: closed paths (M/L/H/V/Q/C/Z), palette fills,
// outline strokes and named face anchors. Unsupported geometry fails loudly.
import { parseSvg } from '../rig-build/svg-parse.mjs';

const COLORS = Object.freeze({ '#1a1b26': '1', '#f7768e': '2', '#dc5069': '3' });
const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
const ARITY = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, Z: 0 };

function flattenPath(source) {
  const tokens = source.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const contours = []; let contour, point = [0, 0], start, command, index = 0;
  const add = next => { point = next; contour.push(next); };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    const upper = command?.toUpperCase();
    if (!(upper in ARITY)) throw new Error(`unsupported path command ${command}`);
    if (upper === 'Z') { add(start); command = null; continue; }
    const count = ARITY[upper], values = tokens.slice(index, index + count).map(Number);
    if (values.length !== count || values.some(value => !Number.isFinite(value))) throw new Error('incomplete path');
    index += count;
    const relative = command !== upper, origin = relative ? point : [0, 0];
    const pair = at => [values[at] + origin[0], values[at + 1] + origin[1]];
    if (upper === 'M') {
      point = pair(0); start = point; contour = [point]; contours.push(contour); command = relative ? 'l' : 'L';
    } else if (!contour) throw new Error('path must begin with M');
    else if (upper === 'L') add(pair(0));
    else if (upper === 'H') add([values[0] + origin[0], point[1]]);
    else if (upper === 'V') add([point[0], values[0] + origin[1]]);
    else {
      const from = point.slice(), p1 = pair(0), p2 = pair(2), p3 = upper === 'C' ? pair(4) : null;
      // Fixed sampling is byte-stable across machines and independent of DPR.
      for (let step = 1; step <= 48; step += 1) {
        const t = step / 48, u = 1 - t;
        add([0, 1].map(axis => p3
          ? u ** 3 * from[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t ** 3 * p3[axis]
          : u * u * from[axis] + 2 * u * t * p1[axis] + t * t * p2[axis]));
      }
    }
  }
  return contours;
}

function inside(x, y, contours) {
  let yes = false;
  for (const contour of contours) {
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const [ax, ay] = contour[i], [bx, by] = contour[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) yes = !yes;
    }
  }
  return yes;
}

function onStroke(x, y, contours, radius) {
  for (const contour of contours) for (let i = 1; i < contour.length; i += 1) {
    const [ax, ay] = contour[i - 1], [bx, by] = contour[i], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= radius ** 2) return true;
  }
  return false;
}

function rasterizePaths(shapes, { x = 0, y = 0, width = 33, height = 33 } = {}) {
  if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 || width > 256 || height > 256) {
    throw new Error('raster bounds must use integer cells with dimensions 1–256');
  }
  const rows = Array.from({ length: height }, () => Array(width).fill(null));
  for (const shape of shapes) {
    const contours = flattenPath(shape.d || '');
    const fill = shape.fill && shape.fill !== 'none' ? shape.fill : null;
    const stroke = shape.stroke && shape.stroke !== 'none' ? shape.stroke : null;
    const radius = (shape.strokeWidth ?? 1) / 2;
    if (stroke && !(Number.isFinite(radius) && radius > 0 && radius <= 4)) throw new Error('invalid raster stroke width');
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
      const px = x + column + .5, py = y + row + .5;
      if (fill && inside(px, py, contours)) rows[row][column] = fill;
      if (stroke && onStroke(px, py, contours, radius)) rows[row][column] = stroke;
    }
  }
  return rows;
}

function compileDangoSvg(text) {
  const svg = parseSvg(text), grids = {}, layouts = {}, parts = {}, anchors = {};
  if (svg.attributes.viewBox !== '0 0 33 33' || svg.attributes['data-body-size'] !== '66') throw new Error('expected 33 logical cells / 66 art units');
  if (svg.attributes.transform || svg.attributes.style) throw new Error('unsupported root transform or style');
  const version = Number(svg.attributes['data-version']);
  if (!Number.isInteger(version) || version < 1) throw new Error('positive body version required');
  for (const view of svg.children.filter(child => child.attributes['data-view'])) {
    const name = view.attributes['data-view'];
    if (!VIEWS.includes(name) || grids[name]) throw new Error(`invalid or repeated view ${name}`);
    if (view.attributes.transform || view.attributes.style) throw new Error('unsupported view transform or style');
    const grid = Array.from({ length: 33 }, () => Array(33).fill('.'));
    const layout = { eyeAnchors: {}, mouthAnchor: null, cheekAnchors: [] };
    const partGrids = {}, bodyAnchors = {};
    function visit(nodes, part = null) {
      for (const node of nodes) {
        if (node.name === 'g') {
          const key = node.attributes['data-part'];
          if (!['torso', 'foot-left', 'foot-right'].includes(key) || node.attributes.transform || node.attributes.style) throw new Error('every part group must be named and untransformed');
          partGrids[key] ||= Array.from({ length: 33 }, () => Array(33).fill('.'));
          visit(node.children, key); continue;
        }
        const a = node.attributes;
        if (node.name === 'circle' && a['data-anchor']) {
          const [x, y] = [Number(a.cx), Number(a.cy)];
          const anchor = a['data-anchor'];
          const bodyAnchor = /^(foot|shoulder)-(left|right)$/.test(anchor);
          if (![x, y].every(value => Number.isInteger(value * (bodyAnchor ? 2 : 1)) && value >= 0 && value < 33)) {
            throw new Error('face anchors must use integer cells; body anchors must use integer art units');
          }
          if (/^eye-(left|right)$/.test(anchor)) {
            const width = a['data-eye-width'] === undefined ? 5 : Number(a['data-eye-width']);
            if (!Number.isInteger(width) || width < 3 || width > 5) throw new Error('eye width must be three to five cells');
            layout.eyeAnchors[anchor.slice(4)] = { gridX: x, gridY: y, ...(width !== 5 ? { gridWidth: width } : {}) };
          } else if (anchor === 'mouth') layout.mouthAnchor = { gridX: x, gridY: y };
          else if (anchor.startsWith('cheek-')) layout.cheekAnchors.push([x, y]);
          else if (bodyAnchor) bodyAnchors[anchor] = { x: x * 2, y: y * 2 };
          else throw new Error(`unknown anchor ${anchor}`);
          continue;
        }
        if (node.name !== 'path' || a.transform || a.style || a['clip-path']) throw new Error(`unsupported dango shape ${node.name}`);
        const contours = flattenPath(a.d || ''), fill = a.fill === 'none' ? null : COLORS[a.fill];
        const stroke = !a.stroke || a.stroke === 'none' ? null : COLORS[a.stroke];
        if (a.fill !== 'none' && !fill || a.stroke && a.stroke !== 'none' && !stroke) throw new Error('unknown palette color');
        const radius = Number(a['stroke-width'] || 1) / 2;
        if (!(radius > 0 && radius <= 2)) throw new Error('outline width must be positive and at most four cells');
        for (let y = 0; y < 33; y += 1) for (let x = 0; x < 33; x += 1) {
          let glyph = fill && inside(x + .5, y + .5, contours) ? fill : null;
          if (stroke && onStroke(x + .5, y + .5, contours, radius)) glyph = stroke;
          if (glyph) { grid[y][x] = glyph; if (part) partGrids[part][y][x] = glyph; }
        }
      }
    }
    visit(view.children);
    if (['torso', 'foot-left', 'foot-right'].some(key => !partGrids[key])
      || ['foot-left', 'foot-right'].some(key => !bodyAnchors[key])) throw new Error('separable torso and both anchored feet are required');
    const wantedEyes = name === 'back' ? 0 : name === 'profile' ? 1 : 2;
    if (Object.keys(layout.eyeAnchors).length !== wantedEyes || Boolean(layout.mouthAnchor) !== (name !== 'back')) {
      throw new Error(`incorrect face anchor count for ${name}`);
    }
    grids[name] = grid.map(row => row.join('')); layouts[name] = layout;
    parts[name] = Object.fromEntries(Object.entries(partGrids).map(([key, rows]) => [key, rows.map(row => row.join(''))]));
    anchors[name] = bodyAnchors;
  }
  if (VIEWS.some(name => !grids[name])) throw new Error('all four independent views are required');
  return { version, grids, layouts, parts, anchors };
}

function emitDangoModule({ version, grids, layouts, parts, anchors }) {
  return `// Generated from assets/companion/dango/dango.body.svg by tools/dango-build/cli.mjs.\n`
    + `// Palette glyphs remain indexed so all ten skins use the same authored geometry.\n`
    + `const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n`
    + `export const BODY_VERSION = ${version};\nexport const BODY_GRIDS = freeze(${JSON.stringify(grids, null, 2)});\n`
    + `export const VIEW_LAYOUTS = freeze(${JSON.stringify(layouts, null, 2)});\n`
    + `export const PART_GRIDS = freeze(${JSON.stringify(parts, null, 2)});\n`
    + `export const BODY_ANCHORS = freeze(${JSON.stringify(anchors, null, 2)});\n`;
}

export { compileDangoSvg, emitDangoModule, flattenPath, rasterizePaths };
