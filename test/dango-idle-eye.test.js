'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleDangoFace } = require('../src/capabilities/companion/presentation/dango-face.mjs');
const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const idle = EXPRESSIONS.find(expression => expression.id === 'life.idle');

test('idle keeps canonical eyes through the curious beat while retaining gaze, eyelids and mouth', () => {
  let replaced = 0;
  for (let elapsedMs = 0; elapsedMs <= 10400; elapsedMs += 25) {
    const options = { expressionId: idle.id, motion: 'idle', elapsedMs, expressionElapsedMs: elapsedMs };
    const before = sampleFaceChoreography(idle.face, options), after = sampleDangoFace(idle.face, options);
    if (before.eyes === 'curious') {
      assert.deepEqual(after, { ...before, eyes: 'neutral' }); replaced++;
    } else assert.deepEqual(after, before);
    assert.equal(after.eyes, 'neutral');
  }
  assert.ok(replaced > 100);
  const shown = sampleDangoFace(idle.face, { expressionId: idle.id, expressionElapsedMs: 2600 });
  assert.equal(shown.mouth, 'smile'); assert.equal(shown.openness, .92);
  assert.equal(shown.eyeOffsetY, -.2);
});

test('expressions outside idle and the reviewed petting refinement keep their existing sampled geometry', () => {
  for (const expression of EXPRESSIONS.filter(item => ![idle.id, 'react.petted'].includes(item.id))) {
    for (const elapsedMs of [0, 800, 1500, 2600, 4100, 6200]) {
      const options = { expressionId: expression.id, elapsedMs, motion: 'idle' };
      assert.deepEqual(sampleDangoFace(expression.face, options), sampleFaceChoreography(expression.face, options),
        `${expression.id}/${elapsedMs}`);
    }
  }
  assert.equal(sampleDangoFace(idle.face, { elapsedMs: 2600 }).eyes, 'curious', 'no blanket curious replacement');
  assert.strictEqual(sampleDangoFace(idle.face, { expressionId: idle.id, calmVisual: true }), idle.face);
  const feedback = { eyes: 'curious', mouth: 'open', openness: .8 };
  assert.strictEqual(sampleDangoFace(feedback, {
    expressionId: idle.id, action: { id: 'carry-energy', expression: 'work.focus', motion: 'carry' }, progress: .5
  }), feedback, 'winning expression mismatch still short-circuits activity shaping');
});

test('canonical eye heights and pivots retain existing frontal symmetry and modest three-quarter perspective', () => {
  const expected = {
    front: [[18.887179, 27.897436], [46.538462, 27.897436]],
    'three-quarter': [[41.123077, 28.14359], [59.338462, 27.979487]]
  };
  for (const [view, pivots] of Object.entries(expected)) {
    const [near, far] = DANGO_RASTER.views[view].face.eyes.neutral;
    assert.deepEqual([near.pivot, far.pivot], pivots);
    const heightRatio = near.rect[3] / far.rect[3];
    assert.ok(heightRatio > .97 && heightRatio < 1.01, `${view} keeps both eye heights`);
    assert.ok(near.rect[2] / far.rect[2] < 1.42, `${view} preserves canonical width perspective`);
    for (const eye of [near, far]) {
      assert.ok(eye.src.startsWith('views/'));
      assert.ok(Math.abs(eye.rect[0] + eye.rect[2] / 2 - eye.pivot[0]) < .000002);
      assert.ok(Math.abs(eye.rect[1] + eye.rect[3] / 2 - eye.pivot[1]) < .000002);
    }
  }
});

test('production raster painter selects canonical idle sprites and still closes both eyes for blinking', async () => {
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER,
    loadImage: async src => ({ src, width: 8, height: 8 }) });
  await artist.ready({ all: true });
  try {
    for (const view of ['front', 'three-quarter', 'back']) {
      const artwork = artist.resolveArtwork({ view, motion: 'idle', face: idle.face,
        expressionId: idle.id, expressionElapsedMs: 2600, elapsedMs: 2600 });
      for (const blinking of [false, true]) {
        const context = recordingContext();
        artist.face(context, PALETTES.pink, idle.face, blinking, artwork.view, null, artwork);
        if (view === 'back') { assert.equal(context.calls.length, 0); continue; }
        const eyes = context.calls.slice(0, 2);
        assert.equal(eyes.length, 2);
        assert.ok(eyes.every(call => call.image.src.includes(blinking ? '/face/eyes-closed-' : '/eye-')));
        assert.ok(eyes.every(call => !call.image.src.includes('curious')));
        assert.equal(eyes[0].matrix[3], blinking ? 1 : .92);
        assert.equal(eyes[1].matrix[3], blinking ? 1 : .92);
        assert.deepEqual(eyes.map(call => call.rect), DANGO_RASTER.views[view].face.eyes[blinking ? 'closed' : 'neutral'].map(s => s.rect));
      }
    }
  } finally { artist.dispose(); }
});

const canvasPackage = process.env.DANGO_CANVAS_PACKAGE;
const baselineRoot = process.env.DANGO_EYE_BASELINE_ROOT;
test('actual renderer preserves idle correction and explicitly scopes later focus far-eye changes',
  { skip: !(canvasPackage && baselineRoot) && 'Set DANGO_CANVAS_PACKAGE and DANGO_EYE_BASELINE_ROOT for before/after Skia evidence' }, async () => {
    const { makeComparison, auditRegression } = await import('../tools/dango-eye-preview/audit.mjs');
    const comparison = await makeComparison(require(canvasPackage), baselineRoot);
    try {
      const result = auditRegression(comparison);
      assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
      assert.ok(result.changedIdleCases >= 6);
      assert.equal(result.changedFocusCases, 4);
      assert.equal(result.changedOpenCases, 4);
      assert.ok(result.unchangedCases >= 26);
      assert.ok(result.noFaceBackCases >= 8);
    } finally { comparison.dispose(); }
  });
