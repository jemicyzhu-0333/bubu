'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileDangoVector, emitDangoVector, readMaterial, compileVectorShape } = require('../tools/dango-build/vector-build.mjs');
const { parseSvg } = require('../tools/rig-build/svg-parse.mjs');
const { rasterizePaths } = require('../tools/dango-build/build.mjs');
const art = require('../src/content/companion/dango-vector.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { paintVectorShapes } = require('../src/core/pet-vector-paint.mjs');
const source = fs.readFileSync(path.join(__dirname, '../assets/companion/dango/dango.vector.svg'), 'utf8');

test('editable vector body compiles deterministically without reducing Bezier curves to a pixel grid', () => {
  const result = compileDangoVector(source);
  assert.deepEqual(result.views, art.BODY_VIEWS);
  assert.deepEqual(result.anchors, art.BODY_ANCHORS);
  assert.deepEqual(result.layouts, art.FACE_LAYOUTS);
  assert.deepEqual(result.eyes, art.EYE_SHAPES);
  assert.deepEqual(result.mouths, art.MOUTH_SHAPES);
  assert.deepEqual(result.materials, art.MATERIALS);
  assert.equal(emitDangoVector(result), fs.readFileSync(path.join(__dirname, '../src/content/companion/dango-vector.mjs'), 'utf8'));
  assert.deepEqual(result, compileDangoVector(source));
  assert.match(result.views.front.torso[0].d, /[CQ]/);
  assert.match(result.views.front.torso[0].d, /\d\.\d/);
});

test('maximum facing angle keeps two eyes and legacy profile aliases the exact three-quarter artwork', () => {
  for (const key of ['BODY_VIEWS', 'BODY_ANCHORS', 'FACE_LAYOUTS']) assert.deepEqual(art[key].profile, art[key]['three-quarter']);
  for (const view of ['front', 'three-quarter', 'profile']) {
    assert.equal(art.FACE_LAYOUTS[view].eyes.length, 2);
    assert.ok(art.FACE_LAYOUTS[view].mouth);
  }
  assert.equal(art.FACE_LAYOUTS.back.eyes.length, 0);
  assert.equal(art.FACE_LAYOUTS.back.mouth, null);
});

test('both separate feet and all facial anchors lie inside their authored filled anatomy', () => {
  for (const [view, body] of Object.entries(art.BODY_VIEWS)) {
    assert.deepEqual(Object.keys(body.feet), ['foot-left', 'foot-right']);
    const silhouette = rasterizePaths([{ d: body.torso[0].d, fill: 'body' }], { width: 66, height: 66 });
    for (const eye of art.FACE_LAYOUTS[view].eyes) {
      for (const [dx, dy] of [[0, 0], [-4 * eye.scaleX, 0], [4 * eye.scaleX, 0], [0, -5], [0, 5]]) {
        assert.equal(silhouette[Math.floor(eye.y + dy)][Math.floor(eye.x + dx)], 'body', `${view}: eye remains inside the rounded body`);
      }
    }
    const mouth = art.FACE_LAYOUTS[view].mouth;
    if (mouth) assert.equal(silhouette[Math.floor(mouth.y + 4)][Math.floor(mouth.x)], 'body');
    for (const side of ['foot-left', 'foot-right']) {
      const shape = body.feet[side][0], anchor = art.BODY_ANCHORS[view][side];
      const pixels = rasterizePaths([{ d: shape.d, fill: 'foot' }], { width: 66, height: 66 });
      assert.equal(pixels[Math.floor(anchor.y)][Math.floor(anchor.x)], 'foot', `${view}: ${side} has a real local attachment`);
    }
  }
});

test('sixteen rounded eye states and nine mouth states have independent actual paths', () => {
  assert.equal(Object.keys(art.EYE_SHAPES).length, 16);
  assert.equal(Object.keys(art.MOUTH_SHAPES).length, 9);
  for (const states of [art.EYE_SHAPES, art.MOUTH_SHAPES]) {
    assert.equal(new Set(Object.values(states).map(shapes => shapes.map(shape => shape.d).join('|'))).size, Object.keys(states).length);
    assert.ok(Object.values(states).every(shapes => shapes.length && shapes.every(shape => shape.d.startsWith('M'))));
  }
  assert.ok(art.EYE_SHAPES.neutral.some(shape => shape.fillToken === 'eye'));
  assert.ok(art.EYE_SHAPES.neutral.some(shape => shape.fillToken === 'white'));
  assert.ok(art.MOUTH_SHAPES.neutral.every(shape => shape.fill === 'none' && shape.cap === 'round'));
});

test('all ten palettes resolve native material gradients and authored grain through the shared painter', () => {
  assert.equal(Object.keys(PALETTES).length, 10);
  for (const palette of Object.values(PALETTES)) {
    const colors = [], gradients = [];
    const context = {
      globalAlpha: 1, save() {}, restore() {}, transform() {}, fill() {}, stroke() {},
      set fillStyle(value) { if (typeof value === 'string') colors.push(value); },
      set strokeStyle(value) { colors.push(value); },
      createRadialGradient(...coords) { gradients.push(coords); return { addColorStop(_offset, color) { colors.push(color); } }; },
      createLinearGradient(...coords) { gradients.push(coords); return { addColorStop(_offset, color) { colors.push(color); } }; }
    };
    const body = art.BODY_VIEWS['three-quarter'];
    const shapes = [...body.feet['foot-left'], ...body.feet['foot-right'], ...body.torso, ...art.EYE_SHAPES.neutral];
    assert.equal(paintVectorShapes(context, shapes, palette, { materials: art.MATERIALS, paths: { get: d => ({ d }) } }), shapes.length);
    assert.ok(gradients.length >= 3);
    assert.ok(colors.includes(palette[2]) && colors.includes(palette[4]));
    assert.ok(colors.every(color => /^#[\da-f]{6}$/i.test(color) || /^rgba\(\d+,\d+,\d+,(?:0|1|0\.\d+)\)$/.test(color)));
  }
});

test('shared shape/material reader preserves literal fabric colors and rejects unsupported paint silently falling back', () => {
  const node = parseSvg('<svg><linearGradient gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="20"><stop offset="0" stop-color="#f0c48b"/><stop offset="1" stop-color="#9b623a"/></linearGradient></svg>').children[0];
  assert.deepEqual(readMaterial(node).stops, [{ offset: 0, color: '#f0c48b' }, { offset: 1, color: '#9b623a' }]);
  node.children[1].attributes['stop-opacity'] = '0';
  assert.deepEqual(readMaterial(node).stops[1], { offset: 1, color: '#9b623a', opacity: 0 });
  node.children[1].attributes['stop-opacity'] = '1.5';
  assert.throws(() => readMaterial(node), /invalid material stop/);
  const shape = parseSvg('<svg><path d="M0 0 Q1.25 2 3 4" data-fill-token="eye"/></svg>').children[0];
  assert.equal(compileVectorShape(shape, [1, 0, 0, 1, 0, 0], { fill: '#191827' }).fillToken, 'eye');
  assert.throws(() => compileVectorShape(shape, [1, 0, 0, 1, 0, 0], { fill: 'url(#missing)' }), /unknown vector material/);
  assert.throws(() => compileDangoVector(source.replace('data-body-size="66"', 'data-body-size="33"')), /66-unit/);
  assert.throws(() => compileDangoVector(source.replace('data-eye="curious"', 'data-eye="neutral"')), /duplicate eye/);
  assert.throws(() => compileDangoVector(source.replace('data-token="body"', 'data-token="unknown"')), /palette token/);
  assert.throws(() => compileDangoVector(source.replace('<defs>', '<filter/><defs>')), /unsupported vector element/);
});
