'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const expected = require('../test-support/fixtures/usagi-r1-preserved-poses.json');
const { default: rig } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { default: support } = require('../src/capabilities/companion/presentation/usagi-support.mjs');
const { expandedContactPaw, contactPawGeometry } = require('../src/capabilities/companion/presentation/usagi-contact-limbs.mjs');
const { gesturePawGeometry, paintUsagiGesturePart } = require('../src/capabilities/companion/presentation/usagi-gesture-limbs.mjs');
const { usagiProfileFaceRig, usagiSneezeFaceRig } = require('../src/capabilities/companion/presentation/usagi-face-projection.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { USAGI_FORM } = require('../src/content/companion/usagi-form.mjs');
const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });

test('R1 catalogue world, grips and prop tracks preserve the authenticated baseline within machine roundoff', async t => {
  const crypto = require('node:crypto');
  const values = require('../test-support/fixtures/usagi-r1-preserved-values.json');
  const { comparePoseValues } = require('../test-support/assert-pose-baseline');
  const { cataloguePoses } = await import('../tools/usagi-pose-extension/pose-fixtures.mjs');
  // These full values were recovered only after all 4536 records reproduced
  // the original golden hashes. Authenticate them again; never refresh hashes.
  for (const [hash, value] of Object.entries(values)) {
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'), hash);
  }
  const actual = (await cataloguePoses(path.resolve(__dirname, '..'), { includeValues: true }))
    .filter(record => record.id !== 'paper-return');
  assert.equal(actual.length, expected.length);
  const report = { maxAbsolute: 0, maxScaledEpsilons: 0, path: null };
  for (let i = 0; i < expected.length; i++) {
    const { hash: originalHash, ...identity } = expected[i];
    const { hash, values: sampled, ...currentIdentity } = actual[i];
    assert.deepEqual(currentIdentity, identity, `record ${i}: sample identity changed`);
    assert.ok(values[originalHash], `record ${i}: original baseline values missing`);
    // The motion-craft changes have dedicated contact/ground tests. Preserve
    // all other bones and prop fields against the authenticated golden values.
    const current = structuredClone(sampled);
    const original = structuredClone(values[originalHash]);
    if (identity.id === 'moonwalk') {
      delete current.world.leg_l; delete current.world.leg_r;
      delete original.world.leg_l; delete original.world.leg_r;
    }
    if (identity.id === 'magic-trick') { delete current.propPoses.star; delete original.propPoses.star; }
    comparePoseValues(current, original, `${i}/${identity.id}/${identity.view}/${identity.progress}`, report);
  }
  t.diagnostic(`Pose baseline numeric drift: ${JSON.stringify(report)}`);
});

test('pose baseline comparator rejects geometry, identity, shape and nonfinite regressions', () => {
  const { comparePoseValues } = require('../test-support/assert-pose-baseline');
  const value = { world: { hand: [1, 0, 0, 1, 20, 30] }, props: ['book'], propPoses: { book: { x: .1 } } };
  assert.doesNotThrow(() => comparePoseValues(structuredClone(value), value, 'same'));
  const roundoff = structuredClone(value); roundoff.world.hand[0] += Number.EPSILON;
  assert.doesNotThrow(() => comparePoseValues(roundoff, value, 'one epsilon'));
  for (const mutate of [v => { v.world.hand[4] += 1e-7; }, v => { v.props[0] = 'other'; },
    v => { v.world.hand[0] += 129 * Number.EPSILON; },
    v => { v.world.hand.pop(); }, v => { v.propPoses.book.x = NaN; }]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => comparePoseValues(changed, value, 'mutation'));
  }
});

test('integrated tool contours retain exact production wrist targets', () => {
  const ids = ['read-book', 'take-note', 'type-keyboard', 'sip-tea', 'knit-scarf', 'drum-solo',
    'build-blocks', 'tiny-chef', 'sweep', 'umbrella-dance', 'snack-picnic', 'bubble-blow', 'sing', 'plant-water'];
  let checked = 0;
  for (const id of ids) for (const view of Object.keys(rig.views)) for (let n = 0; n <= 40; n++) {
    const action = PET_ACTIONS[id], data = rig.views[view];
    const artwork = artist.resolve(rig, { action, view, motion: action.motion, progress: n / 40 });
    for (const side of ['l', 'r']) if (expandedContactPaw(artwork.pose.sample, side)) {
      const geometry = contactPawGeometry(artwork, data, side);
      assert.deepEqual(geometry.to, applyPoint(artwork.pose.world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot));
      assert.ok([...geometry.from, ...geometry.to, ...geometry.control].every(Number.isFinite));
      assert.equal(geometry.openRoot, true); checked++;
    }
  }
  assert.ok(checked > 1000);
});

test('story hand release retains its integrated painter only while the blended wrist is extended', () => {
  const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
  const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
  const { integratedUsagiPaw } = require('../src/capabilities/companion/presentation/usagi-contact-limbs.mjs');
  for (const [id, edge, sides] of [['rest-tea', .16, ['l']], ['focus-browse', .85, ['l', 'r']]]) {
    const painter = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
    const activity = SESSION_ACTIVITIES[id];
    const resolve = (at, now) => {
      const beat = sampleActivityStory(activity, at);
      return painter.resolve(rig, { action: beat.action, motion: beat.action.motion, progress: beat.progress,
        view: 'front', elapsedMs: now, channel: id });
    };
    resolve(edge - .001, 0);
    const startingRelease = resolve(edge + .001, 20);
    const settled = resolve(edge + .03, 600);
    for (const side of sides) {
      assert.equal(integratedUsagiPaw(startingRelease, side), true, id + ': still extended');
      assert.equal(integratedUsagiPaw(settled, side), false, id + ': restored authored resting paw');
    }
  }
  assert.equal(expandedContactPaw({ contactAction: 'rest-nap', motion: 'breathe', props: ['laptop'] }, 'l'), false);
});

test('free gesture route stays short, continuous and closed at the cycle boundary', () => {
  for (const id of ['wave', 'stretch']) for (const view of Object.keys(rig.views)) for (const side of ['l', 'r']) {
    let first, previous;
    for (let n = 0; n <= 160; n++) {
      const action = PET_ACTIONS[id], data = rig.views[view];
      const artwork = artist.resolve(rig, { action, view, motion: action.motion, progress: n / 160 });
      const geometry = gesturePawGeometry(artwork, data, side);
      assert.ok(Math.hypot(geometry.to[0] - geometry.from[0], geometry.to[1] - geometry.from[1]) < 17);
      if (previous) assert.ok(Math.hypot(geometry.to[0] - previous[0], geometry.to[1] - previous[1]) < 1.5);
      first ||= geometry; previous = geometry.to;
      if (n === 160) assert.deepEqual(geometry, first);
    }
  }
});

test('corner correction changes only the profile worried mouth and delegates approved sneeze unchanged', () => {
  const next = usagiProfileFaceRig(rig, { id: 'stuck-corner' }, 'profile');
  assert.notEqual(next, rig);
  for (const id of ['yawn', 'high-five', 'sip-tea', 'sing', 'bubble-blow']) {
    assert.equal(usagiProfileFaceRig(rig, { id }, 'profile'), rig);
  }
  assert.equal(usagiProfileFaceRig(rig, { id: 'sneeze' }, 'profile'), usagiSneezeFaceRig(rig, { id: 'sneeze' }, 'profile'));
  for (const [name, mouth] of Object.entries(rig.views.profile.face.mouth)) if (name !== 'wavy') {
    assert.equal(next.views.profile.face.mouth[name], mouth);
  }
  assert.equal(next.views.profile.face.eyes, rig.views.profile.face.eyes);
});

test('free-hand paint clears actual canonical open-mouth and eye pixels through all visible angle probes', t => {
  if (!process.env.USAGI_CANVAS_PACKAGE) return t.skip('Real Canvas backend required for face clearance');
  const { createCanvas, Path2D } = require(process.env.USAGI_CANVAS_PACKAGE);
  const painter = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => new Path2D(d) }) });
  const size = 584, scale = 4, face = { eyes: 'neutral', mouth: 'open', openness: 1 };
  const faceCanvas = createCanvas(size, size), limbCanvas = createCanvas(size, size);
  const fc = faceCanvas.getContext('2d'), lc = limbCanvas.getContext('2d');
  const reset = c => { c.resetTransform(); c.clearRect(0, 0, size, size); c.scale(scale, scale); c.translate(40, 40); };
  // Geometry diagnostics include profile story waves. Ordinary wave retains its
  // production front-only view policy; this test does not expand allowed views.
  for (const id of ['wave', 'stretch']) for (const view of ['front', 'three-quarter', 'profile']) {
    const data = rig.views[view], action = PET_ACTIONS[id];
    for (let n = 0; n <= 80; n++) {
      const artwork = painter.resolve(rig, { action, view, motion: action.motion, progress: n / 80, face });
      reset(fc); reset(lc);
      painter.face(fc, {}, face, false, view, USAGI_FORM.faceRig, artwork);
      for (const part of data.parts.filter(p => p.bone.startsWith('hand_'))) {
        paintUsagiGesturePart(lc, { part, data, artwork });
      }
      const f = fc.getImageData(0, 0, size, size).data, l = lc.getImageData(0, 0, size, size).data;
      let faceInk = 0, limbInk = 0, overlap = 0;
      for (let i = 3; i < f.length; i += 4) { faceInk += f[i] > 0; limbInk += l[i] > 0; overlap += f[i] > 0 && l[i] > 0; }
      assert.ok(faceInk && limbInk);
      assert.equal(overlap, 0, `${id}/${view}/${n / 80}: limb touches face ink`);
    }
  }
});

test('ordinary magic star clears resolved face ink throughout the reveal path', t => {
  if (!process.env.USAGI_CANVAS_PACKAGE) return t.skip('Real Canvas backend required for star clearance');
  const { createCanvas, Path2D } = require(process.env.USAGI_CANVAS_PACKAGE);
  const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
  const { sampleUsagiFaceTiming } = require('../src/capabilities/companion/presentation/usagi-face-timing.mjs');
  const { adaptFaceForView } = require('../src/core/pet-appearance.mjs');
  const { EXPRESSIONS } = require('../src/content/expressions.mjs');
  const paths = createPathCache({ createPath: d => new Path2D(d) });
  const painter = createRigArtist({ fallback: support, paths });
  const size = 584, faceCanvas = createCanvas(size, size), starCanvas = createCanvas(size, size);
  const fc = faceCanvas.getContext('2d'), sc = starCanvas.getContext('2d');
  const reset = c => { c.resetTransform(); c.clearRect(0, 0, size, size); c.scale(4, 4); c.translate(40, 40); };
  const action = PET_ACTIONS['magic-trick'];
  let visibleSamples = 0;
  for (const view of ['front', 'three-quarter', 'profile']) {
    const starPaths = new Set(rig.views[view].props.star.shapes.map(shape => paths.get(shape.d)));
    const mask = new Proxy(sc, { get(context, key) {
      const value = context[key];
      if (typeof value !== 'function') return value;
      if (key === 'fill' || key === 'stroke') return (p, ...args) => starPaths.has(p) && value.call(context, p, ...args);
      return value.bind(context);
    }, set(context, key, value) { context[key] = value; return true; } });
    for (let n = 0; n <= 160; n++) {
      const progress = n / 160;
      const base = adaptFaceForView(EXPRESSIONS.find(e => e.id === action.expression).face, view);
      const timing = { action, expressionId: action.expression, motion: action.motion, progress };
      const face = sampleUsagiFaceTiming(sampleFaceChoreography(base, timing), base, timing);
      const artwork = painter.resolve(rig, { action, view, motion: action.motion, progress, face });
      reset(fc); reset(sc);
      painter.face(fc, {}, face, false, view, USAGI_FORM.faceRig, artwork);
      painter.action(mask, { artwork, action, motion: action.motion, view, layer: 'front', palette: {} });
      const f = fc.getImageData(0, 0, size, size).data, s = sc.getImageData(0, 0, size, size).data;
      let overlap = 0, starInk = 0, faceInk = 0;
      for (let i = 3; i < f.length; i += 4) { overlap += f[i] > 0 && s[i] > 0; starInk += s[i] > 0; faceInk += f[i] > 0; }
      assert.ok(faceInk > 0);
      if (starInk > 0) visibleSamples++;
      assert.equal(overlap, 0, `${view}/${progress}: ordinary star covers a face pixel`);
    }
  }
  assert.ok(visibleSamples > 250, 'the real production star must be visible during the tested reveal');
});
