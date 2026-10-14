#!/usr/bin/env node
// Reproduce the reviewed front-hiccup slice using the actual standard artist.
// Only an in-memory manifest copy is enabled. No asset/package flags are written.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { createDangoRasterArtist } from '../../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { PALETTES } from '../../src/core/pet-art.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') throw Error('Usage: node tools/dango-contact-review/render-hiccup.mjs --out <directory>');
const out = path.resolve(args[1]);
const packageUrl = new URL('../../assets/companion/dango/raster/action-contact/hiccup-front-v1/', import.meta.url);
const frames = JSON.parse(fs.readFileSync(new URL('frames.json', packageUrl))).frames;
const keys = ['hiccup-front-contact-left', 'hiccup-front-contact-right'];
const legacyManifest = structuredClone(DANGO_RASTER);
for (const sprite of Object.values(legacyManifest.tools)) {
  if (sprite.sourceContactPose?.id === 'sip-front-short-v1') sprite.sourceContactPose.runtimeReady = false;
}
const enabled = structuredClone(legacyManifest);
for (const key of keys) {
  assert.equal(DANGO_RASTER.tools[key].sourceContactPose.runtimeReady, false, 'Review must not activate the checked-in contract');
  enabled.tools[key].sourceContactPose.runtimeReady = true;
}
const make = async manifest => {
  const artist = createDangoRasterArtist({ manifest, createSurface: createCanvas, loadImage: u => loadImage(fileURLToPath(u)) });
  await artist.ready({ all: true });
  return artist;
};
const baseline = await make(legacyManifest), standard = await make(enabled);
const referenceImages = {}, fingerprints = {};
for (const frame of frames) {
  const bytes = fs.readFileSync(new URL(frame.src, packageUrl));
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, frame.sha256, 'Reviewed logical source fingerprint changed');
  fingerprints[frame.side] = hash;
  referenceImages[frame.side] = await loadImage(bytes);
}
const action = PET_ACTIONS.hiccup;
const options = p => ({ action, motion: action.motion, view: 'front', progress: p, elapsedMs: p * action.duration,
  channel: 'contact-review', actionInstanceKey: 'hiccup-review-1' });
function referenceArtwork(p) {
  const art = baseline.resolveArtwork(options(p));
  return { ...art, contact: { ...art.contact, hands: art.contact.hands.map(hand => ({ ...hand, limb: true })) },
    limbPainter: { paint(context, { hand, layer, covered }) {
      if (layer === 'front' && !covered) {
        context.save(); context.imageSmoothingEnabled = false; context.globalAlpha *= hand.opacity ?? 1;
        context.drawImage(referenceImages[hand.side], 0, 0); context.restore();
      }
      return true;
    } } };
}
function canvas(w, h, background = true) {
  const c = createCanvas(w, h);
  if (background) { const x = c.getContext('2d'); x.fillStyle = '#eeeae4'; x.fillRect(0, 0, w, h); }
  return c;
}
function paint(target, artist, p, artwork, x = 0, y = 0, scale = 1) {
  const ctx = target.getContext('2d');
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  artist.applyMotionTransform(ctx, action.motion, p, { action, bodySize: 66, size: 146, translate: (a, b) => ctx.translate(a, b) });
  const off = artist.motionOffset(action.motion, p, false, { action }); ctx.translate(40 + off.x, 40 + off.y);
  const o = { action, artwork, palette: PALETTES.pink, view: artwork.view, progress: p };
  artist.action(ctx, { ...o, layer: 'back' }); artist.body(ctx, PALETTES.pink, artwork.view, artwork);
  artist.face(ctx, PALETTES.pink, {}, false, artwork.view, null, artwork); artist.action(ctx, { ...o, layer: 'front' }); ctx.restore();
}
const rgba = c => Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
const write = (name, c) => fs.writeFileSync(path.join(out, name), c.toBuffer('image/png'));
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
const report = { contract: 'hiccup-front-v1', productionEnabled: false, backend: 'actual raster artist / offscreen Skia',
  sourceFingerprints: fingerprints, phaseCount: 257, matchingPhases: 0, otherActionCount: 0, otherActionContactSamples: 0,
  endpoints: [0, 1], sourceMode: 'standard pawSprite; independent logical-source reference is test-only' };
try {
  for (let i = 0; i <= 256; i++) {
    const p = i / 256, actual = standard.resolveArtwork(options(p)), old = baseline.resolveArtwork(options(p));
    assert.equal(actual.sourceContactPose, 'hiccup-front-v1'); assert.equal(actual.limbPainter, null);
    assert.ok(actual.contact.hands.every(h => keys.includes(h.pawSprite)));
    assert.deepEqual(actual.contact.tools, old.contact.tools); assert.deepEqual(actual.effectOrigins, old.effectOrigins);
    const a = canvas(292, 292, false), b = canvas(292, 292, false);
    paint(a, standard, p, actual, 0, 0, 2); paint(b, baseline, p, referenceArtwork(p), 0, 0, 2);
    assert.equal(Buffer.compare(rgba(a), rgba(b)), 0, `Standard/reference pixels differ at ${i}/256`);
    report.matchingPhases++;
    const pair = canvas(584, 330); paint(pair, baseline, p, old, 0, 0, 2); paint(pair, standard, p, actual, 292, 0, 2);
    const ctx = pair.getContext('2d'); ctx.fillStyle = '#222'; ctx.font = '13px sans-serif';
    ctx.fillText(`hiccup ${i}/256 | original`, 8, 315); ctx.fillText('STANDARD SOURCE-CONTACT PREVIEW', 297, 315);
    write(`frames/${String(i).padStart(3, '0')}.png`, pair);
  }
  // Contacts, targets and prop positions of all other actions stay unchanged.
  for (const other of Object.values(PET_ACTIONS)) {
    if (other.id === 'hiccup') continue;
    report.otherActionCount++;
    for (const progress of [0, .5, 1]) {
      const o = { action: other, motion: other.motion, view: 'front', progress, elapsedMs: progress * other.duration, channel: 'other-actions' };
      const a = standard.resolveArtwork(o), b = baseline.resolveArtwork(o);
      assert.equal(a.sourceContactPose, undefined); assert.deepEqual(a.contact, b.contact, `${other.id} p${progress}`);
      report.otherActionContactSamples++;
    }
  }
  const sheet = canvas(876, 176);
  for (const [i, p] of [.25, .5, .85].entries()) for (const v of [0, 1]) {
    const artist = v ? standard : baseline;
    paint(sheet, artist, p, artist.resolveArtwork(options(p)), (i * 2 + v) * 146);
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#222'; ctx.font = '9px sans-serif';
    ctx.fillText(`${p} ${v ? 'standard preview' : 'original'}`, (i * 2 + v) * 146 + 2, 156);
  }
  write('static-before-new-1x.png', sheet);
  const twice = canvas(1752, 352), tx = twice.getContext('2d'); tx.imageSmoothingEnabled = false; tx.drawImage(sheet, 0, 0, 1752, 352); write('static-before-new-2x.png', twice);
  const zoom = canvas(1168, 1168); paint(zoom, standard, .5, standard.resolveArtwork(options(.5)), 0, 0, 8); write('actual-body-8x.png', zoom);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'playback.html'), `<!doctype html><meta charset="utf-8"><title>Front hiccup standard artist review</title>
<style>body{background:#eeeae4;font:14px sans-serif}img{image-rendering:pixelated}button{margin:10px}</style>
<p>Original / standard source-contact preview. 257 sampled frames, 6.5 seconds. Contract remains disabled in checked-in assets.</p>
<button id="toggle">Pause</button><span id="status"></span><br><img id="frame" width="584" height="330" alt="Original and standard artist comparison">
<script>const frames=Array.from({length:257},(_,i)=>{const x=new Image();x.src='frames/'+String(i).padStart(3,'0')+'.png';return x});let running=true,start=performance.now(),last=0;document.querySelector('#toggle').onclick=()=>{running=!running;if(running)start=performance.now()-last/256*6500;document.querySelector('#toggle').textContent=running?'Pause':'Play'};function tick(t){if(running)last=Math.min(256,Math.floor(((t-start)%6500)/6500*257));document.querySelector('#frame').src=frames[last].src;document.querySelector('#status').textContent=last+'/256';requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>`);
  console.log(JSON.stringify(report, null, 2));
} finally { baseline.dispose(); standard.dispose(); }
