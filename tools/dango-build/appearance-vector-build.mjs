// Editable native wardrobe SVG -> fractional Bezier paths and material data.
// This compiler never calls the historical logical-cell rasterizer.
import { parseSvg } from '../rig-build/svg-parse.mjs';
import { parseTransform, inheritStyle, multiply, applyPoint } from '../rig-build/svg-geometry.mjs';
import { compileVectorShape, readMaterial } from './vector-build.mjs';
import { exactVectorShapeBounds } from './vector-path-bounds.mjs';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const VIEWS = ['front', 'three-quarter', 'back'];
const LAYERS = ['back', 'front'];
const ATTACHMENTS = ['foot-left', 'foot-right'];
function assertBounds(shape) {
  const b = exactVectorShapeBounds(shape);
  if (!b) return;
  if (Object.values(b).some(value => !Number.isFinite(value))
    || b.minX < -40 || b.minY < -40 || b.maxX > 106 || b.maxY > 106) {
    throw new Error('native wardrobe path exceeds the 66-unit body and 40-unit bleed contract');
  }
}
function compileDangoVectorAppearance(source) {
  const svg = parseSvg(source), version = Number(svg.attributes['data-version']);
  if (svg.attributes['data-art-size'] !== '66' || svg.attributes.viewBox !== '-40 -40 146 146') {
    throw new Error('native wardrobe requires direct 66-unit art coordinates');
  }
  if (!Number.isInteger(version) || version < 1) throw new Error('positive native wardrobe version required');
  const materials = {}, items = {}, bounds = {};
  for (const defs of svg.children.filter(node => node.name === 'defs')) for (const node of defs.children) {
    const id = node.attributes.id;
    if (!id || materials[id] || !['linearGradient', 'radialGradient'].includes(node.name)) throw new Error('invalid wardrobe material');
    materials[id] = readMaterial(node);
  }
  for (const item of svg.children.filter(node => node.name === 'g')) {
    const key = item.attributes['data-item'];
    if (!/^[a-z][a-z-]*$/.test(key || '') || items[key]) throw new Error('invalid or duplicate wardrobe item');
    const views = {}, itemMatrix = parseTransform(item.attributes.transform), itemStyle = inheritStyle({}, item);
    for (const view of item.children) {
      const name = view.attributes['data-view'];
      if (name === 'profile') {
        if (view.attributes['data-alias'] !== 'three-quarter' || view.children.length) throw new Error('profile is the maximum three-quarter turn');
        continue;
      }
      if (view.name !== 'g' || !VIEWS.includes(name) || views[name]) throw new Error('native wardrobe requires three explicit views');
      const layers = { back: [], front: [], effects: [] };
      const matrix = multiply(itemMatrix, parseTransform(view.attributes.transform));
      const style = inheritStyle(itemStyle, view);
      for (const node of view.children) {
        if (node.attributes['data-effect-anchor'] !== undefined) {
          if (node.name !== 'circle') throw new Error('effect anchors require circle markers');
          const point = applyPoint(matrix, Number(node.attributes.cx), Number(node.attributes.cy));
          if (!point.every(Number.isFinite)) throw new Error('invalid native effect anchor');
          layers.effects.push(point); continue;
        }
        const layer = node.attributes['data-layer'], attachment = node.attributes['data-attachment'] || null;
        if (node.name !== 'g' || !LAYERS.includes(layer) || attachment && !ATTACHMENTS.includes(attachment)) {
          throw new Error('invalid native wardrobe layer or attachment');
        }
        const shapes = [], partMatrix = multiply(matrix, parseTransform(node.attributes.transform));
        const paint = inheritStyle(style, node);
        function visit(element, parentMatrix, parentPaint) {
          const own = multiply(parentMatrix, parseTransform(element.attributes.transform));
          const style = inheritStyle(parentPaint, element);
          if (element.name === 'g') { for (const child of element.children) visit(child, own, style); return; }
          const shape = compileVectorShape(element, own, style, materials);
          if (!shape) throw new Error(`unsupported native wardrobe element ${element.name}`);
          assertBounds(shape); shapes.push(shape);
        }
        for (const child of node.children) visit(child, partMatrix, paint);
        if (!shapes.length) throw new Error('native wardrobe part must contain paths');
        layers[layer].push({ attachment, shapes });
      }
      views[name] = layers;
    }
    if (VIEWS.some(view => !views[view])) throw new Error(`${key} requires front, three-quarter and back`);
    views.profile = views['three-quarter']; items[key] = { views };
    bounds[key] = Object.fromEntries(Object.entries(views).map(([view, layers]) => {
      const boxes = [...layers.front, ...layers.back].flatMap(part => part.shapes).map(exactVectorShapeBounds).filter(Boolean);
      const x = Math.min(...boxes.map(box => box.minX)), y = Math.min(...boxes.map(box => box.minY));
      return [view, { x, y, width: Math.max(...boxes.map(box => box.maxX)) - x,
        height: Math.max(...boxes.map(box => box.maxY)) - y }];
    }));
  }
  if (Object.keys(items).length !== 16) throw new Error('native wardrobe must preserve all sixteen items');
  return { version, materials, items, bounds };
}
function emitDangoVectorAppearance({ version, materials, items, bounds }) {
  return '// Generated from assets/companion/dango/dango.appearance.vector.svg; run tools/dango-build/appearance-vector-cli.mjs.\n'
    + '// Native paths and authored weave, knit, stitch and leather details; no logical-cell raster.\n'
    + 'const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n'
    + `export const VECTOR_APPEARANCE_VERSION = ${version};\n`
    + `export const APPEARANCE_MATERIALS = freeze(${JSON.stringify(materials)});\n`
    + `export const APPEARANCE_BOUNDS = freeze(${JSON.stringify(bounds)});\n`
    + `export const VECTOR_APPEARANCE = freeze(${JSON.stringify(items)});\n`;
}
export { compileDangoVectorAppearance, emitDangoVectorAppearance };
