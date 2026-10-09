'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { COMPANION_ACTIVITY_STORIES } = require('../src/content/companion/activity-stories.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { default: support } = require('../src/capabilities/companion/presentation/usagi-support.mjs');
const { usagiPropMatrix } = require('../src/capabilities/companion/presentation/usagi-contact.mjs');
const { withUsagiGround } = require('../src/capabilities/companion/presentation/usagi-ground.mjs');
const { USAGI_FORM } = require('../src/content/companion/usagi-form.mjs');
const { resolveFormMotion } = require('../src/capabilities/companion/form-registry.mjs');
const { MOTIONS, MOTION_NAMES, sampleMotion, sampleTrack } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { PROP_SETS, PROP_NAMES, PROP_PIVOTS, resolveRigProps } = require('../src/capabilities/companion/presentation/rig/props.mjs');
const { computeBoneWorld, applyPoint, multiply, localMatrix } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { LIMITS, validateRig } = require('../src/capabilities/companion/presentation/rig/schema.mjs');
const { sampleBodyMotion } = require('../src/capabilities/companion/presentation/usagi-body-motion.mjs');
const { pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
const { default: rig } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const actions = [...Object.values(PET_ACTIONS), ...Object.values(SESSION_ACTIVITIES)];
const views = Object.keys(rig.views);
const phases = Array.from({ length: 17 }, (_, index) => index / 17);

function fingerprint(sample, data) {
  return JSON.stringify(Object.fromEntries(Object.entries(sample.bones).filter(([bone]) => data.bones[bone])));
}

test('every catalog action retains its semantic motion and has a distinct articulated loop', () => {
  for (const action of actions) {
    assert.equal(resolveFormMotion(USAGI_FORM, action), action.motion, action.id);
    assert.ok(MOTIONS[action.motion], `${action.id} has authored choreography`);
  }
  assert.deepEqual(new Set(USAGI_FORM.supportedMotions), new Set(MOTION_NAMES));
  for (const view of views) {
    const loopSignatures = new Map();
    for (const motion of MOTION_NAMES) {
      const frames = phases.map(progress => fingerprint(sampleMotion(motion, { view, progress }), rig.views[view]));
      assert.ok(new Set(frames).size > 3, `${motion}/${view} has several visibly different bone poses`);
      const signature = frames.join('|');
      assert.ok(!loopSignatures.has(signature), `${motion}/${view} must not reuse ${loopSignatures.get(signature)}`);
      loopSignatures.set(signature, motion);
    }
  }
});

test('all authored channels return smoothly to their first key at the loop seam', () => {
  for (const [motion, definition] of Object.entries(MOTIONS)) {
    for (const bones of [definition.bones, ...Object.values(definition.views || {}), definition.bare || {}]) {
      for (const [bone, channels] of Object.entries(bones)) for (const [channel, keys] of Object.entries(channels)) {
        assert.equal(keys[0][0], 0, `${motion}/${bone}/${channel} starts at zero`);
        assert.equal(keys.at(-1)[0], 1, `${motion}/${bone}/${channel} ends at one`);
        assert.equal(keys[0][1], keys.at(-1)[1], `${motion}/${bone}/${channel} must close its loop`);
        assert.ok(Math.abs(sampleTrack(keys, 0.000001) - sampleTrack(keys, 0.999999)) < 0.00001);
        for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i][0] > keys[i - 1][0]);
      }
    }
    for (const view of views) {
      const before = sampleMotion(motion, { view, progress: 0.999999 });
      const after = sampleMotion(motion, { view, progress: 0.000001 });
      for (const [id, pose] of Object.entries(before.propPoses)) for (const [channel, value] of Object.entries(pose)) {
        assert.ok(Math.abs(value - after.propPoses[id][channel]) < 0.001, `${motion}/${id}/${channel} prop loop`);
      }
    }
  }
});

test('calm mode freezes a readable complete pose including props, without a hidden prop oscillator', () => {
  for (const action of actions) for (const view of views) {
    const first = sampleMotion(action.motion, { view, prop: action.prop, progress: 0, calmVisual: true });
    for (const progress of [0.1, 0.4, 0.8, 0.999]) {
      assert.deepEqual(sampleMotion(action.motion, { view, prop: action.prop, progress, calmVisual: true }), first);
    }
  }
});

test('all catalog props resolve to exact native equipment in every view, including explicit none', () => {
  for (const action of actions) for (const view of views) {
    assert.ok(Object.hasOwn(PROP_SETS, action.prop), `${action.id}: ${action.prop} is a closed semantic choice`);
    const sample = sampleMotion(action.motion, { view, prop: action.prop, progress: 0.5 });
    assert.deepEqual(sample.props, PROP_SETS[action.prop], `${action.id}/${view}`);
    assert.deepEqual(resolveRigProps(rig.views[view], sample).missing, [], `${action.id}/${view}`);
  }
  assert.deepEqual(sampleMotion('type').props, ['keyboard']);
  assert.deepEqual(sampleMotion('knit').props, ['yarn', 'needle-l', 'needle-r']);
  assert.deepEqual(sampleMotion('water').props, ['watering-can', 'plant']);
  assert.deepEqual(sampleMotion('cook').props, ['pan']);
  assert.deepEqual(sampleMotion('browse').props, ['laptop']);
  assert.deepEqual(sampleMotion('trade').props, ['chart']);
  assert.deepEqual(sampleMotion('look', { prop: 'none' }).props, []);
  assert.deepEqual(sampleMotion('look', { prop: 'unknown-equipment' }).props, []);
  assert.notDeepEqual(sampleMotion('look', { prop: 'none', progress: .5 }).bones,
    sampleMotion('look', { prop: 'binoculars', progress: .5 }).bones, 'bare window watching does not hold invisible binoculars');
  for (const view of views) assert.ok(PROP_NAMES.every(id => rig.views[view].props[id]));
});

test('hands contact the work surface and both typing and knitting paws move independently', () => {
  const data = rig.views.front;
  for (const motion of ['read', 'type', 'knit', 'drum']) {
    const sample = sampleMotion(motion, { progress: .5 });
    const world = computeBoneWorld(data.bones, sample.bones);
    const left = applyPoint(world.hand_l, ...data.bones.hand_l.pivot);
    const right = applyPoint(world.hand_r, ...data.bones.hand_r.pivot);
    assert.ok(left[0] >= 20 && left[0] <= 34, `${motion}: left paw is inside the tool's working area`);
    assert.ok(right[0] >= 32 && right[0] <= 47, `${motion}: right paw is inside the tool's working area`);
    assert.ok(left[1] >= 43 && left[1] <= 59 && right[1] >= 43 && right[1] <= 59, `${motion}: paws meet the surface`);
  }
  for (const motion of ['type', 'knit']) {
    for (const bone of ['arm_l', 'arm_r']) {
      assert.ok(new Set(phases.map(progress => sampleMotion(motion, { progress }).bones[bone].r.toFixed(4))).size > 5);
    }
  }
});

test('complex props have causal reveal/recovery and independently phased motion', () => {
  const dig = progress => sampleMotion('dig', { prop: 'treasure', progress }).propPoses;
  assert.equal(dig(0).treasure.opacity, 0);
  assert.equal(dig(.75).treasure.opacity, 1);
  assert.ok(dig(.75).shovel.opacity < dig(0).shovel.opacity);
  const magic = progress => sampleMotion('magic', { progress }).propPoses.star;
  assert.equal(magic(.1).opacity, 0);
  assert.equal(magic(.7).opacity, 1);
  const first = sampleMotion('juggle', { progress: .1 }).propPoses;
  const next = sampleMotion('juggle', { progress: .4 }).propPoses;
  for (const id of ['balls-l', 'balls-r', 'balls-top']) assert.notDeepEqual(first[id], next[id]);
  assert.notEqual(first['balls-l'].y, first['balls-r'].y);
});

test('rig prop capacity is bounded and excess input fails instead of silently dropping equipment', () => {
  const doc = structuredClone(rig);
  const prop = doc.views.front.props.book;
  doc.views.front.props = Object.fromEntries(Array.from({ length: LIMITS.props + 1 }, (_, i) => [`prop-${i}`, prop]));
  assert.equal(LIMITS.props, 64);
  const invalid = validateRig(doc);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(message => /too many props/.test(message)));
});

// Conservative path bounds include control points and are stricter than ink
// screenshots. Check the actual authored parts and props under both layers of
// motion, rather than only testing parameter magnitudes or a synthetic bone.
function wholeMatrix(motion, progress) {
  const { x, y, r, sx, sy } = sampleBodyMotion(motion, progress);
  const c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy,
    33 + x - 33 * c * sx + 33 * s * sy, 33 + y - 33 * s * sx - 33 * c * sy];
}

test('all four-view catalog loops keep posed native geometry inside the stage safe area', () => {
  const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
  for (const view of views) for (const action of actions) for (let frame = 0; frame <= 32; frame += 1) {
    const progress = frame / 32, data = rig.views[view];
    const artwork = withUsagiGround(artist.resolve(rig, { view, motion: action.motion, action, progress }), action, progress, false);
    const sample = artwork.pose.sample, world = artwork.pose.world;
    const whole = wholeMatrix(action.motion, progress);
    const parts = data.parts.map(part => ({ ...part, matrix: part.layer === 'body' ? [1, 0, 0, 1, 0, 0] : world[part.bone] }));
    for (const id of sample.props) {
      const prop = data.props[id], pose = sample.propPoses[id];
      if (pose?.opacity < .05) continue;
      const pivot = prop.bone === 'root' ? PROP_PIVOTS[id] || [33, 52] : data.bones[prop.bone].pivot;
      const matrix = pose ? multiply(world[prop.bone], localMatrix(pivot, pose)) : world[prop.bone];
      parts.push({ ...prop, id, matrix: usagiPropMatrix(matrix, { id, artwork, data }) });
    }
    for (const part of parts) for (const shape of part.shapes) {
      const matrix = multiply(whole, multiply(part.matrix, shape.m));
      const bounds = pathBounds(shape.d, matrix);
      const margin = shape.stroke && shape.stroke !== 'none' ? shape.width / 2 : 0;
      const bottom = Number.isFinite(artwork.groundClipY) ? Math.min(bounds.maxY + margin, 67) : bounds.maxY + margin;
      assert.ok(bounds.minX - margin >= -40 && bounds.minY - margin >= -40
        && bounds.maxX + margin <= 106 && bottom <= 106,
      `${action.id}/${view}/${frame}/${part.id || part.bone} stays inside the stage: ${JSON.stringify(bounds)}`);
    }
  }
});


test('every long-session story beat preserves equipment through sequence, motion and native artist', () => {
  const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
  let painted = 0;
  const ctx = { globalAlpha: 1, save() {}, restore() {}, transform() {}, fill() { painted += 1; }, stroke() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, closePath() {} };
  for (const [id, timeline] of Object.entries(COMPANION_ACTIVITY_STORIES)) {
    let start = 0;
    for (const stage of timeline.stages) {
      const sampled = sampleActivityStory(SESSION_ACTIVITIES[id], (start + stage.until) / 2);
      for (const view of views) {
        const motion = resolveFormMotion(USAGI_FORM, sampled.action);
        const sample = sampleMotion(motion, { view, prop: sampled.action.prop, progress: sampled.progress });
        const label = `${id}/${stage.label}/${view}`;
        assert.ok(Object.hasOwn(PROP_SETS, stage.prop), label);
        const props = resolveRigProps(rig.views[view], sample);
        assert.deepEqual(props.missing, [], label);
        if (stage.prop === 'none') assert.deepEqual(sample.props, [], label);
        else assert.ok(props.drawn.length > 0, `${label}: non-empty native equipment`);
        if (stage.prop === 'plant') assert.deepEqual(sample.props, ['plant']);
        if (stage.motion === 'write') assert.ok(sample.props.includes('pen'), `${label}: writing needs a pen`);
        const artwork = artist.resolve(rig, { view, motion, action: sampled.action, progress: sampled.progress });
        assert.deepEqual(artwork.pose.sample.props, sample.props, `${label}: action prop reaches artist`);
        for (const layer of ['back', 'front']) artist.action(ctx, { artwork, layer, view, palette: {}, motion });
      }
      start = stage.until;
    }
  }
  assert.ok(painted > 100, 'the complete artist actually paints the sampled stages');
});

test('plant watching never holds invisible binoculars, writing supplies a pen, and a resting cup stays upright', () => {
  const plant = sampleMotion('look', { prop: 'plant', progress: .5 });
  assert.deepEqual(plant.bones, sampleMotion('look', { prop: 'none', progress: .5 }).bones);
  assert.deepEqual(plant.props, ['plant']);
  for (const prop of ['chart', 'notes', 'book']) {
    assert.ok(sampleMotion('write', { prop }).props.includes('pen'));
    assert.ok(!sampleMotion('read', { prop }).props.includes('pen'));
  }
  for (const motion of ['breathe', 'daydream', 'organize', 'carry']) for (const progress of phases) {
    const pose = sampleMotion(motion, { prop: 'cup', progress }).bones;
    assert.ok(Math.abs(pose.arm_r.r + pose.hand_r.r) < 1e-9, `${motion}: the cup stays vertical`);
  }
});
