import { createHash } from 'node:crypto';
import { parseSvg } from './svg-parse.mjs';
import {
  round, num, parseTransform, shapeToPath, pathBounds, unionBounds, inheritStyle, withAlpha,
  multiply, applyPoint
} from './svg-geometry.mjs';
import {
  RIG_FORMAT, RIG_FORMAT_VERSION, RIG_VIEWS, RIG_LAYERS, validateRig
} from '../../src/capabilities/companion/presentation/rig/schema.mjs';

// Compiles a layered SVG into a rig document (docs/PET_RIG.md). Markers can
// be written as data-* attributes or as tokens in an Inkscape layer name /
// element id, e.g. `bone:arm_r pivot:54,40 layer:front`.
const DEFAULT_ROOT_PIVOT = Object.freeze([33, 64]);
const DRAWABLE = new Set(['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
const SKIPPED = new Set(['defs', 'metadata', 'title', 'desc', 'sodipodi:namedview', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'pattern', 'symbol', 'marker', 'filter', 'style']);

function markersOf(element) {
  const a = element.attributes;
  const markers = {};
  const label = [a['inkscape:label'], a['data-name'], a.id].find(value => typeof value === 'string'
    && (value.includes(':') || /^(pivot|pupil|ignore)$/.test(value.trim())));
  for (const token of String(label || '').trim().split(/\s+/)) {
    const colon = token.indexOf(':');
    if (colon > 0) markers[token.slice(0, colon)] = token.slice(colon + 1);
    else if (['pupil', 'ignore', 'pivot'].includes(token)) markers[token] = true;
  }
  for (const key of ['view', 'bone', 'pivot', 'layer', 'face', 'prop', 'anchor', 'palette', 'pupil', 'ignore']) {
    if (a[`data-${key}`] !== undefined) markers[key] = a[`data-${key}`] === '' ? true : a[`data-${key}`];
  }
  if (typeof markers.face === 'string') markers.face = markers.face.replace('/', ':');
  return markers;
}

function collectGradients(svg) {
  const stops = new Map();
  const walk = element => {
    if (/Gradient$/.test(element.name) && element.attributes.id) {
      const colors = element.children.filter(child => child.name === 'stop').map(stop => {
        const style = inheritStyle({}, stop);
        return stop.attributes['stop-color'] || /stop-color:\s*([^;]+)/.exec(stop.attributes.style || '')?.[1]
          || style.fill;
      }).filter(Boolean);
      stops.set(element.attributes.id, { colors, href: (element.attributes['xlink:href'] || element.attributes.href || '').replace('#', '') });
    }
    element.children.forEach(walk);
  };
  walk(svg);
  const resolve = (id, depth = 0) => {
    const gradient = stops.get(id);
    if (!gradient || depth > 4) return null;
    if (gradient.colors.length) return gradient.colors[Math.floor(gradient.colors.length / 2)].trim();
    return resolve(gradient.href, depth + 1);
  };
  return resolve;
}

function artMatrix(svg) {
  const scale = num(svg.attributes['data-art-scale'], 1);
  const [ox, oy] = String(svg.attributes['data-art-origin'] || '0,0').split(/[\s,]+/).map(Number);
  return [scale, 0, 0, scale, -(ox || 0) * scale, -(oy || 0) * scale];
}

function compileRig(svgText, { form, id, version, sourceName = 'rig.svg' } = {}) {
  const svg = parseSvg(svgText);
  const warnings = [];
  const gradient = collectGradients(svg);
  const rootAttributes = svg.attributes;
  const rigId = id || rootAttributes['data-rig-id'] || 'rig';
  const rigVersion = Number.isInteger(version) ? version : Math.max(1, Math.trunc(num(rootAttributes['data-rig-version'], 1)));
  const rigForm = form || rootAttributes['data-rig-form'] || 'usagi';
  const views = {};
  let bounds = null;
  let styleWarned = false;

  function viewState(name) {
    if (!views[name]) {
      views[name] = { bones: {}, parts: [], face: { eyes: {}, mouth: {} }, props: {}, anchors: {}, faceUsed: false };
    }
    return views[name];
  }

  function paint(color, where) {
    if (!color) return null;
    const url = /^url\(#([^)]+)\)/.exec(color);
    if (url) {
      const flat = gradient(url[1]);
      warnings.push(`${where}: gradient ${url[1]} flattened to ${flat || 'none'}`);
      return flat || 'none';
    }
    if (color === 'currentColor') return '#000000';
    return color;
  }

  function makeShape(element, ctm, style, context) {
    const d = shapeToPath(element);
    if (!d) return null;
    const where = element.attributes.id || element.name;
    const fillOpacity = num(style['fill-opacity'], 1);
    const strokeOpacity = num(style['stroke-opacity'], 1);
    const shape = {
      d, m: ctm.map(round),
      fill: withAlpha(paint(style.fill ?? '#000000', where), fillOpacity),
      stroke: withAlpha(paint(style.stroke ?? 'none', where), strokeOpacity),
      width: round(num(style['stroke-width'], 1)),
      opacity: round(Math.max(0, Math.min(1, style.opacity ?? 1)))
    };
    if (element.name === 'line' || element.name === 'polyline') shape.fill = 'none';
    if (style['stroke-linecap']) shape.cap = style['stroke-linecap'];
    if (style['stroke-linejoin']) shape.join = style['stroke-linejoin'] === 'miter-clip' || style['stroke-linejoin'] === 'arcs'
      ? 'miter' : style['stroke-linejoin'];
    if (style['fill-rule'] === 'evenodd') shape.rule = 'evenodd';
    if (context.palette) shape.palette = Number(context.palette);
    const box = pathBounds(d, ctm);
    if (box && !context.face && !context.prop) bounds = unionBounds(bounds, box);
    return shape;
  }

  function pivotOf(element, markers, ctm) {
    if (typeof markers.pivot === 'string') {
      const [x, y] = markers.pivot.split(/[\s,]+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) return applyPoint(ctm, x, y).map(round);
    }
    const marker = element.children.find(child => markersOf(child).pivot === true);
    if (marker) {
      const own = multiply(ctm, parseTransform(marker.attributes.transform));
      return applyPoint(own, num(marker.attributes.cx), num(marker.attributes.cy)).map(round);
    }
    return null;
  }

  function place(view, context, shape) {
    const state = viewState(view);
    if (context.face) {
      const [part, faceState] = context.face.split(':');
      if (!['eyes', 'mouth'].includes(part) || !faceState) {
        warnings.push(`unknown face marker ${context.face}`);
        return;
      }
      state.faceUsed = true;
      const entry = state.face[part][faceState] || (state.face[part][faceState] = { shapes: [] });
      if (context.pupil) (entry.pupil || (entry.pupil = [])).push(shape);
      else entry.shapes.push(shape);
      return;
    }
    if (context.prop) {
      const prop = state.props[context.prop] || (state.props[context.prop] = {
        bone: context.bone, layer: context.layerSet ? context.layer : 'front', shapes: []
      });
      prop.shapes.push(shape);
      return;
    }
    const last = state.parts[state.parts.length - 1];
    if (last && last.bone === context.bone && last.layer === context.layer) last.shapes.push(shape);
    else state.parts.push({ id: `${context.bone}.${context.layer}.${state.parts.length}`, bone: context.bone, layer: context.layer, shapes: [shape] });
  }

  function visit(element, ctm, style, context) {
    if (SKIPPED.has(element.name)) {
      if (element.name === 'style' && !styleWarned) {
        styleWarned = true;
        warnings.push('a <style> sheet was ignored; export with presentation attributes or inline styles');
      }
      return;
    }
    const markers = markersOf(element);
    if (markers.ignore || markers.pivot === true) return;
    const localCtm = multiply(ctm, parseTransform(element.attributes.transform));
    const localStyle = inheritStyle(style, element);
    const next = { ...context };
    if (markers.view) {
      if (!RIG_VIEWS.includes(markers.view)) { warnings.push(`unknown view ${markers.view} skipped`); return; }
      next.view = markers.view;
      next.bone = 'root';
      viewState(next.view);
    }
    const hidden = localStyle.display === 'none' || localStyle.visibility === 'hidden';
    // Editors hide alternative eyes and props; those still belong to the rig.
    if (hidden && !markers.face && !markers.prop && !context.face && !context.prop && !markers.view) return;
    if (markers.layer) {
      if (!RIG_LAYERS.includes(markers.layer)) warnings.push(`unknown layer ${markers.layer}; using body`);
      else { next.layer = markers.layer; next.layerSet = true; }
    }
    if (markers.palette) next.palette = markers.palette;
    if (markers.face) next.face = markers.face;
    if (markers.pupil) next.pupil = true;
    if (markers.prop) { next.prop = markers.prop; if (!markers.layer) next.layerSet = false; }
    if (!next.view) {
      for (const child of element.children) visit(child, localCtm, localStyle, next);
      return;
    }
    if (markers.bone) {
      const state = viewState(next.view);
      const pivot = pivotOf(element, markers, localCtm);
      if (!state.bones[markers.bone]) {
        state.bones[markers.bone] = {
          parent: markers.bone === 'root' ? null : context.bone,
          pivot: pivot || (markers.bone === 'root' ? DEFAULT_ROOT_PIVOT.slice() : null)
        };
        if (!pivot && markers.bone !== 'root') warnings.push(`${next.view}: bone ${markers.bone} has no pivot; using its parent's`);
      }
      next.bone = markers.bone;
    }
    if (markers.anchor) {
      const a = element.attributes;
      const [x, y] = element.name === 'circle' || element.name === 'ellipse'
        ? applyPoint(localCtm, num(a.cx), num(a.cy))
        : pivotOf(element, markers, localCtm) || [NaN, NaN];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        viewState(next.view).anchors[markers.anchor] = { bone: next.bone, x: round(x), y: round(y) };
      } else warnings.push(`anchor ${markers.anchor} needs a circle, an ellipse or a pivot`);
      return;
    }
    if (DRAWABLE.has(element.name)) {
      const shape = makeShape(element, localCtm, localStyle, next);
      if (shape) place(next.view, next, shape);
      return;
    }
    if (!['g', 'svg', 'a', 'switch'].includes(element.name)) {
      warnings.push(`<${element.name}> is not supported and was skipped`);
      return;
    }
    for (const child of element.children) visit(child, localCtm, localStyle, next);
  }

  const anyView = element => Boolean(markersOf(element).view) || element.children.some(anyView);
  const hasViewGroups = anyView(svg);
  // With view groups, anything outside them (reference images, guides) is
  // ignored; without any, the whole drawing is the front view.
  const context = { view: hasViewGroups ? null : 'front', bone: 'root', layer: 'body', layerSet: false };
  if (!hasViewGroups) viewState('front');
  for (const child of svg.children) visit(child, artMatrix(svg), {}, context);

  const doc = { format: RIG_FORMAT, formatVersion: RIG_FORMAT_VERSION, id: rigId, version: rigVersion, form: rigForm,
    name: rootAttributes['data-rig-name'] || rigId, views: {} };
  for (const [name, state] of Object.entries(views)) {
    if (!state.bones.root) state.bones.root = { parent: null, pivot: DEFAULT_ROOT_PIVOT.slice() };
    for (const bone of Object.values(state.bones)) {
      if (!bone.pivot) bone.pivot = (state.bones[bone.parent]?.pivot || DEFAULT_ROOT_PIVOT).slice();
    }
    doc.views[name] = {
      bones: state.bones, parts: state.parts,
      face: state.faceUsed ? state.face : null,
      props: state.props, anchors: state.anchors
    };
  }
  const result = validateRig(doc);
  const digest = createHash('sha256').update(svgText).digest('hex').slice(0, 16);
  return {
    doc, ok: result.ok, errors: result.errors, warnings,
    bounds: bounds && { x: round(bounds.minX), y: round(bounds.minY),
      width: round(bounds.maxX - bounds.minX), height: round(bounds.maxY - bounds.minY) },
    source: { name: sourceName, sha256: digest }
  };
}

function emitModule(doc, { sourceName = 'rig.svg', sha256 = '' } = {}) {
  return `// Generated by \`npm run rig:build\` from ${sourceName} (sha256 ${sha256}). Do not edit.\n`
    + '// The artwork belongs to whoever drew the source SVG; see docs/PET_RIG.md.\n'
    + `const RIG = ${JSON.stringify(doc)};\n`
    + 'export default RIG;\n';
}

export { compileRig, emitModule, markersOf, DEFAULT_ROOT_PIVOT };
