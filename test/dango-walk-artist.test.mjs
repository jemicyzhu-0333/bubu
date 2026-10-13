import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { sampleDangoWalkEpisode } from '../src/capabilities/companion/presentation/gait/dango-walk.mjs';
import { mapDangoWalkToRaster } from '../src/capabilities/companion/presentation/gait/dango-walk-artist.mjs';

const view = 'three-quarter-right';
const palette = ['transparent', '#ffffff', '#f7768e', '#ff9eaa', '#1a1b26'];
const images = new Map();
async function imageLoader(url) {
  const u = new URL(url); u.search = '';
  let image = images.get(u.href);
  if (!image) { image = await loadImage(fileURLToPath(u)); images.set(u.href, image); }
  return image;
}
const make = (extra = {}) => createDangoRasterArtist({ manifest: DANGO_RASTER,
  loadImage: imageLoader, createSurface: createCanvas, walkPreview: { enabled: true }, ...extra });
const opts = (p, extra = {}) => ({ view, state: 'walking', motion: 'idle', channel: 'gait-test',
  face: { eyes: 'neutral', mouth: 'neutral' }, walkEpisode: { id: 'episode-1', progress: p }, ...extra });
const baselineOpts = (p, extra = {}) => ({ ...opts(p, extra), state: 'idle', motion: 'idle',
  walkEpisode: undefined, progress: 0, elapsedMs: p * 7200, expressionElapsedMs: p * 7200 });
const pixels = canvas => createHash('sha256').update(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data).digest('hex');
function draw(artist, artwork, { dpr = 1, at = [0, 0], alpha = 1, trace = null, cached = false } = {}) {
  const canvas = createCanvas(Math.ceil(219 * dpr), Math.ceil(219 * dpr)), ctx = canvas.getContext('2d');
  ctx.scale(1.5 * dpr, 1.5 * dpr); ctx.translate(40 + at[0], 40 + at[1]); ctx.globalAlpha = alpha;
  const native = ctx.drawImage.bind(ctx);
  if (trace) ctx.drawImage = (image, ...args) => { const m = ctx.getTransform(); trace.push({ image,
    matrix: [m.a, m.b, m.c, m.d, m.e, m.f], args, alpha: ctx.globalAlpha }); return native(image, ...args); };
  artist.action(ctx, { artwork, view, palette, layer: 'back' });
  if (cached) {
    const body = createCanvas(Math.ceil(146 * 1.5 * dpr), Math.ceil(146 * 1.5 * dpr)), bc = body.getContext('2d');
    bc.scale(1.5 * dpr, 1.5 * dpr); bc.translate(40, 40);
    artist.body(bc, palette, view, artwork, { cache: true });
    artist.clipBody(ctx, artwork, () => { ctx.drawImage(body, -40, -40, 146, 146);
      artist.bodyForeground(ctx, palette, artwork); });
  } else artist.body(ctx, palette, view, artwork);
  artist.face(ctx, palette, artwork.face, false, view, null, artwork);
  artist.action(ctx, { artwork, view, palette, layer: 'front' });
  return canvas;
}

test('mapper keeps native sources, exact native ground64 and stationary endpoint geometry', () => {
  const data = DANGO_RASTER.views[view];
  for (const p of [0, 1]) {
    const w = mapDangoWalkToRaster(sampleDangoWalkEpisode(p), data);
    assert.equal(w.bodyWorld[1], 0);
    for (const f of w.feet) {
      assert.equal(f.source, data.parts[f.key].src); assert.equal(f.groundY, 64);
      assert.equal(f.support, true); assert.equal(f.matrix[5], 0);
      assert.ok(Math.abs(f.matrix[4] - w.bodyWorld[0]) < 1e-12);
    }
  }
});

test('standard artist endpoints are pixel-exact native idle at the same world position, four DPRs', async () => {
  const artist = make(); await artist.ready();
  for (const dpr of [1, 1.25, 1.5, 2]) for (const p of [0, 1]) {
    const art = artist.resolveArtwork(opts(p)); assert.equal(art.walkStatus, 'preview-ready');
    assert.equal(art.data, DANGO_RASTER.views[view]);
    const idle = artist.resolveArtwork(baselineOpts(p));
    assert.deepEqual(pixels(draw(artist, art, { dpr })),
      pixels(draw(artist, idle, { dpr, at: art.walk.bodyWorld })), `DPR ${dpr} p=${p}`);
  }
  artist.dispose();
});

test('default factory and unsupported action, outfit, view, clip or invalid input retain complete legacy', async () => {
  const legacy = make(), artist = make(), disabled = make({ walkPreview: null });
  await Promise.all([legacy.ready(), artist.ready(), disabled.ready()]);
  assert.equal(disabled.resolveArtwork(opts(.5)).walk, undefined); disabled.dispose();
  let i = 0;
  for (const extra of [ { view: 'front' }, { view: 'three-quarter-left' }, { state: 'dragged' },
    { motion: 'dash' }, { motion: 'moonwalk' }, { action: { id: 'chase-laser', motion: 'dash', prop: 'laser' } },
    { action: { id: 'idle', motion: 'idle', prop: 'none' } }, { appearance: { items: [{ id: 'missing', renderKey: 'hat' }] } },
    { transform: [1, 0, 0, 1, 0, 0] }, { accent: 'glint' } ]) {
    const o = opts(.5, { ...extra, walkEpisode: { id: `unsupported-${i++}`, progress: .5 } });
    const art = artist.resolveArtwork(o), old = legacy.resolveArtwork({ ...o, walkEpisode: undefined });
    assert.equal(art.walk, null); assert.deepEqual(art.data, old.data);
    assert.deepEqual(pixels(draw(artist, art)), pixels(draw(legacy, old)));
  }
  for (const p of [NaN, -1, 1.1]) assert.equal(artist.resolveArtwork(opts(p)).walkStatus, 'invalid-episode');
  artist.dispose(); legacy.dispose();
});

test('ordinary cycle uses exactly the two native feet, with planted world transforms constant', async () => {
  const artist = make(); await artist.ready(); const previous = new Map(), cacheKeys = new Set();
  const nativeFeet = await Promise.all(['foot-left', 'foot-right'].map(k => imageLoader(new URL(DANGO_RASTER.views[view].parts[k].src, DANGO_RASTER.baseUrl))));
  let lifted = 0, planted = 0;
  for (let i = 0; i <= 120; i++) {
    const art = artist.resolveArtwork(opts(i / 120)), trace = []; cacheKeys.add(art.key);
    draw(artist, art, { trace }); const calls = trace.filter(c => nativeFeet.includes(c.image));
    assert.equal(calls.length, 2);
    for (let j = 0; j < 2; j++) {
      const f = art.walk.feet[j], prev = previous.get(f.key), x = calls[j].matrix[4];
      if (f.support) { planted++; assert.equal(f.soleWorld[1], 64);
        if (prev?.support) assert.ok(Math.abs(x - prev.x) < 1e-10); }
      else { lifted++; assert.ok(f.soleWorld[1] < 64); }
      previous.set(f.key, { support: f.support, x });
    }
    if (i % 10 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(lifted > 0 && planted > 0); assert.equal(cacheKeys.size, 1);
  artist.dispose();
});

test('one supplied progress freezes all layers; reduced motion settles and retains the latched world position', async () => {
  const artist = make(); await artist.ready();
  const a = artist.resolveArtwork(opts(.41, { elapsedMs: 100 }));
  const b = artist.resolveArtwork(opts(.41, { elapsedMs: 90000 }));
  assert.deepEqual(pixels(draw(artist, a)), pixels(draw(artist, b)));
  const r = artist.resolveArtwork(opts(.41, { reducedMotion: true }));
  const s = artist.resolveArtwork(opts(.9, { reducedMotion: true, elapsedMs: 999999 }));
  assert.deepEqual(pixels(draw(artist, r)), pixels(draw(artist, s)));
  assert.equal(r.walk.bodyWorld[0], a.walk.bodyWorld[0]);
  assert.equal(r.walk.bodyWorld[1], 0); assert.ok(r.walk.feet.every(f => f.support));
  artist.dispose();
});

test('parent alpha is inherited; body, ears, face share one body translation and source coordinates', async () => {
  const artist = make(); await artist.ready();
  const art = artist.resolveArtwork(opts(.36)), baseline = artist.resolveArtwork(baselineOpts(.36)), trace = [], old = [];
  draw(artist, art, { alpha: .4, trace }); draw(artist, baseline, { alpha: .4, trace: old });
  assert.equal(trace.length, old.length);
  const footSources = await Promise.all(['foot-left', 'foot-right'].map(k => imageLoader(new URL(art.data.parts[k].src, DANGO_RASTER.baseUrl))));
  const rootSources = art.data.rootJoins ? await Promise.all(['foot-left', 'foot-right'].map(k => imageLoader(new URL(art.data.rootJoins.fills[k].src, DANGO_RASTER.baseUrl)))) : [];
  assert.equal(art.data.rootJoins, undefined, 'this ordinary native view has no root join fills');
  for (let i = 0; i < trace.length; i++) {
    assert.equal(trace[i].image, old[i].image); assert.deepEqual(trace[i].args, old[i].args);
    assert.ok(Math.abs(trace[i].alpha - .4) < 1e-6);
    if (!footSources.includes(trace[i].image) && !rootSources.includes(trace[i].image)) {
      assert.ok(Math.abs(trace[i].matrix[4] - old[i].matrix[4] - art.walk.bodyWorld[0] * 1.5) < 1e-5, 'Skia getTransform is float32; body translation error exceeds 0.00001 device px');
      assert.ok(Math.abs(trace[i].matrix[5] - old[i].matrix[5] - art.walk.bodyWorld[1] * 1.5) < 1e-5);
    } else {
      const side = Math.max(footSources.indexOf(trace[i].image), rootSources.indexOf(trace[i].image));
      assert.ok(Math.abs(trace[i].matrix[4] - old[i].matrix[4] - art.walk.feet[side].matrix[4] * 1.5) < 1e-5);
      assert.ok(Math.abs(trace[i].matrix[5] - old[i].matrix[5] - art.walk.feet[side].matrix[5] * 1.5) < 1e-5);
    }
  }
  artist.dispose();
});

test('unready episode remains complete legacy until a new id; ready and disposal reuse original lifecycle', async () => {
  const artist = make(); const cold = artist.resolveArtwork(opts(0)); assert.equal(cold.walk, null);
  await artist.ready(); assert.equal(artist.resolveArtwork(opts(.3)).walk, null);
  const hot = artist.resolveArtwork(opts(.3, { walkEpisode: { id: 'second', progress: .3 } }));
  assert.equal(hot.walkStatus, 'preview-ready');
  const count = artist.cacheStats().source.entries;
  for (let i = 0; i <= 30; i++) artist.resolveArtwork(opts(i / 30, { walkEpisode: { id: 'second', progress: i / 30 } }));
  assert.equal(artist.cacheStats().source.entries, count);
  artist.dispose(); assert.equal(artist.cacheStats().source.disposed, true);
  assert.equal(artist.cacheStats().walk.channels, 0); assert.equal(artist.cacheStats().walk.host, null);
});

test('missing native foot is all-or-none fallback without any alternative source', async () => {
  const calls = [];
  const artist = make({ loadImage: async url => { calls.push(url); if (url.includes('views/three-quarter-right/foot-left.png')) throw Error('synthetic missing foot'); return imageLoader(url); } });
  await artist.ready(); const art = artist.resolveArtwork(opts(.4)); assert.equal(art.walk, null);
  assert.equal(art.layeredReady, false); const trace = []; draw(artist, art, { trace });
  assert.ok(trace.length > 0); assert.ok(calls.every(url => !url.includes('/limbs/') && !url.includes('/sources/')));
  artist.dispose();
});

test('cached body pixels and key remain phase-independent; cached path applies world translation once', async () => {
  const artist = make(); await artist.ready(); let reference = null;
  for (const p of [0, .2, .45, .7, 1]) {
    const art = artist.resolveArtwork(opts(p));
    const c = createCanvas(120, 100), ctx = c.getContext('2d'); ctx.translate(20, 20);
    artist.body(ctx, palette, view, art, { cache: true });
    if (reference) assert.deepEqual(pixels(c), reference); else reference = pixels(c);
    const idle = artist.resolveArtwork(baselineOpts(p));
    if (p === 0 || p === 1) assert.deepEqual(pixels(draw(artist, art, { cached: true })),
      pixels(draw(artist, idle, { cached: true, at: art.walk.bodyWorld })));
  }
  artist.dispose();
});


test('only strict enabled=true admits preview; disposal never restarts source loading', async () => {
  for (const enabled of [false, 'false', 1, 'true', null]) {
    const artist = make({ walkPreview: { enabled } }); await artist.ready();
    assert.equal(artist.resolveArtwork(opts(.4)).walk, undefined); artist.dispose();
  }
  let loads = 0;
  const artist = make({ loadImage: async url => { loads++; return imageLoader(url); } });
  await artist.ready(); artist.dispose(); const before = loads;
  await artist.ready(); artist.resolveArtwork(opts(.5)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, before); assert.equal(artist.cacheStats().source.entries, 0);
});
