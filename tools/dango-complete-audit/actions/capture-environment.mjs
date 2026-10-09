import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { installOffscreenImages } from '../../usagi-gallery/offscreen-images.mjs';
import { SCENE_PARTICLES } from '../../../src/capabilities/companion/presentation/dango-raster-scenes.mjs';
import { DANGO_RASTER } from '../../../assets/companion/dango/raster/dango.raster.mjs';
import { framePixels } from '../../dango-frequency-audit/audit.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
backend.GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'sans-serif');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const { loadSource, createRenderHarness } = await import('../../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href);
const out = path.resolve(arg('out')), kind = arg('kind'), id = arg('id'); fs.mkdirSync(out, { recursive: true });
const sourceFiles = ['src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/scene.mjs', 'src/capabilities/companion/presentation/dango-raster-scenes.mjs',
  'src/capabilities/companion/presentation/dango-raster-art.mjs', 'assets/companion/dango/raster/dango.raster.mjs'];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const before = hashes(), sceneSources = new Set(), naturalParticleTypes = new Set(), frames = [];
const select = h => h.select(kind === 'room' ? 'session' : kind, kind === 'room' ? id === 'focused' ? 'focus-read' : 'rest-daydream' : id);
const h = createRenderHarness(source, { skin: 'pink', outfit: false, view: 'front', dpr: 2, blink: false });
const combined = backend.createCanvas(440, 440);
let proof, reducedMotion = null;
if (kind === 'particles') {
  const sheet = backend.createCanvas(1000, 260 * Math.ceil(SCENE_PARTICLES.length / 4)), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e9edef'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (const [index, type] of SCENE_PARTICLES.entries()) {
    h.select('scene', 'cozy-room'); const state = h.draw(0).state;
    const fixture = { type, x: type === 'flash' ? 14 : 45, y: type === 'flash' ? 14 : 70,
      vx: 0, vy: 0, gravity: 0, life: 90, baseLife: 90,
      size: type === 'cloud' ? 23 : type === 'mist' ? 36 : type === 'flash' ? 192 : 3.5, color: '#c0caf5', ch: 'A' };
    state.sceneParticles = [fixture];
    const context = h.scene.getContext('2d'), original = context.drawImage, calls = [];
    context.drawImage = function (image, ...rect) {
      if (typeof image.src === 'string' && image.src.includes(`/${DANGO_RASTER.sceneParticles[type].src}`)) calls.push(image.src);
      return original.call(this, image, ...rect);
    };
    h.draw(1); context.drawImage = original; h.composite(combined);
    const x = index % 4 * 250, y = Math.floor(index / 4) * 260;
    ctx.drawImage(combined, x + 15, y + 22, 220, 220); ctx.fillStyle = '#263642'; ctx.font = '13px sans-serif';
    ctx.fillText(type, x + 15, y + 17);
    frames.push({ type, renderedSpriteSources: calls, fixtureState: fixture,
      fixture: 'One existing particle injected into actual renderer state at the midpoint of its production size range; not a natural-emitter claim' });
  }
  proof = 'registered-particles.png'; fs.writeFileSync(path.join(out, proof), sheet.toBuffer('image/png'));
} else {
  select(h); const sheet = backend.createCanvas(1100, 550), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e9edef'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = '#263642'; ctx.font = '18px sans-serif'; ctx.fillText(`${kind}/${id} · exact renderer · 99 CSS px body`, 15, 27);
  const context = h.scene.getContext('2d'), original = context.drawImage;
  context.drawImage = function (image, ...rect) {
    if (typeof image.src === 'string') sceneSources.add(image.src.split('?')[0].replace(pathToFileURL(root).href + '/', ''));
    return original.call(this, image, ...rect);
  };
  for (let at = 0; at <= 20000; at += 100) {
    const result = h.draw(at); result.state.sceneParticles.forEach(particle => naturalParticleTypes.add(particle.type));
    const pixels = framePixels(h.body); frames.push({ atMs: at, occupied: pixels.occupied, edge: pixels.edge });
    if ([0, 10000, 20000].includes(at)) {
      h.composite(combined); const index = at / 10000;
      ctx.drawImage(combined, index * 220 + 5, 90, 220, 220);
      ctx.fillStyle = '#263642'; ctx.font = '13px sans-serif'; ctx.fillText(`${at / 1000}s natural playback`, index * 220 + 10, 335);
    }
  }
  context.drawImage = original; h.composite(combined); ctx.drawImage(combined, 660, 50, 440, 440);
  ctx.fillStyle = '#263642'; ctx.fillText('2× final composite', 680, 520);
  proof = 'composite.png'; fs.writeFileSync(path.join(out, proof), sheet.toBuffer('image/png'));
  const calm = createRenderHarness(source, { skin: 'pink', outfit: false, view: 'front', dpr: 2, calm: true });
  select(calm); calm.draw(0);
  const calmStart = { body: framePixels(calm.body).hash, scene: framePixels(calm.scene).hash };
  const calmEnd = calm.draw(20000); const reduced = calm.composite(combined);
  reducedMotion = { bodyStable: calmStart.body === framePixels(calm.body).hash,
    sceneStable: calmStart.scene === framePixels(calm.scene).hash, remainingParticles: calmEnd.state.sceneParticles.length };
  fs.writeFileSync(path.join(out, 'reduced-motion.png'), reduced.toBuffer('image/png')); calm.dispose();
}
h.dispose();
const after = hashes();
const record = { kind, id, sourceHashes: before, changedSources: sourceFiles.filter(file => before[file] !== after[file]),
  evidence: 'Actual createPetRenderer, scene/body/overlay composite in existing Skia; not native desktop',
  bodyDesignWidthCssPx: 99, proof, reducedMotion, naturalParticleTypes: [...naturalParticleTypes].sort(), sceneSources: [...sceneSources].sort(), frames };
fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ kind, id, frames: frames.length, naturalParticleTypes: record.naturalParticleTypes, proof }));
