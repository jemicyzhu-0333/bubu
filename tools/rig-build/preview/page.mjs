import { validateRig, RIG_VIEWS } from '/src/capabilities/companion/presentation/rig/schema.mjs';
import { createRigArtist } from '/src/capabilities/companion/presentation/rig/rig-art.mjs';
import { MOTION_NAMES } from '/src/capabilities/companion/presentation/rig/motions.mjs';
import { EYE_FALLBACKS, MOUTH_FALLBACKS } from '/src/capabilities/companion/presentation/rig/face.mjs';
import vectorArt from '/src/capabilities/companion/presentation/usagi-support.mjs';
import { USAGI_FORM } from '/src/content/companion/usagi-form.mjs';
import { PET_APPEARANCE_ITEMS } from '/src/content/appearance.mjs';

// Draws every view × motion and every face state with the same artist the
// app uses, in the same order as the pet renderer: action back, accessories
// back, body, face, accessories front, action front.
const $ = id => document.getElementById(id);
const SCALE = 1.4;
const PALETTE = { 1: '#473b40', 2: '#fff2dc', 3: '#ebd6be', 4: '#342b34' };
const artist = createRigArtist({ fallback: vectorArt });
const outfit = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'usagi');
const bounds = USAGI_FORM.artBounds;
const cells = [];
const gaze = { x: 0, y: 0 };

function makeCanvas() {
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * SCALE * ratio);
  canvas.height = Math.round(bounds.height * SCALE * ratio);
  canvas.style.width = `${bounds.width * SCALE}px`;
  canvas.style.height = `${bounds.height * SCALE}px`;
  canvas.addEventListener('mousemove', event => {
    const box = canvas.getBoundingClientRect();
    gaze.x = ((event.clientX - box.left) / box.width - 0.5) * 4;
    gaze.y = ((event.clientY - box.top) / box.height - 0.4) * 4;
  });
  return canvas;
}

function paint(cell, rig, now) {
  const { canvas, view, motion, eyes = 'neutral', mouth = 'neutral' } = cell;
  const ctx = canvas.getContext('2d');
  const ratio = canvas.width / (bounds.width * SCALE);
  const calmVisual = $('calm').checked;
  const blinking = $('blink').checked && !cell.eyes && (now % 3000) < 140;
  const face = { eyes, mouth, eyeOffsetX: gaze.x, eyeOffsetY: gaze.y, openness: 1 };
  const progress = (now % 2400) / 2400;
  const artwork = artist.resolve(rig, { view, motion, face, calmVisual, progress, elapsedMs: now,
    channel: `preview:${view}:${motion}:${eyes}:${mouth}` });
  ctx.setTransform(ratio * SCALE, 0, 0, ratio * SCALE, -bounds.x * ratio * SCALE, -bounds.y * ratio * SCALE);
  ctx.clearRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const items = $('outfit').checked ? outfit : [];
  const accessories = layer => {
    for (const item of items) {
      if (item.parts.includes(layer)) artist.appearance(ctx, { item, layer, palette: PALETTE, form: USAGI_FORM,
        view, calmVisual, elapsedMs: now, artwork });
    }
  };
  const action = layer => artist.action(ctx, { motion: motion === 'idle' ? null : motion, progress, layer,
    form: USAGI_FORM, palette: PALETTE, view, calmVisual, artwork });
  action('back');
  accessories('back');
  artist.body(ctx, PALETTE, view, artwork);
  if (view !== 'back') artist.face(ctx, PALETTE, face, blinking, view, USAGI_FORM.faceRig, artwork);
  accessories('front');
  action('front');
}

function buildTables(rig) {
  const motions = $('motions');
  motions.innerHTML = '';
  cells.length = 0;
  const head = motions.insertRow();
  head.insertCell().outerHTML = '<th></th>';
  for (const motion of MOTION_NAMES) head.insertCell().outerHTML = `<th>${motion}</th>`;
  for (const view of RIG_VIEWS) {
    const row = motions.insertRow();
    row.insertCell().outerHTML = `<th>${view}${rig.views[view] ? '' : '（回退）'}</th>`;
    for (const motion of MOTION_NAMES) {
      const canvas = makeCanvas();
      row.insertCell().appendChild(canvas);
      cells.push({ canvas, view, motion });
    }
  }
  const faces = $('faces');
  faces.innerHTML = '';
  const addRow = (label, states, key) => {
    const titles = faces.insertRow();
    titles.insertCell().outerHTML = `<th>${label}</th>`;
    for (const state of states) titles.insertCell().outerHTML = `<th>${state}</th>`;
    const row = faces.insertRow();
    row.insertCell();
    for (const state of states) {
      const canvas = makeCanvas();
      row.insertCell().appendChild(canvas);
      cells.push({ canvas, view: 'front', motion: 'idle', [key]: state });
    }
  };
  addRow('眼睛', Object.keys(EYE_FALLBACKS), 'eyes');
  addRow('嘴', Object.keys(MOUTH_FALLBACKS), 'mouth');
}

async function load() {
  const payload = await (await fetch('/rig.json')).json();
  if (payload.error) {
    $('status').className = 'error';
    $('status').textContent = payload.error;
    return;
  }
  const result = validateRig(payload.rig);
  if (!result.ok) {
    $('status').className = 'error';
    $('status').textContent = result.errors.join('\n');
    return;
  }
  $('source').textContent = `${payload.source} · ${result.rig.id}@${result.rig.version}`;
  $('status').textContent = payload.warnings.length ? payload.warnings.join('\n') : '';
  buildTables(result.rig);
  const frame = now => {
    for (const cell of cells) paint(cell, result.rig, now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

load();
