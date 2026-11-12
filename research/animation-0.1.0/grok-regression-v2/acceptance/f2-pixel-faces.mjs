// F2 live pixel check (Grok 电脑验收, test tooling only). Reads the x11grab
// recording of one `f2live` run plus its renderer logs and classifies the face
// that is actually on screen, from pixels, in every captured frame:
//  - pet located by its pink body mask; eyes = the two largest dark blobs;
//  - a face patch is resampled in eye coordinates (translation/scale/rotation
//    invariant) and compared with reference patches built from the SAME run's
//    calibration contact (110 DIP/s -> T05, 40 DIP/s -> 01), captured live;
//  - nearest reference wins only with a margin, otherwise 'ambiguous'
//    (crossfades); frames without a pet or two eyes are 'unclassifiable'.
// Capture time and renderer time are both wall-clock based but are aligned only
// through the measured motion onset (the first frame the pet moves vs the first
// logged move); dot measured 334-574ms end-to-end drift between the renderer
// clocks, so no precise latency is derived from this alignment.
// Usage: node f2-pixel-faces.mjs <variant-dir> <rep> [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { analyseF2 } from './f2-analyzer.mjs';

const GX = 36, GY = 30, MARGIN = 0.85, LAG_MS = 600, SLACK_MS = 100, STABLE_MS = 400;

function framesOf(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return out.trim().split('\n').map(x => Math.round(parseFloat(x) * 1000));
}
async function decode(file, W, H, onFrame) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const size = W * H * 3; let buf = Buffer.alloc(0), k = 0;
  for await (const chunk of ff.stdout) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= size) { onFrame(k++, buf.subarray(0, size)); buf = buf.subarray(size); }
  }
  return k;
}
// --- per-frame features -----------------------------------------------------
function analyseFrame(px, W, H) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  const top = Math.min(H, 160);
  for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3; if (px[i] > 180 && px[i + 1] < 150 && px[i + 2] < 150) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0 || x1 - x0 < 40) return { ok: false, why: 'no-pet' };
  const cx = (x0 + x1) / 2;
  // dark blobs inside the upper body
  const rx0 = x0, rx1 = x1, ry0 = y0, ry1 = Math.min(H - 1, y0 + 85), rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
  const dark = new Uint8Array(rw * rh), lab = new Int32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const i = ((y + ry0) * W + x + rx0) * 3; dark[y * rw + x] = px[i] < 90 && px[i + 1] < 90 && px[i + 2] < 90 ? 1 : 0; }
  const blobs = []; const stack = [];
  for (let s = 0; s < dark.length; s++) {
    if (!dark[s] || lab[s]) continue;
    const id = blobs.length + 1; let n = 0, sx = 0, sy = 0; lab[s] = id; stack.push(s);
    while (stack.length) { const q = stack.pop(); const x = q % rw, y = (q - x) / rw; n++; sx += x; sy += y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue; const t = ny * rw + nx; if (dark[t] && !lab[t]) { lab[t] = id; stack.push(t); } } }
    blobs.push({ n, x: sx / n + rx0, y: sy / n + ry0 });
  }
  const big = blobs.filter(b => b.n >= 12).sort((a, b) => b.n - a.n).slice(0, 2);
  if (big.length < 2) return { ok: false, why: 'eyes-not-found', cx };
  let [L, R] = big[0].x < big[1].x ? big : [big[1], big[0]];
  const dx = R.x - L.x, dy = R.y - L.y, d = Math.hypot(dx, dy);
  if (d < 15 || Math.abs(dy) > 0.35 * d) return { ok: false, why: 'eyes-implausible', cx };
  const ux = dx / d, uy = dy / d, vx = -uy, vy = ux, mx = (L.x + R.x) / 2, my = (L.y + R.y) / 2;
  const patch = new Float32Array(GX * GY);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const a = (-0.95 + 1.9 * i / (GX - 1)) * d, b = (-0.45 + 1.1 * j / (GY - 1)) * d;
    const x = mx + a * ux + b * vx, y = my + a * uy + b * vy;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; let v = 0;
    for (const [ox, oy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const X = Math.min(W - 1, Math.max(0, xi + ox)), Y = Math.min(H - 1, Math.max(0, yi + oy)), k = (Y * W + X) * 3;
      v += w * (255 - (0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]));
    }
    patch[j * GX + i] = v;
  }
  return { ok: true, cx, eyeDist: +d.toFixed(2), eyeArea: (L.n + R.n) / 2, patch };
}
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const e = a[i] - b[i]; s += e * e; } return Math.sqrt(s); };
const mean = ps => { const m = new Float32Array(ps[0].length); for (const p of ps) for (let i = 0; i < m.length; i++) m[i] += p[i] / ps.length; return m; };
function classify(p, refs) {
  const d = Object.entries(refs).map(([k, r]) => [k, dist(p, r)]).sort((a, b) => a[1] - b[1]);
  return { label: d[0][1] / d[1][1] <= MARGIN ? d[0][0] : 'ambiguous', d: d.map(([k, v]) => [k, +v.toFixed(1)]) };
}
function runsOf(seq) { const out = []; for (const v of seq) { if (out.at(-1)?.[0] === v) out.at(-1)[1]++; else out.push([v, 1]); } return out; }

export async function pixelCheck(dir, rep) {
  const run = JSON.parse(fs.readFileSync(path.join(dir, `f2live-run-${rep}.json`), 'utf8'));
  const { file, bounds: { width: W, height: H }, fps } = run.capture;
  const video = path.join(dir, file);
  const pts = framesOf(video);
  const frames = [];
  let prevSig = null;
  await decode(video, W, H, (k, px) => {
    const f = analyseFrame(px, W, H);
    // a presented frame = pixels differ from the previous capture
    let sig = 0; for (let i = 0; i < px.length; i += 7) sig = (sig * 31 + px[i]) >>> 0;
    frames.push({ k, t: pts[k], newPresent: sig !== prevSig, ...f }); prevSig = sig;
  });
  const cal = JSON.parse(fs.readFileSync(path.join(dir, `f2live-calibration-${rep}.json`), 'utf8'));
  const ep = (log, name) => { const m = log.marks.find(x => x.name === name); return m ? log.timeOrigin + m.now : null; };
  // clock alignment: first captured frame whose pet centre moved >=2px vs first logged move
  function onsetOffset(log) {
    const t0 = ep(log, 'down'), firstMove = log.moves.find(m => m.tag && m.tag !== 'down');
    if (!firstMove) return null;
    const base = frames.filter(f => f.t >= t0 - 300 && f.t <= t0 && f.cx !== undefined).at(-1);
    const moved = base && frames.find(f => f.t > t0 && f.cx !== undefined && Math.abs(f.cx - base.cx) >= 2);
    return moved ? moved.t - (log.timeOrigin + firstMove.now) : null;
  }
  const calOffset = onsetOffset(cal) ?? 0;
  const inWin = (f, a, b) => f.ok && f.t - calOffset >= a && f.t - calOffset <= b;
  const tT05 = ep(cal, 'cal-T05'), t01 = ep(cal, 'cal-01'), tEnd = ep(cal, 'end');
  const refFrames = { T05: frames.filter(f => inWin(f, tT05 + 400, t01 - 30)), '01': frames.filter(f => inWin(f, t01 + 500, tEnd - 30)) };
  const refs = { T05: mean(refFrames.T05.map(f => f.patch)), '01': mean(refFrames['01'].map(f => f.patch)) };
  // leave-one-out on the calibration frames themselves
  let looOk = 0, looN = 0, looAmb = 0;
  for (const [k, list] of Object.entries(refFrames)) for (const f of list) {
    const r = { ...refs }; r[k] = mean(list.filter(g => g !== f).map(g => g.patch)); const c = classify(f.patch, r);
    looN++; if (c.label === k) looOk++; else if (c.label === 'ambiguous') looAmb++;
  }
  const sessions = [];
  for (let s = 1; fs.existsSync(path.join(dir, `f2live-${rep}-s${s}-renderer-log.json`)); s++) {
    const log = JSON.parse(fs.readFileSync(path.join(dir, `f2live-${rep}-s${s}-renderer-log.json`), 'utf8'));
    const off = onsetOffset(log);
    const o = off ?? calOffset;
    const bandStart = ep(log, 'band-66'), end = ep(log, 'end');
    const toR = f => f.t - o; // capture time on the renderer wall clock
    // window: first band mark .. end mark (same window for all layers)
    const capt = frames.filter(f => toR(f) >= bandStart && toR(f) <= end);
    const present = capt.filter(f => f.newPresent);
    const labelled = present.map(f => ({ k: f.k, t: toR(f), ...(f.ok ? classify(f.patch, refs) : { label: 'unclassifiable', why: f.why }) }));
    const known = labelled.filter(x => x.label === 'T05' || x.label === '01');
    const pixelSwitches = [];
    for (let i = 1; i < known.length; i++) if (known[i].label !== known[i - 1].label) pixelSwitches.push({ t: known[i].t, from: known[i - 1].label, to: known[i].label });
    // controller layer: logged faceIntent changes on DragController.move in the window
    const mv = log.moves.filter(m => m.tag && m.tag !== 'down');
    const ctl = [];
    for (let i = 1; i < mv.length; i++) {
      const a = mv[i - 1], b = mv[i], t = log.timeOrigin + b.now; if (t < bandStart || t > end || a.face === b.face) continue;
      const why = a.face === 'T05' && b.face === '01' && b.speed < 64 ? 'speed<64' : a.face === '01' && b.face === 'T05' && b.speed > 76 ? 'speed>76'
        : (b.t - a.t >= 0.12 && b.face === '01') ? 'stationary>=120ms' : null;
      ctl.push({ t, from: a.face, to: b.face, speed: +b.speed.toFixed(2), why });
    }
    // owner layer: candidate changes per rAF, explanation from analyzer v2.1 (64/76 contract)
    const a = analyseF2(log, { contract: 'hysteresis', coverage: { minSettledBandMoves: 1, minInBandMoves: 0, minBandFrames: 1 } });
    const own = a.details.switches.map(x => ({ ...x, t: log.timeOrigin + x.at })).filter(x => x.t >= bandStart && x.t <= end);
    // pixel switch to face B at t -> the latest owner switch to B in [t - LAG_MS, t + SLACK_MS]
    // (the visible face trails the owner request by the crossfade); it inherits that
    // owner switch's 64/76 explanation. No owner switch in the window -> unmatched.
    const seen = new Set();
    for (const p of pixelSwitches) {
      let best = -1;
      own.forEach((x, k) => { if (x.to === p.to && x.t >= p.t - LAG_MS && x.t <= p.t + SLACK_MS && (best < 0 || x.t > own[best].t)) best = k; });
      if (best >= 0) { seen.add(best); p.matched = true; p.ownerAt = Math.round(own[best].t - bandStart); p.owner = own[best].reason; p.explained = own[best].explained; } else { p.matched = false; p.owner = null; p.explained = false; }
    }
    // agreement on frames where the owner candidate was constant for the previous STABLE_MS
    const ownerFrames = log.frames.map(f => ({ t: log.timeOrigin + f.now, c: f.candidate }));
    const stable = { agree: 0, disagree: 0, ambiguous: 0, unclassifiable: 0 };
    for (const x of labelled) {
      const span = ownerFrames.filter(f => f.t >= x.t - STABLE_MS && f.t <= x.t);
      if (span.length < 2 || !span.every(f => f.c === span[0].c) || !['T05', '01'].includes(span[0].c)) continue;
      if (x.label === span[0].c) stable.agree++; else if (x.label === 'ambiguous') stable.ambiguous++; else if (x.label === 'unclassifiable') stable.unclassifiable++; else stable.disagree++;
    }
    const settled = log.moves.filter(m => m.tag?.startsWith('band') && m.now >= log.marks.find(x => x.name === 'band-66').now + 80);
    sessions.push({
      session: s, alignOffsetMs: off, windowMs: Math.round(end - bandStart),
      samplesInBand: settled.filter(m => m.speed >= 64 && m.speed <= 76).length, settledBandMoves: settled.length,
      controller: { switches: ctl.length, unexplained: ctl.filter(x => !x.why).length },
      owner: { switches: own.length, unexplained: own.filter(x => !x.explained).length },
      pixel: { switches: pixelSwitches.length, unexplained: pixelSwitches.filter(x => !x.explained).length,
        unmatched: pixelSwitches.filter(x => !x.matched).length, ownerSwitchesWithoutPixelSwitch: own.length - seen.size },
      stableOwnerAgreement: stable,
      capture: { framesCaptured: capt.length, achievedFps: capt.length > 1 ? +((capt.length - 1) / ((capt.at(-1).t - capt[0].t) / 1000)).toFixed(1) : null,
        presentedFrames: present.length, T05: labelled.filter(x => x.label === 'T05').length, '01': labelled.filter(x => x.label === '01').length,
        ambiguous: labelled.filter(x => x.label === 'ambiguous').length, unclassifiable: labelled.filter(x => x.label === 'unclassifiable').length },
      pixelRuns: runsOf(labelled.map(x => x.label)).map(([v, n]) => `${v}x${n}`).join(' '),
      ownerRuns: runsOf(log.frames.filter(f => { const t = log.timeOrigin + f.now; return t >= bandStart && t <= end; }).map(f => f.candidate)).map(([v, n]) => `${v}x${n}`).join(' '),
      details: { presented: labelled.map(x => ({ k: x.k, t: Math.round(x.t - bandStart), label: x.label, d: x.d })), pixelSwitches: pixelSwitches.map(x => ({ ...x, t: Math.round(x.t - bandStart) })), controllerSwitches: ctl.map(x => ({ ...x, t: Math.round(x.t - bandStart) })),
        ownerSwitches: own.map(x => ({ t: Math.round(x.t - bandStart), from: x.from, to: x.to, explained: x.explained, reason: x.reason })) },
    });
  }
  const all = pts.length > 1 ? (pts.length - 1) / ((pts.at(-1) - pts[0]) / 1000) : null;
  return { label: 'Grok 电脑验收 (Xvfb + Electron + SwiftShader, synthetic input)', video: file, requestedFps: fps, achievedFpsWholeVideo: all && +all.toFixed(2),
    capturedFrames: frames.length, calibration: { alignOffsetMs: calOffset, refFrames: { T05: refFrames.T05.length, '01': refFrames['01'].length },
      leaveOneOut: { n: looN, correct: looOk, ambiguous: looAmb }, loggedFaces: run.calibration?.loggedFaces }, sessions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, rep] = process.argv.slice(2);
  const res = await pixelCheck(dir, rep ?? '1');
  const jo = process.argv.indexOf('--json');
  if (jo > 0) fs.writeFileSync(process.argv[jo + 1], JSON.stringify(res, null, 1));
  const { sessions, ...head } = res;
  console.log(JSON.stringify(head));
  for (const s of sessions) { const { details, ...rest } = s; console.log(JSON.stringify(rest)); }
}
