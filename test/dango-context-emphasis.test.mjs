import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DANGO_RASTER as manifest } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { toolMatrix } from '../src/capabilities/companion/presentation/dango-raster-actions.mjs';
import { applyPoint } from '../src/capabilities/companion/presentation/rig/pose.mjs';
import { MIRROR_ACTIVITIES } from '../src/content/session-activities.mjs';
import { PALETTES } from '../src/core/pet-art.mjs';
import { recordingContext } from '../test-support/dango-reconstruction-fixture.mjs';
const make = (loadImage = async src => ({ src, width: 8, height: 8 })) => createDangoRasterArtist({ manifest, loadImage });
const options = (progress = .25, extra = {}) => ({ action: MIRROR_ACTIVITIES['mirror-ai'], motion: 'browse', view: 'front', progress, ...extra });
const context = () => ({ ...recordingContext(), moveTo() {}, lineTo() {}, closePath() {} });
const source = new URL('../assets/companion/dango/raster/sources/tools/context-emphasis-v2/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('shipped context props preserve asset hashes and approved runtime anatomy', () => {
  const recipe = JSON.parse(fs.readFileSync(new URL('recipe.json', source)));
  const provenance = JSON.parse(fs.readFileSync(new URL('provenance.json', source)));
  // Authoring master verification belongs to the private art-source archive.
  // Public checks verify every shipped prop and the approved runtime invariants.
  for (const cell of recipe.cells) {
    const sprite = manifest.tools[cell.key];
    assert.deepEqual(sprite.rect, cell.rect);
    assert.equal(sha(fs.readFileSync(new URL(sprite.src, manifest.baseUrl))), cell.outputSha256);
  }
  for (const [path, expected] of Object.entries(provenance.approvedRuntimeInvariants)) {
    assert.equal(sha(fs.readFileSync(new URL(`../${path}`, import.meta.url))), expected, path);
  }
});

test('AI notebook collaborator stays beside the pet outside face, clothes and lower badge through every lifecycle', async () => {
  const artist = make(); await artist.ready({ all: true });
  for (const view of ['front', 'three-quarter']) for (const phase of ['enter', 'loop', 'exit']) for (let n = 0; n <= 120; n++) {
    const progress = n / 120;
    const action = { ...MIRROR_ACTIVITIES['mirror-ai'], propOpacity: phase === 'enter' ? progress : phase === 'exit' ? 1 - progress : 1,
      mirrorPresentation: { phase, loopProgress: progress } };
    const artwork = artist.resolveArtwork(options(progress, { view, action }));
    const buddies = artwork.contact.tools.filter(item => item.key === 'ai-robot-buddy');
    assert.equal(buddies.length, 1); assert.ok(artwork.ready);
    assert.ok(!artwork.contact.tools.some(item => item.key.startsWith('headphones-')));
    const buddy = buddies[0], sprite = manifest.tools[buddy.key], matrix = toolMatrix(buddy, sprite);
    const [x, y, width, height] = sprite.rect;
    for (const point of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
      const [px, py] = applyPoint(matrix, ...point);
      assert.ok(px > 77 && px < 97, `buddy x=${px}`);
      assert.ok(py > 42 && py < 68, `buddy y=${py}`);
      assert.ok(py < 80.33, 'never reaches lower floating category badge');
    }
  }
  artist.dispose();
});

test('a cold or failed robot never leaves a partial AI equipment group and settles atomically', async () => {
  for (const fail of [false, true]) {
    let settle;
    const artist = make(src => src.includes('/ai-robot-buddy.png') ? new Promise((resolve, reject) => {
      settle = () => fail ? reject(Error('fixture unavailable')) : resolve({ src, width: 8, height: 8 });
    }) : Promise.resolve({ src, width: 8, height: 8 }));
    const ready = artist.ready({ all: true }); await new Promise(resolve => setImmediate(resolve));
    const check = () => {
      const art = artist.resolveArtwork(options()); assert.equal(art.actionReady, false);
      const ctx = context(); for (const layer of ['back', 'front']) artist.action(ctx, { artwork: art, action: options().action, palette: PALETTES.pink, layer });
      assert.ok(!ctx.calls.some(call => /laptop-reverse|ai-robot-buddy|small-fin/.test(call.image.src)));
    };
    check(); settle(); await ready;
    if (fail) check(); else {
      const art = artist.resolveArtwork(options()); assert.ok(art.ready);
      const ctx = context(); artist.action(ctx, { artwork: art, action: options().action, palette: PALETTES.pink, layer: 'front' });
      for (const name of ['laptop-reverse-front', 'ai-robot-buddy', 'small-fin']) assert.ok(ctx.calls.some(call => call.image.src.includes(`/${name}.png`)));
    }
    artist.dispose();
  }
});

test('interrupting or removing the mirror action cannot retain a robot or headphones', async () => {
  const artist = make(); await artist.ready({ all: true });
  artist.resolveArtwork(options(.75));
  for (const action of [null, { id: 'wave', motion: 'wave', prop: 'none' }]) {
    const art = artist.resolveArtwork({ action, motion: action?.motion || 'idle', view: 'front', progress: .25 });
    assert.ok(!(art.contact?.tools || []).some(item => /headphones|ai-robot/.test(item.key)));
    const ctx = context(); for (const layer of ['back', 'front']) artist.action(ctx, { artwork: art, action, palette: PALETTES.pink, layer });
    assert.ok(!ctx.calls.some(call => /headphones|ai-robot-buddy/.test(call.image.src)));
  }
  artist.dispose();
});
