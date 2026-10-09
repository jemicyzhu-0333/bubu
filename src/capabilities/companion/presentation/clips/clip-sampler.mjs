'use strict';

import { isValidatedClipManifest } from './clip-manifest.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = reason => Object.freeze({ ok: false, reason, sample: null });
const clamp = value => Math.max(0, Math.min(1, value));
const outfitKey = ids => JSON.stringify([...ids].sort());

function wrap(value) {
  const remainder = value % 1;
  return remainder < 0 ? remainder + 1 : remainder || 0;
}

// PET_VISUAL「动画表达方式与片段契约」: no clock, scheduler, renderer, cache or effects.
// Poses are authored holds, not cross-faded bitmaps. All geometry stays local;
// rootDisplacementPx is a separate caller-owned value, never added to anchors.
// For locomotion, distance determines gait phase at the injected display scale.
function sampleClip(manifest, intent) {
  if (!isValidatedClipManifest(manifest)) return fail('unvalidated-manifest');
  if (!intent || typeof intent !== 'object') return fail('invalid-intent');
  if (intent.actionId !== manifest.actionId) return fail('action-mismatch');
  if (intent.view !== manifest.view) return fail('view-mismatch');
  const wardrobeIds = intent.wardrobeIds ?? [];
  if (!Array.isArray(wardrobeIds) || wardrobeIds.some(id => typeof id !== 'string')
    || new Set(wardrobeIds).size !== wardrobeIds.length) return fail('invalid-wardrobe');
  const row = manifest.wardrobeCompatibility.find(item => outfitKey(item.wardrobeIds) === outfitKey(wardrobeIds));
  if (!row) return fail('undeclared-outfit');
  if (row.status === 'unsupported') return fail('unsupported-outfit');
  const group = manifest.resourceGroups.find(item => item.id === row.resourceGroup);
  // The resource owner supplies decoded-ready evidence for this exact version
  // and group. A prior outfit's identically named frame is not readiness.
  const ready = intent.readyBundle;
  if (!ready || !Array.isArray(ready.assetIds) || ready.assetIds.some(id => typeof id !== 'string')) return fail('missing-readiness');
  if (ready.characterId !== manifest.characterId || ready.clipId !== manifest.clipId
    || ready.contentVersion !== manifest.contentVersion || ready.resourceGroup !== group.id) return fail('stale-readiness');
  if (!group.assets.every(asset => ready.assetIds.includes(asset.id))) return fail('resource-group-not-ready');
  const still = intent.reducedMotion === true || intent.calmVisual === true;
  if (['reducedMotion', 'calmVisual'].some(key => intent[key] !== undefined && typeof intent[key] !== 'boolean')) {
    return fail('invalid-motion-policy');
  }
  const phase = intent.phase ?? 'loop';
  if (!['enter', 'loop', 'exit'].includes(phase)) return fail('invalid-phase');
  let progress = 0, distancePx = 0;
  if (!still) {
    const timing = sampleProgress(manifest, intent);
    if (!timing.ok) return timing;
    progress = manifest.loop && phase === 'loop' ? wrap(timing.progress) : clamp(timing.progress);
    distancePx = timing.distancePx;
  }
  const pose = still ? group.poses.find(item => item.id === group.staticPose)
    : group.poses.findLast(item => item.at <= progress);
  return Object.freeze({
    ok: true, clipId: manifest.clipId, contentVersion: manifest.contentVersion,
    actionId: manifest.actionId, view: manifest.view, wardrobeIds: row.wardrobeIds,
    compatibility: row.status, resourceGroup: group.id,
    poseId: pose.id, frame: pose.frame, bodyRecolorMask: pose.bodyRecolorMask,
    faceMode: manifest.faceMode, semanticAnchors: pose.semanticAnchors,
    occlusionPlan: pose.occlusionPlan, bounds: pose.bounds, groundAnchor: manifest.groundAnchor,
    contactPhase: pose.contacts, phase01: still ? pose.at : progress,
    rootDisplacementPx: Object.freeze([distancePx, 0]), staticPose: still
  });
}

function sampleProgress(manifest, intent) {
  const pixelsPerUnit = intent.pixelsPerUnit ?? 1;
  if (!finite(pixelsPerUnit) || pixelsPerUnit <= 0) return fail('invalid-scale');
  let distancePx = 0;
  if (intent.locomotion !== undefined) {
    if (!intent.locomotion || !finite(intent.locomotion.distancePx)
      || (intent.locomotion.speedPxPerSec !== undefined && !finite(intent.locomotion.speedPxPerSec))) return fail('invalid-locomotion');
    distancePx = intent.locomotion.distancePx;
  }
  if (intent.phase01 !== undefined && !finite(intent.phase01)) return fail('invalid-progress');
  if (intent.elapsedMs !== undefined && (!finite(intent.elapsedMs) || intent.elapsedMs < 0)) return fail('invalid-time');
  let progress;
  if (intent.locomotion !== undefined && manifest.rootTravelPerLoop > 0) {
    progress = distancePx / pixelsPerUnit / manifest.rootTravelPerLoop;
  } else if (intent.phase01 !== undefined) progress = intent.phase01;
  else if (intent.elapsedMs !== undefined) progress = intent.elapsedMs / manifest.durationMs;
  else return fail('missing-time-or-progress');
  if (!finite(progress)) return fail('invalid-progress');
  return { ok: true, progress, distancePx };
}

export { sampleClip };
