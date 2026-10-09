'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileRig } = require('../tools/rig-build/build.mjs');
const { pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
const { validateRig } = require('../src/capabilities/companion/presentation/rig/schema.mjs');
const { resolveRigFace, rigEyeMatrix } = require('../src/capabilities/companion/presentation/rig/face.mjs');
const { USAGI_FORM } = require('../src/content/companion/usagi-form.mjs');
const bundled = require('../assets/companion/usagi/rig/usagi.rig.mjs').default;
const source = fs.readFileSync(path.join(__dirname, '../assets/companion/usagi/rig/usagi.rig.svg'), 'utf8');
const compiled = compileRig(source);

const geometry = entry => JSON.stringify([entry.shapes, entry.pupil].flat().filter(Boolean).map(shape =>
  [shape.d, shape.m, shape.fill, shape.stroke, shape.width]));

test('bundled Usagi artwork is the exact compiled source and keeps four independently authored views', () => {
  assert.equal(compiled.ok, true, compiled.errors.join('\n'));
  assert.deepEqual(compiled.warnings, []);
  assert.equal(validateRig(bundled).ok, true);
  assert.deepEqual(bundled.views, compiled.doc.views);
  assert.equal(bundled.version, 5);
  assert.equal(new Set(Object.values(bundled.views).map(view => JSON.stringify(view.parts))).size, 4);
});

test('every visible Usagi view has sixteen distinct eye drawings and nine distinct mouths', () => {
  for (const name of ['front', 'three-quarter', 'profile']) {
    const { face } = bundled.views[name];
    assert.equal(Object.keys(face.eyes).length, 16, name);
    assert.equal(new Set(Object.values(face.eyes).map(geometry)).size, 16, `${name}: no relabeled duplicate eyes`);
    assert.equal(Object.keys(face.mouth).length, 9, name);
    assert.equal(new Set(Object.values(face.mouth).map(geometry)).size, 9, `${name}: no relabeled duplicate mouths`);
    for (const [state, entry] of Object.entries(face.eyes)) {
      assert.ok(entry.pupil.length > 0, `${name}/${state} can be animated independently`);
    }
  }
  assert.equal(Object.keys(bundled.views.back.face?.eyes || {}).length, 0, 'the back must not grow a face');
});

test('Usagi eyes continuously close around their own centers and converge without translating brows with gaze', () => {
  const view = bundled.views.front;
  const resolved = resolveRigFace(view.face, { eyes: 'neutral', openness: .45, eyeInsetX: 2, eyeOffsetX: 1.5, eyeOffsetY: -.5 });
  const left = view.face.eyes.neutral.pupil[0];
  const right = view.face.eyes.neutral.pupil.find(shape => shape.m[4] === 43);
  const transform = rigEyeMatrix(left, resolved, USAGI_FORM.faceRig.front, true);
  assert.deepEqual(transform.slice(0, 5), [1, 0, 0, .45, 3.5]);
  assert.ok(Math.abs(transform[5] - 13.25) < 1e-10);
  assert.equal(rigEyeMatrix(right, resolved, USAGI_FORM.faceRig.front, true)[4], -.5);
  assert.deepEqual(rigEyeMatrix(view.face.eyes.neutral.shapes[0], resolved, USAGI_FORM.faceRig.front), [1, 0, 0, 1, 2, 0]);
  const blink = resolveRigFace(view.face, { openness: .1, eyeInsetX: 9 }, false);
  assert.equal(blink.eyes.state, 'closed');
  assert.equal(blink.eyeInsetX, 4);
  assert.equal(rigEyeMatrix(view.face.eyes.closed.pupil[0], blink, USAGI_FORM.faceRig.front, true)[3], 1);
  const profile = resolveRigFace(bundled.views.profile.face, { eyeInsetX: 4 });
  assert.equal(rigEyeMatrix(bundled.views.profile.face.eyes.neutral.pupil[0], profile, USAGI_FORM.faceRig.profile, true)[4], 0);
});

test('native props and wardrobe anchors remain bone-mounted and within the rest stage', () => {
  for (const [name, view] of Object.entries(bundled.views)) {
    assert.equal(Object.keys(view.props).length, 54, name);
    assert.equal(view.props.cup.bone, 'hand_r');
    assert.equal(view.props['needle-l'].bone, 'hand_l');
    assert.equal(view.props['needle-r'].bone, 'hand_r');
    assert.equal(view.props.umbrella.layer, 'back');
    assert.equal(view.anchors['usagi.earwear'].bone, 'ear_r');
    assert.equal(view.anchors['usagi.footwear'].bone, 'leg_l');
    assert.equal(view.anchors['usagi.footwear-r'].bone, 'leg_r');
    assert.equal(view.anchors['usagi.footwear'].x, view.bones.leg_l.pivot[0]);
    for (const [id, prop] of Object.entries(view.props)) {
      for (const shape of prop.shapes) {
        const bounds = pathBounds(shape.d, shape.m);
        assert.ok(bounds.minX >= -15 && bounds.maxX <= 81 && bounds.minY >= -31 && bounds.maxY <= 82,
          `${name}/${id} stays inside the stage at rest: ${JSON.stringify(bounds)}`);
      }
    }
  }
});


test('the native hand mirror follows the right paw in every view instead of floating at the root', () => {
  const { default: native } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
  for (const view of Object.values(native.views)) assert.equal(view.props.mirror.bone, 'hand_r');
});

test('every mouth keeps the identity-bearing double-wave lip on top of its distinct lower mouth', () => {
  const signature = 'M-4 -1 Q-4 2 -1.5 1 Q0 0 0 -1 Q0 3 3 1 Q4 0 4 -1';
  for (const view of ['front', 'three-quarter', 'profile']) {
    for (const [name, entry] of Object.entries(bundled.views[view].face.mouth)) {
      const lip = entry.shapes.at(-1), creamAbove = entry.shapes.at(-2);
      assert.equal(lip.d, signature, `${view}/${name}: two-wave lip must survive mouth changes`);
      assert.equal(lip.fill, 'none');
      assert.equal(lip.stroke, '#351710');
      assert.equal(creamAbove.fill, '#fff5de', 'cream mask protects both lobes from the dark lower opening');
      assert.ok(creamAbove.d.startsWith(signature));
    }
  }
});

test('umbrella shaft goes exactly through its paw pivot for every view and every sampled phase', () => {
  const { sampleMotion } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
  const { computeBoneWorld, multiply, applyPoint, localMatrix } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
  for (const [name, view] of Object.entries(bundled.views)) {
    const umbrella = view.props.umbrella, shaft = umbrella.shapes[0];
    assert.equal(umbrella.bone, 'hand_r');
    assert.equal(umbrella.layer, 'back');
    assert.equal(shaft.d, 'M0 -48 V2 Q0 5 -3 5 Q-5 5 -5 2');
    const grip = view.anchors['usagi.umbrella-grip'];
    assert.deepEqual([grip.x, grip.y], view.bones.hand_r.pivot);
    assert.deepEqual(applyPoint(shaft.m, 0, 0), view.bones.hand_r.pivot);
    for (let step = 0; step <= 100; step += 1) {
      const sample = sampleMotion('umbrella', { view: name, progress: step / 100, prop: 'umbrella' });
      const world = computeBoneWorld(view.bones, sample.bones);
      const extra = sample.propPoses.umbrella;
      const propMatrix = extra ? multiply(world.hand_r, localMatrix(view.bones.hand_r.pivot, extra)) : world.hand_r;
      const shaftGrip = applyPoint(multiply(propMatrix, shaft.m), 0, 0);
      const pawGrip = applyPoint(world.hand_r, ...view.bones.hand_r.pivot);
      assert.ok(Math.hypot(shaftGrip[0] - pawGrip[0], shaftGrip[1] - pawGrip[1]) < 1e-9, `${name}/${step}: umbrella detached`);
    }
  }
});

test('moonwalk accents sparkle existing feet without introducing another pair of shoe silhouettes', () => {
  for (const [name, view] of Object.entries(bundled.views)) {
    assert.equal(view.props['sparkle-shoes'], undefined, `${name}: no root-level extra shoes`);
    for (const [id, bone] of [['shoe-glint-l', 'leg_l'], ['shoe-glint-r', 'leg_r']]) {
      const glint = view.props[id], [x] = view.bones[bone].pivot;
      assert.equal(glint.bone, bone);
      for (const shape of glint.shapes) {
        assert.equal(shape.fill, 'none', 'glints have no filled shoe/body material');
        assert.ok(shape.width <= 1);
        const bounds = pathBounds(shape.d, shape.m);
        assert.ok(bounds.minX >= x - 7 && bounds.maxX <= x + 7 && bounds.minY >= 58 && bounds.maxY <= 68);
      }
    }
  }
});
