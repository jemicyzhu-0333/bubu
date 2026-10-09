'use strict';

// Newly reconstructed logic tests, NOT the lost original nine-test suite.
// Path2D below only enables rig resolution; no pixel-render pass is claimed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const presentation = 'src/capabilities/companion/presentation/';
let modules;
async function setup() {
  if (!modules) modules = Promise.all([
    load('assets/companion/usagi/rig/usagi.rig.mjs'),
    load(presentation + 'usagi-gesture-limbs.mjs'),
    load(presentation + 'usagi-contact.mjs'),
    load(presentation + 'usagi-face-projection.mjs'),
    load(presentation + 'rig/motions.mjs'),
    load(presentation + 'rig/pose.mjs')
  ]).then(([document, limbs, contact, face, motions, pose]) => ({ rig: document.default, limbs, contact, face, motions, pose }));
  return modules;
}
function artwork(m, action, view, progress = 0, extra = {}) {
  const data = m.rig.views[view];
  const raw = m.motions.sampleMotion(action.id === 'yawn' ? 'stretch' : 'high-five', { progress, prop: action.prop });
  const sample = m.contact.prepareUsagiSample(raw, { data, view, progress, action });
  return { rig: m.rig, drawnView: view, pose: { sample, world: m.pose.computeBoneWorld(data.bones, sample.bones) }, ...extra };
}
function trace() {
  const calls = [];
  const context = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: () => true });
  return { context, calls };
}

test('recorded shoulders are explicit for every original view', async () => {
  const { limbs } = await setup();
  for (const [view, l, r] of [['front', [12,44], [54,44]], ['three-quarter', [16,44], [55,43]],
    ['profile', [18,44], [55,43]], ['back', [12,44], [54,44]]]) {
    assert.deepEqual(limbs.gestureShoulder(view, 'l'), l);
    assert.deepEqual(limbs.gestureShoulder(view, 'r'), r);
  }
});

test('gesture action gates do not capture nap or other stretch actions', async () => {
  const m = await setup();
  for (const id of ['rest-nap', 'stretch', 'sneeze']) {
    const a = artwork(m, { id }, 'front', .5);
    assert.equal(a.pose.sample.gesture, null);
    assert.equal(m.limbs.usagiGesture(a), null);
  }
  assert.equal(m.limbs.usagiGesture(artwork(m, { id: 'yawn' }, 'profile')), 'yawn');
});

test('reconstructed wrist curves are finite, short and return to their start', async () => {
  const m = await setup();
  for (const id of ['yawn', 'high-five']) for (const view of Object.keys(m.rig.views)) {
    for (const side of ['l', 'r']) {
      let first;
      for (let n = 0; n <= 120; n++) {
        const a = artwork(m, { id }, view, n / 120);
        const g = m.limbs.gesturePawGeometry(a, m.rig.views[view], side);
        assert.ok([...g.from, ...g.to, ...g.control, ...g.inside].every(Number.isFinite));
        assert.ok(Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) < 17);
        if (!n) first = g;
        if (n === 120) assert.deepEqual(g, first);
      }
    }
  }
});

test('gesture solve leaves normal root, ear and leg tracks unchanged', async () => {
  const m = await setup(), data = m.rig.views.front;
  const raw = m.motions.sampleMotion('stretch', { progress: .4, prop: 'sleep-cap' });
  const after = m.contact.prepareUsagiSample(raw, { data, view: 'front', progress: .4, action: { id: 'yawn' } });
  for (const [id, bone] of Object.entries(raw.bones)) if (!/^(arm|hand)_/.test(id)) assert.deepEqual(after.bones[id], bone);
  assert.deepEqual(after.props, raw.props);
});

test('profile sneeze projects the existing mouth and retains all other rig references', async () => {
  const { rig, face } = await setup();
  const adjusted = face.usagiSneezeFaceRig(rig, { id: 'sneeze' }, 'profile');
  assert.notEqual(adjusted, rig);
  assert.equal(face.usagiSneezeFaceRig(rig, { id: 'sneeze' }, 'profile'), adjusted);
  assert.equal(face.usagiSneezeFaceRig(rig, { id: 'yawn' }, 'profile'), rig);
  assert.equal(face.usagiSneezeFaceRig(rig, { id: 'sneeze' }, 'front'), rig);
  for (const view of ['front', 'three-quarter', 'back']) assert.equal(adjusted.views[view], rig.views[view]);
  for (const field of ['parts', 'bones', 'props', 'anchors']) assert.equal(adjusted.views.profile[field], rig.views.profile[field]);
  assert.equal(adjusted.views.profile.face.eyes, rig.views.profile.face.eyes);
  for (const [name, entry] of Object.entries(rig.views.profile.face.mouth)) {
    assert.equal(adjusted.views.profile.face.mouth[name].shapes.at(-1).d, entry.shapes.at(-1).d);
  }
  assert.equal(adjusted.views.profile.face.mouth.wavy.shapes[0].d, 'M-1.6 2.7 Q0 3.3 1.5 2.6');
});

test('open-root outline does not close or stroke a shoulder cap', async () => {
  const m = await setup(), a = artwork(m, { id: 'high-five' }, 'front', .5);
  const { context, calls } = trace(), data = m.rig.views.front;
  const part = data.parts.find(p => p.bone === 'hand_r');
  assert.equal(m.limbs.paintUsagiGesturePart(context, { part, data, artwork: a }), true);
  const fillAt = calls.findIndex(c => c[0] === 'fill'), strokeAt = calls.findIndex(c => c[0] === 'stroke');
  assert.ok(fillAt > 0 && strokeAt > fillAt);
  assert.equal(calls.slice(fillAt + 1, strokeAt).some(c => c[0] === 'closePath'), false);
  assert.equal(calls.filter(c => c[0] === 'arc').length, 2); // once per fill/outline path, one geometric palm
});

test('turned far paws paint behind body and wrapped near paws paint only below cloth', async () => {
  const m = await setup(), a = artwork(m, { id: 'yawn' }, 'profile', .5, { wardrobe: { wrapsBody: true } });
  const data = m.rig.views.profile, { context, calls } = trace();
  assert.equal(m.limbs.paintUsagiGestureBack(context, { artwork: a, data, layer: 'back' }), true);
  assert.equal(calls.filter(c => c[0] === 'fill').length, 1);
  assert.equal(m.limbs.paintUsagiGestureUnderCloth(context, { artwork: a }), true);
  assert.equal(calls.filter(c => c[0] === 'fill').length, 2);
  for (const part of data.parts.filter(p => p.bone.startsWith('hand_'))) {
    assert.equal(m.limbs.paintUsagiGesturePart(context, { part, data, artwork: a }), true);
  }
  assert.equal(calls.filter(c => c[0] === 'fill').length, 2);
});

test('selected headwear owns the yawn head without mutating action or outfit', async () => {
  globalThis.Path2D = class ResolutionOnlyPath { constructor(d) { this.d = d; } };
  const { default: artist } = await load(presentation + 'usagi-art.mjs');
  const action = Object.freeze({ id: 'yawn', prop: 'sleep-cap' });
  const hat = Object.freeze({ formId: 'usagi', exclusiveGroup: 'usagi.headwear', renderKey: 'usagi-sunhat', parts: ['front'] });
  const outfit = Object.freeze({ items: Object.freeze([hat]) });
  const dressed = artist.resolveArtwork({ view: 'front', motion: 'stretch', action, appearance: outfit, progress: .5 });
  const bare = artist.resolveArtwork({ view: 'front', motion: 'stretch', action, appearance: { items: [] }, progress: .5 });
  assert.ok(!dressed.pose.sample.props.includes('sleep-cap'));
  assert.ok(bare.pose.sample.props.includes('sleep-cap'));
  assert.equal(action.prop, 'sleep-cap'); assert.equal(outfit.items[0], hat);
  assert.deepEqual(dressed.pose.sample.bones, bare.pose.sample.bones);
});

test('earwear keeps the blue cap; selected headwear also owns calm and immediate cold samples', async () => {
  globalThis.Path2D = class ResolutionOnlyPath { constructor(d) { this.d = d; } };
  const { default: artist } = await load(presentation + 'usagi-art.mjs');
  const action = { id: 'yawn', prop: 'sleep-cap' };
  const resolve = (group, calmVisual) => artist.resolveArtwork({ view: 'profile', motion: 'stretch', action,
    progress: .3, calmVisual, appearance: { items: [{ formId: 'usagi', exclusiveGroup: group,
      renderKey: group === 'usagi.headwear' ? 'usagi-sunhat' : 'usagi-ear-bow', parts: ['front'] }] } });
  for (const calmVisual of [false, true]) {
    assert.ok(resolve('usagi.earwear', calmVisual).pose.sample.props.includes('sleep-cap'));
    assert.ok(!resolve('usagi.headwear', calmVisual).pose.sample.props.includes('sleep-cap'));
  }
});
