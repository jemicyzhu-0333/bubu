'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const make = () => createDangoRasterArtist({ manifest: DANGO_RASTER,
  loadImage: async src => ({ src, width: 8, height: 8 }) });

test('return glance changes facial perspective through center, holds, then returns without twisting the body', async () => {
  const artist = make(); await artist.ready({ all: true });
  const action = PET_ACTIONS['tail-wiggle'];
  const sample = progress => artist.resolveArtwork({ action, motion: action.motion, progress, view: 'auto' });
  const samples = [0, .31, .5, .6, 1].map(sample);
  const mouthX = artwork => applyPoint(artwork.lookback.matrices[2], ...artwork.data.face.mouth.neutral.pivot)[0];
  assert.ok(mouthX(samples[0]) > 45);
  assert.ok(Math.abs(mouthX(samples[1]) - 33) < 1);
  assert.ok(mouthX(samples[2]) < 23);
  assert.deepEqual(samples[2].lookback.matrices, samples[3].lookback.matrices, 'pause while glancing back');
  assert.deepEqual(samples[0].lookback.matrices, samples[4].lookback.matrices);
  assert.ok(samples[2].lookback.matrices[0][0] < samples[2].lookback.matrices[1][0], 'near and far eyes exchange perspective');
  assert.equal(new Set(samples.map(value => value.key)).size, 1, 'the torso keeps one stable cache');
  for (const artwork of samples) {
    assert.equal(artwork.ready, true);
    for (const foot of ['foot-left', 'foot-right']) assert.deepEqual(artwork.matrices[foot].map(value => value || 0), [1, 0, 0, 1, 0, 0]);
  }
  artist.applyMotionTransform(new Proxy({}, { get: () => () => assert.fail('a return glance must not twist the body') }),
    action.motion, .5, { action });
  artist.dispose();
});

test('window activity uses its continuous story phase and reduced motion preserves approved neutral', async () => {
  const artist = make(); await artist.ready({ all: true });
  const action = SESSION_ACTIVITIES['rest-window'];
  const draw = (t, calmVisual = false) => {
    const sample = sampleActivityStory(action, t);
    return artist.resolveArtwork({ action: sample.action, motion: sample.action.motion, progress: sample.progress, view: 'auto', calmVisual });
  };
  assert.ok(draw(.5).lookback.turn > .99);
  assert.ok(draw(.6).lookback.turn > .99, 'a local phase wrap cannot restart the glance');
  assert.equal(draw(.95).lookback.turn, 0);
  assert.deepEqual(draw(.1, true).lookback, draw(.8, true).lookback);
  assert.deepEqual(draw(.8, true).lookback.matrices, [[1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0]]);
  const wave = draw(.95), hand = wave.contact.hands.find(value => value.side === 'right');
  const rightmostEye = wave.data.face.eyes.neutral[1].rect;
  const palmRadius = wave.data.parts['hand-right'].rect[2] / 2;
  assert.ok(hand.points.at(-1)[0] - palmRadius > rightmostEye[0] + rightmostEye[2], 'wave stays beyond the eye envelope');
  artist.dispose();
});
