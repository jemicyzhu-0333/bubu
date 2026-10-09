'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileDangoVectorAppearance, emitDangoVectorAppearance } = require('../tools/dango-build/appearance-vector-build.mjs');
const { VECTOR_APPEARANCE, APPEARANCE_MATERIALS, APPEARANCE_BOUNDS } = require('../src/content/companion/dango-vector-appearance.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { BODY_ANCHORS, FACE_LAYOUTS } = require('../src/content/companion/dango-vector.mjs');
const { PALETTES } = require('../src/core/pet-art.mjs');
const { flattenPath } = require('../tools/dango-build/build.mjs');
const { pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
const { drawDangoAppearance, resolveDangoPortraitBounds, HEAD_LIFT } = require('../src/capabilities/companion/presentation/dango-appearance.mjs');
const { exactVectorPathBounds, exactVectorShapeBounds } = require('../tools/dango-build/vector-path-bounds.mjs');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/companion/dango/dango.appearance.vector.svg'), 'utf8');
const items = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango');
const views = ['front', 'three-quarter', 'profile', 'back'];

function context() {
  const calls = [], stack = [];
  return { calls, globalAlpha: 1, save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    translate(...m) { calls.push(['translate', ...m]); }, transform(...m) { calls.push(['matrix', ...m]); },
    fill(p) { calls.push(['fill', p.d, this.globalAlpha]); }, stroke(p) { calls.push(['stroke', p.d, this.lineWidth, this.globalAlpha]); },
    fillRect() { throw new Error('native wardrobe must not quantize paths into pixel rectangles'); },
    createLinearGradient(...coords) { const stops = []; calls.push(['gradient', coords, stops]); return { addColorStop(...stop) { stops.push(stop); } }; } };
}
function shapesFor(key, view, layer) { return VECTOR_APPEARANCE[key].views[view][layer].flatMap(part => part.shapes); }
function inContours(x, y, contours) {
  let result = false;
  for (const points of contours) for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
function onStroke(x, y, contours, radius) {
  for (const points of contours) for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= radius) return true;
  }
  return false;
}

test('native wardrobe compiles deterministically and retains all sixteen IDs with a two-eye profile alias', () => {
  const compiled = compileDangoVectorAppearance(source);
  assert.deepEqual(compiled.items, VECTOR_APPEARANCE);
  assert.deepEqual(compiled.materials, APPEARANCE_MATERIALS);
  assert.deepEqual(compiled.bounds, APPEARANCE_BOUNDS);
  assert.equal(emitDangoVectorAppearance(compiled), fs.readFileSync(path.join(root, 'src/content/companion/dango-vector-appearance.mjs'), 'utf8'));
  assert.deepEqual(Object.keys(compiled.items).sort(), items.map(item => item.renderKey).sort());
  for (const { views: itemViews } of Object.values(compiled.items)) assert.strictEqual(itemViews.profile, itemViews['three-quarter']);
  for (const item of items) for (const view of views) for (const layer of ['back', 'front']) {
    if (compiled.items[item.renderKey].views[view][layer].length) {
      assert.ok(item.parts.includes(layer), `${item.id}/${view}: native layer must be declared in the projection`);
    }
  }
  assert.equal(new Set(items.map(item => item.exclusiveGroup)).size, 7);
});

test('native authoring rejects unsafe bounds, wrong dimensions, missing views and unknown materials', () => {
  assert.throws(() => compileDangoVectorAppearance(source.replace('data-art-size="66"', 'data-art-size="33"')), /66-unit/);
  assert.throws(() => compileDangoVectorAppearance(source.replace('data-alias="three-quarter"', 'data-alias="front"')), /maximum/);
  assert.throws(() => compileDangoVectorAppearance(source.replace('data-view="back"', 'data-view="unknown"')), /three explicit/);
  assert.throws(() => compileDangoVectorAppearance(source.replace('data-item="sprout"', 'data-item="sprout" transform="translate(0 -200)"')), /bleed contract/);
  assert.throws(() => compileDangoVectorAppearance(source.replace(/fill="url\(#[^)]+\)"/, 'fill="url(#missing)"')), /unknown vector material/);
});

test('straw, knit and leather retain fractional seams and real gradient materials', () => {
  for (const key of ['sunhat', 'scarf', 'satchel', 'boots']) {
    const shapes = ['front', 'back'].flatMap(layer => shapesFor(key, 'front', layer));
    assert.ok(shapes.some(shape => shape.material && APPEARANCE_MATERIALS[shape.material]));
    assert.ok(shapes.filter(shape => shape.fill === 'none' && shape.width < 1).length >= 10, `${key}: authored material strokes`);
    assert.ok(shapes.some(shape => /\d\.\d/.test(shape.d)), `${key}: fractional curves survive the build`);
    assert.ok(shapes.every(shape => !('runs' in shape)), 'no historical logical-cell raster');
  }
});

test('foreground wardrobe leaves both eyes and the complete mouth guard clear in every visible view', () => {
  for (const view of ['front', 'three-quarter', 'profile']) {
    const face = FACE_LAYOUTS[view];
    const guards = face.eyes.map(eye => [eye.x - 5.3 * eye.scaleX, eye.y - 6, eye.x + 5.3 * eye.scaleX, eye.y + 6]);
    guards.push([face.mouth.x - 4.2, face.mouth.y - 2.2, face.mouth.x + 4.2, face.mouth.y + 5]);
    for (const item of items) for (const shape of shapesFor(item.renderKey, view, 'front')) {
      const b = pathBounds(shape.d), radius = shape.stroke !== 'none' ? shape.width / 2 : 0;
      for (const [left, top, right, bottom] of guards) {
        if (b.maxX + radius < left || b.minX - radius > right || b.maxY + radius < top || b.minY - radius > bottom) continue;
        const contours = flattenPath(shape.d);
        // Include the exact bottom/right edges even when an authored anchor is fractional.
        const rows = Math.ceil((bottom - top) / .25), columns = Math.ceil((right - left) / .25);
        for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
          const x = left + (right - left) * column / columns, y = top + (bottom - top) * row / rows;
          assert.ok(!(shape.fill !== 'none' && inContours(x, y, contours)) && !onStroke(x, y, contours, radius), `${item.id}/${view} covers face at${x},${y}`);
        }
      }
    }
  }
});

test('each native boot receives exactly its own live foot matrix and covers its new authored pivot', () => {
  const saved = global.Path2D; global.Path2D = class { constructor(d) { this.d = d; } };
  try {
    const item = items.find(item => item.renderKey === 'boots');
    for (const view of views) {
      const parts = VECTOR_APPEARANCE.boots.views[view].front;
      assert.deepEqual(parts.map(part => part.attachment), ['foot-left', 'foot-right']);
      for (const part of parts) {
        const { x, y } = BODY_ANCHORS[view][part.attachment];
        assert.ok(part.shapes.some(shape => inContours(x, y, flattenPath(shape.d))), `${view}/${part.attachment} must cover ankle`);
      }
      const matrices = { 'foot-left': [1, .1, -.1, 1, 2, -1], 'foot-right': [1, -.1, .1, 1, -2, 1] };
      const ctx = context(); drawDangoAppearance(ctx, { item: { ...item, effect: null }, layer: 'front', view, palette: PALETTES.pink, artwork: { footwearTransforms: matrices } });
      assert.deepEqual(ctx.calls.filter(call => call[0] === 'matrix').map(call => call.slice(1)), Object.values(matrices));
    }
  } finally { global.Path2D = saved; }
});

test('all ten palettes draw native accessories and calm glints stay held', () => {
  const saved = global.Path2D; global.Path2D = class { constructor(d) { this.d = d; } };
  try {
    for (const palette of Object.values(PALETTES)) for (const item of items) for (const view of views) {
      const ctx = context(); let painted = false;
      for (const layer of ['back', 'front']) painted = drawDangoAppearance(ctx, { item, layer, view, palette, appearance: { items }, calmVisual: true }) || painted;
      assert.ok(painted && ctx.calls.some(call => ['fill', 'stroke'].includes(call[0])));
    }
    const item = items.find(item => item.renderKey === 'halo'), draw = elapsedMs => {
      const ctx = context(); drawDangoAppearance(ctx, { item, palette: PALETTES.pink, appearance: { items }, calmVisual: true, elapsedMs }); return ctx.calls;
    };
    assert.deepEqual(draw(0), draw(4300));
    const halo = shapesFor('halo', 'front', 'front').map(shape => { const b = pathBounds(shape.d); return [b.minY - shape.width / 2 - HEAD_LIFT, b.maxY + shape.width / 2 - HEAD_LIFT]; });
    assert.ok(Math.min(...halo.map(span => span[0])) >= -24);
    const antennaTop = Math.min(...shapesFor('robot-antenna', 'front', 'back').map(shape => pathBounds(shape.d).minY - shape.width / 2));
    assert.ok(antennaTop - Math.max(...halo.map(span => span[1])) >= 2, 'halo clears the authored antenna tip by two art units');
  } finally { global.Path2D = saved; }
});

test('native portrait geometry uses actual curve extrema and transformed stroke bounds', () => {
  const close = (actual, expected) => {
    for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}:${actual[key]} != ${expected[key]}`);
  };
  close(exactVectorPathBounds('M0 0Q10 20 20 0'), { minX: 0, minY: 0, maxX: 20, maxY: 10 });
  close(exactVectorPathBounds('M0 0C0 30 30 30 30 0'), { minX: 0, minY: 0, maxX: 30, maxY: 22.5 });
  close(exactVectorPathBounds('M0 0Q10 20 20 0', [0, 1, -1, 0, 0, 0]), { minX: -10, minY: 0, maxX: 0, maxY: 20 });
  const d = 'M-4 0A4 2 0 1 0 4 0A4 2 0 1 0 -4 0Z';
  close(exactVectorPathBounds(d), { minX: -4, minY: -2, maxX: 4, maxY: 2 });
  close(exactVectorShapeBounds({ d, m: [2, 0, 0, 3, 5, 7], fill: '#fff', stroke: '#111', width: 1, cap: 'round', join: 'round' }),
    { minX: -4, minY: -.5, maxX: 14, maxY: 14.5 });
  const c = Math.SQRT1_2;
  close(exactVectorPathBounds(d, [c, c, -c, c, 0, 0]), { minX: -Math.sqrt(10), minY: -Math.sqrt(10), maxX: Math.sqrt(10), maxY: Math.sqrt(10) });
});

test('portrait fitting uses only selected native items, including view anchors and conditional halo lift', () => {
  const base = { x: -2, y: -2, width: 70, height: 70 };
  assert.strictEqual(resolveDangoPortraitBounds({ items: [] }, base), base, 'bare body keeps its established size');
  const halo = items.find(item => item.renderKey === 'halo'), hat = items.find(item => item.renderKey === 'sunhat');
  const alone = resolveDangoPortraitBounds({ view: 'front', items: [halo] });
  const wearing = resolveDangoPortraitBounds({ view: 'front', items: [halo, hat] });
  assert.ok(wearing.y < alone.y - 10, 'hat presence alone activates halo lift');
  assert.equal(wearing.y, APPEARANCE_BOUNDS.halo.front.y - HEAD_LIFT - 1);
  const shifted = { ...halo, anchor: { profile: { x: 5, y: -3 } } };
  const turned = resolveDangoPortraitBounds({ view: 'profile', items: [shifted] });
  assert.equal(turned.y, APPEARANCE_BOUNDS.halo.profile.y - 3 - 1);
  const cape = items.find(item => item.renderKey === 'cape');
  const capeFit = resolveDangoPortraitBounds({ view: 'front', items: [cape] });
  assert.ok(capeFit.width < 75, 'historical eighteen-unit cape bleed does not shrink the native portrait');
  for (const view of views) for (const item of items) {
    const fitted = resolveDangoPortraitBounds({ view, items: [item] }), bounds = APPEARANCE_BOUNDS[item.renderKey][view];
    assert.ok(fitted.x <= bounds.x - 1 && fitted.y <= bounds.y - 1);
    assert.ok(fitted.x + fitted.width >= bounds.x + bounds.width + 1);
    assert.ok(fitted.y + fitted.height >= bounds.y + bounds.height + 1);
  }
});
