import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDangoLimbManifest, createDangoLimbSource, paintDangoLimb } from '../src/capabilities/companion/presentation/dango-limb-assets.mjs';
import { attachDangoLimbs } from '../src/capabilities/companion/presentation/dango-limbs.mjs';
import { paintRasterPaws } from '../src/capabilities/companion/presentation/dango-raster-paws.mjs';

const fr = (angle, src, extra = {}) => ({ angle, src, size: [12, 12], root: [2.5, 6.5], ...extra });
const arm = s => Array.from({ length: 16 }, (_, i) => fr(i * 22.5, `arm/arm-${s}-l-a${String(i * 225 / 10).padStart(3, '0')}.png`, { tip: [6.5, 6.5] }));
const VALID = {
  schema: 'dango-limbs/1', version: 1, grid: { unitPx: 1, productionScale: 8, outline: 2 },
  bones: { arm: { upper: 4, fore: 4 } },
  sockets: { 'shoulder-l': { front: { src: 'socket/s.png', mask: 'socket/s-mask.png', size: [8, 8], root: [4.5, 4.5], bodyAnchor: 'shoulder-left' } } },
  segments: { 'arm-upper-l': { frames: arm('upper') }, 'arm-fore-l': { frames: arm('fore') } },
  paws: { grip: { views: { front: Array.from({ length: 8 }, (_, i) => fr(i * 45, `paw/g-${i}.png`, { size: [10, 10], grip: [6.5, 6.5] })) } } }
};
const img = src => ({ src, width: 12, height: 12 });

test('validator accepts the brief schema and reports every concrete error', () => {
  assert.deepEqual(validateDangoLimbManifest(VALID).errors, []);
  const bad = structuredClone(VALID); bad.schema = 'x'; bad.segments['arm-upper-l'].frames[0].root = [99, 0];
  bad.segments['arm-fore-l'].frames[1].angle = 0; delete bad.sockets['shoulder-l'].front.mask; bad.paws.grip.views.front[0].src = '../x.png';
  const e = validateDangoLimbManifest(bad).errors.join('\n');
  for (const m of [/schema/, /outside the sprite/, /duplicate angle/, /mask required/, /relative \.png/]) assert.match(e, m);
});

const base = 'file:///x/raster/';
test('lifecycle: absent -> legacy', async () => {
  const s = createDangoLimbSource({ baseUrl: base, loadJson: async () => null, loadImage: img });
  assert.equal(await s.start(), 'absent'); assert.equal(s.manifest(), null);
});
test('lifecycle: loader throws -> absent', async () => {
  const s = createDangoLimbSource({ baseUrl: base, loadJson: async () => { throw Error('404'); }, loadImage: img });
  assert.equal(await s.start(), 'absent');
});
test('lifecycle: invalid -> no manifest, errors exposed', async () => {
  const s = createDangoLimbSource({ baseUrl: base, loadJson: async () => ({ schema: 'nope' }), loadImage: img });
  assert.equal(await s.start(), 'invalid'); assert.ok(s.errors().length > 3);
});
test('lifecycle: one image fails -> failed, nothing half-ready', async () => {
  const s = createDangoLimbSource({ baseUrl: base, loadJson: async () => VALID, loadImage: async u => { if (u.endsWith('g-3.png')) throw Error('decode'); return img(u); } });
  assert.equal(await s.start(), 'failed'); assert.equal(s.manifest(), null); assert.equal(s.image('socket/s.png'), null);
});
test('lifecycle: ready resolves urls relative to limbs.json and is idempotent', async () => {
  const seen = []; const s = createDangoLimbSource({ baseUrl: base, loadJson: async u => (seen.push(u), VALID), loadImage: async u => (seen.push(u), img(u)) });
  assert.equal(await s.start(), 'ready'); await s.start();
  assert.equal(seen[0], 'file:///x/raster/limbs/limbs.json'); assert.ok(seen.includes('file:///x/raster/limbs/socket/s.png'));
  assert.equal(seen.filter(u => u.endsWith('limbs.json')).length, 1);
});

function recorder() { const calls = []; return { calls, save() {}, restore() {}, translate() {}, scale() {}, transform() {}, set globalCompositeOperation(v) { calls.push(['op', v]); },
  drawImage(i, x, y, w, h) { calls.push(['draw', i.src, x, y, w, h]); } }; }
async function readyHand(side = 'left') {
  const s = createDangoLimbSource({ baseUrl: base, loadJson: async () => VALID, loadImage: img }); await s.start();
  const contact = { hands: [{ side, gripPoint: [30.3, 44.7], pawSprite: 'small-fin', pawMatrix: [1, 0, 0, 1, 0, 0] }] };
  attachDangoLimbs(contact, { 'shoulder-left': { x: 7.4, y: 39.7 }, 'shoulder-right': { x: 62, y: 39.7 } }, { view: 'front', limbs: s.manifest() });
  return { s, hand: contact.hands[0], contact };
}
test('painter: frames chosen by IK angle, integer pixels, socket mask erases first', async () => {
  const { s, hand } = await readyHand(); const ctx = recorder();
  assert.equal(paintDangoLimb(ctx, hand, s, { view: 'front' }), true);
  assert.deepEqual(ctx.calls[0], ['op', 'destination-out']);
  for (const c of ctx.calls.filter(c => c[0] === 'draw')) assert.ok(Number.isInteger(c[2]) && Number.isInteger(c[3]), c.join());
  assert.equal(ctx.calls.filter(c => c[0] === 'draw').length, 5);
});
test('painter: missing view or image -> false (legacy sprite draws)', async () => {
  const { s, hand } = await readyHand();
  assert.equal(paintDangoLimb(recorder(), hand, s, { view: 'back' }), false);
  assert.equal(paintDangoLimb(recorder(), { ...hand, limb: null }, s), false);
});
test('paintRasterPaws: ready limbs replace the paw sprite; not ready keeps legacy', async () => {
  const { s, contact } = await readyHand('right');
  const painter = { paint: () => (legacy++, true) }; let legacy = 0;
  const art = { layeredReady: true, actionReady: true, contact, view: 'front' };
  paintRasterPaws(recorder(), { ...art, limbSource: s }, {}, { manifest: { tools: { 'small-fin': {} } }, painter });
  assert.equal(legacy, 0);
  paintRasterPaws(recorder(), { ...art, limbSource: null }, {}, { manifest: { tools: { 'small-fin': {} } }, painter });
  assert.equal(legacy, 1);
});
