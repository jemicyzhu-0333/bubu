// Focused actual-pixel diagnostic. This is offscreen Skia evidence, not Electron/GPU acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(arg('out'));
fs.mkdirSync(out, { recursive: true });
const backend = createRequire(import.meta.url)(arg('canvas-package'));
installOffscreenImages(backend);
const pathNames = new WeakMap();
globalThis.Path2D = class extends backend.Path2D {
  constructor(value) { super(value); pathNames.set(this, value); }
};
let activeTrace = null, canvasSerial = 0;
const makeCanvas = (width = 1, height = width) => {
  const canvas = backend.createCanvas(width, height); canvas.style = {}; canvas.traceId = ++canvasSerial;
  const ctx = canvas.getContext('2d'), fill = ctx.fill.bind(ctx), drawImage = ctx.drawImage.bind(ctx);
  ctx.fill = (...args) => {
    activeTrace?.push({ canvas: canvas.traceId, kind: 'fill', path: pathNames.get(args[0]) });
    return fill(...args);
  };
  ctx.drawImage = (...args) => {
    activeTrace?.push({ canvas: canvas.traceId, kind: 'image' }); return drawImage(...args);
  };
  return canvas;
};
globalThis.document = { createElement: () => makeCanvas() };
globalThis.window = { devicePixelRatio: 1 };
const { loadSource, createRenderHarness } = await import('../usagi-gallery/runtime-harness.mjs');
const source = await loadSource(pathToFileURL(root).href);
const { createCompanionPortraitPainter } = await import('../../src/surfaces/popover/features/companion-portrait.mjs');
const { USAGI_OUTFIT_SETS } = await import('../../src/content/companion/usagi-wardrobe.mjs');
const { createPathCache, paintShapes } = await import('../../src/capabilities/companion/presentation/rig/paint.mjs');
const { resolveRigFace, rigEyeMatrix } = await import('../../src/capabilities/companion/presentation/rig/face.mjs');
const { default: usagiArtist } = await import('../../src/capabilities/companion/presentation/usagi-art.mjs');
const { usagiPartLayer } = await import('../../src/capabilities/companion/presentation/usagi-garment-depth.mjs');
const form = source.forms.resolvePetForm('usagi');
const palette = source.formArt.paletteForSkin('usagi', form);
const rig = source.formArt.resolveArtwork(form, { view: 'front', calmVisual: true }).rig;
const outfits = [{ id: 'bare', itemIds: [] }, ...USAGI_OUTFIT_SETS];
const image = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
const save = (canvas, name) => fs.writeFileSync(path.join(out, name), canvas.toBuffer('image/png'));
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sameDimensions: false, changedPixels: null };
  let changedPixels = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a.data[i + c] - b.data[i + c]);
      changed ||= delta !== 0; maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    changedPixels += Number(changed);
  }
  return { sameDimensions: true, changedPixels, maxChannelDelta };
}
const portraitComparisons = [], portraitHandChecks = [];
const hero = makeCanvas(), reused = createCompanionPortraitPainter({ document, window, canvas: hero });
const targets = { thumb: makeCanvas(), preview: makeCanvas() };
const portraitSheet = makeCanvas(1320, 830), portraitContext = portraitSheet.getContext('2d');
portraitContext.fillStyle = '#f5f2eb'; portraitContext.fillRect(0, 0, 1320, 830);
let portraitRow = 0;
for (const dpr of [1, 1.25, 2, 1.25, 1]) {
  window.devicePixelRatio = dpr;
  for (const index of [0, 2, 1, 3, 2, 0, 3, 1]) {
    const outfit = outfits[index];
    for (const calmVisual of [true, false]) {
      const options = { skinId: 'usagi', itemIds: outfit.itemIds, calmVisual, now: -1, elapsedMs: 750 };
      activeTrace = [];
      reused.drawHero(options);
      const trace = activeTrace; activeTrace = null;
      if (outfit.id !== 'bare') {
        const hands = rig.views.front.parts.filter(part => part.bone.startsWith('hand_')).map(part => {
          const indices = trace.map((event, i) => event.kind === 'fill' && event.path === part.shapes[0].d ? i : -1).filter(i => i >= 0);
          return { bone: part.bone, paints: indices.length,
            onlyOnFinalCanvas: indices.every(i => trace[i].canvas === hero.traceId),
            afterLastImage: indices.every(i => !trace.slice(i + 1).some(event => event.canvas === hero.traceId && event.kind === 'image')) };
        });
        portraitHandChecks.push({ dpr, outfit: outfit.id, calmVisual, hands });
      }
      const freshCanvas = makeCanvas(), fresh = createCompanionPortraitPainter({ document, window, canvas: freshCanvas });
      fresh.drawHero(options);
      portraitComparisons.push({ dpr, outfit: outfit.id, tier: 'hero', calmVisual, ...compare(image(hero), image(freshCanvas)) });
      fresh.dispose();
    }
    for (const tier of ['thumb', 'preview']) {
      reused.drawPetPreview(targets[tier], { skinId: 'usagi', itemIds: outfit.itemIds, size: tier });
      const freshTarget = makeCanvas(), freshHero = makeCanvas();
      const fresh = createCompanionPortraitPainter({ document, window, canvas: freshHero });
      fresh.drawPetPreview(freshTarget, { skinId: 'usagi', itemIds: outfit.itemIds, size: tier });
      portraitComparisons.push({ dpr, outfit: outfit.id, tier, calmVisual: true, ...compare(image(targets[tier]), image(freshTarget)) });
      fresh.dispose();
    }
  }
  if (portraitRow < 3) {
    for (const [index, outfit] of outfits.entries()) {
      reused.drawHero({ skinId: 'usagi', itemIds: outfit.itemIds, calmVisual: true, now: -1 });
      const x = index * 330, y = portraitRow * 275;
      portraitContext.fillStyle = '#342d29'; portraitContext.font = '16px sans-serif';
      portraitContext.fillText(`${outfit.id} / DPR ${dpr}`, x + 18, y + 24);
      portraitContext.drawImage(hero, x + 40, y + 40, hero.width / dpr, hero.height / dpr);
    }
    portraitRow++;
  }
}
reused.dispose(); save(portraitSheet, 'cached-portraits.png');
fs.writeFileSync(path.join(out, 'portrait-comparisons.json'), JSON.stringify(portraitComparisons, null, 2));
fs.writeFileSync(path.join(out, 'portrait-hand-paint-order.json'), JSON.stringify(portraitHandChecks, null, 2));
console.log(JSON.stringify({ phase: 'portrait', comparisons: portraitComparisons.length,
  mismatches: portraitComparisons.filter(row => row.changedPixels !== 0) }));

const paths = createPathCache();
function liveSurface(stage) {
  const canvas = makeCanvas(stage.rasterWidth, stage.rasterHeight), ctx = canvas.getContext('2d');
  ctx.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  ctx.translate(stage.bodyOrigin.x, stage.bodyOrigin.y);
  return { canvas, ctx };
}
function overlap(a, b) {
  let pixels16 = 0, pixels128 = 0, weightedPixels = 0, maskPixels = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const aa = a.data[i], ba = b.data[i];
    if (aa >= 16) maskPixels++;
    if (aa >= 16 && ba >= 16) pixels16++;
    if (aa >= 128 && ba >= 128) pixels128++;
    weightedPixels += aa * ba / (255 * 255);
  }
  return { pixels16, pixels128, weightedPixels, maskPixels };
}
const faceChecks = [], readiness = [];
const faceSheet = makeCanvas(1620, 1134), faceContext = faceSheet.getContext('2d');
faceContext.fillStyle = '#f5f2eb'; faceContext.fillRect(0, 0, 1620, 1134);
for (const [outfitIndex, outfit] of USAGI_OUTFIT_SETS.entries()) for (const [viewIndex, view] of ['front', 'three-quarter', 'profile'].entries()) {
  const appearance = source.appearance.projectAppearance({ skin: 'usagi', formId: 'usagi', view,
    items: source.wardrobe.PET_APPEARANCE_ITEMS, itemIds: outfit.itemIds, includeLocked: true });
  for (const dpr of [1, 1.25, 2]) {
    const stage = source.forms.resolveFormStage('usagi', dpr);
    const artwork = source.formArt.resolveArtwork(form, { view, calmVisual: true, appearance,
      face: { eyes: 'neutral', mouth: 'neutral' } });
    readiness.push({ outfit: outfit.id, view, dpr, ready: artwork.ready, ...artwork.wardrobe });
    const foreground = liveSurface(stage);
    source.formArt.drawAppearanceLayer(foreground.ctx, appearance, palette, { form, stage, view,
      layer: 'front', offX: 0, offY: 0, artwork, calmVisual: true });
    const frontPixels = image(foreground.canvas);
    const data = rig.views[view];
    const checks = [];
    for (const mouth of Object.keys(data.face.mouth)) checks.push({ category: 'mouth', state: mouth, expression: { eyes: 'neutral', mouth } });
    for (const eyes of Object.keys(data.face.eyes)) for (const gaze of [0, -2, 2]) {
      checks.push({ category: 'eyes', state: eyes, gaze, expression: { eyes, mouth: 'neutral', eyeOffsetX: gaze, eyeOffsetY: gaze, openness: gaze === 0 ? 1 : .4 } });
    }
    checks.push({ category: 'cheeks', state: 'canonical' });
    for (const check of checks) {
      const mask = liveSurface(stage);
      if (check.category === 'cheeks') {
        const shapes = data.parts.filter(part => part.layer === 'body').flatMap(part => part.shapes.slice(3));
        paintShapes(mask.ctx, shapes, paths, palette);
      } else {
        const resolved = resolveRigFace(data.face, check.expression, false);
        if (check.category === 'mouth') paintShapes(mask.ctx, resolved.mouth.entry.shapes, paths, palette);
        else {
          for (const shape of resolved.eyes.entry.shapes) paintShapes(mask.ctx, [shape], paths, palette, rigEyeMatrix(shape, resolved, form.faceRig[view]));
          for (const shape of resolved.eyes.entry.pupil || []) paintShapes(mask.ctx, [shape], paths, palette, rigEyeMatrix(shape, resolved, form.faceRig[view], true));
        }
      }
      faceChecks.push({ outfit: outfit.id, view, dpr, category: check.category, state: check.state,
        gaze: check.gaze, ...overlap(image(mask.canvas), frontPixels) });
    }
    if (dpr === 2) {
      for (const [mouthIndex, mouth] of ['neutral', 'open', 'grin'].entries()) {
        const face = { eyes: mouthIndex === 2 ? 'sparkle' : 'neutral', mouth };
        const sample = source.formArt.resolveArtwork(form, { view, calmVisual: true, appearance, face });
        const cell = liveSurface(stage);
        usagiArtist.action(cell.ctx, { artwork: sample, layer: 'back', view, palette, calmVisual: true });
        source.formArt.drawAppearanceLayer(cell.ctx, appearance, palette, { form, stage, view, layer: 'back', offX: 0, offY: 0, artwork: sample, calmVisual: true });
        usagiArtist.body(cell.ctx, palette, view, sample);
        usagiArtist.face(cell.ctx, palette, face, false, view, form.faceRig, sample);
        source.formArt.drawAppearanceLayer(cell.ctx, appearance, palette, { form, stage, view, layer: 'front', offX: 0, offY: 0, artwork: sample, calmVisual: true });
        usagiArtist.action(cell.ctx, { artwork: sample, layer: 'front', view, palette, calmVisual: true });
        const x = (viewIndex * 3 + mouthIndex) * 180, y = outfitIndex * 378;
        faceContext.fillStyle = '#342d29'; faceContext.font = '13px sans-serif';
        faceContext.fillText(`${outfit.id}`, x + 7, y + 22);
        faceContext.fillText(`${view} / ${mouth}`, x + 7, y + 40);
        faceContext.drawImage(cell.canvas, x - 20, y + 60, 220, 220);
      }
    }
  }
}
save(faceSheet, 'live-face-clearance.png');
fs.writeFileSync(path.join(out, 'face-clearance.json'), JSON.stringify(faceChecks, null, 2));
fs.writeFileSync(path.join(out, 'readiness.json'), JSON.stringify(readiness, null, 2));
console.log(JSON.stringify({ phase: 'face', checks: faceChecks.length,
  overlaps: faceChecks.filter(row => row.pixels16), unavailable: readiness.filter(row => !row.ready) }));

const handChecks = [];
for (const outfit of USAGI_OUTFIT_SETS) for (const view of ['front', 'three-quarter', 'profile', 'back']) {
  const appearance = source.appearance.projectAppearance({ skin: 'usagi', formId: 'usagi', view,
    items: source.wardrobe.PET_APPEARANCE_ITEMS, itemIds: outfit.itemIds, includeLocked: true });
  const artwork = source.formArt.resolveArtwork(form, { view, calmVisual: true, appearance });
  handChecks.push({ outfit: outfit.id, view, deferPortraitForeground: artwork.deferPortraitForeground,
    hands: rig.views[view].parts.filter(part => part.bone.startsWith('hand_')).map(part => ({ bone: part.bone, layer: usagiPartLayer(part, artwork) })) });
}
fs.writeFileSync(path.join(out, 'hand-layer-contract.json'), JSON.stringify(handChecks, null, 2));
const farHandChecks = [];
function liveComposite(artwork, appearance, view, dpr) {
  const stage = source.forms.resolveFormStage('usagi', dpr), { canvas, ctx } = liveSurface(stage);
  const common = { form, stage, view, artwork, calmVisual: true, palette, offX: 0, offY: 0 };
  usagiArtist.action(ctx, { ...common, layer: 'back' });
  source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...common, layer: 'back' });
  usagiArtist.body(ctx, palette, view, artwork);
  usagiArtist.face(ctx, palette, { eyes: 'neutral', mouth: 'neutral' }, false, view, form.faceRig, artwork);
  source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...common, layer: 'front' });
  usagiArtist.action(ctx, { ...common, layer: 'front' });
  const cloth = liveSurface(stage);
  source.formArt.drawAppearanceLayer(cloth.ctx, appearance, palette, { ...common, layer: 'back' });
  source.formArt.drawAppearanceLayer(cloth.ctx, appearance, palette, { ...common, layer: 'front' });
  canvas.clothPixels = image(cloth.canvas);
  return canvas;
}
function fitPortrait(artwork, appearance, view, dpr) {
  const stage = source.forms.resolveFormStage('usagi', dpr, { bleed: 4, cssPerArtPixel: 2 });
  const target = makeCanvas(stage.rasterWidth, stage.rasterHeight), ctx = target.getContext('2d');
  const body = makeCanvas(Math.round(stage.bodySize * stage.deviceScale));
  const face = makeCanvas(body.width), fitBounds = source.formArt.resolvePortraitBounds(form, appearance);
  const common = { form, stage, view, fit: true, fitBounds, artwork, calmVisual: true };
  ctx.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  const [offX, offY] = [stage.bodyOrigin.x, stage.bodyOrigin.y];
  source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...common, offX, offY, layer: 'back' });
  target.rearGarmentPixels = image(target);
  source.formArt.paintBodySprite(body, { ...common, palette, tone: 'normal' });
  ctx.drawImage(body, offX, offY, stage.bodySize, stage.bodySize);
  source.formArt.paintFaceSprite(face, { ...common, palette, face: { eyes: 'neutral', mouth: 'neutral' }, blinking: false });
  ctx.drawImage(face, offX, offY, stage.bodySize, stage.bodySize);
  source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...common, offX, offY, layer: 'front' });
  return target;
}
for (const outfit of USAGI_OUTFIT_SETS) for (const view of ['three-quarter', 'profile', 'back']) for (const dpr of [1, 1.25, 2]) {
  const appearance = source.appearance.projectAppearance({ skin: 'usagi', formId: 'usagi', view,
    items: source.wardrobe.PET_APPEARANCE_ITEMS, itemIds: outfit.itemIds, includeLocked: true });
  const artwork = source.formArt.resolveArtwork(form, { view, calmVisual: true, appearance });
  const data = rig.views[view];
  const farParts = data.parts.filter(part => part.bone.startsWith('hand_') && usagiPartLayer(part, artwork) === 'back');
  const withoutFar = { ...artwork, rig: { ...rig, views: { ...rig.views, [view]: { ...data,
    parts: data.parts.filter(part => !farParts.includes(part)) } } } };
  const actual = fitPortrait(artwork, appearance, view, dpr), omitted = fitPortrait(withoutFar, appearance, view, dpr);
  const result = compare(image(actual), image(omitted));
  const actualPixels = image(actual), omittedPixels = image(omitted);
  result.rearClothOverlap16 = 0; result.rearClothOverlap128 = 0; result.rearClothOverlap255 = 0;
  const changedBounds = [actual.width, actual.height, -1, -1];
  for (let i = 0; i < actualPixels.data.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(actualPixels.data[i + c] - omittedPixels.data[i + c])));
    if (delta < 16) continue;
    const x = i / 4 % actual.width, y = Math.floor(i / 4 / actual.width);
    changedBounds[0] = Math.min(changedBounds[0], x); changedBounds[1] = Math.min(changedBounds[1], y);
    changedBounds[2] = Math.max(changedBounds[2], x); changedBounds[3] = Math.max(changedBounds[3], y);
    result.rearClothOverlap16 += Number(actual.rearGarmentPixels.data[i + 3] >= 16);
    result.rearClothOverlap128 += Number(actual.rearGarmentPixels.data[i + 3] >= 128);
    result.rearClothOverlap255 += Number(actual.rearGarmentPixels.data[i + 3] === 255);
  }
  result.changedBounds = changedBounds;
  const live = liveComposite(artwork, appearance, view, dpr), noFarLive = liveComposite(withoutFar, appearance, view, dpr);
  const livePixels = image(live), noFarLivePixels = image(noFarLive);
  result.liveComposite = compare(livePixels, noFarLivePixels);
  result.liveComposite.opaqueClothInfluencePixels = 0;
  for (let i = 0; i < livePixels.data.length; i += 4) {
    if (live.clothPixels.data[i + 3] !== 255) continue;
    if ([0, 1, 2, 3].some(c => Math.abs(livePixels.data[i + c] - noFarLivePixels.data[i + c]) >= 16)) result.liveComposite.opaqueClothInfluencePixels++;
  }
  farHandChecks.push({ outfit: outfit.id, view, dpr, farBones: farParts.map(part => part.bone), ...result });
  if (result.changedPixels) { save(actual, `${outfit.id}-${view}-dpr${dpr}-with-far.png`); save(omitted, `${outfit.id}-${view}-dpr${dpr}-no-far.png`); }
}
fs.writeFileSync(path.join(out, 'far-hand-pixel-isolation.json'), JSON.stringify(farHandChecks, null, 2));
console.log(JSON.stringify({ phase: 'hand', paintChecks: portraitHandChecks.length,
  incorrectPaintOrder: portraitHandChecks.filter(row => row.hands.some(hand => hand.paints !== 1 || !hand.onlyOnFinalCanvas || !hand.afterLastImage)),
  farHandComparisons: farHandChecks.length,
  liveOpaqueClothFailures: farHandChecks.filter(row => row.liveComposite.opaqueClothInfluencePixels) }));
const gestureSheet = makeCanvas(1800, 780), gestureContext = gestureSheet.getContext('2d'), gestureRecords = [];
gestureContext.fillStyle = '#f5f2eb'; gestureContext.fillRect(0, 0, 1800, 780);
for (const [outfitIndex, outfit] of USAGI_OUTFIT_SETS.entries()) for (const [viewIndex, view] of ['front', 'three-quarter', 'profile'].entries()) {
  for (const [poseIndex, [action, calm]] of [['umbrella-dance', false], ['stretch', false], ['stretch', true]].entries()) {
    const harness = createRenderHarness(source, { skin: 'usagi', outfit: outfit.itemIds, view, dpr: 2, blink: false, calm });
    const selection = harness.select('action', action);
    harness.draw(selection.duration * .25);
    const x = (viewIndex * 3 + poseIndex) * 200, y = outfitIndex * 260;
    gestureContext.fillStyle = '#342d29'; gestureContext.font = '12px sans-serif';
    gestureContext.fillText(`${outfit.id} / ${view}`, x + 8, y + 18);
    gestureContext.fillText(`${action} ${calm ? 'reduced motion' : '25%'}`, x + 8, y + 36);
    gestureContext.drawImage(harness.body, x - 10, y + 37, 220, 220);
    gestureRecords.push({ outfit: outfit.id, view, action, calm, progress: .25 });
    harness.dispose();
  }
}
save(gestureSheet, 'forced-view-gestures.png');
fs.writeFileSync(path.join(out, 'gesture-samples.json'), JSON.stringify(gestureRecords, null, 2));
const summary = { renderer: 'Native Skia Canvas using actual production form/rig/popover painters',
  limitation: 'No Electron, browser, native window, GPU, or desktop visual acceptance',
  portraitComparisons: portraitComparisons.length, portraitMismatches: portraitComparisons.filter(row => row.changedPixels !== 0),
  faceChecks: faceChecks.length, faceOverlaps: faceChecks.filter(row => row.pixels16),
  faceScope: 'All 9 mouth states, 16 eye states at 3 gaze/openness configurations, canonical cheek shapes; full outfits; 3 visible views; DPR 1/1.25/2; reduced motion. Only front garment pixels count as occluders.',
  portraitHandPaintChecks: portraitHandChecks.length,
  incorrectHandPaintOrder: portraitHandChecks.filter(row => row.hands.some(hand => hand.paints !== 1 || !hand.onlyOnFinalCanvas || !hand.afterLastImage)),
  farHandComparisons: farHandChecks.length,
  liveOpaqueClothFailures: farHandChecks.filter(row => row.liveComposite.opaqueClothInfluencePixels),
  nonFrontFitFarHandDifferences: farHandChecks.filter(row => row.changedPixels),
  nonFrontFitScope: 'Extra diagnostic only: actual popover is front-only. Fit caches bundle rear hands after rear garments; live production order paints rear hands before rear garments. Residual silhouette pixels outside opaque cloth are not failures.',
  gestureSamples: gestureRecords.length,
  readinessFailures: readiness.filter(row => !row.ready) };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
