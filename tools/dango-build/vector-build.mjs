import { parseSvg } from '../rig-build/svg-parse.mjs';
import { shapeToPath, parseTransform, inheritStyle, multiply, applyPoint, round } from '../rig-build/svg-geometry.mjs';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const TOKENS = new Set(['ink', 'body', 'shadow', 'highlight', 'white', 'paper', 'eye']);
const COLORS = { '#191827': 'ink', '#f7768e': 'body', '#dc5069': 'shadow', '#fff8f2': 'white' };
const PARTS = new Set(['torso', 'foot-left', 'foot-right']);
const VIEWS = ['front', 'three-quarter', 'back'];
const number = (value, fallback) => value === undefined ? fallback : Number(value);

function readMaterial(element) {
  const a = element.attributes;
  const type = element.name === 'radialGradient' ? 'radial' : 'linear';
  if (a.gradientUnits !== 'userSpaceOnUse') throw new Error('vector materials require explicit art-unit coordinates');
  const coords = type === 'radial'
    ? [number(a.fx, Number(a.cx)), number(a.fy, Number(a.cy)), 0, Number(a.cx), Number(a.cy), Number(a.r)]
    : [Number(a.x1), Number(a.y1), Number(a.x2), Number(a.y2)];
  const stops = element.children.map(stop => {
    const s = stop.attributes, token = s['data-token'] || s['stop-color'];
    if (stop.name !== 'stop' || !(TOKENS.has(token) || /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(token || ''))) throw new Error('material stop must name a palette token or hex color');
    const result = { at: Number(s.offset), token, mix: s['data-mix'] || null,
      amount: number(s['data-amount'], 0), opacity: number(s['stop-opacity'], 1) };
    if (result.mix && !(TOKENS.has(result.mix) || /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(result.mix))) throw new Error('unknown material mix token');
    if (![result.at, result.amount, result.opacity].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('invalid material stop');
    return result;
  });
  if (!coords.every(Number.isFinite) || stops.length < 2 || stops.some((stop, i) => i && stop.at < stops[i - 1].at)) throw new Error('invalid gradient geometry');
  return { type, coords, stops: stops.map(stop => ({ offset: stop.at, color: stop.mix ? { from: stop.token, to: stop.mix, amount: stop.amount } : stop.token,
    ...(stop.opacity === 1 ? {} : { opacity: stop.opacity }) })) };
}

function compileVectorShape(element, matrix, paint, materials = {}) {
  const d = shapeToPath(element);
  if (!d) return null;
  if (/[^MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]/.test(d)) throw new Error('unsupported path syntax');
  const shape = { d, m: matrix.map(round), fill: paint.fill || 'none', stroke: paint.stroke || 'none',
    width: number(paint['stroke-width'], 1), opacity: paint.opacity ?? 1,
    cap: paint['stroke-linecap'] || 'round', join: paint['stroke-linejoin'] || 'round' };
  const material = /^url\(#([^)]+)\)$/.exec(shape.fill);
  if (material) {
    if (!materials[material[1]]) throw new Error('unknown vector material');
    shape.material = material[1];
    const first = materials[material[1]].stops[0].color;
    const fallback = typeof first === 'object' ? first.from : first;
    if (TOKENS.has(fallback)) { shape.fill = '#f7768e'; shape.fillToken = fallback; }
    else shape.fill = fallback;
  } else if (COLORS[shape.fill]) shape.fillToken = COLORS[shape.fill];
  if (COLORS[shape.stroke]) shape.strokeToken = COLORS[shape.stroke];
  for (const [attribute, field] of [['data-fill-token', 'fillToken'], ['data-stroke-token', 'strokeToken']]) {
    const token = element.attributes[attribute];
    if (token !== undefined) {
      if (!TOKENS.has(token)) throw new Error('unknown vector paint token');
      shape[field] = token;
    }
  }
  if (number(paint['fill-opacity'], 1) !== 1 || number(paint['stroke-opacity'], 1) !== 1) throw new Error('use shape opacity for native vector paint');
  if (![shape.width, shape.opacity].every(Number.isFinite) || shape.width < 0 || shape.opacity < 0 || shape.opacity > 1) throw new Error('invalid vector paint');
  if (paint['fill-rule'] === 'evenodd') shape.rule = 'evenodd';
  if (element.attributes['data-running-d']) shape.runningD = element.attributes['data-running-d'];
  return shape;
}

function compileDangoVector(source) {
  const svg = parseSvg(source), a = svg.attributes;
  if (a['data-body-size'] !== '66' || a.viewBox !== '0 0 66 66') throw new Error('vector dango keeps the 66-unit body contract');
  const version = Number(a['data-version']);
  if (!Number.isInteger(version) || version < 1) throw new Error('vector version required');
  const materials = {}, views = {}, anchors = {}, layouts = {}, eyes = {}, mouths = {};
  for (const defs of svg.children.filter(child => child.name === 'defs')) {
    for (const item of defs.children) {
      if (!['linearGradient', 'radialGradient'].includes(item.name) || !item.attributes.id) throw new Error('unsupported vector definition');
      materials[item.attributes.id] = readMaterial(item);
    }
  }
  function visit(element, matrix, style, context) {
    if (['title', 'desc', 'defs'].includes(element.name)) return;
    const attr = element.attributes, own = multiply(matrix, parseTransform(attr.transform));
    const paint = inheritStyle(style, element), next = { ...context };
    if (attr['data-view']) {
      const name = attr['data-view'];
      if (!VIEWS.includes(name) || views[name]) throw new Error('front, three-quarter and back must each be authored once');
      views[name] = { torso: [], feet: { 'foot-left': [], 'foot-right': [] } }; anchors[name] = {};
      layouts[name] = { eyes: [], mouth: null, cheeks: [] }; next.view = name;
    }
    if (attr['data-part']) {
      if (!PARTS.has(attr['data-part'])) throw new Error('unknown vector body part');
      next.part = attr['data-part'];
    }
    if (attr['data-eye']) {
      next.eye = attr['data-eye']; if (eyes[next.eye]) throw new Error('duplicate eye state'); eyes[next.eye] = [];
    }
    if (attr['data-mouth']) {
      next.mouth = attr['data-mouth']; if (mouths[next.mouth]) throw new Error('duplicate mouth state'); mouths[next.mouth] = [];
    }
    if (attr['data-anchor']) {
      if (!next.view || element.name !== 'circle') throw new Error('anchors require a view and circle marker');
      const [x, y] = applyPoint(own, Number(attr.cx), Number(attr.cy)).map(round);
      if (![x, y].every(Number.isFinite)) throw new Error('invalid vector anchor');
      const key = attr['data-anchor'];
      if (key.startsWith('eye-')) layouts[next.view].eyes.push({ side: key.slice(4), x, y,
        scaleX: number(attr['data-scale-x'], 1), scaleY: number(attr['data-scale-y'], 1) });
      else if (key === 'mouth') layouts[next.view].mouth = { x, y, scaleX: number(attr['data-scale-x'], 1) };
      else if (key.startsWith('cheek-')) layouts[next.view].cheeks.push({ x, y, scaleX: number(attr['data-scale-x'], 1) });
      else anchors[next.view][key] = { x, y };
      return;
    }
    const d = shapeToPath(element);
    if (d) {
      const shape = compileVectorShape(element, own, paint, materials);
      if (next.eye) eyes[next.eye].push(shape);
      else if (next.mouth) mouths[next.mouth].push(shape);
      else if (next.view && next.part) {
        const target = next.part === 'torso' ? views[next.view].torso : views[next.view].feet[next.part];
        target.push(shape);
      } else throw new Error('all artwork requires a body part or expression group');
    } else if (!['svg', 'g'].includes(element.name)) throw new Error(`unsupported vector element ${element.name}`);
    for (const child of element.children) visit(child, own, paint, next);
  }
  visit(svg, IDENTITY, {}, {});
  for (const view of VIEWS) {
    if (!views[view]?.torso.length || !views[view].feet['foot-left'].length || !views[view].feet['foot-right'].length) throw new Error('each view requires torso and separate feet');
    if (['foot-left', 'foot-right', 'shoulder-left', 'shoulder-right'].some(key => !anchors[view][key])) throw new Error('body attachment anchor missing');
    if (layouts[view].eyes.length !== (view === 'back' ? 0 : 2) || Boolean(layouts[view].mouth) !== (view !== 'back')) throw new Error('facing views must keep both eyes');
    views[view].runningTorso = views[view].torso.map(shape => {
      if (!shape.runningD) return shape;
      const running = { ...shape, d: shape.runningD }; delete running.runningD; delete shape.runningD;
      return running;
    });
  }
  if (Object.keys(eyes).length !== 16 || Object.keys(mouths).length !== 9) throw new Error('16 authored eyes and 9 authored mouths required');
  // Compatibility name, deliberately the identical two-eye maximum turn.
  views.profile = views['three-quarter']; anchors.profile = anchors['three-quarter']; layouts.profile = layouts['three-quarter'];
  return { version, views, anchors, layouts, eyes, mouths, materials };
}

function emitDangoVector({ version, views, anchors, layouts, eyes, mouths, materials }) {
  const serial = value => JSON.stringify(value);
  return '// Generated from assets/companion/dango/dango.vector.svg; run tools/dango-build/vector-cli.mjs.\n'
    + '// Native Bezier paths, palette-relative materials, and source-authored local expressions.\n'
    + 'const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };\n'
    + `export const VECTOR_VERSION = ${version};\n`
    + Object.entries({ BODY_VIEWS: views, BODY_ANCHORS: anchors, FACE_LAYOUTS: layouts,
      EYE_SHAPES: eyes, MOUTH_SHAPES: mouths, MATERIALS: materials })
      .map(([key, value]) => `export const ${key} = freeze(${serial(value)});\n`).join('');
}

export { compileDangoVector, emitDangoVector, compileVectorShape, readMaterial };
