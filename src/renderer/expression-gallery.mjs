import * as content from '../content/expressions.mjs';
import * as expressionEngine from '../core/pet-expression.mjs';
import * as art from '../core/pet-art.mjs';
import * as galleryEngine from '../core/pet-gallery.mjs';
import { forms, formArt } from '../capabilities/companion/index.mjs';

'use strict';

const galleryDebug = (() => {

const captureStatic = new URLSearchParams(window.location.search).get('capture') === 'static';

if (!content || !expressionEngine || !forms || !formArt || !art || !galleryEngine) {
  throw new Error('expression gallery dependencies are incomplete');
}

const registry = expressionEngine.createExpressionRegistry(content.EXPRESSIONS);
if (registry.errors.length > 0 || registry.size !== content.EXPECTED_TOTAL) {
  throw new Error(`expression registry invalid: ${registry.errors.join('; ')}`);
}

const form = forms.resolvePetForm('pink');
const stage = forms.resolveFormStage('pink', window.devicePixelRatio || 1);
const palette = formArt.paletteForSkin('pink', form);
const bounds = formArt.spriteBounds(form, stage);
const controller = galleryEngine.createController(content.EXPECTED_EXPRESSION_IDS);
const cards = new Map();
const bodySurfaces = new Map();

function bodySurface(bodyTone, artwork) {
  const key = formArt.bodySpriteKey(form, 'pink', bodyTone, 'front', false, artwork);
  if (bodySurfaces.has(key)) return bodySurfaces.get(key);
  const surface = document.createElement('canvas');
  surface.width = Math.round(bounds.width * stage.deviceScale);
  surface.height = Math.round(bounds.height * stage.deviceScale);
  formArt.paintBodySprite(surface, { form, palette, tone: bodyTone, stage, view: 'front', artwork });
  bodySurfaces.set(key, surface);
  return surface;
}

function staticPose(config) {
  return {
    face: {
      eyes: config.static.face.eyes,
      mouth: config.static.face.mouth,
      eyeOffsetX: config.face.eyeOffsetX,
      eyeOffsetY: config.face.eyeOffsetY,
      eyeInsetX: config.face.eyeInsetX,
      openness: config.face.openness
    },
    body: config.static.body
  };
}

function paintCard(card, at) {
  const state = controller.snapshot(card.id, at);
  const config = registry.get(card.id);
  const pose = state.static
    ? staticPose(config)
    : expressionEngine.sampleExpressionPose(registry, card.id, state.elapsedMs);
  const context = card.canvas.getContext('2d');
  const body = pose.body;
  const face = pose.face;
  const artwork = formArt.resolveArtwork(form, { view: 'front', motion: 'idle', face,
    expressionId: card.id, accent: config.accent, expressionElapsedMs: state.elapsedMs, elapsedMs: state.elapsedMs,
    calmVisual: state.static, channel: `expression-gallery:${card.id}` });
  context.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  context.clearRect(0, 0, stage.artWidth, stage.artHeight);
  context.save();
  art.applyBodyPose(context, body, stage.artWidth);
  const actionOptions = { form, action: null, motion: 'idle', progress: 0, palette,
    offX: stage.bodyOrigin.x, offY: stage.bodyOrigin.y, view: 'front', stage,
    calmVisual: state.static, artwork };
  formArt.drawActionLayer(context, { ...actionOptions, layer: 'back' });
  const surface = bodySurface(body.tone, artwork);
  context.drawImage(surface, stage.bodyOrigin.x + bounds.x, stage.bodyOrigin.y + bounds.y, bounds.width, bounds.height);
  const blinkPeriod = Math.max(800, config.blink.minMs);
  const blinking = !state.static && state.elapsedMs > config.enter.durationMs
    && state.elapsedMs % blinkPeriod < 100;
  formArt.drawFace(context, { form, palette, face, blinking, stage, view: 'front', artwork,
    offX: stage.bodyOrigin.x, offY: stage.bodyOrigin.y });
  formArt.drawActionLayer(context, { ...actionOptions, layer: 'front' });
  context.restore();
  formArt.drawExpressionAccent(context, form, config.accent, state.elapsedMs, {
    offX: stage.bodyOrigin.x,
    offY: stage.bodyOrigin.y,
    calmVisual: state.static, stage
  });
  card.element.dataset.mode = state.static ? 'static' : 'playing';
  card.mode.textContent = state.static ? '静态' : '播放';
  return Boolean(artwork) && artwork.ready !== false;
}

function addCard(config) {
  const element = document.createElement('article');
  element.className = 'expression-card';
  element.dataset.expressionId = config.id;

  const canvas = document.createElement('canvas');
  canvas.width = stage.rasterWidth;
  canvas.height = stage.rasterHeight;
  canvas.style.width = `${stage.cssWidth}px`;
  canvas.style.height = `${stage.cssHeight}px`;
  canvas.style.imageRendering = 'auto';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${config.id}：${config.label}`);

  const id = document.createElement('div');
  id.className = 'expression-id';
  id.textContent = config.id;
  const label = document.createElement('div');
  label.className = 'expression-label';
  label.textContent = config.label;
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const play = document.createElement('button');
  play.type = 'button';
  play.dataset.action = 'play';
  play.textContent = '重新播放';
  const freeze = document.createElement('button');
  freeze.type = 'button';
  freeze.dataset.action = 'static';
  freeze.textContent = '静态停帧';
  const mode = document.createElement('span');
  mode.className = 'mode';
  mode.setAttribute('aria-live', 'polite');
  actions.append(play, freeze, mode);
  element.append(canvas, id, label, actions);
  document.querySelector('#gallery').appendChild(element);

  const card = { id: config.id, element, canvas, mode };
  cards.set(config.id, card);
  play.addEventListener('click', () => controller.play(config.id));
  freeze.addEventListener('click', () => controller.freeze(config.id));
}

for (const config of content.EXPRESSIONS) addCard(config);

document.querySelector('#playAll').addEventListener('click', () => controller.playAll());
document.querySelector('#staticAll').addEventListener('click', () => controller.freezeAll());

let lastPaintAt = 0;
function paintAll(at) {
  lastPaintAt = at;
  let ready = true;
  for (const card of cards.values()) ready = paintCard(card, at) && ready;
  if (ready) document.documentElement.dataset.galleryReady = 'true';
  else document.documentElement.dataset.galleryReady = 'false';
}

const unsubscribeArtwork = formArt.subscribeArtwork(form, () => {
  bodySurfaces.clear();
  // Static capture has no animation loop. Asset settlements must repaint it
  // too, or a cached loading frame could masquerade as the finished gallery.
  if (captureStatic) paintAll(lastPaintAt);
});
window.addEventListener('pagehide', () => { unsubscribeArtwork(); bodySurfaces.clear(); }, { once: true });

async function rasterizeAll() {
  if (document.documentElement.dataset.galleryReady !== 'true') throw new Error('expression artwork is still loading');
  await Promise.all([...cards.values()].map(card => {
    if (card.captureImage) return Promise.resolve();
    const image = document.createElement('img');
    image.className = 'expression-capture';
    image.width = card.canvas.width;
    image.height = card.canvas.height;
    image.style.width = card.canvas.style.width;
    image.style.height = card.canvas.style.height;
    image.alt = card.canvas.getAttribute('aria-label') || card.id;
    card.captureImage = image;
    return new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error(`capture image failed: ${card.id}`)), { once: true });
      image.src = card.canvas.toDataURL('image/png');
      card.canvas.replaceWith(image);
    });
  }));
  return cards.size;
}

function render(at) {
  paintAll(at);
  window.requestAnimationFrame(render);
}
if (captureStatic) {
  // Deterministic one-frame mode for headless evidence capture. It keeps the gallery
  // completely local and avoids an infinite rAF loop in constrained CI browsers.
  controller.freezeAll(0);
  paintAll(0);
} else {
  window.requestAnimationFrame(render);
}

// 只读开发诊断面，便于自动化确认 32 张卡和逐卡状态；不连接 preload/IPC。
return Object.freeze({
  ids: () => [...cards.keys()],
  snapshot: (id, at) => controller.snapshot(id, at),
  play: (id, at) => controller.play(id, at),
  freeze: (id, at) => controller.freeze(id, at),
  repaint: at => {
    paintAll(Number.isFinite(at) ? at : 0);
    return cards.size;
  },
  rasterize: () => rasterizeAll()
});
})();

export { galleryDebug };
