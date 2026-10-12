'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/capabilities/companion/presentation/motion-core/index.mjs');
const items = [
  { id: 'hat', formId: 'usagi', exclusiveGroup: 'usagi.headwear', parts: ['front'] },
  { id: 'collar', formId: 'usagi', exclusiveGroup: 'usagi.neckwear', parts: ['front'] },
  { id: 'clip', formId: 'usagi', exclusiveGroup: 'usagi.earwear', parts: ['front'] },
  { id: 'dango-hat', exclusiveGroup: 'headwear', parts: ['back'] }
];
const authored = item => item.parts;

test('resolver is deterministic and only plans the drawn form', async () => {
  const { resolveAccessories } = await load();
  const args = { items, formId: 'usagi', view: 'front', action: { id: 'happy-hop', duration: 3000 }, phase: .12 };
  const a = resolveAccessories(args), b = resolveAccessories(args);
  assert.deepEqual(a.list, b.list);
  assert.deepEqual(a.list.map(e => e.id), ['hat', 'collar', 'clip']);
});

test('per-view manifest overrides hide or re-layer a slot', async () => {
  const { resolveAccessories, ACCESSORY_MANIFEST } = await load();
  const manifest = { ...ACCESSORY_MANIFEST, 'usagi.neckwear': { ...ACCESSORY_MANIFEST['usagi.neckwear'], layers: { back: 'hide' } },
    'usagi.earwear': { ...ACCESSORY_MANIFEST['usagi.earwear'], layers: { back: 'back' } } };
  assert.equal(resolveAccessories({ items, formId: 'usagi', view: 'back' }).get('collar').visible, true);
  const plan = resolveAccessories({ manifest, items, formId: 'usagi', view: 'back' });
  assert.deepEqual(plan.itemsFor('back', authored).map(i => i.id), ['clip']);
  assert.equal(plan.get('collar').visible, false);
  assert.equal(plan.get('collar').reason, 'view:back');
  assert.deepEqual(plan.itemsFor('front', authored).map(i => i.id), ['hat']);
});

test('an action that wears a head prop stows headwear; ear clips stack under hats', async () => {
  const { resolveAccessories } = await load();
  const plan = resolveAccessories({ items, formId: 'usagi', view: 'front', action: { id: 'workout', prop: 'headband' }, phase: .5 });
  assert.equal(plan.get('hat').visible, false);
  assert.equal(plan.get('hat').reason, 'prop-headband');
  assert.equal(plan.get('collar').cut, null, 'workout declares holds:false');
  assert.deepEqual(plan.get('clip').stackedUnder, ['usagi.headwear']);
});

test('held props cut torso cloth around the paws', async () => {
  const { resolveAccessories } = await load();
  const plan = resolveAccessories({ items, formId: 'usagi', view: 'front', action: { id: 'sing', prop: 'mic' }, phase: .4 });
  assert.equal(plan.get('collar').cut, 'hands');
  assert.equal(plan.get('hat').cut, null);
});

test('headwear follow is bounded, zero at rest and off under reduced motion', async () => {
  const { resolveAccessories, ACCESSORY_MANIFEST } = await load();
  const max = ACCESSORY_MANIFEST['usagi.headwear'].follow.max;
  let moved = 0;
  for (let p = 0; p <= 1; p += .01) {
    const action = { id: 'happy-hop', duration: 3000 };
    const y = resolveAccessories({ items, formId: 'usagi', action, phase: p }).get('hat').offsetY;
    assert.ok(Math.abs(y) <= max + 1e-9);
    if (y) moved++;
    assert.equal(resolveAccessories({ items, formId: 'usagi', action, phase: p, reduced: true }).get('hat').offsetY, 0);
  }
  assert.ok(moved > 0, 'hop should move the hat');
  assert.equal(resolveAccessories({ items, formId: 'usagi', action: null }).get('hat').offsetY, 0);
});

test('every equipped slot in the catalog has a manifest entry', async () => {
  const { ACCESSORY_MANIFEST } = await load();
  const { PET_APPEARANCE_ITEMS } = await import('../src/content/appearance.mjs');
  for (const item of PET_APPEARANCE_ITEMS) assert.ok(ACCESSORY_MANIFEST[item.exclusiveGroup], item.id);
});

test('matrix analyser flags face cover, floating gaps and canvas exits', async () => {
  const { analyseMask } = await import('../tools/accessory-matrix/analyse.mjs');
  const w = 438, h = 438, n = w * h;
  const blank = () => ({ width: w, height: h, data: new Uint8ClampedArray(n * 4) });
  const bare = blank(), worn = blank();
  const put = (img, x, y, rgb) => { const j = (y * w + x) * 4; img.data.set([...rgb, 255], j); };
  for (let y = 100; y < 360; y++) for (let x = 100; x < 340; x++) { put(bare, x, y, [255, 240, 220]); put(worn, x, y, [255, 240, 220]); }
  // Eyes: dark ink inside the face band.
  for (let y = 200; y < 215; y++) for (let x = 180; x < 195; x++) { put(bare, x, y, [30, 20, 20]); put(worn, x, y, [30, 20, 20]); }
  const clean = analyseMask(bare, worn);
  assert.deepEqual(clean.flags, []);
  const covered = blank(); covered.data.set(worn.data);
  for (let y = 198; y < 217; y++) for (let x = 178; x < 197; x++) put(covered, x, y, [120, 60, 200]);
  assert.ok(analyseMask(bare, covered).flags.includes('covers-face-or-prop-ink'));
  const floating = blank(); floating.data.set(worn.data);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) put(floating, x, y, [120, 60, 200]);
  assert.ok(analyseMask(bare, floating).flags.includes('detached'));
  const edge = blank(); edge.data.set(worn.data);
  for (let y = 0; y < 30; y++) for (let x = 200; x < 230; x++) put(edge, x, y, [120, 60, 200]);
  for (let y = 30; y < 100; y++) for (let x = 210; x < 220; x++) put(edge, x, y, [120, 60, 200]);
  assert.ok(analyseMask(bare, edge).flags.includes('out-of-canvas'));
});
