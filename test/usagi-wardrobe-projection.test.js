'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FOOTWEAR, APERTURES, ANKLES, BERET_CONTACTS, HEAD_CONTACTS, projectFootwear,
  headwearTransform, clipNearShell, paintFootwear } = require('../src/capabilities/companion/presentation/usagi-wardrobe-projection.mjs');
const { applyPoint } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { MOTION_NAMES } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { default: rig } = require('../assets/companion/usagi/rig/usagi.rig.mjs');
const { USAGI_WARDROBE } = require('../assets/companion/usagi/wardrobe/usagi.wardrobe.mjs');
const views = ['front', 'three-quarter', 'profile', 'back'];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

test('all original shoe sources retain their leg identity, canonical ankle and exact recorded dimensions', () => {
  for (const key of Object.keys(FOOTWEAR)) for (const view of views) {
    for (const sprite of USAGI_WARDROBE.appearance[key].views[view].front) {
      const before = JSON.stringify(sprite), projected = projectFootwear(sprite, key, view, { rig });
      const far = sprite.bone === 'leg_l' && ['profile', 'three-quarter'].includes(view);
      const depth = far ? view === 'profile' ? .85 : .89 : 1;
      assert.equal(projected.src, sprite.src); assert.equal(projected.sha256, sprite.sha256);
      assert.equal(projected.bone, sprite.bone); assert.equal(projected.layer, 'back');
      assert.equal(projected.wear.far, far);
      close(projected.rect[2], FOOTWEAR[key][view][0] * depth);
      close(projected.rect[3], FOOTWEAR[key][view][1] * depth);
      close(projected.wear.ankle, ANKLES[view][sprite.bone === 'leg_r' ? 1 : 0]);
      close(projected.rect[0] + projected.rect[2] * APERTURES[key][view][0], projected.wear.ankle);
      close(projected.rect[1] + projected.rect[3], 68.1 - (far ? 1.15 : 0));
      assert.equal(JSON.stringify(sprite), before, 'original descriptor is not mutated');
    }
  }
});

test('a rig-supplied ankle takes precedence over fallback coordinates', () => {
  const sprite = USAGI_WARDROBE.appearance['usagi-rain-boots'].views.profile.front[1];
  const projected = projectFootwear(sprite, 'usagi-rain-boots', 'profile', { anchors: { 'usagi.footwear-r': { x: 46.25 } } });
  close(projected.wear.ankle, 46.25);
});

test('front and back retain paired scale while oblique far shoes become smaller and upstage', () => {
  for (const key of Object.keys(FOOTWEAR)) for (const view of views) {
    const [left, right] = USAGI_WARDROBE.appearance[key].views[view].front.map(s => projectFootwear(s, key, view));
    if (['front', 'back'].includes(view)) {
      close(left.rect[2], right.rect[2]); close(left.wear.sole, right.wear.sole);
    } else {
      assert.ok(left.rect[2] < right.rect[2]); assert.ok(left.wear.sole < right.wear.sole);
    }
  }
});

test('beret contact pairs map exactly onto the recorded skull tangent', () => {
  for (const key of Object.keys(BERET_CONTACTS)) for (const view of ['three-quarter', 'profile']) {
    const matrix = headwearTransform(key, view);
    BERET_CONTACTS[key][view].forEach((point, index) => {
      const result = applyPoint(matrix, ...point);
      result.forEach((value, axis) => close(value, HEAD_CONTACTS[view][index][axis]));
    });
  }
  for (const key of Object.keys(BERET_CONTACTS)) for (const view of ['front', 'back'])
    assert.deepEqual(headwearTransform(key, view), [1, 0, 0, 1, 0, 0]);
});

test('both shoe shells paint behind the torso but the oblique far shell never returns over it', () => {
  const ctx = { save() {}, restore() {}, transform() {}, beginPath() {}, moveTo() {}, lineTo() {},
    ellipse() {}, closePath() {}, clip() {}, fill() {} };
  for (const key of Object.keys(FOOTWEAR)) for (const view of views) {
    const sprites = USAGI_WARDROBE.appearance[key].views[view].front.map(s => projectFootwear(s, key, view));
    for (const layer of ['back', 'front']) {
      const bones = [], painter = { paint(_ctx, sprite) { bones.push(sprite.bone); return true; } };
      for (const sprite of sprites) paintFootwear(ctx, { sprite, layer, painter });
      assert.deepEqual(bones, layer === 'front' && ['three-quarter', 'profile'].includes(view) ? ['leg_r'] : ['leg_l', 'leg_r']);
    }
  }
});

test('projection and painting preserve independent leg matrices across all original motions', () => {
  const artist = createRigArtist({ fallback: {} });
  for (const motion of MOTION_NAMES) for (const view of views) for (const progress of [0, .25, .5, .75]) {
    const artwork = artist.resolve(rig, { view, motion, progress });
    const before = JSON.stringify(artwork.pose.world);
    const applied = [];
    const ctx = { save() {}, restore() {}, transform(...m) { applied.push(m); }, beginPath() {}, ellipse() {}, fill() {} };
    const original = USAGI_WARDROBE.appearance['usagi-rain-boots'].views[view].front;
    for (const source of original) {
      const sprite = projectFootwear(source, 'usagi-rain-boots', view, artwork);
      paintFootwear(ctx, { sprite, layer: 'back', matrix: artwork.pose.world[sprite.bone], painter: { paint: () => true } });
    }
    assert.deepEqual(applied, [artwork.pose.world.leg_l, artwork.pose.world.leg_r]);
    assert.equal(JSON.stringify(artwork.pose.world), before);
  }
});

test('real Canvas U clip excludes the whole opening including its upper half', () => {
  const backend = require(process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas');
  const surface = backend.createCanvas(160, 160), ctx = surface.getContext('2d');
  ctx.scale(4, 4);
  const sprite = { rect: [10, 10, 20, 20], wear: { aperture: [20, 15, 6, 3] } };
  clipNearShell(ctx, sprite);
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 40);
  const alpha = (x, y) => ctx.getImageData(x * 4, y * 4, 1, 1).data[3];
  assert.equal(alpha(20, 13), 0, 'upper half must not reappear through XOR');
  assert.equal(alpha(20, 16), 0, 'ankle opening stays exposed');
  assert.equal(alpha(20, 22), 255, 'toe shell is retained');
  assert.equal(alpha(11, 16), 255, 'side rim is retained');
});
