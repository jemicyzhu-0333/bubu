import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('repo') || !arg('out')) throw Error('Use --repo=/path/to/bubu --out=/path/to/evidence');
const R = path.resolve(arg('repo')) + path.sep, O = path.resolve(arg('out')) + path.sep;
fs.mkdirSync(O, { recursive: true });
const temp = fs.mkdtempSync(path.join(O, '.renderer-')) + path.sep;
const backend = createRequire(R + 'package.json')('@napi-rs/canvas');
const imp = p => import(pathToFileURL(R + p).href);
const { installOffscreenImages } = await imp('tools/usagi-gallery/offscreen-images.mjs');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) }; globalThis.window = { devicePixelRatio: 2 };
const { createRenderHarness } = await imp('tools/usagi-gallery/runtime-harness.mjs');
const formPath = R + 'src/capabilities/companion/presentation/form-art.mjs';
const rendererPath = R + 'src/surfaces/pet/renderer.mjs';
const toURL = p => pathToFileURL(p).href;
const redirect = (text, base, replace) => text.replace(/from '([^']+)'/g,
  (_, ref) => `from '${replace(ref) || new URL(ref, toURL(base)).href}'`);
const fixtureFile = temp + 'fixture.mjs';
fs.writeFileSync(fixtureFile, `
import{createDangoRasterArtist}from'${toURL(R + 'src/capabilities/companion/presentation/dango-raster-art.mjs')}';
import{DANGO_RASTER}from'${toURL(R + 'assets/companion/dango/raster/dango.raster.mjs')}';
import{sipContactSpriteKeys}from'${toURL(R + 'src/capabilities/companion/presentation/dango-sip-contact-pose.mjs')}';
import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const{createCanvas,loadImage}=createRequire(${JSON.stringify(R + 'package.json')})('@napi-rs/canvas');
const manifest=structuredClone(DANGO_RASTER);for(const k of sipContactSpriteKeys())manifest.tools[k].sourceContactPose.runtimeReady=true;
const original=createDangoRasterArtist({manifest,createSurface:createCanvas,loadImage:u=>loadImage(fileURLToPath(u))});
await original.ready({all:true});export const traces=[];
export default{...original,resolveArtwork(options){const a=original.resolveArtwork(options);if(options.action?.id==='sip-tea')traces.push({progress:options.progress,source:a.sourceContactPose,ready:a.ready,bodyKey:a.key,cup:a.contact.tools.find(t=>t.key==='cup'),roots:a.contact.tools.filter(t=>t.sourceContactLayer==='sip-front-v2').length,front:a.contact.hands.filter(h=>h.sourceContact?.sourcePoseId==='sip-front-v2').length});return a;}};
`);
const formFile = temp + 'form-art.mjs';
fs.writeFileSync(formFile, redirect(fs.readFileSync(formPath, 'utf8'), formPath,
  ref => ref === './dango-raster-production.mjs' ? toURL(fixtureFile) : null));
const bridge = temp + 'bridge.mjs';
fs.writeFileSync(bridge, `export * from '${toURL(R + 'src/capabilities/companion/index.mjs')}';\nimport * as formArt from '${toURL(formFile)}';\nexport {formArt};\n`);
const rendererFile = temp + 'renderer.mjs';
fs.writeFileSync(rendererFile, redirect(fs.readFileSync(rendererPath, 'utf8'), rendererPath,
  ref => ref === '../../capabilities/companion/index.mjs' ? toURL(bridge) : null));
const paths = { compositor: 'surfaces/pet/compositor.mjs', scene: 'surfaces/pet/scene.mjs', effects: 'surfaces/pet/effects.mjs',
  frame: 'surfaces/pet/frame-context.mjs', forms: 'capabilities/companion/form-registry.mjs', art: 'core/pet-art.mjs',
  face: 'core/pet-face.mjs', sceneArt: 'core/pet-scene-art.mjs', motion: 'core/pet-motion.mjs', sprite: 'core/pet-sprite.mjs',
  expression: 'core/pet-expression.mjs', appearance: 'core/pet-appearance.mjs', expressions: 'content/expressions.mjs',
  behaviors: 'content/behaviors.mjs', sessions: 'content/session-activities.mjs', scenes: 'content/scenes.mjs',
  wardrobe: 'content/appearance.mjs', skins: 'skins.mjs' };
const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k, p]) => [k, await imp('src/' + p)])));
sources.formArt = await import(toURL(formFile)); sources.renderer = await import(toURL(rendererFile));
const fixture = await import(toURL(fixtureFile)), rows = [];
const hash = c => createHash('sha256').update(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).digest('hex');
for (const dpr of [1, 1.25, 1.5, 2, 4]) {
  const h = createRenderHarness(sources, { skin: 'pink', outfit: false, dpr, view: 'front' });
  h.select('action', 'sip-tea'); let bodyKey = null; const hashes = new Set();
  for (let i = 0; i <= 256; i++) {
    const frame = h.draw(i / 256 * 9000), trace = fixture.traces.at(-1);
    if (trace?.source !== 'sip-front-v2' || !trace.ready || trace.roots !== 2 || trace.front !== 2) throw Error(`fallback at ${dpr}:${i}`);
    bodyKey ??= trace.bodyKey; if (trace.bodyKey !== bodyKey) throw Error('body cache key changed');
    hashes.add(hash(h.body));
    if (dpr === 1 && [0, 64, 128, 192, 256].includes(i)) fs.writeFileSync(O + `runtime-${i}.png`, h.body.toBuffer('image/png'));
    if (i === 256) rows.push({ dpr, frames: 257, allSourceSelected: true, roots: 2, front: 2,
      uniqueBodyFrames: hashes.size, bodyCacheKeyCount: 1, lastActionProgress: frame.state.currentActionProgress });
  }
  h.dispose(); console.log('actual renderer DPR complete', dpr);
}
const stats = fixture.default.cacheStats(); fixture.default.dispose();
const report = { status: 'passed-actual-production-renderer-source-injection', runtimeReady: false, hostAcceptance: null,
  method: 'Unmodified production renderer/form-art with normalized absolute imports and one injected standard Dango artist. Only the four sip source flags are true in the test manifest. Offscreen Skia, no browser or native OS acceptance.',
  phaseInterpretation: '257 timestamps from0..9000ms; existing preview loops the9000ms endpoint tophase0. Separate257 exact phase tests includephase1.',
  dprs: rows, cacheBeforeDispose: stats, cacheAfterDispose: fixture.default.cacheStats(),
  productionSources: Object.fromEntries([formPath, rendererPath].map(p => [p.slice(R.length), createHash('sha256').update(fs.readFileSync(p)).digest('hex')])) };
fs.writeFileSync(O + 'actual-renderer-audit.json', JSON.stringify(report, null, 2) + '\n');
fs.rmSync(temp, { recursive: true, force: true }); console.log(JSON.stringify(report));
