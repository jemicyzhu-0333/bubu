'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { default: rig } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { COMPANION_ACTIVITY_STORIES } = require('../src/content/companion/activity-stories.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { sampleMotion } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { default: support } = require('../src/capabilities/companion/presentation/usagi-support.mjs');
const { connectorControl } = require('../src/capabilities/companion/presentation/usagi-support.mjs');
const { prepareUsagiSample, posedPropPoint, usagiPropMatrix, paintUsagiProp } = require('../src/capabilities/companion/presentation/usagi-contact.mjs');
const { resolveUsagiView } = require('../src/capabilities/companion/presentation/usagi-view-policy.mjs');
const { withUsagiGround, sampleUsagiFall, FLOOR } = require('../src/capabilities/companion/presentation/usagi-ground.mjs');
const { sampleUsagiFaceTiming } = require('../src/capabilities/companion/presentation/usagi-face-timing.mjs');
const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { EXPRESSION_PHRASES } = require('../src/capabilities/companion/presentation/expression-phrases.mjs');
const { requestedEyes, resolveRigFace, rigEyeMatrix } = require('../src/capabilities/companion/presentation/rig/face.mjs');
const { USAGI_FORM } = require('../src/content/companion/usagi-form.mjs');
const { adaptFaceForView } = require('../src/core/pet-appearance.mjs');
const { inkBounds, separated } = require('../test-support/usagi-contact-bounds.js');

const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
const at = (id, progress, view = 'front', extra = {}) => {
  const action = PET_ACTIONS[id] || SESSION_ACTIVITIES[id];
  return artist.resolve(rig, { view, motion: action.motion, action, progress, ...extra });
};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const actionFace = (id, progress, view, calmVisual = false) => {
  const action = PET_ACTIONS[id], expressionId = action.expression;
  const base = adaptFaceForView(EXPRESSIONS.find(expression => expression.id === expressionId).face, view);
  const timing = { action, expressionId, motion: action.motion, progress, calmVisual };
  return sampleUsagiFaceTiming(sampleFaceChoreography(base, timing), base, timing);
};

function assertHeldStarClear(artwork, progress) {
  const view = artwork.drawnView, data = rig.views[view];
  if (!data.face) return; // The back view deliberately has no face.
  const face = resolveRigFace(data.face, actionFace('catch-star', progress, view));
  const bounds = [
    ...face.eyes.entry.shapes.map(shape => inkBounds(shape, rigEyeMatrix(shape, face, USAGI_FORM.faceRig[view]))),
    ...(face.eyes.entry.pupil || []).map(shape => inkBounds(shape, rigEyeMatrix(shape, face, USAGI_FORM.faceRig[view], true))),
    ...face.mouth.entry.shapes.map(shape => inkBounds(shape))
  ];
  const matrix = usagiPropMatrix(null, { id: 'star', artwork, data });
  for (const shape of data.props.star.shapes) for (const feature of bounds) {
    assert.ok(separated(inkBounds(shape, matrix), feature), `${view}/${progress}: stroked held star clears the resolved eyes and mouth`);
  }
}

test('optional Usagi sample hook leaves unrelated and incomplete rigs exactly unchanged', () => {
  const sample = sampleMotion('sip', { progress: .5 });
  assert.equal(prepareUsagiSample(sample, { data: { bones: {}, anchors: {} } }), sample);
  const matrix = [1, 0, 0, 1, 0, 0];
  assert.equal(usagiPropMatrix(matrix, { id: 'plane', data: { anchors: {} } }), matrix);
  assert.equal(paintUsagiProp({}, { id: 'blocks', data: { anchors: {} } }, () => assert.fail('foreign rig was painted')), false);
  const generic = createRigArtist({ fallback: { body() {}, face() {}, action() {}, appearance() {} },
    paths: createPathCache({ createPath: d => ({ d }) }) });
  assert.deepEqual(generic.resolve(rig, { motion: 'sip', progress: .5 }).pose.sample, sample);
});

test('cup rim meets the mouth while the handle and paw share a wrist in each visible view', () => {
  const mouths = { front: [33, 33], 'three-quarter': [46, 33], profile: [58, 30] };
  for (const [view, mouth] of Object.entries(mouths)) for (const progress of [.34, .4, .5, .6, .67]) {
    const artwork = at('sip-tea', progress, view);
    assert.ok(distance(posedPropPoint(artwork, 'cup', [0, -3]), mouth) < 1e-8, `${view}/${progress}: rim`);
    const wrist = applyPoint(artwork.pose.world.hand_r, ...rig.views[view].bones.hand_r.pivot);
    const handle = posedPropPoint(artwork, 'cup', [5, 0]);
    assert.ok(distance(wrist, handle) < 1e-8, `${view}/${progress}: grip`);
  }
  assert.ok(distance(posedPropPoint(at('sip-tea', 0), 'cup', [0, -3]), mouths.front) > 12);
});

test('two-handed carrying keeps its cup or star centered with short symmetric reaches', () => {
  const cup = artist.resolve(rig, { view: 'front', motion: 'carry', progress: .5, action: { prop: 'cup' } });
  assert.ok(Math.abs(posedPropPoint(cup, 'cup', [0, -3])[0] - 33) < 1e-8);
  const energy = at('carry-energy', .5);
  assert.ok(Math.abs(posedPropPoint(energy, 'energy', [0, 0])[0] - 33) < 1e-8);
});

test('catching a star brings it to the actual wrist and holds contact through the catch phase', () => {
  for (const view of ['front', 'three-quarter', 'profile', 'back']) {
    for (const progress of [.4, .5, .64]) {
      const artwork = at('catch-star', progress, view), data = rig.views[view];
      const matrix = usagiPropMatrix([1, 0, 0, 1, 0, 0], { id: 'star', artwork, data });
      const star = applyPoint(matrix, 62, 8);
      const wrist = applyPoint(artwork.pose.world.hand_r, ...data.bones.hand_r.pivot);
      assert.ok(distance(star, [wrist[0] + 2, wrist[1] - 6]) < 1e-8, `${view}/${progress}`);
      const shoulder = applyPoint(artwork.pose.world[data.bones.arm_r.parent], ...data.bones.arm_r.pivot);
      assert.ok(distance(wrist, shoulder) <= 29, `${view}/${progress}: short reach`);
      assertHeldStarClear(artwork, progress);
    }
    const rest = at('catch-star', 0, view);
    assert.deepEqual(usagiPropMatrix([1, 0, 0, 1, 0, 0], { id: 'star', artwork: rest, data: rig.views[view] }), [1, 0, 0, 1, 0, 0]);
  }
});

test('held-star geometry includes its authored points, stroke and miter joins', () => {
  const shape = rig.views.front.props.star.shapes[0];
  const fill = inkBounds({ ...shape, stroke: 'none' }), ink = inkBounds(shape);
  assert.ok(ink.minY < fill.minY - shape.width / 2, 'the sharp top join extends farther than a half-stroke radius');
  const mouth = rig.views.profile.face.mouth.open.shapes[0];
  const throughMouth = inkBounds(shape, [1, 0, 0, 1, 58 - 62, 34 - 8]);
  assert.equal(separated(throughMouth, inkBounds(mouth)), false, 'a deliberately misplaced star must fail mouth clearance');
});

for (const id of ['catch-star', 'juggle']) {
  test(`${id} clears resolved eye and mouth ink throughout its production flight`, t => {
    const packagePath = process.env.USAGI_CANVAS_PACKAGE;
    if (!packagePath) return t.skip('Set USAGI_CANVAS_PACKAGE for real Canvas contact clearance');
    const { createCanvas, Path2D } = require(packagePath);
    const paths = createPathCache({ createPath: d => new Path2D(d) });
    const painter = createRigArtist({ fallback: support, paths });
    const scale = 4, size = 146 * scale;
    const faceCanvas = createCanvas(size, size), propCanvas = createCanvas(size, size);
    const faceContext = faceCanvas.getContext('2d'), propContext = propCanvas.getContext('2d');
    const action = PET_ACTIONS[id], propIds = id === 'catch-star' ? ['star'] : ['balls-l', 'balls-r', 'balls-top'];
    const phases = new Set(Array.from({ length: 301 }, (_, i) => i / 300));
    // Include the approach/hold/release and face-recipe edges on both sides.
    for (const edge of [.08, .28, .4, .64, .7, .94]) {
      for (const delta of [-.000001, 0, .000001]) phases.add(edge + delta);
    }
    const samples = [...phases].sort((a, b) => a - b).map(progress => ({ progress, calmVisual: false }));
    samples.push({ progress: .5, calmVisual: true });
    const reset = context => {
      context.resetTransform(); context.clearRect(0, 0, size, size);
      context.scale(scale, scale); context.translate(40, 40);
    };
    for (const view of ['front', 'three-quarter', 'profile']) {
      const propPaths = new Set(propIds.flatMap(prop => rig.views[view].props[prop].shapes.map(shape => paths.get(shape.d))));
      const drawn = new Set();
      // Execute the unchanged action painter, retaining only native prop paths
      // in this mask. Bone/prop transforms, opacity, fills and strokes stay real.
      const propMask = new Proxy(propContext, {
        get(context, key) {
          const value = context[key];
          if (typeof value !== 'function') return value;
          if (key === 'fill' || key === 'stroke') return (path, ...args) => {
            if (propPaths.has(path)) { drawn.add(path); return value.call(context, path, ...args); }
          };
          return value.bind(context);
        },
        set(context, key, value) { context[key] = value; return true; }
      });
      for (const { progress, calmVisual } of samples) {
        const face = actionFace(id, progress, view, calmVisual);
        const artwork = painter.resolve(rig, { action, motion: action.motion, view, progress, calmVisual, face });
        reset(faceContext); reset(propContext); drawn.clear();
        painter.face(faceContext, {}, face, false, view, USAGI_FORM.faceRig, artwork);
        painter.action(propMask, { artwork, action, motion: action.motion, view, layer: 'front', palette: {} });
        assert.equal(drawn.size, propPaths.size, `${id}/${view}: every production prop path must render`);
        const facePixels = faceContext.getImageData(0, 0, size, size).data;
        const propPixels = propContext.getImageData(0, 0, size, size).data;
        let faceInk = 0, propInk = 0, overlap = 0;
        for (let offset = 3; offset < facePixels.length; offset += 4) {
          faceInk += facePixels[offset] > 0; propInk += propPixels[offset] > 0;
          overlap += facePixels[offset] > 0 && propPixels[offset] > 0;
        }
        const label = `${id}/${view}/${progress}/${calmVisual ? 'reduced' : 'live'}`;
        assert.ok(faceInk > 0 && propInk > 0, `${label}: neither clearance mask may be empty`);
        assert.equal(overlap, 0, `${label}: prop covers resolved eye or mouth ink, including antialiasing`);
      }
    }
  });
}

test('sipping and carrying bend below the direct reach without moving either contact endpoint', () => {
  for (const id of ['sip-tea', 'carry-energy']) for (const view of ['front', 'three-quarter', 'profile']) {
    for (const progress of [0, .2, .4, .6, .8, .999]) {
      const artwork = at(id, progress, view), data = rig.views[view], world = artwork.pose.world;
      const calls = [];
      const ctx = { save() {}, restore() {}, beginPath() {}, stroke() {},
        moveTo(...point) { calls.push({ from: point }); },
        quadraticCurveTo(...points) { Object.assign(calls.at(-1), { control: points.slice(0, 2), to: points.slice(2) }); } };
      support.connectors(ctx, { motion: PET_ACTIONS[id].motion, layer: 'front', data, world });
      for (const call of calls) {
        const sides = ['l', 'r'].filter(side => data.parts.some(part => part.bone === `hand_${side}` && part.layer === 'front'));
        const side = sides.find(side => distance(applyPoint(world[data.bones[`arm_${side}`].parent], ...data.bones[`arm_${side}`].pivot), call.from) < 1e-8);
        assert.ok(side);
        assert.ok(distance(call.to, applyPoint(world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot)) < 1e-8);
        const low = Math.max(call.from[1], call.to[1]);
        assert.ok(call.control[1] > low && call.control[1] <= low + 6.5);
        const chordMiddle = (call.from[1] + call.to[1]) / 2;
        const curveMiddle = .25 * call.from[1] + .5 * call.control[1] + .25 * call.to[1];
        assert.ok(curveMiddle > chordMiddle + 1);
      }
    }
  }
  assert.deepEqual(connectorControl([11, 44], [22, 54], 'l', 'write'), [15, 50.5]);
  assert.deepEqual(connectorControl([55, 44], [68, 49], 'r', 'umbrella'), [63, 48]);
});

test('telescope touches the eyepiece to the near eye, never the objective or mouth', () => {
  for (const [view, eye] of Object.entries({ 'three-quarter': [53, 25], profile: [50, 25] })) {
    for (const progress of [.34, .5, .67]) {
      const artwork = at('telescope', progress, view);
      assert.ok(distance(posedPropPoint(artwork, 'telescope', [-2, 5]), eye) < 1e-8);
      assert.ok(posedPropPoint(artwork, 'telescope', [15, -2])[0] > eye[0] + 15);
    }
  }
});

test('watering spout tips over the fixed plant and both cup and can are held by their handles', () => {
  for (const progress of [.34, .5, .66]) {
    const artwork = at('plant-water', progress, 'profile');
    assert.ok(distance(posedPropPoint(artwork, 'watering-can', [11, -4]), [62, 47]) < 1e-8);
    const wrist = applyPoint(artwork.pose.world.hand_r, ...rig.views.profile.bones.hand_r.pivot);
    assert.ok(distance(posedPropPoint(artwork, 'watering-can', [-8, 0]), wrist) < 1e-8);
    assert.equal(artwork.pose.sample.propPoses.plant, undefined);
  }
});

test('the sweeping bristles stay on the floor while their handle follows the paw', () => {
  for (let i = 0; i < 100; i += 1) {
    const artwork = at('sweep', i / 100), point = posedPropPoint(artwork, 'broom', [0, 18]);
    assert.ok(Math.abs(point[1] - 67) < 1e-8);
  }
});

test('paper plane leaves the paw continuously and fades before resetting', () => {
  const center = progress => {
    const artwork = at('paper-plane', progress, 'profile'), data = rig.views.profile;
    const matrix = usagiPropMatrix(artwork.pose.world.hand_r, { id: 'plane', artwork, data });
    return applyPoint(matrix, data.bones.hand_r.pivot[0], data.bones.hand_r.pivot[1] + 1);
  };
  assert.ok(distance(center(.299999), center(.300001)) < .001);
  assert.ok(center(.8)[0] - center(.31)[0] > 28);
  assert.equal(at('paper-plane', .99, 'profile').pose.sample.propPoses.plane.opacity, 0);
});

test('juggled balls visit both catch points and their flight has no position seam', () => {
  const point = progress => {
    const artwork = at('juggle', progress), data = rig.views.front;
    return applyPoint(usagiPropMatrix(null, { id: 'balls-l', artwork, data }), 17, 8);
  };
  for (const [phase, side] of [[.25, 'r'], [.75, 'l']]) {
    const artwork = at('juggle', phase), hand = `hand_${side}`;
    const wrist = applyPoint(artwork.pose.world[hand], ...rig.views.front.bones[hand].pivot);
    const ball = point(phase);
    assert.ok(Math.abs(ball[0] - wrist[0]) < 1e-8, `${side}: ball is over its actual short-paw catch point`);
    assert.ok(wrist[1] - ball[1] >= 5 && wrist[1] - ball[1] <= 8, `${side}: ball meets the upper palm`);
  }
  assert.ok(point(.5)[1] < -28, 'the arc clears the face and long ears');
  assert.ok(distance(point(.999999), point(.000001)) < .001);
});

test('building lifts only the top block and star while the lower two blocks stay grounded', () => {
  const artwork = at('build-blocks', .3), prop = rig.views.front.props.blocks, calls = [];
  assert.equal(paintUsagiProp({}, { id: 'blocks', prop, artwork }, (shapes, matrix) => calls.push({ shapes, matrix })), true);
  assert.equal(calls.length, 2); assert.equal(calls[0].shapes.length, 2); assert.equal(calls[1].shapes.length, 2);
  assert.deepEqual(calls[0].matrix, [1, 0, 0, 1, 0, 0]);
  assert.equal(calls[1].matrix[4], 15); assert.equal(calls[1].matrix[5], -10);
});

test('pitfall uses one stationary world floor, removes the old disc, and closes its loop', () => {
  for (let i = 0; i <= 100; i += 1) {
    const progress = i / 100, artwork = withUsagiGround(at('pit-fall', progress), PET_ACTIONS['pit-fall'], progress, false);
    assert.equal(artwork.groundClipY + sampleUsagiFall(progress), FLOOR);
    assert.equal(artwork.pose.sample.props.includes('hole'), false);
  }
  assert.ok(sampleUsagiFall(.5) > 35);
  assert.equal(sampleUsagiFall(0), 0); assert.equal(sampleUsagiFall(1), 0);
});

test('view selection preserves visible tails and readable tools throughout every story', () => {
  assert.equal(resolveUsagiView('auto', { action: PET_ACTIONS['tail-wiggle'] }), 'back');
  assert.equal(resolveUsagiView('front', { action: PET_ACTIONS['tail-wiggle'] }), 'back');
  assert.equal(resolveUsagiView('back', { action: PET_ACTIONS.telescope }), 'three-quarter');
  assert.equal(resolveUsagiView('profile', { action: PET_ACTIONS['carry-energy'] }), 'front');
  for (const [id, story] of Object.entries(COMPANION_ACTIVITY_STORIES)) {
    const views = new Set(); let before = 0;
    for (const stage of story.stages) {
      const sampled = sampleActivityStory(SESSION_ACTIVITIES[id], (before + stage.until) / 2);
      views.add(resolveUsagiView('auto', { action: sampled.action, state: 'idle' })); before = stage.until;
    }
    assert.equal(views.size, 1, `${id} keeps its attention across phases`);
  }
});

test('all catalog actions keep coherent contacts in reduced motion', () => {
  for (const action of [...Object.values(PET_ACTIONS), ...Object.values(SESSION_ACTIVITIES)]) {
    const first = at(action.id, 0, 'front', { calmVisual: true });
    for (const progress of [.15, .5, .8, .99]) {
      const next = at(action.id, progress, 'front', { calmVisual: true });
      assert.deepEqual(next.pose, first.pose, action.id);
    }
  }
});

test('standalone phrase switches occur behind closed lids and a settled two-wave mouth', () => {
  for (const expression of EXPRESSIONS) for (const boundary of [.28, .68]) {
    const at = EXPRESSION_PHRASES[expression.id][0] * boundary;
    for (const delta of [-1, 1]) {
      const options = { expressionId: expression.id, expressionElapsedMs: at + delta, motion: 'idle' };
      const face = sampleUsagiFaceTiming(sampleFaceChoreography(expression.face, options), expression.face, options);
      if (!['react.surprised', 'react.celebrate', 'system.restricted'].includes(expression.id)
        && EXPRESSION_PHRASES[expression.id][1] !== expression.face.eyes) {
        assert.equal(requestedEyes(face), 'closed', `${expression.id}/${boundary}`);
      }
      assert.equal(face.mouth, 'closed');
    }
    assert.equal(sampleUsagiFaceTiming(expression.face, expression.face, { calmVisual: true }), expression.face);
    assert.equal(sampleUsagiFaceTiming(expression.face, expression.face, { action: PET_ACTIONS.wave }), expression.face);
  }
});

test('ready replacement footwear can hide exactly two old feet in portraits and live layers', () => {
  const neutral = artist.resolve(rig, { view: 'front', motion: 'idle', calmVisual: true });
  const hidden = { ...neutral, hiddenRigBones: ['leg_l', 'leg_r'] };
  const feet = rig.views.front.parts.filter(part => ['leg_l', 'leg_r'].includes(part.bone)).flatMap(part => part.shapes.map(shape => shape.d));
  const render = (artwork, fit) => {
    const drawn = [], ctx = { globalAlpha: 1, save() {}, restore() {}, transform() {}, stroke() {}, fill(path) { drawn.push(path.d); } };
    if (fit) artist.body(ctx, {}, 'front', artwork, { fit: true });
    else artist.action(ctx, { artwork, view: 'front', motion: 'idle', layer: 'back', palette: {} });
    return drawn;
  };
  for (const fit of [true, false]) {
    const before = render(neutral, fit), after = render(hidden, fit);
    assert.ok(feet.every(path => before.includes(path)));
    assert.ok(feet.every(path => !after.includes(path)));
    assert.deepEqual(after, before.filter(path => !feet.includes(path)));
  }
});
