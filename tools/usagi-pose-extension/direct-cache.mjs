import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource } from '../usagi-gallery/runtime-harness.mjs';
const [root, output] = process.argv.slice(2);
const backend = createRequire(import.meta.url)('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement() { return backend.createCanvas(1, 1); } }; globalThis.window = { devicePixelRatio: 2 };
const load = file => import(pathToFileURL(path.join(root, file)).href);
const source = await loadSource(pathToFileURL(root).href);
const { default: artist } = await load('src/capabilities/companion/presentation/usagi-art.mjs');
const { USAGI_OUTFIT_SETS } = await load('src/content/companion/usagi-wardrobe.mjs');
const { projectAppearance } = await load('src/core/pet-appearance.mjs');
const form = source.forms.resolvePetForm('usagi'), palette = source.formArt.paletteForSkin('usagi', form), results = [];
fs.mkdirSync(output, { recursive: true });
for (const [id, requestedView, outfit] of [['wave', 'front', 'sun-garden'], ['stretch', 'profile', 'rain-walk'],
  ['read-book', 'front', 'moon-post'], ['sip-tea', 'profile', 'bare']]) for (const dpr of [1, 2]) {
  const action = source.behaviors.PET_ACTIONS[id], progress = .5;
  const view = source.formArt.resolveView(form, requestedView, { action, state: 'idle' });
  const stage = source.forms.resolveFormStage('usagi', dpr);
  const appearance = projectAppearance({ skin: 'usagi', formId: 'usagi', level: 25, view,
    itemIds: outfit === 'bare' ? [] : USAGI_OUTFIT_SETS.find(set => set.id === outfit).itemIds, includeLocked: true });
  const baseFace = source.formArt.faceForView(form, source.expressions.EXPRESSIONS.find(e => e.id === action.expression).face, view);
  const artwork = artist.resolveArtwork({ action, view, motion: action.motion, progress, face: baseFace,
    expressionId: action.expression, appearance });
  const face = artwork.face || baseFace;
  const options = { form, action, motion: action.motion, progress, palette, view, stage, artwork, offX: 40, offY: 40, calmVisual: false };
  const pair = [];
  for (const cached of [false, true]) {
    const canvas = backend.createCanvas(stage.rasterWidth, stage.rasterHeight), ctx = canvas.getContext('2d');
    ctx.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
    source.formArt.drawActionLayer(ctx, { ...options, layer: 'back' });
    source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...options, layer: 'back' });
    if (cached) {
      const bounds = source.formArt.spriteBounds(form, stage);
      const sprite = backend.createCanvas(Math.round(bounds.width * stage.deviceScale), Math.round(bounds.height * stage.deviceScale));
      source.formArt.paintBodySprite(sprite, { form, palette, stage, view, artwork });
      source.formArt.drawBodySprite(ctx, sprite, { ...options, bounds });
    } else {
      ctx.save(); ctx.translate(40, 40); artist.body(ctx, palette, view, artwork); ctx.restore();
    }
    source.formArt.drawFace(ctx, { ...options, face, blinking: false });
    source.formArt.drawAppearanceLayer(ctx, appearance, palette, { ...options, layer: 'front' });
    source.formArt.drawActionLayer(ctx, { ...options, layer: 'front' });
    pair.push(canvas);
  }
  const pixels = pair.map(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
  let changedPixels = 0, maxDelta = 0;
  for (let i = 0; i < pixels[0].length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) { const delta = Math.abs(pixels[0][i + c] - pixels[1][i + c]); maxDelta = Math.max(maxDelta, delta); changed ||= delta > 0; }
    changedPixels += changed;
  }
  const size = pair[0].width, sheet = backend.createCanvas(size * 2, size + 50), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e8eeee'; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.fillStyle = '#18323c'; ctx.font = '15px sans-serif';
  ctx.fillText('Direct artist', 6, 18); ctx.fillText('Cached body', size + 6, 18);
  ctx.font = '12px sans-serif'; ctx.fillText(`${id} · ${view} · ${outfit} · ${dpr}×`, 6, 39);
  for (const [i, canvas] of pair.entries()) ctx.drawImage(await backend.loadImage(canvas.toBuffer('image/png')), i * size, 50);
  const file = `${id}-${view}-${outfit}-${dpr}x.png`; fs.writeFileSync(path.join(output, file), sheet.toBuffer('image/png'));
  results.push({ id, requestedView, effectiveView: view, outfit, dpr, file, changedPixels, maxDelta });
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ root,
  scope: 'Direct artist versus cached-body composition at identical rig pose; geometry diagnostic without whole-body playback/scene/effects; actual production playback is separate', results }, null, 2) + '\n');
console.log(JSON.stringify(results));
