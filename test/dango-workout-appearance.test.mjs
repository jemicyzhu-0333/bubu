import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(process.env.BUBU_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
const { createRasterWardrobe } = await imp('src/capabilities/companion/presentation/dango-raster-appearance.mjs');
const b = createRequire(path.join(root, 'package.json'))('@napi-rs/canvas');
const ID = 'workout-front-support-v4';

// This narrow painter regression complements, never replaces, final-stage
// heavy-outfit/shoe screenshots. Run only after the shared support predicate patch.
test('new planted-support semantic keeps all existing boot layers in the same back pass as legacy workout', () => {
  const item = { id: 'milestone.boots', formId: 'dango', renderKey: 'boots', exclusiveGroup: 'footwear' };
  const outfit = { items: [item] }, records = [];
  const wardrobe = createRasterWardrobe({ manifest: DANGO_RASTER, source: { state: () => 'ready' },
    painter: { paint(ctx, sprite, palette, matrix) { records.push({ src: sprite.src, matrix }); return true; } } });
  const selected = DANGO_RASTER.appearance.boots.views.front;
  const expected = [...selected.back || [], ...selected.front || []].map(s => s.src);
  assert.ok((selected.front || []).length, 'fixture has front material to prove it is moved');
  const matrices = { 'foot-left': [1, 0, 0, 1, 0, -2.25], 'foot-right': [1, 0, 0, 1, 0, -2.25] };
  const draw = hands => {
    const artwork = { actionReady: true, layeredReady: true, view: 'front', contact: { hands },
      matrices, attachmentMatrices: matrices, wardrobe: wardrobe.resolveOutfit(outfit, 'front') };
    const ctx = b.createCanvas(1, 1).getContext('2d'); records.length = 0;
    wardrobe.appearance(ctx, { item, layer: 'back', view: 'front', artwork, appearance: outfit });
    const back = structuredClone(records); records.length = 0;
    wardrobe.appearance(ctx, { item, layer: 'front', view: 'front', artwork, appearance: outfit });
    return { back, front: structuredClone(records) };
  };
  const old = draw([{ pawSprite: 'support-paw' }]);
  const current = draw(['left', 'right'].map(side => ({ side, sourceContact: {
    sourcePoseId: ID, kind: 'planted-support', depth: 'behind-body' } })));
  assert.deepEqual(current.back.map(d => d.src), expected); assert.deepEqual(current.front, []);
  assert.deepEqual(current, old, 'same boot source draws and ankle matrices');
  for (const contact of [{ sourcePoseId: 'other', kind: 'planted-support', depth: 'behind-body' },
    { sourcePoseId: ID, kind: 'other', depth: 'behind-body' },
    { sourcePoseId: ID, kind: 'planted-support', depth: 'foreground' }]) {
    assert.ok(draw([{ sourceContact: contact }]).front.length, 'unrelated contacts retain normal garment layers');
  }
});
