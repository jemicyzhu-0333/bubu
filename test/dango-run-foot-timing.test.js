'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDangoRasterArtist } = require('../src/capabilities/companion/presentation/dango-raster-art.mjs');
const { sampleRasterRunningFeet } = require('../src/capabilities/companion/presentation/dango-raster-pose.mjs');
const { sampleRunningPose } = require('../src/core/pet-running-pose.mjs');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { recordingContext } = require('../test-support/dango-raster-fixture.mjs');
const action = Object.freeze({ id: 'chase-laser', motion: 'dash', duration: 9500, prop: 'laser' });
const intent = changes => ({ action, motion: 'dash', view: 'three-quarter', progress: .4,
  appearance: { items: [] }, face: { eyes: 'neutral', mouth: 'neutral' }, ...changes });
const make = runFootTiming => createDangoRasterArtist({ manifest: DANGO_RASTER, runFootTiming,
  loadImage: async () => ({ width: 256, height: 256 }) });
const point = (matrix, anchor) => [matrix[0] * anchor.x + matrix[2] * anchor.y + matrix[4],
  matrix[1] * anchor.x + matrix[3] * anchor.y + matrix[5]];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('reviewed foot timing is explicitly configured and limited to the reviewed running action', async () => {
  const original = make(null), revised = make('forward-recovery');
  await Promise.all([original.ready({ all: true }), revised.ready({ all: true })]);
  assert.equal(original.resolveArtwork(intent()).runFootTiming, null);
  assert.equal(revised.resolveArtwork(intent()).runFootTiming, 'forward-recovery');
  for (const change of [{ action: { ...action, id: 'chase-butterfly' } }, { view: 'front' }, { view: 'back' }, { motion: 'idle' }, { calmVisual: true }, { reducedMotion: true }, { state: 'dragged' },
    { appearance: { items: [{ id: 'test-hat', renderKey: 'test-hat' }] } }]) {
    assert.equal(revised.resolveArtwork(intent(change)).runFootTiming, null);
  }
  assert.throws(() => make('unknown'), /unknown run foot timing/);
  original.dispose(); revised.dispose();
});

test('recovery changes only vertical foot timing, preserving parallel x strides and foot roll', () => {
  const data = DANGO_RASTER.views['three-quarter'].variants.running;
  let changed = 0;
  for (let index = 0; index <= 240; index++) {
    const progress = index / 240, oldFeet = sampleRasterRunningFeet(data, progress, false);
    const newFeet = sampleRasterRunningFeet(data, progress, false, 'forward-recovery');
    const body = sampleRunningPose(progress);
    for (const [side, name] of ['foot-left', 'foot-right'].entries()) {
      assert.deepEqual(oldFeet[name].slice(0, 5), newFeet[name].slice(0, 5));
      const rest = data.anchors[name], oldPoint = point(oldFeet[name], rest), newPoint = point(newFeet[name], rest);
      near(oldPoint[0], newPoint[0]);
      const forwardVelocity = Math.cos(body.phase + side * Math.PI);
      const expectedLift = Math.max(0, forwardVelocity) * data.motion.running.liftY * body.effort;
      near(newPoint[1], rest.y - expectedLift);
      if (forwardVelocity <= 0) near(newPoint[1], rest.y);
      if (Math.abs(oldPoint[1] - newPoint[1]) > 1e-6) changed++;
    }
  }
  assert.ok(changed > 300, 'the opt-in sample must visibly differ in lift timing');
});

test('body breathing, lean, face choreography, horizontal root and body cache remain exactly original', async () => {
  const original = make(null), revised = make('forward-recovery');
  await Promise.all([original.ready({ all: true }), revised.ready({ all: true })]);
  for (let index = 0; index <= 120; index++) {
    const progress = index / 120, options = intent({ progress, elapsedMs: progress * 9500 });
    const before = original.resolveArtwork(options), after = revised.resolveArtwork(options);
    assert.equal(before.key, after.key);
    assert.deepEqual(before.face, after.face);
    for (const name of ['ear-left', 'ear-right', 'hand-left', 'hand-right']) {
      assert.deepEqual(before.matrices[name], after.matrices[name]);
    }
    assert.deepEqual(original.motionOffset('dash', progress, false, { action }),
      revised.motionOffset('dash', progress, false, { action }));
    const contexts = [recordingContext(), recordingContext()];
    for (const [i, artist] of [original, revised].entries()) {
      artist.applyMotionTransform(contexts[i], 'dash', progress,
        { artwork: i ? after : before, action, size: 146, bodySize: 66, facing: 1 });
      contexts[i].drawImage({}, 0, 0);
    }
    assert.deepEqual(contexts[0].calls[0].matrix, contexts[1].calls[0].matrix);
    assert.equal(before.clip, null); assert.equal(after.clip, null);
  }
  original.dispose(); revised.dispose();
});

test('quiet and dragged motion preserve the same complete original static pose', async () => {
  const original = make(null), revised = make('forward-recovery');
  await Promise.all([original.ready({ all: true }), revised.ready({ all: true })]);
  for (const change of [{ calmVisual: true }, { state: 'dragged' }]) {
    const before = original.resolveArtwork(intent(change)), after = revised.resolveArtwork(intent(change));
    assert.deepEqual(before.matrices, after.matrices);
    assert.deepEqual(before.face, after.face);
    assert.equal(before.key, after.key);
  }
  original.dispose(); revised.dispose();
});


test('normal Dango production selects the reviewed narrow timing without enabling the rejected clip', () => {
  const production = require('../src/capabilities/companion/presentation/dango-raster-production.mjs').default;
  const selected = production.resolveArtwork(intent());
  assert.equal(selected.runFootTiming, 'forward-recovery');
  assert.equal(selected.clip, null);
  assert.equal(selected.clipStatus, 'disabled');
  const scarf = production.resolveArtwork(intent({ appearance: { items: [
    { id: 'milestone.scarf', renderKey: 'scarf', formId: 'dango' }
  ] } }));
  assert.equal(scarf.runFootTiming, 'forward-recovery'); assert.equal(scarf.clip, null);
  for (const renderKey of ['sunhat', 'sprout']) {
    const pair = production.resolveArtwork(intent({ appearance: { items: [
      { id: 'milestone.scarf', renderKey: 'scarf', formId: 'dango' },
      { id: `milestone.${renderKey}`, renderKey, formId: 'dango' }
    ] } }));
    assert.equal(pair.runFootTiming, 'forward-recovery'); assert.equal(pair.clip, null);
  }
  for (const change of [{ action: { ...action, id: 'chase-butterfly' } }, { view: 'front' },
    { view: 'back' }, { calmVisual: true }, { reducedMotion: true }, { state: 'dragged' },
    { appearance: { items: [{ id: 'test-boots', renderKey: 'boots' }] } }]) {
    const artwork = production.resolveArtwork(intent(change));
    assert.equal(artwork.runFootTiming, null); assert.equal(artwork.clip, null);
  }
});
