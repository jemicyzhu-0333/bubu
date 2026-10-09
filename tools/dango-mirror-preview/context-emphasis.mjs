// Actual production-renderer evidence at native body scale and2x; no native OS claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness, loadSource } from '../usagi-gallery/runtime-harness.mjs';
import { pixels } from '../usagi-gallery/pixels.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = createRequire(import.meta.url)(arg('canvas-package') || process.env.DANGO_CANVAS_PACKAGE);
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-context-emphasis'));
fs.mkdirSync(out, { recursive: true });
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
source.sessions = { ...source.sessions, SESSION_ACTIVITIES: { ...source.sessions.SESSION_ACTIVITIES, ...source.sessions.MIRROR_ACTIVITIES } };
const common = ['milestone.sunhat', 'milestone.scarf', 'milestone.boots'];
const outfits = { bare: [], dressed: common, demanding: [...common, 'milestone.cape', 'milestone.satchel'] };
const report = { method: 'Production createPetRenderer via image-backed offscreen harness',
  dimensions: '146art stage,219CSS square;99CSS body design width at1x,198CSS at2x',
  limitations: ['No native desktop/OS/GPU or private event probe evidence', 'Bounded snapshots; semantic continuity reviewed separately', 'Independent DOM badge not included in body canvas'], cases: [] };
const sheets = {};
for (const [theme, color] of Object.entries({ light: '#f4f1e8', dark: '#202634' })) {
  const canvas = backend.createCanvas(219 * 4, 260 * 6), context = canvas.getContext('2d');
  context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
  sheets[theme] = { canvas, context };
}
let index = 0;
for (const id of ['mirror-music', 'mirror-ai']) for (const view of ['front', 'three-quarter']) for (const [outfitName, outfit] of Object.entries(outfits)) {
  const name = `${id}-${view}-${outfitName}`;
  const proof = backend.createCanvas(1314, 490), ctx = proof.getContext('2d');
  const record = { id, view, outfitName, outfit, frames: [], calm: [] };
  for (const dpr of [1, 2]) {
    const driver = createRenderHarness(source, { skin: 'pink', view, outfit, blink: false, dpr });
    driver.select('session', id); driver.draw(0);
    const duration = source.sessions.MIRROR_ACTIVITIES[id].durationMs;
    for (const phase of [0, .05, .125, .25, .5, .75, .95, .999, 1, 1.001]) {
      driver.draw(phase * duration); const sampled = pixels(driver.body);
      assert.ok(sampled.occupied > 0); assert.equal(sampled.edge, 0, name);
      if (id === 'mirror-ai') {
        const data = sampled.image, sideStart = Math.floor(169 * dpr);
        let robotPixels = 0;
        for (let y = Math.floor(110 * dpr); y < Math.floor(165 * dpr); y++) for (let x = sideStart; x < Math.floor(210 * dpr); x++) {
          if (data.data[(y * data.width + x) * 4 + 3] > 15) robotPixels++;
        }
        assert.ok(robotPixels > 100 * dpr * dpr, `${name} lacks right-side robot`);
      }
      record.frames.push({ dpr, phase, bounds: sampled.bounds, hash: sampled.hash });
    }
    driver.draw(.125 * duration);
    const bytes = driver.body.toBuffer('image/png'); fs.writeFileSync(path.join(out, `${name}-${dpr}x.png`), bytes);
    const left = dpr === 1 ? createRenderHarness(source, { skin: 'pink', view, outfit, blink: false, dpr, facing: -1 }) : null;
    if (left) {
      left.select('session', id); left.draw(0); left.draw(.125 * duration);
      const sampled = pixels(left.body); assert.ok(sampled.occupied > 0); assert.equal(sampled.edge, 0);
      record.leftFacing = { hash: sampled.hash, bounds: sampled.bounds, rendererFacing: -1 };
      fs.writeFileSync(path.join(out, `${name}-left-1x.png`), left.body.toBuffer('image/png'));
    }
    for (const [theme, color] of Object.entries({ light: '#f4f1e8', dark: '#202634' })) {
      const base = theme === 'light' ? 0 : 657, x = base + (dpr === 1 ? 0 : 219);
      ctx.fillStyle = color; ctx.fillRect(x, 0, 219 * dpr, 490);
      ctx.fillStyle = theme === 'light' ? '#334044' : '#e5eaf1'; ctx.font = '13px sans-serif';
      ctx.fillText(`${name} | ${dpr}x`, x + 5, 21);
      ctx.drawImage(driver.body, x, 36, 219 * dpr, 219 * dpr);
      if (dpr === 1) for (const facing of [1, -1]) {
        const sheet = sheets[theme], column = index % 2 * 2 + (facing === 1 ? 0 : 1), row = Math.floor(index / 2);
        sheet.context.fillStyle = theme === 'light' ? '#334044' : '#e5eaf1'; sheet.context.font = '10px sans-serif';
        sheet.context.fillText(`${name} ${facing === 1 ? 'right' : 'left'}`, column * 219 + 4, row * 260 + 18);
        sheet.context.drawImage(facing === -1 ? left.body : driver.body, column * 219, row * 260 + 24, 219, 219);
      }
    }
    left?.dispose(); driver.dispose();
    const calm = createRenderHarness(source, { skin: 'pink', view, outfit, blink: false, dpr, calm: true });
    calm.select('session', id); calm.draw(.03 * duration); const a = pixels(calm.body); calm.draw(.91 * duration); const b = pixels(calm.body);
    assert.equal(a.hash, b.hash, name); record.calm.push({ dpr, stable: true, bounds: b.bounds }); calm.dispose();
  }
  fs.writeFileSync(path.join(out, `${name}-light-dark-native-2x.png`), proof.toBuffer('image/png'));
  report.cases.push(record); index++;
}
for (const [theme, { canvas }] of Object.entries(sheets)) fs.writeFileSync(path.join(out, `native-overview-${theme}.png`), canvas.toBuffer('image/png'));
fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, cases: report.cases.length, sampledFrames: report.cases.reduce((n, item) => n + item.frames.length, 0), calmStable: report.cases.every(item => item.calm.every(value => value.stable)) }));
