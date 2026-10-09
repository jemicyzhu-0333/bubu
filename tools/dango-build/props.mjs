// Tool sources use the same restricted SVG parser and deterministic pixel
// rasterizer as the dango body; the runtime only consumes compiled runs.
import fs from 'node:fs';
import { parseSvg } from '../rig-build/svg-parse.mjs';
import { rasterizePaths } from './build.mjs';

export function compileToolSvg(text) {
  const svg = parseSvg(text), result = {};
  for (const node of svg.children) {
    if (node.name !== 'g' || !node.attributes['data-tool']) throw new Error('named tool groups required');
    // Atlas group translations only arrange the editable design sheet;
    // runtime sprites and grip anchors deliberately remain local.
    if (node.attributes.transform && !/^translate\(\d+ \d+\)$/.test(node.attributes.transform)) throw new Error('only atlas translations are allowed');
    const id = node.attributes['data-tool'], width = Number(node.attributes['data-width']), height = Number(node.attributes['data-height']);
    if (result[id]) throw new Error(`duplicate tool ${id}`);
    const anchors = {}, shapes = [];
    for (const part of node.children) {
      const a = part.attributes;
      if (a.transform || a.style) throw new Error('tool geometry must be local and explicit');
      if (part.name === 'circle' && a['data-anchor']) {
        const x = Number(a.cx), y = Number(a.cy);
        if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > width || y > height) throw new Error('unbounded tool anchor');
        anchors[a['data-anchor']] = [x, y];
      } else if (part.name === 'path') shapes.push({ d: a.d, fill: a.fill, stroke: a.stroke,
        strokeWidth: Number(a['stroke-width'] || 1), opacity: Number(a.opacity || 1),
        cap: a['stroke-linecap'] || 'round', join: a['stroke-linejoin'] || 'round' });
      else throw new Error(`unsupported tool shape ${part.name}`);
    }
    const rows = rasterizePaths(shapes, { x: 0, y: 0, width, height }), runs = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width;) {
      const fill = rows[y][x]; if (!fill) { x += 1; continue; }
      const begin = x; while (x < width && rows[y][x] === fill) x += 1;
      runs.push([fill, begin, y, x - begin]);
    }
    if (!runs.length) throw new Error(`blank tool ${id}`);
    const paths = shapes.map(({ strokeWidth, ...shape }) => ({ ...shape, width: strokeWidth,
      ...(shape.fill === '#1a1b26' ? { fillToken: 'ink' } : {}),
      ...(shape.stroke === '#1a1b26' ? { strokeToken: 'ink' } : {}) }));
    result[id] = { width, height, anchors, runs, paths };
  }
  return result;
}
export function emitToolModule(tools) {
  return '// Generated from assets/companion/dango/tools/dango.tools.svg by tools/dango-build/props.mjs.\n'
    + 'const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n'
    + `export const TOOL_SPRITES = freeze(${JSON.stringify(tools)});\n`;
}
if (process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1])) {
  const source = new URL('../../assets/companion/dango/tools/dango.tools.svg', import.meta.url);
  const destination = new URL('../../src/content/companion/dango-tools.mjs', import.meta.url);
  const output = emitToolModule(compileToolSvg(fs.readFileSync(source, 'utf8')));
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) throw new Error('dango tool sprites stale');
  } else fs.writeFileSync(destination, output);
  console.log('dango tool SVG, grip anchors, and pixel runs synchronized');
}
