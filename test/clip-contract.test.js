'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClipManifest, RESERVED_MIRROR_ACTION_IDS } = require('../src/capabilities/companion/presentation/clips/clip-manifest.mjs');
const { sampleClip } = require('../src/capabilities/companion/presentation/clips/clip-sampler.mjs');

// Synthetic metadata only: these hashes do not claim that real art was built,
// rendered, inspected for continuous foot slip, or accepted by the user.
function fixture() {
  const asset = id => ({ id, src: `clips/${id}.png`, sha256: 'b'.repeat(64) });
  const pose = (id, at, frame, left, leftContact) => ({
    id, at, frame, bodyRecolorMask: 'body-mask', bounds: [0, 0, 66, 66],
    semanticAnchors: { 'foot-left': left, 'foot-right': [42, 64], face: [33, 24] },
    contacts: { left: leftContact, right: leftContact === 'support' ? 'swing' : 'support' },
    occlusionPlan: ['body', 'face']
  });
  const bare = {
    id: 'bare', assets: ['frame-a', 'frame-b', 'frame-c', 'frame-d', 'body-mask'].map(asset),
    poses: [pose('start', 0, 'frame-a', [22, 64], 'support'), pose('planted', .25, 'frame-b', [16, 64], 'support'),
      pose('flight', .5, 'frame-c', [22, 60], 'swing'), pose('return', .75, 'frame-d', [28, 64], 'swing'),
      pose('end', 1, 'frame-a', [22, 64], 'support')],
    staticPose: 'planted'
  };
  const rain = structuredClone(bare);
  rain.id = 'rain';
  rain.assets.push(...['coat-back', 'coat-front', 'shoe-left', 'shoe-right'].map(asset));
  rain.poses.forEach(item => { item.occlusionPlan = ['coat-back', 'body', 'coat-front', 'face', 'shoe-left', 'shoe-right']; });
  const manifest = {
    schemaVersion: 1, contentVersion: 'dango-run-v1', characterId: 'dango', clipId: 'run-test',
    actionId: 'run', view: 'three-quarter', identityRefSha256: 'a'.repeat(64),
    designUnits: 66, artBounds: [0, 0, 66, 66], groundAnchor: [33, 64], durationMs: 950,
    loop: true, rootTravelPerLoop: 24, resourceGroups: [bare, rain],
    wardrobeCompatibility: [
      { wardrobeIds: [], status: 'supported', resourceGroup: 'bare' },
      { wardrobeIds: ['coat', 'boot-left', 'boot-right'], status: 'adapted', resourceGroup: 'rain', reason: 'Dedicated garment and independent shoe layers' },
      { wardrobeIds: ['winter-coat'], status: 'unsupported', reason: 'No authored pose layers yet' }
    ]
  };
  const expected = {
    expectedIdentityRefSha256: manifest.identityRefSha256,
    expectedAssetHashes: Object.fromEntries(manifest.resourceGroups.flatMap(group => group.assets.map(item => [item.src, item.sha256])))
  };
  return { manifest, expected };
}

function validated(source = fixture()) {
  const result = validateClipManifest(source.manifest, source.expected);
  assert.equal(result.ok, true, result.errors.join('\n'));
  return result.manifest;
}

function intent(manifest, changes = {}) {
  const row = manifest.wardrobeCompatibility.find(item => JSON.stringify([...item.wardrobeIds].sort())
    === JSON.stringify([...(changes.wardrobeIds ?? [])].sort()));
  return { actionId: manifest.actionId, view: manifest.view, wardrobeIds: [], elapsedMs: 0,
    readyBundle: { characterId: manifest.characterId, clipId: manifest.clipId,
      contentVersion: manifest.contentVersion, resourceGroup: row?.resourceGroup,
      assetIds: [...new Set(manifest.resourceGroups.flatMap(group => group.assets.map(asset => asset.id)))] }, ...changes };
}

function atPath(value, path) { return path.reduce((node, key) => node[key], value); }

function reject(change, pattern) {
  const source = fixture();
  change(source.manifest, source.expected);
  const result = validateClipManifest(source.manifest, source.expected);
  assert.equal(result.ok, false);
  assert.equal(result.manifest, null);
  assert.ok(result.errors.length > 0);
  if (pattern) assert.match(result.errors.join('\n'), pattern);
}

test('clip manifest normalizes only overlay default and freezes a defensive copy', () => {
  const source = fixture(), manifest = validated(source);
  assert.equal(manifest.faceMode, 'overlay');
  assert.equal(source.manifest.faceMode, undefined);
  source.manifest.resourceGroups[0].poses[0].semanticAnchors['foot-left'][0] = 900;
  source.manifest.resourceGroups[0].assets[0].sha256 = 'c'.repeat(64);
  source.manifest.wardrobeCompatibility[0].wardrobeIds.push('winter-coat');
  assert.equal(manifest.resourceGroups[0].poses[0].semanticAnchors['foot-left'][0], 22);
  assert.equal(manifest.resourceGroups[0].assets[0].sha256, 'b'.repeat(64));
  assert.deepEqual(manifest.wardrobeCompatibility[0].wardrobeIds, []);
  function frozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(manifest);
  assert.throws(() => { manifest.resourceGroups[0].poses[0].bounds[0] = 99; }, TypeError);
});

test('every required manifest, group, asset, pose, contact and compatibility field fails closed when missing', async t => {
  const fields = [
    [[], Object.keys(fixture().manifest)],
    [['resourceGroups', 0], ['id', 'assets', 'poses', 'staticPose']],
    [['resourceGroups', 0, 'assets', 0], ['id', 'src', 'sha256']],
    [['resourceGroups', 0, 'poses', 1], ['id', 'at', 'frame', 'bodyRecolorMask', 'bounds', 'semanticAnchors', 'contacts', 'occlusionPlan']],
    [['resourceGroups', 0, 'poses', 1, 'contacts'], ['left', 'right']],
    [['resourceGroups', 0, 'poses', 1, 'semanticAnchors'], ['foot-left', 'foot-right', 'face']],
    [['wardrobeCompatibility', 0], ['wardrobeIds', 'status', 'resourceGroup']],
    [['wardrobeCompatibility', 1], ['reason']],
    [['wardrobeCompatibility', 2], ['reason']]
  ];
  for (const [path, keys] of fields) for (const key of keys) {
    await t.test([...path, key].join('.'), () => reject(manifest => { delete atPath(manifest, path)[key]; }));
  }
});

test('unknown keys fail closed at every fixed object level and array container', async t => {
  const paths = [[], ['resourceGroups', 0], ['resourceGroups', 0, 'assets', 0],
    ['resourceGroups', 0, 'poses', 0], ['resourceGroups', 0, 'poses', 0, 'contacts'],
    ['wardrobeCompatibility', 0], ['resourceGroups'], ['resourceGroups', 0, 'poses', 0, 'bounds']];
  for (const path of paths) await t.test(path.join('.') || 'manifest', () => reject(manifest => {
    atPath(manifest, path).surprise = true;
  }, /unknown field|plain data field|extended array/));
});

test('plain-data validation rejects sparse arrays, symbols, getters, cycles and nonfinite numbers without executing code', () => {
  const paths = [['resourceGroups'], ['resourceGroups', 0, 'assets'], ['resourceGroups', 0, 'poses'],
    ['resourceGroups', 0, 'poses', 0, 'bounds'], ['resourceGroups', 0, 'poses', 0, 'semanticAnchors', 'foot-left'],
    ['resourceGroups', 0, 'poses', 0, 'occlusionPlan'], ['wardrobeCompatibility', 1, 'wardrobeIds']];
  for (const path of paths) reject(manifest => { delete atPath(manifest, path)[0]; }, /sparse/);
  reject(manifest => { delete manifest.groundAnchor[0]; manifest.groundAnchor.extra = 1; }, /plain data field/);
  reject(manifest => { manifest.resourceGroups[0].poses[0].semanticAnchors[Symbol('hidden')] = [1, 2]; }, /plain data field/);
  let invoked = false;
  reject(manifest => { Object.defineProperty(manifest, 'faceMode', { enumerable: true, get() { invoked = true; throw new Error('must not run'); } }); });
  assert.equal(invoked, false);
  reject(manifest => { manifest.resourceGroups[0].poses[0].semanticAnchors.circular = manifest; }, /acyclic/);
  for (const bad of [NaN, Infinity, -Infinity, undefined, () => {}, Symbol('value'), 1n]) {
    reject(manifest => { manifest.durationMs = bad; });
  }
  for (const bad of [NaN, Infinity, -Infinity]) {
    reject(manifest => { manifest.resourceGroups[0].poses[0].semanticAnchors.face[0] = bad; });
  }
});

test('unsupported versions, empty resources, duplicate identities and invalid geometry are rejected', () => {
  reject(manifest => { manifest.schemaVersion = 2; }, /unsupported clip schema/);
  reject(manifest => { manifest.resourceGroups = []; });
  reject(manifest => { manifest.resourceGroups[0].assets = []; });
  reject(manifest => { manifest.resourceGroups[0].poses = []; });
  reject(manifest => { manifest.wardrobeCompatibility = []; });
  reject(manifest => { manifest.resourceGroups[1].id = 'bare'; }, /duplicate resource group/);
  reject(manifest => { manifest.resourceGroups[0].assets[1].id = 'frame-a'; }, /duplicate/);
  reject(manifest => { manifest.resourceGroups[0].assets[1].src = 'clips/frame-a.png'; }, /duplicate asset path/);
  reject(manifest => { manifest.resourceGroups[0].poses[1].id = 'start'; }, /duplicate pose/);
  reject(manifest => { manifest.wardrobeCompatibility[1].wardrobeIds = []; }, /duplicate outfit/);
  reject(manifest => { manifest.wardrobeCompatibility[1].wardrobeIds = ['coat', 'coat']; }, /duplicate outfit member/);
  reject(manifest => { manifest.resourceGroups[0].staticPose = 'absent'; }, /unknown pose/);
  reject(manifest => { manifest.wardrobeCompatibility[0].resourceGroup = 'absent'; }, /resource group missing/);
  reject(manifest => { manifest.resourceGroups[0].poses[0].bounds[2] = 67; }, /artBounds/);
  reject(manifest => { manifest.resourceGroups[0].poses[0].semanticAnchors.face = [100, 100]; }, /inside bounds/);
  reject(manifest => { manifest.groundAnchor = [-1, 64]; }, /inside artBounds/);
  for (const field of ['durationMs', 'designUnits']) reject(manifest => { manifest[field] = 0; });
  reject(manifest => { manifest.rootTravelPerLoop = -1; });
  reject(manifest => { manifest.loop = 'true'; });
  reject(manifest => { manifest.view = 'unknown'; });
  reject(manifest => { manifest.resourceGroups[0].poses[1].contacts.left = 'maybe'; });
  reject(manifest => { manifest.wardrobeCompatibility[0].status = 'assumed'; });
});

test('every referenced frame, mask and clothing layer must exist in its resource group', () => {
  const source = fixture();
  for (let index = 0; index < source.manifest.resourceGroups[1].assets.length; index += 1) {
    reject(manifest => { manifest.resourceGroups[1].assets.splice(index, 1); }, /missing resource-group asset|unknown or non-overlay/);
  }
  reject(manifest => { manifest.resourceGroups[0].poses[0].bodyRecolorMask = 'frame-a'; }, /separate body-only mask/);
  reject(manifest => { manifest.resourceGroups[0].poses[0].occlusionPlan.push('body-mask'); }, /non-overlay/);
  reject(manifest => { manifest.resourceGroups[0].poses[0].occlusionPlan.push('body'); }, /declare body once/);
});

test('reference and every asset hash must match caller-verified inputs', () => {
  const source = fixture();
  assert.equal(validateClipManifest(source.manifest).ok, false);
  reject((manifest, expected) => { expected.expectedIdentityRefSha256 = 'c'.repeat(64); }, /reference hash/);
  reject(manifest => { manifest.identityRefSha256 = 'malformed'; }, /reference hash/);
  reject(manifest => { manifest.identityRefSha256 = 'c'.repeat(64); }, /reference hash/);
  for (const asset of source.manifest.resourceGroups[1].assets) {
    reject((manifest, expected) => { delete expected.expectedAssetHashes[asset.src]; }, /asset hash/);
    reject((manifest, expected) => { expected.expectedAssetHashes[asset.src] = 'c'.repeat(64); }, /asset hash/);
  }
  for (const bad of ['malformed', 'B'.repeat(64), 'c'.repeat(64)]) {
    reject(manifest => { manifest.resourceGroups[0].assets[0].sha256 = bad; }, /SHA-256|asset hash/);
  }
});

test('asset URLs, absolute paths, source-only inputs and traversal are not runtime resources', () => {
  for (const src of ['https://example.com/a.png', 'file:///tmp/a.png', '/tmp/a.png', '../a.png', 'a/../b.png',
    'a/./b.png', 'a//b.png', 'sources/a.png', 'clips/sources/a.png', 'a\\b.png', 'a.png?token=x', 'a.svg']) {
    reject((manifest, expected) => {
      manifest.resourceGroups[0].assets[0].src = src;
      expected.expectedAssetHashes[src] = 'b'.repeat(64);
    }, /packaged relative PNG/);
  }
});

test('loop metadata requires exact endpoints and a closed seam, independent of object key order', () => {
  reject(manifest => { manifest.resourceGroups[0].poses[0].at = .1; }, /endpoints/);
  reject(manifest => { manifest.resourceGroups[0].poses.at(-1).at = .9; }, /endpoints/);
  reject(manifest => { manifest.resourceGroups[0].poses[2].at = .25; }, /increase strictly/);
  for (const key of ['frame', 'bodyRecolorMask', 'bounds', 'semanticAnchors', 'contacts', 'occlusionPlan']) {
    reject(manifest => { manifest.resourceGroups[0].poses.at(-1)[key] = null; }, /loop seam/);
  }
  const source = fixture();
  source.manifest.resourceGroups[0].poses.at(-1).semanticAnchors = { face: [33, 24], 'foot-right': [42, 64], 'foot-left': [22, 64] };
  validated(source);
});

test('supported, adapted, baked and unsupported outfit rows are explicit; baked faces require a per-row exception', () => {
  for (const status of ['supported', 'adapted', 'baked', 'unsupported']) {
    const source = fixture(), row = source.manifest.wardrobeCompatibility[1];
    row.status = status;
    if (status === 'unsupported') {
      delete row.resourceGroup;
      source.manifest.resourceGroups.pop();
    }
    assert.equal(validated(source).wardrobeCompatibility[1].status, status);
  }
  reject(manifest => { manifest.faceMode = 'automatic'; }, /faceMode/);
  reject(manifest => { manifest.faceMode = 'baked'; }, /bakedFaceReason/);
  reject(manifest => { manifest.wardrobeCompatibility[0].bakedFaceReason = 'Unnecessary'; }, /only allowed/);
  reject(manifest => { manifest.wardrobeCompatibility[2].resourceGroup = 'bare'; }, /unsupported outfit/);
  const source = fixture();
  source.manifest.faceMode = 'baked';
  for (const group of source.manifest.resourceGroups) for (const pose of group.poses) {
    pose.occlusionPlan = pose.occlusionPlan.filter(id => id !== 'face');
    delete pose.semanticAnchors.face;
  }
  for (const row of source.manifest.wardrobeCompatibility.filter(item => item.status !== 'unsupported')) row.bakedFaceReason = 'Authored face compression for this outfit';
  const manifest = validated(source);
  assert.equal(sampleClip(manifest, intent(manifest)).faceMode, 'baked');
  delete source.manifest.wardrobeCompatibility[1].bakedFaceReason;
  assert.equal(validateClipManifest(source.manifest, source.expected).ok, false);
});

test('sampling cannot bypass hash validation by cloning or inheriting a validated document', () => {
  const source = fixture(), manifest = validated(source);
  for (const candidate of [source.manifest, structuredClone(manifest), { ...manifest }, Object.create(manifest), null]) {
    assert.equal(sampleClip(candidate, intent(manifest)).reason, 'unvalidated-manifest');
  }
});

test('caller time and progress produce deterministic holds and loop without owning a clock', () => {
  const manifest = validated();
  const start = sampleClip(manifest, intent(manifest));
  assert.equal(start.poseId, 'start');
  assert.equal(sampleClip(manifest, intent(manifest, { elapsedMs: 950 / 4 })).poseId, 'planted');
  assert.equal(sampleClip(manifest, intent(manifest, { phase01: .5, elapsedMs: 0 })).poseId, 'flight');
  assert.equal(sampleClip(manifest, intent(manifest, { phase01: 10.75 })).poseId, 'return');
  assert.equal(sampleClip(manifest, intent(manifest, { phase01: -.25 })).poseId, 'return');
  assert.deepEqual(sampleClip(manifest, intent(manifest, { elapsedMs: 950 })), start);
  assert.deepEqual(sampleClip(manifest, intent(manifest, { elapsedMs: 950 * 1000 })), start);
  assert.equal(sampleClip(manifest, intent(manifest, { phase01: 1, phase: 'exit' })).poseId, 'end');
  assert.equal(sampleClip(manifest, intent(manifest, { phase01: -1, phase: 'enter' })).poseId, 'start');
  const source = fixture();
  source.manifest.loop = false;
  const oneShot = validated(source);
  assert.equal(sampleClip(oneShot, intent(oneShot, { phase01: 3 })).poseId, 'end');
  const fractional = fixture();
  fractional.manifest.resourceGroups[0].poses[1].at = .4;
  const decimal = validated(fractional);
  assert.equal(sampleClip(decimal, intent(decimal, { phase01: .4 })).poseId, 'planted', 'modulo does not round a positive authored boundary down');
});

test('injected distance aligns authored support samples and scale, while bounds and anchors stay local', () => {
  const manifest = validated(), scale = 1.5;
  const first = sampleClip(manifest, intent(manifest, { locomotion: { distancePx: 0 }, pixelsPerUnit: scale }));
  const quarter = sampleClip(manifest, intent(manifest, { locomotion: { distancePx: 9, speedPxPerSec: 36 }, pixelsPerUnit: scale }));
  assert.equal(quarter.phase01, .25);
  assert.equal(quarter.contactPhase.left, 'support');
  assert.deepEqual(quarter.rootDisplacementPx, [9, 0]);
  assert.deepEqual(quarter.bounds, [0, 0, 66, 66]);
  assert.deepEqual(quarter.semanticAnchors['foot-left'], [16, 64]);
  assert.equal(first.semanticAnchors['foot-left'][0] * scale + first.rootDisplacementPx[0],
    quarter.semanticAnchors['foot-left'][0] * scale + quarter.rootDisplacementPx[0]);
  const full = sampleClip(manifest, intent(manifest, { locomotion: { distancePx: 36 }, pixelsPerUnit: scale }));
  assert.equal(full.phase01, 0);
  assert.equal(full.frame, first.frame);
  assert.deepEqual(full.semanticAnchors, first.semanticAnchors);
  assert.deepEqual(full.rootDisplacementPx, [36, 0]);
  assert.deepEqual(quarter.occlusionPlan, ['body', 'face']);
});

test('low stimulus and reduced motion immediately hold the authored staticPose with zero displacement', () => {
  const manifest = validated();
  const expected = sampleClip(manifest, intent(manifest, { reducedMotion: true }));
  assert.equal(expected.poseId, 'planted');
  assert.equal(expected.staticPose, true);
  assert.deepEqual(expected.rootDisplacementPx, [0, 0]);
  for (const policy of ['calmVisual', 'reducedMotion']) for (const elapsedMs of [0, 100, 950, 1e8]) {
    const sample = sampleClip(manifest, intent(manifest, { [policy]: true, elapsedMs, phase01: .9, locomotion: { distancePx: 9999 } }));
    assert.deepEqual(sample, expected);
  }
  assert.deepEqual(sampleClip(manifest, intent(manifest, { reducedMotion: true, elapsedMs: NaN, phase01: Infinity })), expected,
    'stopping motion does not wait for timing to become usable');
});

test('partial resources never expose animation or static poses; every selected group asset must be ready', () => {
  const manifest = validated(), wardrobeIds = ['boot-right', 'coat', 'boot-left'];
  const request = intent(manifest, { wardrobeIds });
  assert.equal(sampleClip(manifest, request).resourceGroup, 'rain');
  assert.equal(sampleClip(manifest, request).compatibility, 'adapted');
  for (const asset of manifest.resourceGroups[1].assets) for (const reducedMotion of [false, true]) {
    assert.equal(sampleClip(manifest, { ...request, reducedMotion,
      readyBundle: { ...request.readyBundle, assetIds: request.readyBundle.assetIds.filter(id => id !== asset.id) } }).reason, 'resource-group-not-ready');
  }
  assert.equal(sampleClip(manifest, { ...request, readyBundle: undefined }).reason, 'missing-readiness');
  assert.equal(sampleClip(manifest, { ...request, readyBundle: { ...request.readyBundle, assetIds: [] } }).reason, 'resource-group-not-ready');
  assert.equal(sampleClip(manifest, intent(manifest, { readyBundle: { characterId: manifest.characterId,
    clipId: manifest.clipId, contentVersion: manifest.contentVersion,
    resourceGroup: 'bare', assetIds: manifest.resourceGroups[0].assets.map(asset => asset.id) } })).ok, true,
    'an unselected outfit does not block a complete selected group');
});

test('readiness from another character, clip, group or content version cannot authorize same-named new assets', () => {
  const source = fixture();
  const asset = source.manifest.resourceGroups[1].assets[0];
  asset.src = 'clips/rain-frame-a.png';
  asset.sha256 = 'c'.repeat(64);
  source.expected.expectedAssetHashes[asset.src] = asset.sha256;
  const manifest = validated(source);
  const request = intent(manifest, { wardrobeIds: ['coat', 'boot-left', 'boot-right'] });
  assert.equal(sampleClip(manifest, request).ok, true);
  for (const change of [{ characterId: 'usagi' }, { clipId: 'other-clip' }, { resourceGroup: 'bare' }, { contentVersion: 'dango-run-v0' }]) {
    for (const reducedMotion of [false, true]) {
      assert.equal(sampleClip(manifest, { ...request, reducedMotion, readyBundle: { ...request.readyBundle, ...change } }).reason, 'stale-readiness');
    }
  }
});

test('action, view and exact outfit identity never silently fall back, including reserved mirror action ids', () => {
  assert.deepEqual(RESERVED_MIRROR_ACTION_IDS, ['mirror-music', 'mirror-coding', 'mirror-ai']);
  for (const actionId of RESERVED_MIRROR_ACTION_IDS) {
    const source = fixture();
    source.manifest.actionId = actionId;
    const manifest = validated(source);
    assert.equal(sampleClip(manifest, intent(manifest)).actionId, actionId);
  }
  const manifest = validated();
  assert.equal(sampleClip(manifest, intent(manifest, { actionId: 'mirror-ai' })).reason, 'action-mismatch');
  assert.equal(sampleClip(manifest, intent(manifest, { view: 'front' })).reason, 'view-mismatch');
  assert.equal(sampleClip(manifest, intent(manifest, { wardrobeIds: ['coat'] })).reason, 'undeclared-outfit');
  assert.equal(sampleClip(manifest, intent(manifest, { wardrobeIds: ['winter-coat'] })).reason, 'unsupported-outfit');
});

test('invalid injected timing, scale, motion policy and selection fail without throwing', () => {
  const manifest = validated();
  const requests = [
    { elapsedMs: NaN }, { elapsedMs: Infinity }, { elapsedMs: -1 }, { phase01: NaN }, { phase01: Infinity },
    { elapsedMs: undefined }, { phase: 'unknown' }, { pixelsPerUnit: 0 }, { pixelsPerUnit: Infinity },
    { locomotion: { distancePx: NaN } }, { locomotion: { distancePx: 1, speedPxPerSec: Infinity } },
    { reducedMotion: 'true' }, { calmVisual: 1 }, { wardrobeIds: ['coat', 'coat'] }, { wardrobeIds: [null] }
  ];
  for (const changes of requests) {
    const result = sampleClip(manifest, intent(manifest, changes));
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.equal(result.sample, null);
  }
});
