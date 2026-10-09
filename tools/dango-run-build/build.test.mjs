import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DANGO_RUN } from '../../assets/companion/dango/clips/run/dango-run.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { validateClipManifest } from '../../src/capabilities/companion/presentation/clips/clip-manifest.mjs';
import { sampleClip } from '../../src/capabilities/companion/presentation/clips/clip-sampler.mjs';

const expected = { expectedIdentityRefSha256: DANGO_RUN.identityRefSha256,
  expectedAssetHashes: DANGO_RUN.expectedAssetHashes };
const validated = () => {
  const result = validateClipManifest(DANGO_RUN.manifest, expected);
  assert.equal(result.ok, true, result.errors.join('\n'));
  return result.manifest;
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} must be within ${tolerance} of ${expected}`);

test('source-derived run manifest validates exactly 24 poses and complete body/mask resources', () => {
  const manifest = validated(), group = manifest.resourceGroups[0];
  assert.equal(manifest.actionId, 'chase-laser');
  assert.equal(manifest.view, 'three-quarter');
  assert.equal(manifest.faceMode, 'overlay');
  assert.equal(manifest.durationMs, 950);
  assert.equal(group.poses.length, 25);
  assert.equal(group.assets.length, 48);
  assert.deepEqual(manifest.wardrobeCompatibility, [{ wardrobeIds: [], status: 'supported', resourceGroup: 'bare' }]);
  for (const [index, pose] of group.poses.slice(0, 24).entries()) {
    close(pose.at, index / 24);
    assert.notEqual(pose.frame, pose.bodyRecolorMask);
    assert.deepEqual(pose.occlusionPlan, ['body', 'face']);
    assert.ok(Object.isFrozen(DANGO_RUN.faceTransforms[pose.id]));
  }
  assert.deepEqual(DANGO_RUN.faceTransforms['run-seam'], DANGO_RUN.faceTransforms['run-00']);
});

test('every generated PNG is packaged-relative, 256 square RGBA and independently hash-pinned', () => {
  for (const asset of validated().resourceGroups[0].assets) {
    const bytes = fs.readFileSync(new URL(asset.src, DANGO_RUN.baseUrl));
    assert.equal(sha256(bytes), asset.sha256, asset.src);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), 256);
    assert.equal(bytes.readUInt32BE(20), 256);
    assert.equal(bytes[24], 8);
    assert.equal(bytes[25], 6);
  }
});

test('shared geometry fits immutable production bounds without per-frame normalization', () => {
  const manifest = validated(), [x, y, width, height] = manifest.artBounds;
  const production = DANGO_RASTER.artBounds;
  assert.ok(x >= production.x && y >= production.y
    && x + width <= production.x + production.width && y + height <= production.y + production.height);
  for (const pose of manifest.resourceGroups[0].poses) assert.deepEqual(pose.bounds, manifest.artBounds);
  close(manifest.groundAnchor[1], 64 + 2 * 64 / 390);
  close(DANGO_RUN.spriteRect[2], 512 * 64 / 390);
  const [a, b, c, d] = DANGO_RUN.faceTransforms['run-00'];
  close(a * d - b * c, 1);
  close(a * a + b * b, 1);
  close(a * c + b * d, 0);
  for (const matrix of Object.values(DANGO_RUN.faceTransforms)) {
    assert.deepEqual(matrix.slice(0, 5), DANGO_RUN.faceTransforms['run-00'].slice(0, 5));
  }
});

test('authored support contacts stay grounded and cancel root travel at sampled pose times', () => {
  const manifest = validated(), poses = manifest.resourceGroups[0].poses.slice(0, 24);
  for (const side of ['left', 'right']) {
    const supports = poses.filter(pose => pose.contacts[side] === 'support');
    assert.equal(supports.length, 10);
    const rootContact = supports[0].semanticAnchors[`foot-${side}`][0] + supports[0].at * manifest.rootTravelPerLoop;
    for (const pose of supports) {
      const foot = pose.semanticAnchors[`foot-${side}`];
      close(foot[1], manifest.groundAnchor[1]);
      close(foot[0] + pose.at * manifest.rootTravelPerLoop, rootContact);
    }
  }
  assert.equal(poses.filter(pose => Object.values(pose.contacts).every(state => state === 'swing')).length, 4);
});

test('all 24 time samples are reachable, loop closes, calm freezes and undeclared clothes fail closed', () => {
  const manifest = validated(), group = manifest.resourceGroups[0];
  const base = { actionId: manifest.actionId, view: manifest.view,
    readyBundle: { characterId: manifest.characterId, clipId: manifest.clipId,
      contentVersion: manifest.contentVersion, resourceGroup: group.id, assetIds: group.assets.map(asset => asset.id) } };
  for (let index = 0; index < 24; index++) {
    assert.equal(sampleClip(manifest, { ...base, phase01: index / 24 + 1e-8 }).poseId, `run-${String(index).padStart(2, '0')}`);
  }
  assert.equal(sampleClip(manifest, { ...base, phase01: 1 }).poseId, 'run-00');
  assert.equal(sampleClip(manifest, { ...base, phase01: .75, reducedMotion: true }).poseId, 'run-00');
  assert.equal(sampleClip(manifest, { ...base, phase01: .75, wardrobeIds: ['boots'] }).reason, 'undeclared-outfit');
});

test('retained build record proves all 24 canonical neutral and silhouette identities', () => {
  const record = JSON.parse(fs.readFileSync(new URL('build-record.json', DANGO_RUN.baseUrl)));
  assert.equal(record.checks.length, 24);
  for (const check of record.checks) {
    assert.equal(check.baselineReproduced, true);
    assert.equal(check.neutralRecompositionExact, true);
    assert.equal(check.silhouetteUnchanged, true);
    assert.equal(check.trajectoryUnchanged, true);
  }
  assert.equal(record.faceMode, 'overlay');
  assert.equal(record.phaseCount, 24);
});
