import test from 'node:test';
import assert from 'node:assert/strict';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { SESSION_ACTIVITIES, MIRROR_ACTIVITIES } from '../src/content/session-activities.mjs';
import { sampleActivityStory } from '../src/capabilities/companion/presentation/activity-playback.mjs';
import { sampleUsagiEventRobot } from '../src/capabilities/companion/presentation/usagi-event-robot.mjs';
globalThis.Path2D = class { constructor(d) { this.d = d; } };
const { default: usagi } = await import('../src/capabilities/companion/presentation/usagi-art.mjs');
const combine = action => ({ ...action, activityCombination: Object.freeze({ v: 1, primary: action.id,
  categories: Object.freeze({ music: true, ai: true, coding: false }),
  extras: Object.freeze(['headphones', 'robot']), static: true }) });
const option = (action, progress, view) => ({ action, motion: action.motion, progress, view,
  face: { eyes: 'neutral', mouth: 'neutral' }, calmVisual: true });

test('all focus story phases retain exact primary contacts, feet and faces with two quiet accessories', async () => {
  const dango = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await dango.ready({ all: true });
  for (const activity of Object.values(SESSION_ACTIVITIES).filter(value => value.state === 'focused')) {
    for (const view of ['front', 'three-quarter']) for (let i = 0; i <= 40; i++) {
      const sampled = sampleActivityStory(activity, i / 40);
      const plain = option(sampled.action, sampled.progress, view);
      const stacked = { ...plain, action: combine(sampled.action) };
      const a = dango.resolveArtwork(plain), b = dango.resolveArtwork(stacked);
      assert.deepEqual(b.contact?.hands, a.contact?.hands);
      assert.deepEqual(b.face, a.face); assert.deepEqual(b.matrices, a.matrices);
      assert.deepEqual(b.footwearTransforms, a.footwearTransforms);
      const primaryTools = b.contact.tools.filter(tool => tool.key !== 'ai-robot-buddy' && !tool.key.startsWith('headphones-'));
      assert.deepEqual(primaryTools, a.contact?.tools || []);
      assert.equal(b.contact.tools.filter(tool => tool.key === 'ai-robot-buddy').length, 1);
      assert.ok(b.contact.tools.filter(tool => tool.key.startsWith('headphones-')).length >= 2);
      assert.ok(b.actionReady);
      const ua = usagi.resolveArtwork(plain), ub = usagi.resolveArtwork(stacked);
      assert.deepEqual(ub.pose.sample, ua.pose.sample);
      assert.deepEqual(ub.pose.world, ua.pose.world); assert.deepEqual(ub.face, ua.face);
      assert.equal(ub.combinationAccessories.headphones, true);
      assert.equal(sampleUsagiEventRobot(ub).opacity, 1, 'focus hand-tool fades do not blink the quiet buddy');
    }
  }
  dango.dispose();
});

test('AI plus music deduplicates robot and preserves one computer with headphones', async () => {
  const dango = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: async src => ({ src, width: 8, height: 8 }) });
  await dango.ready({ all: true });
  const action = combine(MIRROR_ACTIVITIES['mirror-ai']);
  const a = dango.resolveArtwork(option(action, .4, 'front'));
  assert.equal(a.contact.tools.filter(tool => tool.key === 'ai-robot-buddy').length, 1);
  assert.ok(a.contact.tools.some(tool => tool.key.startsWith('headphones-')));
  const b = usagi.resolveArtwork(option(action, .4, 'front'));
  assert.deepEqual(b.pose.sample.props, ['laptop']);
  assert.ok(sampleUsagiEventRobot(b));
  assert.equal(b.combinationAccessories.headphones, true);
  const cleared = usagi.resolveArtwork(option(SESSION_ACTIVITIES['focus-read'], .4, 'front'));
  assert.equal(sampleUsagiEventRobot(cleared), null);
  assert.equal(cleared.combinationAccessories.headphones, false);
  dango.dispose();
});

test('cold or failed secondary accessories never remove the original focus tool or hands', async () => {
  for (const fail of [false, true]) {
    let settle;
    const artist = createDangoRasterArtist({ manifest: DANGO_RASTER,
      loadImage: src => src.includes('/ai-robot-buddy.png') ? new Promise((resolve, reject) => {
        settle = () => fail ? reject(Error('secondary asset unavailable')) : resolve({ src, width: 8, height: 8 });
      }) : Promise.resolve({ src, width: 8, height: 8 }) });
    const ready = artist.ready({ all: true });
    await new Promise(resolve => setImmediate(resolve));
    const action = SESSION_ACTIVITIES['focus-read'], options = option(combine(action), .4, 'front');
    const pending = artist.resolveArtwork(options);
    assert.equal(pending.actionReady, true);
    assert.equal(pending.accessoriesReady, false);
    assert.ok(pending.contact.tools.length > 0);
    assert.ok(pending.contact.tools.every(tool => !tool.contextAccessory));
    const plain = artist.resolveArtwork(option(action, .4, 'front'));
    assert.deepEqual(pending.contact.hands, plain.contact.hands);
    assert.deepEqual(pending.contact.tools, plain.contact.tools);
    settle(); await ready;
    const final = artist.resolveArtwork(options);
    assert.equal(final.actionReady, true);
    assert.equal(final.accessoriesReady, !fail);
    assert.equal(final.contact.tools.some(tool => tool.key === 'ai-robot-buddy'), !fail);
    artist.dispose();
  }
});
