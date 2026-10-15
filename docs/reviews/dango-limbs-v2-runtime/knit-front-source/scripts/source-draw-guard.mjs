import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production source-contribution QA. A query is URL metadata, never a local filename.
export function normalizeLocalImageRequest(value) {
  if (value instanceof URL || typeof value === 'string' && value.startsWith('file:')) {
    const url = new URL(value);
    if (url.protocol !== 'file:') throw new TypeError('candidate image URL must use file:');
    url.search = ''; url.hash = '';
    return path.normalize(fileURLToPath(url));
  }
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError('candidate image request must be a file URL or absolute path');
  }
  return path.normalize(value);
}

const dimensions = image => [image?.naturalWidth || image?.width, image?.naturalHeight || image?.height];
const sameSet = (a, b) => a.length === b.length && a.every(value => b.includes(value));
// Dango Artwork carries parts/face/rootJoins under data, plus clipping,
// eye projection, attachment transforms and wardrobe visibility at top level.
// Keep all of it. Only the non-serializable painter handle and load counter
// are excluded; painter presence is retained and both renders use the same code.
const poseSignature = artwork => JSON.stringify({
  ...Object.fromEntries(Object.entries(artwork || {}).filter(([key]) =>
    key !== 'limbPainter' && key !== 'sourceRevision')),
  limbPainterPresent: Boolean(artwork?.limbPainter)
});
function assertRenderInputs(actual, control, prefix) {
  for (const [kind, input] of [['actual', actual], ['omitted', control]]) {
    assert.ok(input?.manifest?.views && input.manifest.tools,
      `${prefix}: ${kind} renderInputs must include the complete raster manifest`);
    assert.ok(input.frame && typeof input.frame === 'object',
      `${prefix}: ${kind} renderInputs must include the complete deterministic frame inputs`);
  }
  // Tools/effects/appearance are closed over by the production artist and
  // cannot be recovered from artwork.contact or artwork.data alone.
  assert.deepEqual(actual, control, `${prefix}: control changed manifest or frame inputs`);
}

export function createSourceDrawGuard({ targets, loadImage, createSurface }) {
  assert.equal(typeof loadImage, 'function', 'loadImage is required');
  assert.equal(typeof createSurface, 'function', 'createSurface is required');
  assert.ok(Array.isArray(targets) && targets.length, 'targets are required');
  const byId = new Map(), byRequest = new Map(), observedStages = new WeakMap();
  for (const spec of targets) {
    assert.ok(spec.id && spec.spriteKey, 'each target needs id and actual hand spriteKey');
    assert.ok(!byId.has(spec.id), `duplicate target id: ${spec.id}`);
    const target = { ...spec, request: normalizeLocalImageRequest(spec.request),
      filePath: normalizeLocalImageRequest(spec.filePath), normal: { requested: 0, loaded: 0, pending: 0, failures: [] },
      omitted: { requested: 0, loaded: 0, pending: 0, failures: [] } };
    byId.set(target.id, target);
    for (const key of new Set([target.request, target.filePath])) {
      assert.ok(!byRequest.has(key), `ambiguous target request: ${key}`);
      byRequest.set(key, target);
    }
  }
  const targetFor = id => { assert.ok(byId.has(id), `unknown source target: ${id}`); return byId.get(id); };

  function makeLoader(omittedId = null) {
    return async (request, options) => {
      const normalized = normalizeLocalImageRequest(request), target = byRequest.get(normalized);
      const record = target && (omittedId === null ? target.normal
        : omittedId === target.id ? target.omitted : null);
      if (record) { record.requested++; record.pending++; }
      try {
        const image = await loadImage(target?.filePath || normalized, options);
        const [width, height] = dimensions(image);
        assert.ok(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0,
          `image has invalid dimensions: ${normalized}`);
        if (record) record.loaded++;
        if (target?.id !== omittedId) return image;
        // Readiness and selection stay identical. Only this source's actual
        // pixels disappear. Do not omit its descriptor or change the pose.
        const blank = createSurface(width, height);
        assert.ok(blank?.getContext, 'createSurface must return a readable canvas');
        blank.getContext('2d').clearRect(0, 0, width, height);
        return blank;
      } catch (error) {
        if (record) record.failures.push(String(error?.message || error));
        throw new Error(`source image load failed (${target?.id || normalized}): ${error.message}`, { cause: error });
      } finally { if (record) record.pending--; }
    };
  }

  function assertLoaded(ids = [...byId.keys()]) {
    for (const id of ids) {
      const record = targetFor(id).normal;
      assert.equal(record.failures.length, 0, `${id}: target loader failed: ${record.failures.join('; ')}`);
      assert.ok(record.requested > 0, `${id}: target source was never requested`);
      assert.ok(record.loaded > 0, `${id}: target source was not loaded`);
      assert.equal(record.pending, 0, `${id}: target source is still loading`);
    }
  }
  function assertSelected(artwork, ids = [...byId.keys()]) {
    assert.equal(artwork?.layeredReady, true, 'actual artwork is not layeredReady');
    assert.equal(artwork?.actionReady, true, 'actual artwork is not actionReady');
    for (const id of ids) {
      const key = targetFor(id).spriteKey;
      assert.ok(artwork.contact?.hands?.some(hand => hand.pawSprite === key),
        `${id}: actual artwork did not select target sprite ${key}`);
    }
  }
  function observe(canvas, omittedIds) {
    assert.ok(canvas?.getContext, 'register the actual final-stage canvas, e.g. harness.body');
    const prior = observedStages.get(canvas);
    assert.ok(!prior || sameSet(prior, omittedIds), 'stage cannot be both actual and source-omitted');
    observedStages.set(canvas, omittedIds);
    return canvas;
  }
  function omit(id) {
    targetFor(id);
    return Object.freeze({ targetId: id, loadImage: makeLoader(id),
      observeFinalStage: canvas => observe(canvas, [id]) });
  }
  function assertContribution({ targetId, stage, omittedStage, artwork, omittedArtwork,
    renderInputs, omittedRenderInputs, label = '' }) {
    const prefix = `${label ? label + ': ' : ''}${targetId}`;
    assertLoaded([targetId]);
    assertSelected(artwork, [targetId]); assertSelected(omittedArtwork, [targetId]);
    assertRenderInputs(renderInputs, omittedRenderInputs, prefix);
    const omitted = targetFor(targetId).omitted;
    assert.equal(omitted.failures.length, 0, `${prefix}: omitted control loader failed`);
    assert.ok(omitted.requested > 0 && omitted.loaded > 0 && !omitted.pending,
      `${prefix}: omitted control must really request/load the same source`);
    assert.notEqual(stage, omittedStage, `${prefix}: distinct final-stage canvases required`);
    assert.deepEqual(observedStages.get(stage), [], `${prefix}: actual final stage was not registered`);
    assert.deepEqual(observedStages.get(omittedStage), [targetId],
      `${prefix}: control stage must omit this target alone`);
    assert.equal(poseSignature(artwork), poseSignature(omittedArtwork),
      `${prefix}: control changed complete artwork data, pose, descriptors or drawing flags`);
    assert.equal(stage.width, omittedStage.width, `${prefix}: stage width differs`);
    assert.equal(stage.height, omittedStage.height, `${prefix}: stage height differs`);
    assert.ok(stage.width > 1 && stage.height > 1, `${prefix}: empty final stage`);
    const actual = stage.getContext('2d').getImageData(0, 0, stage.width, stage.height).data;
    const control = omittedStage.getContext('2d').getImageData(0, 0, stage.width, stage.height).data;
    let changedPixels = 0, changedAlphaPixels = 0;
    for (let i = 0; i < actual.length; i += 4) {
      if (!actual[i + 3] && !control[i + 3]) continue;
      if (actual[i] !== control[i] || actual[i + 1] !== control[i + 1]
        || actual[i + 2] !== control[i + 2] || actual[i + 3] !== control[i + 3]) changedPixels++;
      if (actual[i + 3] !== control[i + 3]) changedAlphaPixels++;
    }
    assert.ok(changedPixels > 0, `${prefix}: no target-source contribution on the real final stage`);
    return Object.freeze({ targetId, label, changedPixels, changedAlphaPixels,
      width: stage.width, height: stage.height, proof: 'same-pose single-source-omitted final-stage pixel difference' });
  }
  return Object.freeze({ loadImage: makeLoader(), omit,
    observeFinalStage: canvas => observe(canvas, []), assertLoaded, assertSelected, assertContribution,
    snapshot: () => [...byId.values()].map(t => ({ id: t.id, spriteKey: t.spriteKey, request: t.request,
      filePath: t.filePath, normal: structuredClone(t.normal), omitted: structuredClone(t.omitted) })) });
}
