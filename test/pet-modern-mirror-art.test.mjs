import test from 'node:test';
import assert from 'node:assert/strict';
import { MIRROR_ACTIVITIES, MIRROR_ROTATIONS } from '../src/content/session-activities.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { createSessionActivityController } from '../src/core/session-activity.mjs';
import { resolveActionPlayback } from '../src/surfaces/pet/action-playback.mjs';
import { PET_FORMS } from '../src/capabilities/companion/form-registry.mjs';
import { resolveView } from '../src/capabilities/companion/presentation/form-art.mjs';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import rig from '../assets/companion/usagi/rig/usagi.rig.mjs';
import support from '../src/capabilities/companion/presentation/usagi-support.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { createRigArtist } from '../src/capabilities/companion/presentation/rig/rig-art.mjs';
import { createPathCache } from '../src/capabilities/companion/presentation/rig/paint.mjs';
import { resolveRigProps } from '../src/capabilities/companion/presentation/rig/props.mjs';
import { integratedUsagiPaw } from '../src/capabilities/companion/presentation/usagi-contact-limbs.mjs';
import { recordingContext } from '../test-support/dango-reconstruction-fixture.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';

const expected = {
  'mirror-music': { motion: 'dance', prop: 'music-notes', duration: 24000, raster: ['headphones-front-band', 'headphones-front-cups'], rig: [] },
  'mirror-coding': { motion: 'type', prop: 'keyboard', duration: 36000, raster: ['keyboard-front'], rig: ['keyboard'] },
  'mirror-ai': { motion: 'browse', prop: 'ai-chat', duration: 30000, raster: ['laptop-reverse-front', 'ai-robot-buddy'], rig: ['laptop'] }
};
const content = { PET_ACTIONS, MIRROR_ACTIVITIES };
const makeRig = () => createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
const makeRaster = () => createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
const play = (form, action, progress, calmVisual = false, egg = null) => resolveActionPlayback({
  content, form, sessionSnapshot: { activity: action, progress }, now: progress * action.durationMs,
  actionStartedAt: 0, calmVisual, egg
});

// The mirror remains a session-controller activity, not an alias to another story.
test('modern playback retains mirror identity, duration and equipment through loops and interruptions', () => {
  const saved = JSON.stringify(MIRROR_ACTIVITIES);
  for (const form of Object.values(PET_FORMS)) for (const [id, spec] of Object.entries(expected)) {
    const controller = createSessionActivityController({ activities: MIRROR_ACTIVITIES, rotations: MIRROR_ROTATIONS, clock: { now: () => 0 } });
    const action = controller.setMode(id, 0);
    assert.deepEqual([action.motion, action.prop, action.durationMs], [spec.motion, spec.prop, spec.duration]);
    for (const at of [0, spec.duration - 1, spec.duration, spec.duration + 1, 20 * spec.duration + 137]) {
      const snapshot = controller.snapshot(at);
      const playback = resolveActionPlayback({ content, form, sessionSnapshot: snapshot, now: at });
      assert.strictEqual(playback.actionConfig, action);
      assert.equal(playback.phase, null, 'no borrowed story phases');
      assert.equal(playback.actionT, (at % spec.duration) / spec.duration);
    }
    assert.equal(play(form, action, .4, false, { id: 'wave', duration: 5000 }).actionConfig.id, 'wave');
    assert.strictEqual(play(form, action, .4).actionConfig, action, 'mirror returns when the interrupt ends');
    assert.equal(play(form, action, .1, true).actionT, .5);
    assert.equal(play(form, action, .9, true).actionT, .5);
  }
  assert.equal(JSON.stringify(MIRROR_ACTIVITIES), saved);
});

test('both modern artists resolve and actually paint native mirror props without legacy action art', async () => {
  const raster = makeRaster(), vector = makeRig();
  await raster.ready({ all: true });
  try {
    for (const [id, spec] of Object.entries(expected)) {
      const action = MIRROR_ACTIVITIES[id], form = PET_FORMS.dango;
      const playback = play(form, action, .5);
      const artwork = raster.resolveArtwork({ action: playback.actionConfig, motion: spec.motion, progress: playback.actionT, view: 'front' });
      assert.equal(artwork.ready, true, id);
      assert.deepEqual(artwork.missingAssets, []);
      assert.deepEqual(artwork.contact.tools.map(tool => tool.key), spec.raster);
      const ctx = { ...recordingContext(), moveTo() {}, lineTo() {}, closePath() {} };
      raster.action(ctx, { artwork, action, layer: 'back', palette: PALETTES.pink });
      assert.equal(raster.action(ctx, { artwork, action, layer: 'front', palette: PALETTES.pink }), true);
      for (const key of spec.raster) assert.ok(ctx.calls.some(call => call.image.src.includes(`/${key}.png`)), key);
      if (id === 'mirror-ai') {
        assert.ok(!ctx.calls.some(call => call.image.src.includes('/ellipsis.png')), 'category does not imply AI thinking state');
        assert.ok(artwork.contact.hands.every(hand => hand.pawSprite === 'small-fin'));
      }
      const native = vector.resolve(rig, { action, motion: spec.motion, progress: .5, view: 'front' });
      assert.deepEqual(native.pose.sample.props, spec.rig);
      const props = resolveRigProps(rig.views.front, native.pose.sample, 'front');
      assert.deepEqual(props.missing, []);
      assert.deepEqual(props.drawn.map(item => item.id), spec.rig);
      const painted = [];
      const context = new Proxy({ globalAlpha: 1 }, {
        get: (target, key) => key in target ? target[key] : (...args) => {
          if (key === 'fill' || key === 'stroke') painted.push(args[0]?.d);
        }, set: (target, key, value) => { target[key] = value; return true; }
      });
      assert.equal(vector.action(context, { artwork: native, action, layer: 'front', palette: {} }), true);
      for (const key of spec.rig) assert.ok(rig.views.front.props[key].shapes.some(shape => painted.includes(shape.d)), `${id}/${key}`);
      if (id !== 'mirror-music') for (const side of ['l', 'r']) assert.equal(integratedUsagiPaw(native, side), true);
    }
  } finally { raster.dispose(); }
});

test('mirror angles and calm samples stay in the already supported modern geometry', async () => {
  const raster = makeRaster(), vector = makeRig();
  await raster.ready({ all: true });
  try {
    for (const action of Object.values(MIRROR_ACTIVITIES)) for (const requested of ['auto', 'front', 'three-quarter', 'profile', 'back']) {
      const dangoView = resolveView(PET_FORMS.dango, requested, { action });
      const usagiView = resolveView(PET_FORMS.usagi, requested, { action });
      assert.equal(dangoView, ['three-quarter', 'profile'].includes(requested) ? 'three-quarter' : 'front');
      assert.equal(usagiView, action.id !== 'mirror-coding' && requested === 'three-quarter' ? 'three-quarter' : 'front');
      const resolve = progress => raster.resolveArtwork({ action, motion: action.motion, progress, calmVisual: true, view: dangoView });
      const a = resolve(.1), b = resolve(.9);
      assert.equal(a.ready, true); assert.deepEqual(a.contact, b.contact); assert.deepEqual(a.matrices, b.matrices);
      const options = { action, motion: action.motion, view: usagiView, calmVisual: true };
      assert.deepEqual(vector.resolve(rig, { ...options, progress: .1 }).pose, vector.resolve(rig, { ...options, progress: .9 }).pose);
    }
  } finally { raster.dispose(); }
});

test('Usagi AI keeps pet-facing laptop contact independent of the old ai-chat prop alias', () => {
  const vector = makeRig(), action = MIRROR_ACTIVITIES['mirror-ai'];
  for (const calmVisual of [false, true]) for (let n = 0; n <= 60; n++) {
    const options = { motion: action.motion, progress: n / 60, view: 'front', calmVisual };
    const ai = vector.resolve(rig, { ...options, action });
    assert.deepEqual(ai.pose.sample.props, ['laptop'], 'AI context does not display a fabricated thinking indicator');
    const laptop = vector.resolve(rig, { ...options, action: { ...action, prop: 'laptop' } });
    assert.deepEqual(ai.pose.world, laptop.pose.world);
    assert.deepEqual(ai.pose.sample.bones, laptop.pose.sample.bones);
    assert.deepEqual(ai.pose.sample.propPoses, laptop.pose.sample.propPoses);
  }
});
