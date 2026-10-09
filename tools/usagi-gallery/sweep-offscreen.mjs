import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installOffscreenImages } from './offscreen-images.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const require = createRequire(import.meta.url), backend = require(arg('canvas-package'));
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D; globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 1 };
const { loadSource, createRenderHarness } = await import('./runtime-harness.mjs');
const { pixels } = await import('./pixels.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await loadSource(pathToFileURL(root).href);
const catalog = [...Object.values(source.behaviors.PET_ACTIONS).map(item => ({ kind: 'action', item })),
  ...Object.values(source.sessions.SESSION_ACTIVITIES).map(item => ({ kind: 'session', item }))];
const scenes = Object.values(source.scenes.SCENES), fractions = [.18, .5, .82], results = [], errors = [];
const out = path.resolve(arg('out') || 'dist/usagi-gallery-scene-sweep'); fs.mkdirSync(out, { recursive: true });
const start = Date.now(), form = arg('form') === 'dango' ? 'dango' : 'usagi';
const skin = arg('skin') || (form === 'dango' ? 'pink' : 'usagi');
const mosaic = backend.createCanvas(5 * 250, 5 * 250), ctx = mosaic.getContext('2d');
ctx.fillStyle = '#eef3f3'; ctx.fillRect(0, 0, mosaic.width, mosaic.height);
for (const [sceneIndex, scene] of scenes.entries()) {
  for (const entry of catalog) {
    const h = createRenderHarness(source, { skin, dpr: 1, outfit: true, level: 25, scene: scene.id, sceneMode: 'selected' });
    try {
      const selected = h.select(entry.kind, entry.item.id, scene.id), samples = [];
      for (const progress of fractions) {
        const frame = h.draw(selected.duration * progress), body = pixels(h.body), scenePixels = pixels(h.scene);
        const phase = source.formArt.sampleAction(h.form, selected.item, progress);
        samples.push({ progress, renderedScene: frame.state.selectedScene.value?.id,
          bodyPixels: body.occupied, scenePixels: scenePixels.occupied, edgePixels: body.edge, bodyHash: body.hash,
          phase: phase.phase?.label || null, motion: phase.action?.motion, prop: phase.action?.prop });
        if (frame.state.selectedScene.value?.id !== scene.id) throw new Error('Selected scene override was not rendered');
      }
      results.push({ kind: entry.kind, id: entry.item.id, scene: scene.id, samples });
      // A compact representative scene/contact matrix accompanies the all-pairs numeric sweep.
      if (entry.item.id === catalog[sceneIndex % catalog.length].item.id) {
        const image = h.composite(); ctx.drawImage(image, sceneIndex % 5 * 250 + 15, Math.floor(sceneIndex / 5) * 250 + 5, 220, 220);
        image.width = 1; image.height = 1; ctx.fillStyle = '#36566a'; ctx.font = '11px sans-serif';
        ctx.fillText(scene.id, sceneIndex % 5 * 250 + 12, Math.floor(sceneIndex / 5) * 250 + 228);
        ctx.fillText(entry.item.id, sceneIndex % 5 * 250 + 12, Math.floor(sceneIndex / 5) * 250 + 244);
      }
    } catch (error) { errors.push({ scene: scene.id, kind: entry.kind, id: entry.item.id, error: error.stack }); }
    finally { h.dispose(); }
  }
  globalThis.gc?.(); console.log(`${scene.id}: ${catalog.length} combinations`);
}
fs.writeFileSync(path.join(out, 'scene-action-mosaic.png'), mosaic.toBuffer('image/png'));
const all = results.flatMap(r => r.samples);
const report = { renderer: 'Offscreen Skia Canvas / exact production renderer', generatedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - start) / 1000, form, skin, dpr: 1, outfit: 'Lv.25 automatic', sceneMode: 'Explicit selected scene override, including session activities',
  sourceRendererSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/surfaces/pet/renderer.mjs'))).digest('hex'),
  coverage: { actions: 43, sessions: 12, scenes: scenes.length, expectedCombinations: catalog.length * scenes.length,
    combinations: results.length, samplesPerCombination: fractions.length, frames: all.length, fractions },
  blankBodyFrames: all.filter(s => s.bodyPixels === 0).length, blankSceneFrames: all.filter(s => s.scenePixels === 0).length,
  edgeTouchFrames: all.filter(s => s.edgePixels > 0).length, errors,
  limitation: 'Three samples per pair test scene compatibility/blankness/edge contact, not exhaustive continuity, prop contact or visual semantics. See dense action strips and sequential videos.', results };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ coverage: report.coverage, blankBodyFrames: report.blankBodyFrames, edgeTouchFrames: report.edgeTouchFrames, errors: errors.length, seconds: report.elapsedSeconds }));
if (errors.length) process.exitCode = 1;
