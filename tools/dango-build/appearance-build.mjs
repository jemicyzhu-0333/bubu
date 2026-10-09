// Editable wardrobe SVG -> palette-role, integer-cell scanlines. Runtime never
// reads SVG, resizes a front view, or invents the hidden side of an accessory.
import { parseSvg } from '../rig-build/svg-parse.mjs';
import { flattenPath, rasterizePaths } from './build.mjs';

const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
const LAYERS = ['back', 'front'];
const ROLES = ['outline', 'accent', 'accentDark', 'highlight'];
const COLOR = /^#[0-9a-f]{6}$/i;
const BOUNDS = { left: -20, top: -20, right: 53, bottom: 53 };

function rasterize(nodes, colors) {
  const role = color => ROLES.find(key => colors[key] === color) || color;
  const shapes = nodes.map(node => {
    const a = node.attributes;
    if (node.name !== 'path' || a.transform || a.style || a['clip-path']) throw new Error('wardrobe accepts plain authored paths only');
    const fill = a.fill || 'none', stroke = a.stroke || 'none';
    if (![fill, stroke].every(color => color === 'none' || COLOR.test(color))) throw new Error('invalid wardrobe color');
    return { d: a.d || '', fill, stroke, strokeWidth: Number(a['stroke-width'] || 1) };
  });
  if (!shapes.length) return [];
  const points = shapes.flatMap(shape => flattenPath(shape.d).flat());
  const radius = Math.max(...shapes.map(shape => shape.strokeWidth / 2));
  const left = Math.floor(Math.min(...points.map(p => p[0])) - radius);
  const top = Math.floor(Math.min(...points.map(p => p[1])) - radius);
  const right = Math.ceil(Math.max(...points.map(p => p[0])) + radius);
  const bottom = Math.ceil(Math.max(...points.map(p => p[1])) + radius);
  const rows = rasterizePaths(shapes, { x: left, y: top, width: right - left, height: bottom - top });
  const runs = [];
  for (const [rowIndex, row] of rows.entries()) {
    const y = top + rowIndex;
    for (let column = 0; column < row.length;) {
      if (!row[column]) { column += 1; continue; }
      let end = column + 1;
      while (row[end] === row[column]) end += 1;
      const x = left + column;
      if (x < BOUNDS.left || y < BOUNDS.top || left + end > BOUNDS.right || y >= BOUNDS.bottom) throw new Error('wardrobe ink outside stage');
      runs.push([x * 2, y * 2, (end - column) * 2, role(row[column])]);
      column = end;
    }
  }
  return runs;
}
function compileDangoAppearance(text) {
  const svg = parseSvg(text), items = {};
  if (svg.attributes['data-art-scale'] !== '2') throw new Error('wardrobe source must use one logical cell = two art units');
  const version = Number(svg.attributes['data-version']);
  if (!Number.isInteger(version) || version < 1) throw new Error('positive wardrobe version required');
  for (const item of svg.children.filter(node => node.name === 'g')) {
    if (item.attributes.transform || item.attributes.style) throw new Error('wardrobe item groups must be untransformed');
    const key = item.attributes['data-item'];
    if (!/^[a-z][a-z-]*$/.test(key || '') || items[key]) throw new Error('invalid or duplicate wardrobe item');
    const colors = Object.fromEntries(ROLES.map(role => [role, item.attributes[`data-${role}`]]));
    if (Object.values(colors).some(color => !COLOR.test(color || ''))) throw new Error('all palette roles are required');
    const views = {};
    for (const view of item.children) {
      if (view.attributes.transform || view.attributes.style) throw new Error('wardrobe views must be untransformed');
      const name = view.attributes['data-view'];
      if (view.name !== 'g' || !VIEWS.includes(name) || views[name]) throw new Error('all wardrobe views must be explicit and unique');
      const layers = { back: [], front: [] }, effects = [];
      for (const node of view.children) {
        const a = node.attributes;
        if (a.transform || a.style) throw new Error('wardrobe layers must be untransformed');
        if (node.name === 'circle' && a['data-effect-anchor']) {
          const x = Number(a.cx) * 2, y = Number(a.cy) * 2;
          if (![x, y].every(Number.isInteger)) throw new Error('effect anchors must align to art pixels');
          effects.push([x, y]); continue;
        }
        const layer = a['data-layer'], attachment = a['data-attachment'] || null;
        if (node.name !== 'g' || !LAYERS.includes(layer)
          || attachment && !['foot-left', 'foot-right'].includes(attachment)) throw new Error('invalid wardrobe layer/attachment');
        const runs = rasterize(node.children, colors);
        if (runs.length) layers[layer].push({ attachment, runs });
      }
      views[name] = { ...layers, effects };
    }
    if (VIEWS.some(name => !views[name])) throw new Error(`${key} needs four authored views`);
    items[key] = { colors, views };
  }
  if (!Object.keys(items).length) throw new Error('wardrobe source is empty');
  return { version, items };
}
function emitDangoAppearance({ version, items }) {
  return '// Generated from assets/companion/dango/dango.appearance.svg; edit that source, then run tools/dango-build/appearance-cli.mjs.\n'
    + 'const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n'
    + `export const APPEARANCE_VERSION = ${version};\nexport const DANGO_APPEARANCE = freeze(${JSON.stringify(items)});\n`;
}
export { compileDangoAppearance, emitDangoAppearance };
