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

test('legacy matrix analyser flags face cover, floating gaps and canvas exits', async () => {
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

test('dango raster hats bob in whole art pixels only, and dango paws are never cut', async () => {
  const { resolveAccessories, FORM_TRAITS } = await load();
  const dango = [{ id: 'hat', exclusiveGroup: 'headwear' }, { id: 'scarf', exclusiveGroup: 'neckwear' }];
  let bobbed = 0;
  for (let p = 0; p <= 1; p += .005) {
    const plan = resolveAccessories({ items: dango, formId: 'dango', action: { id: 'happy-hop', duration: 6000, prop: 'x' }, phase: p });
    const y = plan.get('hat').offsetY;
    assert.ok(Number.isInteger(y) && Math.abs(y) <= 1, `p=${p} y=${y}`);
    if (y) bobbed++;
    assert.equal(plan.get('scarf').cut, null);
  }
  assert.ok(bobbed > 0);
  assert.equal(FORM_TRAITS.dango.pawsAboveCloth, true);
});

test('floating auras carry a canvas headroom budget', async () => {
  const { resolveAccessories } = await load();
  const plan = resolveAccessories({ items: [{ id: 'halo', formId: 'usagi', exclusiveGroup: 'usagi.aura' }], formId: 'usagi' });
  assert.ok(plan.get('halo').headroom.px >= 2, 'stays clear of the 2px canvas edge band');
  assert.ok(plan.get('halo').headroom.top < 0);
});

test('fit analyser v2: real eye mask, hidden front-pass ink and z-order flips', async () => {
  const { analyseFit, zOrderFlips } = await import('../tools/accessory-matrix/analyse.mjs');
  const w = 120, h = 120;
  const img = () => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const put = (im, x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) im.data.set([...rgb, 255], (y * w + x) * 4); };
  const scene = ({ eyes = true, paw = true, cloth = false, clothOverPaw = false }) => {
    const im = img(); put(im, 20, 20, 100, 100, [250, 240, 220]);
    if (eyes) put(im, 40, 40, 46, 46, [20, 20, 20]);
    if (paw && !clothOverPaw) { if (cloth) put(im, 30, 70, 90, 90, [200, 120, 90]); put(im, 50, 72, 62, 84, [240, 150, 170]); }
    else { if (paw) put(im, 50, 72, 62, 84, [240, 150, 170]); if (cloth) put(im, 30, 70, 90, 90, [200, 120, 90]); }
    return im;
  };
  const frame = opts => ({ bare: scene({ ...opts, cloth: false }), worn: scene({ ...opts, cloth: true }),
    bareNoFront: scene({ ...opts, cloth: false, paw: false }), wornNoFront: scene({ ...opts, cloth: true, paw: false }),
    bareBlink: scene({ ...opts, eyes: false, cloth: false }) });
  const ok = analyseFit(frame({}));
  assert.deepEqual(ok.flags, []); assert.equal(ok.metrics.order, 'prop');
  const bad = analyseFit(frame({ clothOverPaw: true }));
  assert.ok(bad.flags.includes('covers-prop')); assert.equal(bad.metrics.order, 'item');
  // Eye cover: cloth drawn over the eye block.
  const f = frame({}); put(f.worn, 38, 38, 48, 48, [200, 120, 90]);
  assert.ok(analyseFit(f).flags.includes('covers-eyes'));
  assert.deepEqual(zOrderFlips(['prop', null, 'item', 'item', 'prop']), [[0, 2], [3, 4]]);
  assert.deepEqual(zOrderFlips(['prop', 'prop', null]), []);
});
