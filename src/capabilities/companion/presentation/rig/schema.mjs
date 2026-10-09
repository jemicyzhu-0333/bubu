'use strict';

// A layered rig is data produced by `npm run rig:build` from an SVG. It holds
// no code: shapes are SVG path strings plus a 2D matrix, bones are pivots in
// the form's art space (the same 66-unit body coordinates the vector painter
// uses). The renderer only trusts a document this validator returned.
const RIG_FORMAT = 'focuspix-rig';
const RIG_FORMAT_VERSION = 1;
const RIG_VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);
const RIG_LAYERS = Object.freeze(['back', 'body', 'front']);
const FACE_PARTS = Object.freeze(['eyes', 'mouth']);
const LIMITS = Object.freeze({ shapes: 6000, pathLength: 40000, bones: 64, props: 64, anchors: 32 });
const ID = /^[a-z][a-z0-9_.-]{0,47}$/;
const COLOR = /^(?:none|transparent|#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\)|[a-zA-Z]{3,20})$/;
const PATH = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/;

function fail(errors, message) { errors.push(message); return null; }
const finite = value => typeof value === 'number' && Number.isFinite(value);

function readMatrix(value, where, errors) {
  if (value === undefined) return Object.freeze([1, 0, 0, 1, 0, 0]);
  if (!Array.isArray(value) || value.length !== 6 || !value.every(finite)) {
    return fail(errors, `${where}: matrix must be six finite numbers`);
  }
  return Object.freeze(value.slice());
}

function readColor(value, where, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !COLOR.test(value.trim())) return fail(errors, `${where}: bad color ${value}`);
  return value.trim();
}

function readShape(raw, where, errors, counter) {
  counter.shapes += 1;
  if (!raw || typeof raw !== 'object') return fail(errors, `${where}: shape must be an object`);
  if (typeof raw.d !== 'string' || !raw.d.trim() || raw.d.length > LIMITS.pathLength || !PATH.test(raw.d)) {
    return fail(errors, `${where}: shape path is missing or not plain SVG path data`);
  }
  const shape = {
    d: raw.d,
    m: readMatrix(raw.m, where, errors),
    fill: readColor(raw.fill, where, errors),
    stroke: readColor(raw.stroke, where, errors),
    width: raw.width === undefined ? 1 : raw.width,
    opacity: raw.opacity === undefined ? 1 : raw.opacity,
    cap: raw.cap || 'round',
    join: raw.join || 'round',
    rule: raw.rule === 'evenodd' ? 'evenodd' : 'nonzero',
    palette: raw.palette === undefined ? null : raw.palette
  };
  if (!finite(shape.width) || shape.width < 0 || shape.width > 40) errors.push(`${where}: bad stroke width`);
  if (!finite(shape.opacity) || shape.opacity < 0 || shape.opacity > 1) errors.push(`${where}: bad opacity`);
  if (!['butt', 'round', 'square'].includes(shape.cap)) errors.push(`${where}: bad line cap`);
  if (!['miter', 'round', 'bevel'].includes(shape.join)) errors.push(`${where}: bad line join`);
  if (shape.palette !== null && (!Number.isInteger(shape.palette) || shape.palette < 1 || shape.palette > 9)) {
    errors.push(`${where}: palette index must be 1-9`);
  }
  return Object.freeze(shape);
}

function readShapes(list, where, errors, counter) {
  if (!Array.isArray(list)) return fail(errors, `${where}: shapes must be an array`) || Object.freeze([]);
  return Object.freeze(list.map((raw, index) => readShape(raw, `${where}[${index}]`, errors, counter)).filter(Boolean));
}

function readBones(raw, where, errors) {
  if (!raw || typeof raw !== 'object' || !raw.root) return fail(errors, `${where}: a root bone is required`);
  const ids = Object.keys(raw);
  if (ids.length > LIMITS.bones) return fail(errors, `${where}: too many bones`);
  const bones = {};
  for (const id of ids) {
    const bone = raw[id];
    if (!ID.test(id)) errors.push(`${where}: bad bone id ${id}`);
    const parent = bone?.parent ?? null;
    if (id === 'root' ? parent !== null : !raw[parent]) errors.push(`${where}.${id}: unknown parent ${parent}`);
    if (!Array.isArray(bone?.pivot) || bone.pivot.length !== 2 || !bone.pivot.every(finite)) {
      errors.push(`${where}.${id}: pivot must be [x, y]`);
    }
    bones[id] = Object.freeze({ parent, pivot: Object.freeze((bone?.pivot || [0, 0]).slice()) });
  }
  for (const id of ids) {
    const seen = new Set();
    for (let cursor = id; cursor; cursor = bones[cursor]?.parent) {
      if (seen.has(cursor)) { errors.push(`${where}.${id}: bone cycle`); break; }
      seen.add(cursor);
    }
  }
  return Object.freeze(bones);
}

function readAttached(raw, where, bones, errors, counter, { layered = true } = {}) {
  const bone = raw?.bone || 'root';
  if (!bones?.[bone]) errors.push(`${where}: unknown bone ${bone}`);
  const layer = raw?.layer || 'body';
  if (layered && !RIG_LAYERS.includes(layer)) errors.push(`${where}: unknown layer ${layer}`);
  return Object.freeze({ bone, layer, shapes: readShapes(raw?.shapes, `${where}.shapes`, errors, counter) });
}

function readFace(raw, where, bones, errors, counter) {
  if (raw === undefined || raw === null) return null;
  const face = {};
  for (const part of FACE_PARTS) {
    const states = {};
    for (const [state, entry] of Object.entries(raw[part] || {})) {
      if (!ID.test(state)) { errors.push(`${where}.${part}: bad state ${state}`); continue; }
      states[state] = Object.freeze({
        shapes: readShapes(entry?.shapes, `${where}.${part}.${state}`, errors, counter),
        pupil: entry?.pupil ? readShapes(entry.pupil, `${where}.${part}.${state}.pupil`, errors, counter) : null
      });
    }
    face[part] = Object.freeze(states);
  }
  return Object.freeze(face);
}

function readView(raw, view, errors, counter) {
  const where = `views.${view}`;
  const bones = readBones(raw?.bones, `${where}.bones`, errors);
  if (!bones) return null;
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const props = {};
  if (Object.keys(raw.props || {}).length > LIMITS.props) errors.push(`${where}: too many props`);
  for (const [id, prop] of Object.entries(raw.props || {}).slice(0, LIMITS.props)) {
    if (!ID.test(id)) errors.push(`${where}.props: bad id ${id}`);
    props[id] = readAttached(prop, `${where}.props.${id}`, bones, errors, counter);
  }
  const anchors = {};
  for (const [slot, anchor] of Object.entries(raw.anchors || {}).slice(0, LIMITS.anchors)) {
    if (!anchor || !finite(anchor.x) || !finite(anchor.y)) { errors.push(`${where}.anchors.${slot}: bad point`); continue; }
    if (!bones[anchor.bone || 'root']) errors.push(`${where}.anchors.${slot}: unknown bone ${anchor.bone}`);
    anchors[slot] = Object.freeze({ bone: anchor.bone || 'root', x: anchor.x, y: anchor.y });
  }
  return Object.freeze({
    bones,
    parts: Object.freeze(parts.map((part, index) => Object.freeze({
      id: typeof part?.id === 'string' ? part.id : `part-${index}`,
      ...readAttached(part, `${where}.parts[${index}]`, bones, errors, counter)
    }))),
    face: readFace(raw.face, `${where}.face`, bones, errors, counter),
    props: Object.freeze(props),
    anchors: Object.freeze(anchors)
  });
}

function validateRig(doc) {
  const errors = [];
  const counter = { shapes: 0 };
  if (!doc || typeof doc !== 'object') return Object.freeze({ ok: false, rig: null, errors: ['rig is empty'] });
  if (doc.format !== RIG_FORMAT || doc.formatVersion !== RIG_FORMAT_VERSION) {
    errors.push(`unsupported rig format ${doc.format}@${doc.formatVersion}`);
  }
  if (typeof doc.id !== 'string' || !ID.test(doc.id)) errors.push('rig id is required');
  if (!Number.isInteger(doc.version) || doc.version < 1) errors.push('rig version must be a positive integer');
  if (typeof doc.form !== 'string' || !ID.test(doc.form)) errors.push('rig form is required');
  const views = {};
  for (const view of RIG_VIEWS) {
    if (doc.views?.[view]) views[view] = readView(doc.views[view], view, errors, counter);
  }
  if (!views.front) errors.push('the front view is required');
  if (counter.shapes > LIMITS.shapes) errors.push(`too many shapes: ${counter.shapes}`);
  if (errors.length) return Object.freeze({ ok: false, rig: null, errors: Object.freeze(errors) });
  const rig = Object.freeze({
    format: RIG_FORMAT, formatVersion: RIG_FORMAT_VERSION,
    id: doc.id, version: doc.version, form: doc.form,
    name: typeof doc.name === 'string' ? doc.name.slice(0, 60) : doc.id,
    views: Object.freeze(views)
  });
  return Object.freeze({ ok: true, rig, errors: Object.freeze([]) });
}

// A view the author did not draw borrows the nearest drawn one. Profile and
// three-quarter share a silhouette more than either shares with the front.
const VIEW_FALLBACKS = Object.freeze({
  front: ['front'],
  'three-quarter': ['three-quarter', 'profile', 'front'],
  profile: ['profile', 'three-quarter', 'front'],
  back: ['back', 'front']
});

function resolveRigView(rig, view = 'front') {
  const chain = VIEW_FALLBACKS[view] || VIEW_FALLBACKS.front;
  const drawn = chain.find(candidate => rig?.views?.[candidate]);
  return drawn ? Object.freeze({ view: drawn, data: rig.views[drawn], exact: drawn === view }) : null;
}

function rigCacheKey(rig) { return rig ? `rig:${rig.id}@${rig.version}` : ''; }

export {
  RIG_FORMAT, RIG_FORMAT_VERSION, RIG_VIEWS, RIG_LAYERS, FACE_PARTS, LIMITS,
  VIEW_FALLBACKS, validateRig, resolveRigView, rigCacheKey
};
export default Object.freeze({
  RIG_FORMAT, RIG_FORMAT_VERSION, RIG_VIEWS, RIG_LAYERS, FACE_PARTS, LIMITS,
  VIEW_FALLBACKS, validateRig, resolveRigView, rigCacheKey
});
