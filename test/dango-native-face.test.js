'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleDangoFace } = require('../src/capabilities/companion/presentation/dango-face.mjs');
const art = require('../src/capabilities/companion/presentation/dango-art.mjs').default;
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const face = { eyes: 'focused', mouth: 'closed', openness: 1 };
const action = PET_ACTIONS['carry-energy'];

test('carrying watches the object with the bright native reference eyes, while effort stays in the pose', () => {
  const shown = sampleDangoFace(face, { action, expressionId: action.expression, progress: .514, motion: 'carry' });
  assert.equal(shown.eyes, 'curious');
  assert.ok(shown.openness > .9 && shown.eyeOffsetY > .5);
  const feedback = { eyes: 'surprised', mouth: 'open', openness: 1 };
  assert.strictEqual(sampleDangoFace(feedback, { action, expressionId: 'react.startled', progress: .514 }), feedback,
    'higher-priority user feedback is never replaced by the carrying phrase');
  assert.deepEqual(sampleDangoFace(face, { action, calmVisual: true, progress: .1 }), sampleDangoFace(face, { action, calmVisual: true, progress: .9 }));
});
test('only the energy-carry action takes supporting steps; a held tea cup does not walk', () => {
  const a = art.resolveArtwork({ view: 'auto', action, motion: 'carry', progress: .2 });
  const b = art.resolveArtwork({ view: 'auto', action, motion: 'carry', progress: .6 });
  assert.equal(a.view, 'front');
  assert.notDeepEqual(a.footwearTransforms, b.footwearTransforms);
  const tea = { id: 'rest-tea', motion: 'carry', prop: 'cup' };
  assert.deepEqual(art.resolveArtwork({ action: tea, motion: 'carry', progress: .2 }).footwearTransforms,
    art.resolveArtwork({ action: tea, motion: 'carry', progress: .6 }).footwearTransforms);
  assert.equal(art.resolveArtwork({ action: PET_ACTIONS.moonwalk, motion: 'moonwalk' }).footGlints, true);
});
