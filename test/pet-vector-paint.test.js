'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paintVectorShapes, createVectorPathCache, vectorColor, mixVectorColor } = require('../src/core/pet-vector-paint.mjs');
function context() {
  const calls = [];
  return { calls, globalAlpha: 1, save() {}, restore() {}, transform(...m) { calls.push(['matrix', m]); },
    fill(path, rule) { calls.push(['fill', path.d, rule, this.fillStyle]); }, stroke(path) { calls.push(['stroke', path.d, this.strokeStyle, this.lineWidth]); },
    createRadialGradient(...coords) { const stops = []; const gradient = { coords, stops, addColorStop(...stop) { stops.push(stop); } }; calls.push(['gradient', gradient]); return gradient; } };
}
test('native paths retain fractional curves, palette-relative shading and authored texture opacity', () => {
  const ctx = context(), paths = createVectorPathCache({ createPath: d => ({ d }) });
  const d = 'M.25 .75 C1.25 .1 3.4 2.8 4.5 1.2Z';
  const shape = { d, fillToken: 'body', strokeToken: 'ink', width: .65, opacity: .7, material: 'soft' };
  const palette = { 1: '#151525', 2: '#f7768e', 3: '#dc5069' };
  const materials = { soft: { type: 'radial', coords: [2, 1, 0, 2, 2, 4], stops: [{ offset: 0, color: 'highlight' }, { offset: 1, color: 'shadow' }] } };
  assert.equal(paintVectorShapes(ctx, [shape], palette, { paths, materials }), 1);
  assert.equal(ctx.globalAlpha, .7);
  assert.equal(ctx.calls.find(call => call[0] === 'fill')[1], d, 'Bezier coordinates are not quantized to cells');
  assert.deepEqual(ctx.calls.find(call => call[0] === 'stroke').slice(2), ['#151525', .65]);
  assert.equal(ctx.calls.find(call => call[0] === 'gradient')[1].stops[1][1], '#dc5069');
  assert.notEqual(vectorColor('highlight', palette), palette[2]);
});
test('path cache is bounded, pose-independent and can be injected without a browser', () => {
  let count = 0; const paths = createVectorPathCache({ limit: 2, createPath: d => { count++; return { d }; } });
  const first = paths.get('M0 0Z'); assert.strictEqual(paths.get('M0 0Z'), first); assert.equal(count, 1);
  paths.get('M1 1Z'); paths.get('M2 2Z'); assert.equal(paths.size, 2); paths.get('M0 0Z'); assert.equal(count, 4);
});
test('materials reject unsupported or unknown definitions instead of silently using the wrong design', () => {
  const ctx = context(), paths = createVectorPathCache({ createPath: d => ({ d }) });
  const shape = { d: 'M0 0Z', fill: '#fff', material: 'missing' };
  assert.throws(() => paintVectorShapes(ctx, [shape], {}, { paths }), /unknown vector material/);
  assert.throws(() => paintVectorShapes(ctx, [shape], {}, { paths, materials: { missing: { type: 'image' } } }), /invalid vector material/);
  assert.equal(mixVectorColor('#000', '#fff', .5), '#808080');
  assert.equal(vectorColor({ from: 'body', to: '#fff', amount: 1 }, { 2: '#f7768e' }), '#ffffff');
});
