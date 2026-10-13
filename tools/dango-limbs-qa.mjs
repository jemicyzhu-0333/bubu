// node tools/dango-limbs-qa.mjs [--out=dir]: solve every Dango contact hand
// against the limbs v2 package and report reach/contact error per action/view.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = createRequire(root + '/')(process.env.DANGO_CANVAS_PACKAGE || '@napi-rs/canvas');
const imp = p => import(pathToFileURL(path.join(root, p)).href);
const { createDangoLimbSource } = await imp('src/capabilities/companion/presentation/dango-limb-assets.mjs');
const { solveLimb, poseFor } = await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const { DANGO_LIMB_RIG } = await imp('src/content/companion/dango-limbs.mjs');
export async function loadLimbSource() {
  const base = pathToFileURL(path.join(root, 'assets/companion/dango/raster/')).href;
  const src = createDangoLimbSource({ baseUrl: base, acceptContract: 2,
    loadJson: async u => JSON.parse(fs.readFileSync(fileURLToPath(u))),
    loadImage: u => backend.loadImage(fileURLToPath(u)),
    readPixels: img => { const c = backend.createCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height); } });
  await src.start(); return src;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const src = await loadLimbSource();
  console.log('state', src.state(), src.errors().slice(0, 5));
  const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
  const { createDangoRasterArtist } = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
  const { PET_ACTIONS } = await imp('src/content/behaviors.mjs');
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: s => backend.loadImage(fileURLToPath(s)), createSurface: backend.createCanvas });
  await artist.ready({ all: true });
  const rows = [];
  for (const [id, a] of Object.entries(PET_ACTIONS)) for (const view of ['front', 'three-quarter', 'back']) for (let p = .05; p < 1; p += .1) {
    const art = artist.resolveArtwork({ action: a, motion: a.motion, progress: p, view, elapsedMs: p * 4000 });
    for (const h of art.contact?.hands || []) {
      const t = h.points?.at(-1) || h.gripPoint; if (!t) continue;
      const plan = solveLimb(src, { view: art.drawnView || view, side: h.side, target: t, pose: poseFor(a) });
      rows.push({ id, view: art.drawnView || view, side: h.side, p: +p.toFixed(2), pose: poseFor(a), err: plan ? +plan.error.toFixed(2) : null, kind: h.pawSprite || h.style || (h.attachedArm ? 'arm' : '?') });
    }
  }
  const ok = rows.filter(r => r.err != null && r.err <= DANGO_LIMB_RIG.maxContactError);
  console.log('hand samples', rows.length, 'within', DANGO_LIMB_RIG.maxContactError, ':', ok.length);
  const by = {}; for (const r of rows) { const k = r.id; (by[k] ||= { n: 0, ok: 0, max: 0 }); by[k].n++; if (r.err != null && r.err <= DANGO_LIMB_RIG.maxContactError) by[k].ok++; by[k].max = Math.max(by[k].max, r.err ?? 99); }
  for (const [k, v] of Object.entries(by)) console.log(k.padEnd(16), `${v.ok}/${v.n}`, 'maxErr', v.max.toFixed(1));
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6); if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
}
