// Limb detectors (pixels, production renderer via the gallery harness).
//   gap   – silhouette outline gaps in the limb band: boundary pixels of the
//           composed body (alpha edge) with no outline ink within 2 px.
//           Reported as the largest connected gap (px) per action.
//   jump  – limb-band temporal spike: a frame whose pixel change vs both
//           neighbours is far above the local motion level (reported as a
//           warning: whole-body motion such as workout push-ups also trips it).
// node tools/limb-check/pixels.mjs [--ids=a,b] [--skins=usagi,pink] [--out=file]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const PIXEL_THRESHOLDS = Object.freeze({ maxGap: 18, spikeRatio: 3, spikeMin: 260, fps: 30, band: [.36, .78] });

export async function scanLimbPixels(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), { ids = null, skins = ['usagi'], thresholds = PIXEL_THRESHOLDS, canvasPackage = process.env.USAGI_CANVAS_PACKAGE || '@napi-rs/canvas' } = {}) {
  const backend = createRequire(root + '/')(canvasPackage);
  const { installOffscreenImages } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/offscreen-images.mjs')).href); installOffscreenImages(backend);
  globalThis.Path2D = backend.Path2D; globalThis.document ||= { createElement: () => backend.createCanvas(1, 1) }; globalThis.window ||= { devicePixelRatio: 1 };
  const { loadSource, createRenderHarness } = await import(pathToFileURL(path.join(root, 'tools/usagi-gallery/runtime-harness.mjs')).href);
  const { PET_ACTIONS } = await import(pathToFileURL(path.join(root, 'src/content/behaviors.mjs')).href);
  const source = await loadSource(pathToFileURL(root).href);
  const report = { thresholds, actions: {}, failures: [] };
  for (const skin of skins) {
    const h = createRenderHarness(source, { skin, view: 'auto', dpr: 1, blink: false, outfit: [] });
    for (const id of Object.keys(PET_ACTIONS).filter(id => !ids || ids.includes(id))) {
      let d; try { d = h.select('action', id).duration; } catch { continue; }
      const W = h.body.width, H = h.body.height, y0 = Math.floor(H * thresholds.band[0]), y1 = Math.floor(H * thresholds.band[1]);
      let prev = null; const diffs = []; let maxGap = 0, gapAt = 0;
      for (let t = 0; t <= d; t += 1000 / thresholds.fps) {
        h.draw(t);
        const px = h.body.getContext('2d').getImageData(0, y0, W, y1 - y0).data, rows = y1 - y0;
        // The renderer may hold a frame across clock ticks; compare distinct frames only.
        if (prev) { let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i + 3] - prev[i + 3]) > 96 || Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]) > 180) n++;
          if (n < 8) continue; diffs.push([t, n]); }
        prev = px;
        // outline gap scan
        const A = (x, y) => px[(y * W + x) * 4 + 3];
        const ink = (x, y) => { const i = (y * W + x) * 4; return px[i + 3] > 128 && px[i] + px[i + 1] + px[i + 2] < 330; };
        const gap = new Uint8Array(W * rows);
        for (let y = 3; y < rows - 3; y++) for (let x = 3; x < W - 3; x++) {
          if (A(x, y) < 160) continue;
          if (!(A(x - 1, y) < 16 || A(x + 1, y) < 16 || A(x, y - 1) < 16 || A(x, y + 1) < 16)) continue;
          let found = false;
          for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2 && !found; dx++) found = ink(x + dx, y + dy);
          if (!found) gap[y * W + x] = 1;
        }
        // largest 8-connected gap cluster
        const seen = new Uint8Array(W * rows);
        for (let i = 0; i < gap.length; i++) if (gap[i] && !seen[i]) {
          let size = 0; const stack = [i]; seen[i] = 1;
          while (stack.length) { const j = stack.pop(); size++; const x = j % W, y = (j / W) | 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (y + dy) * W + x + dx; if (k >= 0 && k < gap.length && gap[k] && !seen[k]) { seen[k] = 1; stack.push(k); } } }
          if (size > maxGap) { maxGap = size; gapAt = t; }
        }
      }
      let spikes = 0, worst = 0;
      // A pop is a frame change far above both its neighbours AND the action's
      // typical (median) frame change, so steady fast motion never counts.
      const sorted = diffs.map(v => v[1]).sort((a, b) => a - b), median = sorted[sorted.length >> 1] || 1;
      for (let i = 1; i < diffs.length - 1; i++) {
        const n = diffs[i][1], local = Math.max(diffs[i - 1][1], diffs[i + 1][1], 1);
        if (n > thresholds.spikeMin && n > local * thresholds.spikeRatio && n > median * thresholds.spikeRatio * 2) { spikes++; worst = Math.max(worst, n); (report.warnings ||= []).push(`${skin}:${id} limb-band spike ${n}px @${diffs[i][0] | 0}ms`); }
      }
      if (maxGap > thresholds.maxGap) report.failures.push(`${skin}:${id} outline gap ${maxGap}px @${gapAt | 0}ms`);
      report.actions[`${skin}:${id}`] = { maxGap, gapAt: gapAt | 0, spikes, worst };
    }
    h.dispose();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const r = await scanLimbPixels(opt('root') || undefined, { ids: opt('ids')?.split(','), skins: (opt('skins') || 'usagi').split(',') });
  console.log(`limb pixels: ${Object.keys(r.actions).length} actions, ${r.failures.length} failures, ${(r.warnings || []).length} spike warnings`);
  for (const f of r.failures.slice(0, 40)) console.log('  ' + f);
  if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(r, null, 1));
  process.exitCode = r.failures.length ? 1 : 0;
}
