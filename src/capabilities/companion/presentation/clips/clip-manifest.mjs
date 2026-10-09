'use strict';

// PET_VISUAL「动画表达方式与片段契约」: read-only presentation
// content, never persisted state. Hashes are supplied by an I/O-owning caller.
const CLIP_SCHEMA_VERSION = 1;
const RESERVED_MIRROR_ACTION_IDS = Object.freeze(['mirror-music', 'mirror-coding', 'mirror-ai']);
const CLIP_VIEWS = Object.freeze(['front', 'three-quarter', 'three-quarter-left', 'three-quarter-right', 'profile', 'back']);
const validatedManifests = new WeakSet();
const ID = /^[a-z][a-z0-9.-]{0,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const point = value => Array.isArray(value) && value.length === 2 && value.every(finite);
const rect = value => Array.isArray(value) && value.length === 4 && value.every(finite)
  && value[2] > 0 && value[3] > 0;
const has = (value, key) => Object.hasOwn(value, key);
const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => has(b, key) && same(a[key], b[key])));

function plainData(value, path, errors, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || finite(value)) return;
  if ((!record(value) && !(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype)) || ancestors.has(value)) {
    errors.push(`${path}: expected finite, acyclic plain data`); return;
  }
  ancestors.add(value);
  if (Array.isArray(value) && Object.keys(value).length !== value.length) errors.push(`${path}: sparse or extended array`);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !has(descriptor, 'value')
      || (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
      errors.push(`${path}.${String(key)}: expected plain data field`); continue;
    }
    plainData(descriptor.value, `${path}.${key}`, errors, ancestors);
  }
  ancestors.delete(value);
}

function closed(value, required, optional, path, errors) {
  if (!record(value)) { errors.push(`${path}: expected an object`); return false; }
  for (const key of required) if (!has(value, key)) errors.push(`${path}.${key}: required`);
  for (const key of Reflect.ownKeys(value)) {
    if (!required.includes(key) && !optional.includes(key)) errors.push(`${path}.${String(key)}: unknown field`);
    else if (!Object.getOwnPropertyDescriptor(value, key).enumerable
      || !has(Object.getOwnPropertyDescriptor(value, key), 'value')) errors.push(`${path}.${key}: expected plain data`);
  }
  return true;
}

function list(value, path, errors, { min = 1, max = 512 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max
    || Object.keys(value).length !== value.length) {
    errors.push(`${path}: expected ${min}..${max} entries`); return [];
  }
  return value;
}

function named(value, path, errors) {
  if (typeof value !== 'string' || !ID.test(value)) errors.push(`${path}: invalid id`);
}

function reason(value, path, errors) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) errors.push(`${path}: explicit reason required`);
}

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (record(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])));
  return value;
}

function contains(bounds, inner) {
  return inner[0] >= bounds[0] && inner[1] >= bounds[1]
    && inner[0] + inner[2] <= bounds[0] + bounds[2]
    && inner[1] + inner[3] <= bounds[1] + bounds[3];
}

function readAssets(group, path, expectedHashes, errors) {
  const assets = new Map(), sources = new Set();
  for (const [index, asset] of list(group.assets, `${path}.assets`, errors).entries()) {
    const at = `${path}.assets[${index}]`;
    if (!closed(asset, ['id', 'src', 'sha256'], [], at, errors)) continue;
    named(asset.id, `${at}.id`, errors);
    if (['body', 'face'].includes(asset.id) || assets.has(asset.id)) errors.push(`${at}.id: duplicate or reserved asset id`);
    if (sources.has(asset.src)) errors.push(`${at}.src: duplicate asset path`);
    sources.add(asset.src);
    if (typeof asset.src !== 'string' || !/^[a-zA-Z0-9_./-]+\.png$/.test(asset.src)
      || asset.src.startsWith('/') || asset.src.split('/').some(part => !part || part === '.' || part === '..' || part === 'sources')) {
      errors.push(`${at}.src: expected a packaged relative PNG path`);
    }
    if (!SHA256.test(asset.sha256) || typeof asset.sha256 !== 'string') errors.push(`${at}.sha256: invalid SHA-256`);
    if (!record(expectedHashes) || !has(expectedHashes, asset.src) || expectedHashes[asset.src] !== asset.sha256) {
      errors.push(`${at}.sha256: asset hash missing or mismatched`);
    }
    assets.set(asset.id, asset);
  }
  return assets;
}

function readPose(pose, path, manifest, assets, errors) {
  if (!closed(pose, ['id', 'at', 'frame', 'bodyRecolorMask', 'bounds', 'semanticAnchors', 'contacts', 'occlusionPlan'], [], path, errors)) return;
  named(pose.id, `${path}.id`, errors);
  if (!finite(pose.at) || pose.at < 0 || pose.at > 1) errors.push(`${path}.at: expected phase in [0,1]`);
  for (const field of ['frame', 'bodyRecolorMask']) {
    if (!assets.has(pose[field])) errors.push(`${path}.${field}: missing resource-group asset`);
  }
  if (pose.frame === pose.bodyRecolorMask) errors.push(`${path}.bodyRecolorMask: must be a separate body-only mask`);
  if (!rect(pose.bounds) || (rect(manifest.artBounds) && !contains(manifest.artBounds, pose.bounds))) {
    errors.push(`${path}.bounds: must fit artBounds`);
  }
  if (!record(pose.semanticAnchors)) errors.push(`${path}.semanticAnchors: expected an object`);
  else {
    for (const anchor of ['foot-left', 'foot-right', ...(manifest.faceMode === 'baked' ? [] : ['face'])]) {
      if (!has(pose.semanticAnchors, anchor)) errors.push(`${path}.semanticAnchors.${anchor}: required`);
    }
    for (const [anchor, value] of Object.entries(pose.semanticAnchors)) {
      named(anchor, `${path}.semanticAnchors.${anchor}`, errors);
      if (!point(value) || (rect(pose.bounds) && !contains(pose.bounds, [...value, 0, 0]))) {
        errors.push(`${path}.semanticAnchors.${anchor}: must be a local point inside bounds`);
      }
    }
  }
  if (closed(pose.contacts, ['left', 'right'], [], `${path}.contacts`, errors)) {
    for (const foot of ['left', 'right']) if (!['support', 'swing'].includes(pose.contacts[foot])) {
      errors.push(`${path}.contacts.${foot}: expected support or swing`);
    }
  }
  const plan = list(pose.occlusionPlan, `${path}.occlusionPlan`, errors);
  if (new Set(plan).size !== plan.length || plan.filter(id => id === 'body').length !== 1
    || plan.filter(id => id === 'face').length !== (manifest.faceMode === 'baked' ? 0 : 1)) {
    errors.push(`${path}.occlusionPlan: declare body once and overlay face once, or omit a baked face`);
  }
  for (const id of plan) if (!['body', 'face'].includes(id)
    && (!assets.has(id) || id === pose.bodyRecolorMask || id === pose.frame)) {
    errors.push(`${path}.occlusionPlan: unknown or non-overlay asset ${String(id)}`);
  }
}

function readGroups(manifest, expectedHashes, errors) {
  const groups = new Map();
  for (const [index, group] of list(manifest.resourceGroups, 'resourceGroups', errors, { max: 64 }).entries()) {
    const path = `resourceGroups[${index}]`;
    if (!closed(group, ['id', 'assets', 'poses', 'staticPose'], [], path, errors)) continue;
    named(group.id, `${path}.id`, errors);
    if (groups.has(group.id)) errors.push(`${path}.id: duplicate resource group`);
    groups.set(group.id, group);
    const assets = readAssets(group, path, expectedHashes, errors);
    const poses = list(group.poses, `${path}.poses`, errors, { min: 2 });
    const ids = new Set();
    for (const [poseIndex, pose] of poses.entries()) {
      const at = `${path}.poses[${poseIndex}]`;
      readPose(pose, at, manifest, assets, errors);
      if (!record(pose)) continue;
      if (ids.has(pose.id)) errors.push(`${at}.id: duplicate pose`);
      ids.add(pose.id);
      if (poseIndex > 0 && !(pose.at > poses[poseIndex - 1]?.at)) errors.push(`${at}.at: phases must increase strictly`);
    }
    if (poses[0]?.at !== 0 || poses.at(-1)?.at !== 1) errors.push(`${path}.poses: endpoints 0 and 1 required`);
    if (!ids.has(group.staticPose)) errors.push(`${path}.staticPose: unknown pose`);
    if (manifest.loop && poses.length >= 2) {
      for (const key of ['frame', 'bodyRecolorMask', 'bounds', 'semanticAnchors', 'contacts', 'occlusionPlan']) {
        if (!same(poses[0]?.[key], poses.at(-1)?.[key])) errors.push(`${path}.poses: loop seam differs in ${key}`);
      }
    }
  }
  return groups;
}

function readCompatibility(manifest, groups, errors) {
  const outfits = new Set(), usedGroups = new Set();
  for (const [index, row] of list(manifest.wardrobeCompatibility, 'wardrobeCompatibility', errors).entries()) {
    const path = `wardrobeCompatibility[${index}]`;
    if (!closed(row, ['wardrobeIds', 'status'], ['resourceGroup', 'reason', 'bakedFaceReason'], path, errors)) continue;
    const ids = list(row.wardrobeIds, `${path}.wardrobeIds`, errors, { min: 0, max: 16 });
    ids.forEach(id => named(id, `${path}.wardrobeIds`, errors));
    if (new Set(ids).size !== ids.length) errors.push(`${path}.wardrobeIds: duplicate outfit member`);
    const key = JSON.stringify([...ids].sort());
    if (outfits.has(key)) errors.push(`${path}.wardrobeIds: duplicate outfit combination`);
    outfits.add(key);
    if (!['supported', 'adapted', 'baked', 'unsupported'].includes(row.status)) errors.push(`${path}.status: unknown compatibility`);
    if (row.status !== 'supported' || has(row, 'reason')) reason(row.reason, `${path}.reason`, errors);
    if (row.status === 'unsupported') {
      if (has(row, 'resourceGroup') || has(row, 'bakedFaceReason')) errors.push(`${path}: unsupported outfit cannot select resources`);
      continue;
    }
    if (!groups.has(row.resourceGroup)) errors.push(`${path}.resourceGroup: required resource group missing`);
    else usedGroups.add(row.resourceGroup);
    if (manifest.faceMode === 'baked') reason(row.bakedFaceReason, `${path}.bakedFaceReason`, errors);
    else if (has(row, 'bakedFaceReason')) errors.push(`${path}.bakedFaceReason: only allowed for a baked face`);
  }
  for (const id of groups.keys()) if (!usedGroups.has(id)) errors.push(`resourceGroups.${id}: unused resource group`);
}

/** Validates one action/view and its exact outfit variants, without loading files. */
function validateClipManifest(input, { expectedIdentityRefSha256, expectedAssetHashes } = {}) {
  const errors = [];
  plainData(input, 'manifest', errors);
  if (errors.length) return Object.freeze({ ok: false, manifest: null, errors: Object.freeze(errors) });
  const required = ['schemaVersion', 'contentVersion', 'characterId', 'clipId', 'actionId', 'view', 'identityRefSha256',
    'designUnits', 'artBounds', 'groundAnchor', 'durationMs', 'loop', 'rootTravelPerLoop', 'resourceGroups', 'wardrobeCompatibility'];
  if (!closed(input, required, ['faceMode'], 'manifest', errors)) return Object.freeze({ ok: false, manifest: null, errors: Object.freeze(errors) });
  if (input.schemaVersion !== CLIP_SCHEMA_VERSION) errors.push('schemaVersion: unsupported clip schema');
  for (const field of ['contentVersion', 'characterId', 'clipId', 'actionId']) named(input[field], field, errors);
  if (!CLIP_VIEWS.includes(input.view)) errors.push('view: unsupported view');
  if (typeof input.identityRefSha256 !== 'string' || !SHA256.test(input.identityRefSha256)
    || input.identityRefSha256 !== expectedIdentityRefSha256) errors.push('identityRefSha256: reference hash missing or mismatched');
  for (const field of ['designUnits', 'durationMs']) if (!finite(input[field]) || input[field] <= 0) errors.push(`${field}: expected positive finite number`);
  if (!rect(input.artBounds)) errors.push('artBounds: expected finite local rectangle');
  if (!point(input.groundAnchor) || (rect(input.artBounds) && !contains(input.artBounds, [...input.groundAnchor, 0, 0]))) {
    errors.push('groundAnchor: expected local point inside artBounds');
  }
  if (typeof input.loop !== 'boolean') errors.push('loop: expected boolean');
  if (!finite(input.rootTravelPerLoop) || input.rootTravelPerLoop < 0) errors.push('rootTravelPerLoop: expected nonnegative design-unit distance');
  const faceMode = has(input, 'faceMode') ? input.faceMode : 'overlay';
  if (!['overlay', 'baked'].includes(faceMode)) errors.push('faceMode: expected overlay or baked');
  const normalized = { ...input, faceMode };
  const groups = readGroups(normalized, expectedAssetHashes, errors);
  readCompatibility(normalized, groups, errors);
  if (errors.length) return Object.freeze({ ok: false, manifest: null, errors: Object.freeze(errors) });
  const manifest = freezeCopy(normalized);
  validatedManifests.add(manifest);
  return Object.freeze({ ok: true, manifest, errors: Object.freeze([]) });
}

function isValidatedClipManifest(manifest) { return validatedManifests.has(manifest); }

export { CLIP_SCHEMA_VERSION, CLIP_VIEWS, RESERVED_MIRROR_ACTION_IDS, validateClipManifest, isValidatedClipManifest };
