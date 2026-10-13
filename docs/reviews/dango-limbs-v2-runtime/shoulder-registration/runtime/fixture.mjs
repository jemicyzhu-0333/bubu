// Test-only source injection. Both registrations are explicit; the checkout may already contain the corrected socket.
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
const cache = new Map();
export function createFixture(repo) {
  const R = path.resolve(repo) + path.sep;
  if (!cache.has(R)) cache.set(R, build(R));
  return cache.get(R);
}
async function build(R) {
  const backend = createRequire(R + 'package.json')('@napi-rs/canvas');
  const {loadLimbSource} = await import(pathToFileURL(R + 'tools/dango-limbs-qa.mjs').href);
  const {createDangoRasterArtist} = await import(pathToFileURL(R + 'src/capabilities/companion/presentation/dango-raster-art.mjs').href);
  const {DANGO_RASTER} = await import(pathToFileURL(R + 'assets/companion/dango/raster/dango.raster.mjs').href);
  const {createDangoLimbPainter} = await import(pathToFileURL(R + 'src/capabilities/companion/presentation/dango-limb-compose.mjs').href);
  const original = await loadLimbSource();
  if (original.state() !== 'ready') throw Error(original.errors().join('; '));
  function registered(worldRoot) {
    const manifest = structuredClone(original.manifest());
    const socket = manifest.sockets.find(s => s.kind === 'shoulder' && s.view === 'front' && s.side === 'r');
    socket.worldRoot = worldRoot;
    socket.anchorOffset = worldRoot.map((v, i) => v - socket.sourceBodyAnchor[i]);
    const old = original.pixels(socket.coverageStencil);
    const coverage = {width: old.width, height: old.height, data: new Uint8ClampedArray(old.data.length)};
    const offset = worldRoot.map((v, i) => Math.round(v - socket.root[i]));
    for (let y = socket.usefulLocalRect[1]; y < socket.usefulLocalRect[3]; y++) {
      for (let x = socket.usefulLocalRect[0]; x < socket.usefulLocalRect[2]; x++) {
        if (original.bodyAlpha(socket.view, x + offset[0] + .5, y + offset[1] + .5)) {
          coverage.data.set([255, 255, 255, 255], (y * coverage.width + x) * 4);
        }
      }
    }
    return {...original, manifest: () => manifest,
      pixels: id => id === socket.coverageStencil ? coverage : original.pixels(id)};
  }
  const beforeSource = registered([61.5, 45.5]), afterSource = registered([58.5, 45.5]), traces = [];
  async function makeArtist(source, label) {
    const artist = createDangoRasterArtist({manifest: DANGO_RASTER, limbs: source,
      loadImage: url => backend.loadImage(fileURLToPath(url)), createSurface: backend.createCanvas});
    const painter = createDangoLimbPainter({source, createSurface: backend.createCanvas});
    await artist.ready({all: true});
    return {...artist, resolveArtwork(options) {
      const art = artist.resolveArtwork(options);
      if (options.action?.id === 'bubble-blow') {
        const hand = art.contact?.hands.find(h => h.side === 'right');
        const plan = hand && painter.plan(art.view, hand, options.action);
        traces.push({label, progress: options.progress, elapsedMs: options.elapsedMs,
          standard: !!hand?.limb, view: art.view, target: hand?.gripPoint || hand?.points?.at(-1),
          plan: plan && {S: plan.S, E: plan.E, W: plan.W, contact: plan.contactWorld,
            error: plan.error, paw: plan.paw.src, angles: [plan.joint.upperAngle, plan.joint.foreAngle]},
          tools: art.contact?.tools, body: art.data.body, effectOrigins: art.effectOrigins});
      }
      return art;
    }, dispose() { painter.dispose(); artist.dispose(); }};
  }
  return {R, backend, beforeSource, afterSource, traces,
    beforeArtist: await makeArtist(beforeSource, 'before'), afterArtist: await makeArtist(afterSource, 'after')};
}
