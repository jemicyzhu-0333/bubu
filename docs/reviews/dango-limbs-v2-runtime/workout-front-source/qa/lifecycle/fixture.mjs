import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createSourceDrawGuard, normalizeLocalImageRequest } from '../source-draw-guard.mjs';

export async function fixture(root, out) {
  const url = p => pathToFileURL(path.resolve(root, p)).href;
  const imp = p => import(url(p));
  const backend = createRequire(root + '/package.json')('@napi-rs/canvas');
  const tags = new WeakMap(), stages = new WeakMap(), streams = new Map();
  function surface(w, h) {
    const c = backend.createCanvas(w, h), ctx = c.getContext('2d');
    const draw = ctx.drawImage.bind(ctx), clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args) => { if (args[0] === 0 && args[1] === 0) tags.delete(c); return clear(...args); };
    ctx.drawImage = (im, ...args) => {
      const labels = tags.get(im) || [];
      if (labels.length) tags.set(c, [...new Set([...(tags.get(c) || []), ...labels])]);
      const mode = stages.get(c);
      if (mode) streams.get(mode).push({ sources: labels, draw: args, alpha: ctx.globalAlpha });
      return draw(im, ...args);
    };
    return c;
  }
  const trace = { surface, mark(im, label) { tags.set(im, [label]); return im; },
    register(mode, c) { stages.set(c, mode); streams.set(mode, []); },
    begin(mode) { streams.set(mode, []); }, read(mode) { return streams.get(mode) || []; } };
  const { installOffscreenImages } = await imp('tools/usagi-gallery/offscreen-images.mjs');
  installOffscreenImages(backend);
  globalThis.Path2D = backend.Path2D;
  globalThis.document = { hidden: false, createElement: () => surface(1, 1) };
  globalThis.window = { devicePixelRatio: 2 };
  const work = path.join(out, 'isolated-fixture'); fs.mkdirSync(work, { recursive: true });
  const redirect = (s, file, ov = {}) => s.replace(/from '([^']+)'/g, (_, r) => `from '${ov[r] || new URL(r, pathToFileURL(file)).href}'`);
  const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
  const { createDangoRasterArtist } = await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
  const { DANGO_WALK_WORKBENCH } = await imp('src/content/companion/gait/dango-walk.mjs');
  const { loadLimbSource } = await imp('tools/dango-limbs-qa.mjs');
  const limbs = await loadLimbSource(), cache = new Map();
  const realLoad = u => { const p = normalizeLocalImageRequest(u); if (!cache.has(p)) cache.set(p, backend.loadImage(p)); return cache.get(p); };
  const keys = ['left', 'right'].map(side => 'workout-front-support-v4-' + side);
  for (const k of keys) if (!DANGO_RASTER.tools[k]?.sourceContactPose?.runtimeReady) throw Error('Real production integration absent: ' + k);
  const guard = createSourceDrawGuard({ targets: ['left', 'right'].map(side => ({ id: side,
    spriteKey: 'workout-front-support-v4-' + side,
    request: new URL(DANGO_RASTER.tools['workout-front-support-v4-' + side].src, DANGO_RASTER.baseUrl),
    filePath: new URL(DANGO_RASTER.tools['workout-front-support-v4-' + side].src, DANGO_RASTER.baseUrl)
  })), loadImage: realLoad, createSurface: surface });
  const omissions = { omitLeft: guard.omit('left'), omitRight: guard.omit('right') };
  const oldPaths = new Set([DANGO_RASTER.tools['support-paw'].src,
    ...Object.values(DANGO_RASTER.views).flatMap(v => ['hand-left', 'hand-right', 'arm'].map(k => v.parts?.[k]?.src))]
    .filter(Boolean).map(p => normalizeLocalImageRequest(new URL(p, DANGO_RASTER.baseUrl))));
  const F = { guard, omissions, manifests: {}, traces: {}, artists: {}, originals: {}, trace, oldPaths: [...oldPaths] };
  const modes = ['actual', 'omitLeft', 'omitRight', 'omitLegacy'];
  for (const mode of modes) {
    const manifest = structuredClone(DANGO_RASTER); F.manifests[mode] = manifest;
    const loader = omissions[mode]?.loadImage || guard.loadImage;
    const a = createDangoRasterArtist({ manifest, limbs, runFootTiming: 'forward-recovery',
      walkPreview: { enabled: DANGO_WALK_WORKBENCH.enabled, workbench: true }, createSurface: surface,
      loadImage: async u => { const im = await loader(u), p = normalizeLocalImageRequest(u);
        return trace.mark(mode === 'omitLegacy' && oldPaths.has(p) ? surface(im.width, im.height) : im, p); } });
    F.originals[mode] = a;
    F.artists[mode] = { ...a, resolveArtwork(options) { const art = a.resolveArtwork(options);
      F.traces[mode] = { art, options, count: (F.traces[mode]?.count || 0) + 1 }; return art; } };
  }
  await Promise.all(Object.values(F.artists).map(a => a.ready({ all: true })));
  guard.assertLoaded();
  const globalKey = 'workoutLifecycleFixture' + Date.now(); globalThis[globalKey] = F.artists;
  const paths = { compositor: 'surfaces/pet/compositor.mjs', scene: 'surfaces/pet/scene.mjs', effects: 'surfaces/pet/effects.mjs', frame: 'surfaces/pet/frame-context.mjs', forms: 'capabilities/companion/form-registry.mjs', art: 'core/pet-art.mjs', face: 'core/pet-face.mjs', sceneArt: 'core/pet-scene-art.mjs', motion: 'core/pet-motion.mjs', sprite: 'core/pet-sprite.mjs', expression: 'core/pet-expression.mjs', appearance: 'core/pet-appearance.mjs', expressions: 'content/expressions.mjs', behaviors: 'content/behaviors.mjs', sessions: 'content/session-activities.mjs', scenes: 'content/scenes.mjs', wardrobe: 'content/appearance.mjs', skins: 'skins.mjs', interactionPlayback: 'surfaces/pet/interaction-playback.mjs' };
  const common = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k, p]) => [k, await imp('src/' + p)]))), sources = {};
  const fp = root + '/src/capabilities/companion/presentation/form-art.mjs', rp = root + '/src/surfaces/pet/renderer.mjs';
  for (const mode of modes) {
    const adapter = work + '/' + mode + '-adapter.mjs', form = work + '/' + mode + '-form.mjs', bridge = work + '/' + mode + '-bridge.mjs', renderer = work + '/' + mode + '-renderer.mjs';
    fs.writeFileSync(adapter, `export default globalThis[${JSON.stringify(globalKey)}].${mode};`);
    fs.writeFileSync(form, redirect(fs.readFileSync(fp, 'utf8'), fp, { './dango-raster-production.mjs': pathToFileURL(adapter).href }));
    fs.writeFileSync(bridge, `export * from '${url('src/capabilities/companion/index.mjs')}'; import * as formArt from '${pathToFileURL(form).href}'; export { formArt };`);
    fs.writeFileSync(renderer, redirect(fs.readFileSync(rp, 'utf8'), rp, { '../../capabilities/companion/index.mjs': pathToFileURL(bridge).href }));
    const implementation = await import(pathToFileURL(renderer).href), controls = [];
    sources[mode] = { ...common, controls, formArt: await import(pathToFileURL(form).href),
      renderer: { ...implementation, createPetRenderer(options) {
        const real = implementation.createPetRenderer(options), control = {}; controls.push(control);
        return { executeFrame(frame, command, args) { if (!command) control.lastFrame = frame;
          const result = real.executeFrame(frame, command, args); control.lastResult = result; return result; } };
      } } };
  }
  // The three production controller lifecycle functions are extracted verbatim,
  // with their surrounding state/effect ports supplied by this disposable fixture.
  // No production selector, action painter, or paw painter is replaced.
  const controllerText = fs.readFileSync(root + '/src/surfaces/pet/controller.mjs', 'utf8');
  const start = controllerText.indexOf('function cancelCurrentAction('), end = controllerText.indexOf('\nfunction presentExpressionEvent(', start);
  if (start < 0 || end < 0) throw Error('Controller lifecycle extraction anchors absent');
  const extracted = controllerText.slice(start, end);
  const lifecycleFile = work + '/controller-lifecycle.mjs';
  fs.writeFileSync(lifecycleFile, `export function createControllerLifecycle() {
let currentEgg = null, actionSequence = 0, actionStartedAt = 0, animNow = 0;
let petPlayer = null, presentationDirector = null, lastEggEventId = null, resets = 0;
const resetPetActionEmitters = () => { resets++; };
${extracted}
return { setNow(now) { animNow = now; }, begin: beginActionPlayback, cancel: cancelCurrentAction,
update: updateActionPlayback, snapshot() { return { currentEgg, actionStartedAt, resets }; } };
}`);
  const { createControllerLifecycle } = await import(pathToFileURL(lifecycleFile).href);
  return { backend, sources, F, modes, createControllerLifecycle,
    createRenderHarness: (await imp('tools/usagi-gallery/runtime-harness.mjs')).createRenderHarness,
    dispose() { for (const a of Object.values(F.originals)) a.dispose(); delete globalThis[globalKey]; } };
}
