// node gate-scan.mjs <root>: which action/view/side pass the forced-on limb gate
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url';
const root = process.argv[2]; const imp = p => import(pathToFileURL(path.join(root, p)).href);
const backend = createRequire(root + '/')('@napi-rs/canvas');
const { loadLimbSource } = await imp('tools/dango-limbs-qa.mjs');
const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
const { createDangoRasterArtist } = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const { PET_ACTIONS } = await imp('src/content/behaviors.mjs');
const limbs = await loadLimbSource();
const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, loadImage: s => backend.loadImage(fileURLToPath(s)), createSurface: backend.createCanvas, limbs });
await artist.ready({ all: true });
const out = [];
for (const [id, a] of Object.entries(PET_ACTIONS)) for (const view of ['front', 'three-quarter', 'back']) {
  const sides = {};
  for (const p of [.1, .5, .9]) {
    const art = artist.resolveArtwork({ action: a, motion: a.motion, progress: p, view, elapsedMs: p * (a.duration || 4000) });
    for (const h of art.contact?.hands || []) (sides[h.side] ||= new Set()).add(h.limb ? 'limb' : 'legacy');
  }
  const on = Object.entries(sides).filter(([, s]) => s.has('limb')).map(([k]) => k);
  if (on.length) out.push({ id, view, on });
}
console.log(JSON.stringify(out));
