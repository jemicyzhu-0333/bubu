'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../src/pet-content.js');
const { createManualActionPlayback, resolveInteraction, createInteractionParticles } = require('../src/surfaces/pet/interaction-playback.mjs');
const { resolveActionPlayback } = require('../src/surfaces/pet/action-playback.mjs');
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const formArt = require('../src/capabilities/companion/presentation/form-art.mjs');
const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
const { sampleInteractionPresentation } = require('../src/capabilities/companion/presentation/interaction-presentation.mjs');

const mappings = { 'click-2': 'look-around', 'click-20': 'spin', 'click-30': 'magic-trick', longPress: 'tail-wiggle' };
const playback = (id, formId = 'usagi') => createManualActionPlayback(content, mappings[id], { interactionId: id, formId });
const sample = (id, t, formId = 'usagi', calmVisual = false, preview = null) => {
  const egg = playback(id, formId);
  return resolveActionPlayback({ content, egg, preview, now: egg.duration * t,
    form: PET_FORMS[formId], calmVisual });
};

test('reviewed inputs preserve canonical action IDs, payload identity and ordinary behavior records', () => {
  for (const [id, actionId] of Object.entries(mappings)) {
    assert.equal(resolveInteraction(content, id).action, actionId);
    assert.equal(playback(id).id, actionId);
    assert.equal(playback(id).interactionId, id);
  }
  assert.equal(content.INTERACTIONS.clickCount[50].xp, 0);
  assert.equal(playback('longPress').duration, 7000);
  assert.equal(playback('longPress').expression, 'react.petted');
  assert.equal(playback('click-30').expression, 'react.happy');
  assert.equal(playback('longPress', 'dango').duration, content.PET_ACTIONS['tail-wiggle'].duration);
  assert.equal(playback('longPress', 'dango').expression, content.PET_ACTIONS['tail-wiggle'].expression);
  assert.equal(createManualActionPlayback(content, 'missing'), null);
  assert.equal(createManualActionPlayback(content, 'wave', { interactionId: 'longPress' }).interactionId, undefined);
  assert.equal(resolveInteraction(content, 'click-999'), undefined);
});

test('only Usagi input-context performances face the user, including every requested view and complete cycle', () => {
  for (const id of ['longPress', 'click-30', 'click-20']) for (let n = 0; n <= 200; n += 1) {
    const { actionConfig, actionT, phase } = sample(id, n / 200);
    assert.equal(actionConfig.id, mappings[id]);
    assert.equal(actionConfig.motion, 'breathe');
    assert.equal(actionConfig.prop, 'none');
    assert.equal(actionConfig.effect, 'none');
    assert.equal(actionT, n / 200);
    assert.ok(phase.label.length);
    for (const view of ['auto', 'front', 'three-quarter', 'profile', 'back']) {
      assert.equal(formArt.resolveView(PET_FORMS.usagi, view, { action: actionConfig }), 'front');
    }
    const preview = sample(id, n / 200, 'usagi', false, { category: 'action', id: mappings[id] });
    if (n < 200) assert.deepEqual(preview.actionConfig, actionConfig, 'workbench contextual action equals actual input playback');
    const dango = sample(id, n / 200, 'dango');
    assert.equal(dango.actionConfig, content.PET_ACTIONS[mappings[id]], 'Dango remains unchanged');
  }
  for (const actionId of ['tail-wiggle', 'magic-trick']) {
    const ordinary = content.PET_ACTIONS[actionId];
    assert.equal(formArt.sampleAction(PET_FORMS.usagi, ordinary, .5).action, ordinary);
    assert.equal(sampleInteractionPresentation(ordinary, .5), null);
  }
});

test('purr and summon have a stable readable low-stimulus pose and respect higher-priority faces', () => {
  for (const id of ['longPress', 'click-30', 'click-20']) {
    const calm = sample(id, 0, 'usagi', true);
    for (let n = 1; n <= 100; n += 1) assert.deepEqual(sample(id, n / 100, 'usagi', true), calm);
    const expected = calm.actionConfig.expression;
    const face = { eyes: 'neutral', mouth: 'neutral', openness: 1 };
    const petted = sampleFaceChoreography(face, { action: calm.actionConfig, motion: 'breathe', progress: .5,
      expressionId: expected, calmVisual: true });
    assert.equal(petted.eyes, 'content'); assert.equal(petted.mouth, 'smile');
    assert.equal(sampleFaceChoreography(face, { action: calm.actionConfig, expressionId: 'react.surprised' }), face);
  }
});

test('fireworks and purr use finite deterministic one-shot particles and obey low stimulus', () => {
  for (const [effect, count] of [['explode', 30], ['purr', 5]]) {
    const particles = createInteractionParticles(effect, { random: () => .5 });
    assert.equal(particles.length, count);
    for (const p of particles) {
      assert.equal(p.life / p.baseLife, 1);
      for (const key of ['x', 'y', 'vx', 'vy', 'life', 'baseLife']) assert.ok(Number.isFinite(p[key]), key);
    }
    assert.deepEqual(createInteractionParticles(effect, { calmVisual: true }), []);
  }
  assert.deepEqual(createInteractionParticles('sparkles'), []);
  assert.equal(sample('click-20', .6 / 7).actionConfig.motion, 'breathe');
  assert.deepEqual(createInteractionParticles('explode', { formId: 'usagi' }), []);
  assert.equal(createInteractionParticles('explode', { formId: 'dango' }).length, 30);
  assert.deepEqual(sample('click-2', 4.6 / 8.5).actionConfig, { ...content.PET_ACTIONS['look-around'], interactionId: 'click-2' });
});

test('real Canvas input rendering preserves static comfort and differentiates fireworks from an ordinary spin', async t => {
  const packagePath = process.env.USAGI_CANVAS_PACKAGE;
  if (!packagePath) return t.skip('Set USAGI_CANVAS_PACKAGE for real Canvas evidence');
  const backend = require(packagePath);
  const { pathToFileURL } = require('node:url');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { installOffscreenImages } = await import('../tools/usagi-gallery/offscreen-images.mjs');
  const previous = { Image: globalThis.Image, Path2D: globalThis.Path2D, document: globalThis.document, window: globalThis.window };
  installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
  globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 1 };
  const { loadSource, createRenderHarness } = await import('../tools/usagi-gallery/runtime-harness.mjs');
  const source = await loadSource(pathToFileURL(path.resolve(__dirname, '..')).href,
    { interactions: content.INTERACTIONS, interactionPlayback: require('../src/surfaces/pet/interaction-playback.mjs') });
  const hash = canvas => crypto.createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex');
  try {
    for (const id of ['click-20', 'click-30', 'longPress']) for (const dpr of [1, 2]) {
      const calm = createRenderHarness(source, { skin: 'usagi', dpr, calm: true, blink: false, outfit: true });
      const entry = calm.select('interaction', id); const hashes = [];
      for (const progress of [0, .2, .5, .94]) {
        const rendered = calm.draw(entry.duration * progress); hashes.push(hash(calm.body));
        assert.equal(rendered.state.currentExprId, id === 'longPress' ? 'react.petted' : 'react.happy');
        assert.equal(rendered.state.overlayParticles.length, 0);
      }
      assert.equal(new Set(hashes).size, 1, `${id}/${dpr}: reduced motion stays literally still`);
      calm.dispose();
    }
    const trigger = createRenderHarness(source, { skin: 'usagi', dpr: 1, blink: false });
    const ordinary = createRenderHarness(source, { skin: 'usagi', dpr: 1, blink: false });
    trigger.select('interaction', 'click-20'); ordinary.select('action', 'spin');
    for (let at = 0; at <= 600; at += 20) { trigger.draw(at); ordinary.draw(at); }
    assert.notEqual(hash(trigger.body), hash(ordinary.body), 'authored bloom and frontal posture differ from spin');
    trigger.dispose(); ordinary.dispose();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
