import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';

export function argumentsFor(name) {
  const arg = (key, fallback) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
  const repo = path.resolve(arg('repo', process.cwd()));
  if (!fs.existsSync(path.join(repo, 'src/capabilities/companion/presentation/dango-wave-contact-pose.mjs'))) {
    throw new Error('The selected repository does not have the integrated wave module. Pass --repo=/absolute/repo after integration.');
  }
  const out = path.resolve(arg('out', path.join(os.tmpdir(), 'bubu-wave-source-qa', name)));
  fs.mkdirSync(out, {recursive:true});
  return {repo, out, images:process.argv.includes('--images'), frames:process.argv.includes('--frames')};
}

// The candidate is the unchanged production artist and integrated manifest.
// Only dependency wiring for renderer observation is copied into a disposable
// output fixture. No source selector, metadata, action or pose is patched.
export async function fixture({repo, out}) {
  const url = p => pathToFileURL(path.resolve(repo, p)).href;
  const imp = p => import(url(p));
  const backend = createRequire(path.join(repo, 'package.json'))('@napi-rs/canvas');
  const {installOffscreenImages} = await imp('tools/usagi-gallery/offscreen-images.mjs');
  installOffscreenImages(backend);
  globalThis.Path2D = backend.Path2D;
  globalThis.document = {hidden:false, createElement:() => backend.createCanvas(1, 1)};
  globalThis.window = {devicePixelRatio:2};
  const {DANGO_RASTER} = await imp('assets/companion/dango/raster/dango.raster.mjs');
  const wave = await imp('src/capabilities/companion/presentation/dango-wave-contact-pose.mjs');
  const {createDangoRasterArtist} = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
  const {loadLimbSource} = await imp('tools/dango-limbs-qa.mjs');
  const keys = wave.waveContactSpriteKeys();
  if (keys.length !== 11 || !keys.every(k => DANGO_RASTER.tools[k]?.sourceContactPose?.runtimeReady === true)) {
    throw new Error('The selected repository does not register and enable the complete eleven-pose wave group.');
  }
  const limbs = await loadLimbSource();
  const loadImage = u => backend.loadImage(fileURLToPath(u));
  const artists = {}, traces = {};
  let caseId = 0;
  for (const mode of ['legacy', 'candidate']) {
    const manifest = mode === 'candidate' ? DANGO_RASTER : structuredClone(DANGO_RASTER);
    if (mode === 'legacy') for (const key of keys) manifest.tools[key].sourceContactPose.runtimeReady = false;
    const artist = createDangoRasterArtist({manifest, limbs, loadImage, createSurface:backend.createCanvas});
    artists[mode] = {...artist, resolveArtwork(options) {
      // Reserve the same production pet channel; each sequential QA case gets
      // a new explicit episode, avoiding an artificial gallery-channel overflow.
      const o = {...options, channel:'pet', actionInstanceKey:`wave-qa:${caseId}:${options.actionInstanceKey ?? 'default'}`};
      const art = artist.resolveArtwork(o); traces[mode] = {options:o, art}; return art;
    }};
  }
  await Promise.all(Object.values(artists).map(a => a.ready({all:true})));
  const work = fs.mkdtempSync(path.join(out, '.renderer-fixture-'));
  const key = `waveIntegratedFixture${Date.now()}`; globalThis[key] = artists;
  const redirect = (text, file, replacements = {}) => text.replace(/from '([^']+)'/g,
    (_, ref) => `from '${replacements[ref] || new URL(ref, pathToFileURL(file)).href}'`);
  const paths = {compositor:'surfaces/pet/compositor.mjs', scene:'surfaces/pet/scene.mjs', effects:'surfaces/pet/effects.mjs',
    frame:'surfaces/pet/frame-context.mjs', forms:'capabilities/companion/form-registry.mjs', art:'core/pet-art.mjs',
    face:'core/pet-face.mjs', sceneArt:'core/pet-scene-art.mjs', motion:'core/pet-motion.mjs', sprite:'core/pet-sprite.mjs',
    expression:'core/pet-expression.mjs', appearance:'core/pet-appearance.mjs', expressions:'content/expressions.mjs',
    behaviors:'content/behaviors.mjs', sessions:'content/session-activities.mjs', scenes:'content/scenes.mjs',
    wardrobe:'content/appearance.mjs', skins:'skins.mjs', interactionPlayback:'surfaces/pet/interaction-playback.mjs'};
  const common = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k,p]) => [k,await imp('src/'+p)])));
  const sources = {};
  const formPath = path.join(repo, 'src/capabilities/companion/presentation/form-art.mjs');
  const rendererPath = path.join(repo, 'src/surfaces/pet/renderer.mjs');
  for (const mode of Object.keys(artists)) {
    const adapter = path.join(work, `adapter-${mode}.mjs`), form = path.join(work, `form-${mode}.mjs`);
    const bridge = path.join(work, `bridge-${mode}.mjs`), renderer = path.join(work, `renderer-${mode}.mjs`);
    fs.writeFileSync(adapter, `export default globalThis[${JSON.stringify(key)}].${mode};`);
    fs.writeFileSync(form, redirect(fs.readFileSync(formPath, 'utf8'), formPath,
      {'./dango-raster-production.mjs':pathToFileURL(adapter).href}));
    fs.writeFileSync(bridge, `export * from ${JSON.stringify(url('src/capabilities/companion/index.mjs'))};
      import * as formArt from ${JSON.stringify(pathToFileURL(form).href)}; export {formArt};`);
    fs.writeFileSync(renderer, redirect(fs.readFileSync(rendererPath, 'utf8'), rendererPath,
      {'../../capabilities/companion/index.mjs':pathToFileURL(bridge).href}));
    sources[mode] = {...common, renderer:await import(pathToFileURL(renderer).href), formArt:await import(pathToFileURL(form).href)};
  }
  return {repo, out, backend, artists, traces, sources, wave, keys, manifest:DANGO_RASTER,
    createArtist:createDangoRasterArtist, loadImage, limbs,
    createRenderHarness:(await imp('tools/usagi-gallery/runtime-harness.mjs')).createRenderHarness,
    nextCase() {caseId++;},
    dispose() {for (const a of Object.values(artists)) a.dispose(); delete globalThis[key]; fs.rmSync(work, {recursive:true, force:true});}
  };
}

export function finish(out, name, report) {
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({report:path.join(out, `${name}.json`), failures:report.failures?.length || 0}));
  if (report.failures?.length) process.exitCode = 1;
}
