'use strict';
// Grok 电脑验收 harness (software rendering, synthetic input). Test tooling only.
// Starts the isolated dev bench (same entry as `npm run dev:bench`) with the
// realtime pet, injects synthetic mouse input through Electron's
// webContents.sendInputEvent, samples the pet stage state after every input,
// and saves PNG frames plus a JSON log per scenario.
// Frame timings from this harness are NOT G1 evidence.
//
// Env: BUBU_DEV_REALTIME_PET=1 (required), GROK_ACCEPTANCE_OUT=<dir>,
//      GROK_VARIANT=<label>, GROK_SCENARIOS=f1,f2,f3,f4,f6 (optional)
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const ROOT = path.resolve(__dirname, '../../../..');
const OUT = path.join(process.env.GROK_ACCEPTANCE_OUT || path.join(ROOT, 'dist/grok-acceptance'), process.env.GROK_VARIANT || 'baseline');
const LABEL = 'Grok 电脑验收 (software rendering, synthetic input)';
fs.mkdirSync(OUT, { recursive: true });
require(path.join(ROOT, 'tools/dev-bench/launch.js'));

const wait = ms => new Promise(r => setTimeout(r, ms));
let pet;
const js = expr => pet.webContents.executeJavaScript(`import("./entry.mjs").then(m => (${expr}))`);
const STATE = `(() => { const st = m.surface.snapshot().stage?.state; if (!st) return null;
  return { mode: st.mode, pointerId: st.pointerId, dragMode: st.drag?.mode, faceIntent: st.drag?.faceIntent ?? null,
    petPhase: st.pet?.phase ?? null, petFace: st.pet?.face ?? null, faceOwner: st.face?.owner ?? null,
    faceCandidate: st.face?.candidate ?? st.face?.request?.candidate ?? null, faceRequest: st.face?.requestId ?? null,
    facePhase: st.face?.phase ?? null, rootY: Array.isArray(st.body?.root) ? st.body.root[1] : null,
    policy: m.surface.snapshot().policy }; })()`;
const readState = () => js(STATE);

// World coordinates -> window client coordinates (camera from three-stage.mjs:
// orthographic, y in [-1, 4], x half-width 2.5 * aspect).
let rect;
function client(x, y) {
  const halfW = 2.5 * rect.width / rect.height;
  return { x: rect.x + (x + halfW) / (2 * halfW) * rect.width, y: rect.y + (4 - y) / 5 * rect.height };
}

function makeRecorder(name) {
  const log = { label: LABEL, scenario: name, variant: process.env.GROK_VARIANT || 'baseline', rows: [], frames: [] };
  const t0 = Date.now();
  return {
    log,
    async input(type, p, note) {
      const b = pet.getContentBounds();
      const ev = { type, x: Math.round(p.x), y: Math.round(p.y), globalX: b.x + Math.round(p.x), globalY: b.y + Math.round(p.y) };
      if (type === 'mouseMove') ev.modifiers = ['leftButtonDown']; else { ev.button = 'left'; ev.clickCount = 1; }
      pet.webContents.sendInputEvent(ev);
      return this.sample(note ?? type, { x: ev.x, y: ev.y });
    },
    async sample(note, input = null) {
      const s = await readState();
      log.rows.push({ ms: Date.now() - t0, note, input, ...s });
      return s;
    },
    async frame(tag) {
      const file = `${name}-${tag}.png`;
      fs.writeFileSync(path.join(OUT, file), (await pet.webContents.capturePage()).toPNG());
      const s = await readState();
      log.frames.push({ ms: Date.now() - t0, file, mode: s?.mode, dragMode: s?.dragMode, faceIntent: s?.faceIntent, faceOwner: s?.faceOwner, faceCandidate: s?.faceCandidate });
    },
    save(summary) {
      log.summary = summary;
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(log, null, 1));
      console.log(`[${name}]`, JSON.stringify(summary));
    }
  };
}

// Renderer-side instrumentation (test tooling): wraps DragController.prototype.move
// of the module instance the pet page already loaded, and logs inbound pointer
// events and the displayed face owner every animation frame.
async function installRendererLog() {
  await pet.webContents.executeJavaScript(`(async () => {
    if (globalThis.__grok) { globalThis.__grok.reset(); return true; }
    const url = new URL('../../../../research/animation-0.1.0/drag-landing-r5/src/drag-controller.mjs', location.href).href;
    const { DragController } = await import(url);
    const entry = await import('./entry.mjs');
    const L = { moves: [], inputs: [], frames: [], marks: [] };
    let tag = null;
    const original = DragController.prototype.move;
    DragController.prototype.move = function (t, p) {
      const out = original.call(this, t, p);
      const s = this.snapshot();
      L.moves.push({ now: performance.now(), t, x: p.x, y: p.y, speed: Math.hypot(this.velocity.x, this.velocity.y), face: s.faceIntent, mode: s.mode, tag });
      return out;
    };
    addEventListener('pointermove', e => L.inputs.push({ ts: e.timeStamp, now: performance.now(), x: e.clientX, y: e.clientY, tag }), { capture: true });
    const frame = () => {
      const st = entry.surface.snapshot().stage?.state;
      const f = st?.face ?? null;
      L.frames.push({ now: performance.now(), tag, faceIntent: st?.drag?.faceIntent ?? null, mode: st?.mode,
        owner: f?.owner ?? null, requestId: f?.requestId ?? null, phase: f?.phase ?? null, candidate: f?.candidate ?? f?.expression ?? null });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    globalThis.__grok = {
      mark(name) { tag = name; L.marks.push({ name, now: performance.now() }); },
      reset() { for (const k of Object.keys(L)) L[k].length = 0; tag = null; },
      take() { return JSON.parse(JSON.stringify(L)); },
      faceKeys() { return Object.keys(entry.surface.snapshot().stage?.state?.face ?? {}); }
    };
    return true;
  })()`);
}
// v1 classifier, SUPERSEDED by f2-analyzer.mjs (too wide: move state only and any
// >=120ms gap accepted). Classify displayed face switches using the controller-measured speed at the
// move that produced them (T05->01 explained only if <64, 01->T05 only if >76).
function analyseF2(rl) {
  const band = rl.moves.filter(m => m.tag && m.tag.startsWith('band'));
  const firstBandNow = rl.marks.find(m => m.name.startsWith('band'))?.now ?? 0;
  const settled = band.filter(m => m.now >= firstBandNow + 80);
  const inBand = settled.filter(m => m.speed >= 64 && m.speed <= 76).length;
  let explained = 0, unexplained = 0; const details = [];
  for (let i = 1; i < band.length; i++) {
    const a = band[i - 1].face, b = band[i].face;
    if (a === b) continue;
    const gap = band[i].t - band[i - 1].t;
    const reason = (a === 'T05' && b === '01' && band[i].speed < 64) ? 'speed<64'
      : (a === '01' && b === 'T05' && band[i].speed > 76) ? 'speed>76'
      : gap >= 0.12 ? 'stationary-timeout-reset' : null;
    const ok = reason !== null;
    if (ok) explained++; else unexplained++;
    details.push({ at: +(band[i].now - firstBandNow).toFixed(1), from: a, to: b, speed: +band[i].speed.toFixed(2), gapMs: +(gap * 1000).toFixed(1), reason });
  }
  const frames = rl.frames.filter(f => f.tag && f.tag.startsWith('band'));
  const requestRestarts = frames.reduce((n, f, i, arr) => n + (i && f.requestId !== arr[i - 1].requestId ? 1 : 0), 0);
  const displayedRuns = runs(frames.map(f => f.faceIntent));
  const gaps = band.slice(1).map((m, i) => m.t - band[i].t);
  const speeds = settled.map(m => m.speed).sort((p, q) => p - q);
  const q = k => speeds.length ? +speeds[Math.min(speeds.length - 1, Math.floor(k * speeds.length))].toFixed(2) : null;
  return { bandMoves: band.length, settledMoves: settled.length, inBandFraction: settled.length ? +(inBand / settled.length).toFixed(4) : null,
    measuredSpeed: { min: q(0), p05: q(0.05), p50: q(0.5), p95: q(0.95), max: speeds.length ? +speeds.at(-1).toFixed(2) : null },
    maxEventGapMs: gaps.length ? +(Math.max(...gaps) * 1000).toFixed(1) : null,
    faceSwitches: { explained, unexplained, details }, ownerRequestRestartsInBand: requestRestarts,
    displayedFaceIntentPerFrame: displayedRuns, inputsSeen: rl.inputs.length, maxInputX: Math.max(...rl.inputs.map(i => i.x)) };
}
const switches = vals => vals.reduce((n, v, i, a) => n + (i && v !== a[i - 1] ? 1 : 0), 0);
async function settle() {
  try { await js('m.surface.cancel()'); } catch {}
  for (let i = 0; i < 60; i++) { const s = await readState(); if (s?.mode === 'idle' && (s.dragMode === 'rest' || s.dragMode == null)) return; await wait(100); }
}
// Paced input: run `step(i)` every `ms` milliseconds (wall clock).
async function paced(count, ms, step) {
  const start = Date.now();
  for (let i = 1; i <= count; i++) {
    const due = start + i * ms - Date.now();
    if (due > 0) await wait(due);
    await step(i);
  }
}

const scenarios = {
  async scan() { // which world heights accept a pointerdown at rest
    const r = makeRecorder('scan'), out = [];
    for (let y = 0.0; y <= 2.01; y += 0.2) {
      await settle();
      const p = client(0, y);
      await r.input('mouseDown', p); await wait(60);
      const s = await r.sample('down+60ms');
      out.push(`${y.toFixed(1)}:${s.pointerId == null ? '-' : s.mode}`);
      await r.input('mouseUp', p); await wait(400);
    }
    r.save({ hits: out.join(' ') });
  },
  async f1() { // lower/middle body slow 1px drag
    const results = {};
    for (const y of [0.6, 0.9, 1.4]) {
      await settle();
      const r = makeRecorder(`f1-y${y}`), p = client(0, y);
      await r.input('mouseDown', p);
      if (y === 0.6) await r.frame('down');
      let s;
      await paced(20, 8, async i => { s = await r.input('mouseMove', { x: p.x, y: p.y - i }); });
      await wait(150); s = await r.sample('after-150ms');
      if (y === 0.6 || y === 1.4) await r.frame('after-20px');
      await r.input('mouseUp', { x: p.x, y: p.y - 20 });
      const modes = [...new Set(r.log.rows.map(row => row.mode))];
      results[y] = { modes, final: { mode: s.mode, pointerId: s.pointerId } };
      r.save({ worldY: y, modes, finalMode: s.mode, pointerHeld: s.pointerId !== null });
      await wait(1500);
    }
    return results;
  },
  async f2() { // F2 in-band acceptance B: straight horizontal line, 1px steps
    // timed at 1/speed, so the controller's 80ms net-displacement speed equals the
    // planned speed up to delivery jitter. Renderer-side logs are the evidence.
    await f2Straight('f2');
  },
  async f2live() { // F2 acceptance B, LIVE with screen capture (G-20261112-017).
    // Test-side only: the window is widened and the canvas widened to
    // GROK_CANVAS_WIDTH (same 220px height, so DIP per world unit is unchanged)
    // so the whole straight line stays on screen; ffmpeg x11grab records the
    // window region from the Xvfb screen for the whole scenario. One calibration
    // contact (110 DIP/s -> T05, then 40 DIP/s -> 01) gives the
    // live reference faces, then GROK_SESSIONS straight-line F2 contacts follow.
    await widenStage();
    const rep = process.env.GROK_REP || 1, sessions = Number(process.env.GROK_SESSIONS || 3);
    const rec = await startScreenCapture(`f2live-screen-${rep}.mkv`);
    const out = { calibration: await f2Calibration(`f2live-calibration-${rep}`), sessions: [] };
    for (let k = 1; k <= sessions; k++) out.sessions.push(await f2Straight(`f2live-${rep}-s${k}`, { perSession: true }));
    out.capture = await rec.stop();
    const { COVERAGE } = await import(require('node:url').pathToFileURL(path.join(__dirname, 'f2-analyzer.mjs')).href);
    // coverage is required over the whole run (sum of sessions); per-session logs
    // still must be non-empty and strictly bounded.
    const sum = k => out.sessions.reduce((n, x) => n + x.v2.hysteresis.coverage[k], 0);
    out.runCoverage = { settledBandMoves: sum('settledBandMoves'), inBandMoves: sum('inBandMoves'), bandFrames: sum('bandFrames') };
    out.runCoverage.ok = out.runCoverage.settledBandMoves >= COVERAGE.minSettledBandMoves && out.runCoverage.inBandMoves >= COVERAGE.minInBandMoves
      && out.runCoverage.bandFrames >= COVERAGE.minBandFrames;
    fs.writeFileSync(path.join(OUT, `f2live-run-${rep}.json`), JSON.stringify({ label: LABEL, ...out }, null, 1));
    console.log('[f2live-run]', JSON.stringify(out.runCoverage));
  },
};
// The dev bench leaves the pet where it was dropped. For repeated live contacts,
// find the pet in the window pixels (pink body mask in a capturePage frame) and
// drag it back to the start point in a separate, unlogged contact.
async function petCenterX() {
  const img = await pet.webContents.capturePage(); const { width, height } = img.getSize(); const px = img.toBitmap();
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < Math.min(height, 150); y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; const b = px[i], g = px[i + 1], r = px[i + 2];
    if (r > 180 && g < 150 && b < 150) { if (x < lo) lo = x; if (x > hi) hi = x; }
  }
  return lo <= hi ? (lo + hi) / 2 : null;
}
async function returnHome() {
  await settle();
  const home = client(0, 1.4), cx = await petCenterX();
  if (cx === null || Math.abs(cx - home.x) < 4) return;
  const y = Math.round(home.y); let x = Math.round(cx);
  const b = pet.getContentBounds();
  const send = (type) => pet.webContents.sendInputEvent(type === 'mouseMove' ? { type, x, y, globalX: b.x + x, globalY: b.y + y, modifiers: ['leftButtonDown'] }
    : { type, x, y, globalX: b.x + x, globalY: b.y + y, button: 'left', clickCount: 1 });
  send('mouseDown'); await wait(50);
  while (Math.abs(x - home.x) > 2) { x += x > home.x ? -2 : 2; send('mouseMove'); await wait(10); }
  await wait(200); send('mouseUp'); await wait(2500);
  await settle();
}
async function f2Calibration(name) {
  await returnHome();
  await installRendererLog();
  const r = makeRecorder(name), start = client(0, 1.4);
  const y = Math.round(start.y); let x = Math.round(start.x);
  const step = () => { x += 1; const b = pet.getContentBounds();
    pet.webContents.sendInputEvent({ type: 'mouseMove', x, y, globalX: b.x + x, globalY: b.y + y, modifiers: ['leftButtonDown'] }); };
  const mark = tag => js(`globalThis.__grok.mark(${JSON.stringify(tag)})`);
  await mark('down');
  await r.input('mouseDown', { x, y });
  await wait(150);
  const run = async (speed, seconds, tag) => { await mark(tag); const t0 = Date.now(), n = Math.round(seconds * speed);
    for (let i = 1; i <= n; i++) { const due = t0 + i * 1000 / speed - Date.now(); if (due > 0) await wait(due); step(); } };
  await run(110, 0.9, 'cal-T05');
  await run(40, 1.0, 'cal-01');
  await mark('end');
  await r.input('mouseUp', { x, y });
  await wait(600);
  const rl = await js('globalThis.__grok.take()');
  rl.timeOrigin = await pet.webContents.executeJavaScript('performance.timeOrigin');
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ label: LABEL, ...rl }, null, 1));
  const phase = tag => [...new Set(rl.moves.filter(m => m.tag === tag).map(m => `${m.mode}:${m.face}`))];
  const summary = { loggedFaces: { 'cal-T05': phase('cal-T05'), 'cal-01': phase('cal-01') } };
  console.log(`[${name}]`, JSON.stringify(summary));
  await wait(900);
  return summary;
}
async function f2Straight(name, { perSession = false } = {}) {
    if (perSession) await returnHome(); else await settle();
    await installRendererLog();
    const r = makeRecorder(name), start = client(0, 1.4);
    const y = Math.round(start.y);
    let x = Math.round(start.x);
    await r.input('mouseDown', { x, y });
    await js('globalThis.__grok.mark("down")');
    const run = async (speed, seconds, tag) => {
      await js(`globalThis.__grok.mark(${JSON.stringify(tag)})`);
      const t0 = Date.now(), n = Math.round(seconds * speed);
      for (let i = 1; i <= n; i++) {
        const due = t0 + i * 1000 / speed - Date.now(); if (due > 0) await wait(due);
        x += 1;
        const b = pet.getContentBounds();
        pet.webContents.sendInputEvent({ type: 'mouseMove', x, y, globalX: b.x + x, globalY: b.y + y, modifiers: ['leftButtonDown'] });
      }
    };
    await run(110, 0.4, 'enter-110');
    for (let k = 0; k < 10; k++) await run(k % 2 ? 74 : 66, 0.3, k % 2 ? 'band-74' : 'band-66');
    await js('globalThis.__grok.mark("end")');
    await wait(100);
    if (!perSession) await r.frame('band-end');
    await r.input('mouseUp', { x, y });
    if (perSession) await wait(600); // keep logging through release/landing for the screen cross-check
    const rl = await js('globalThis.__grok.take()');
    rl.timeOrigin = await pet.webContents.executeJavaScript('performance.timeOrigin');
    const logName = perSession ? `${name}-renderer-log.json` : `${name}-renderer-log-${process.env.GROK_REP || 1}.json`;
    fs.writeFileSync(path.join(OUT, logName), JSON.stringify({ label: LABEL, ...rl }, null, 1));
    // analyzer v2.1 (BUBU-V2-20261112-012/-013) is authoritative; v1 kept only for comparison.
    const { analyseF2: analyseF2v2 } = await import(require('node:url').pathToFileURL(path.join(__dirname, 'f2-analyzer.mjs')).href);
    let summary;
    if (perSession) {
      const coverage = { minSettledBandMoves: 1, minInBandMoves: 0, minBandFrames: 1, strictBoundaries: true };
      summary = { log: logName, v2: { hysteresis: analyseF2v2(rl, { contract: 'hysteresis', coverage }), threshold: analyseF2v2(rl, { contract: 'threshold', coverage }) } };
    } else summary = { v2: analyseF2v2(rl, { contract: process.env.GROK_F2_CONTRACT || 'hysteresis' }), v1: analyseF2(rl) };
    r.save(summary);
    await wait(perSession ? 900 : 1500);
    return summary;
}
const scenarios2 = {
  async f2circle() { // STRESS scenario only (G-20261112-013): integer-pixel circle; its
    // controller-measured speed really leaves 64..76, so it is NOT an in-band check.
    // Drag around the 70 DIP/s threshold. sendInputEvent only takes
    // integer DIP, so the path is an integer-pixel circle and each event is
    // timed by its true step length / target speed (constant real speed).
    await settle();
    const r = makeRecorder('f2circle'), start = client(0, 1.4), radius = 50;
    const center = { x: Math.round(start.x - radius), y: Math.round(start.y) };
    const pts = [];
    for (let k = 0; k <= 4000; k++) {
      const a = k / 4000 * 2 * Math.PI * 3; // three laps worth of points
      const q = { x: Math.round(center.x + radius * Math.cos(a)), y: Math.round(center.y - radius * Math.sin(a)) };
      const last = pts.at(-1);
      if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
    }
    let idx = 0;
    await r.input('mouseDown', pts[0]);
    const faces = [];
    const run = async (speed, seconds, tag) => {
      const t0 = Date.now(); let due = 0;
      while (due < seconds * 1000) {
        const a = pts[idx], b = pts[idx + 1]; idx++;
        due += Math.hypot(b.x - a.x, b.y - a.y) / speed * 1000;
        const wait_ = t0 + due - Date.now(); if (wait_ > 0) await wait(wait_);
        const st = await r.input('mouseMove', b, tag);
        faces.push({ tag, face: st.faceIntent, mode: st.mode });
      }
    };
    await run(110, 0.6, 'enter-110');
    await r.frame('fast');
    for (let k = 0; k < 10; k++) await run(k % 2 ? 74 : 66, 0.35, k % 2 ? 'band-74' : 'band-66');
    await r.frame('band-end');
    await run(50, 0.6, 'slow-50');
    await r.frame('slow');
    await r.input('mouseUp', pts[idx]);
    const band = faces.filter(f => f.tag.startsWith('band')).map(f => f.face);
    const slow = faces.filter(f => f.tag === 'slow-50').map(f => f.face);
    r.save({ bandEvents: band.length, bandFaceValues: [...new Set(band)], bandSwitches: switches(band),
      bandFaceRuns: runs(band), slowTail: runs(slow),
      modesInBand: [...new Set(faces.filter(f => f.tag.startsWith('band')).map(f => f.mode))] });
    await wait(1800);
  },
  async f3() { // reduced motion: pet and drag must still work
    await settle();
    const dbg = pet.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await wait(600);
    const r = makeRecorder('f3'), p = client(-0.2, 1.4);
    await r.sample('policy-after-emulation');
    await r.input('mouseDown', p);
    await wait(800);
    const held = await r.sample('after-800ms-hold');
    await r.frame('hold-800ms');
    let s;
    await paced(10, 16, async i => { s = await r.input('mouseMove', { x: p.x + 4 * i, y: p.y - 3 * i }); });
    await r.frame('after-pull');
    await r.input('mouseUp', { x: p.x + 40, y: p.y - 30 });
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    dbg.detach();
    r.save({ reducedMotionPolicy: held?.policy?.reducedMotion, modeAfterHold: held?.mode, modeAfterPull: s?.mode,
      modes: [...new Set(r.log.rows.map(row => row.mode))] });
    await wait(1500);
  },
  async f4() { // re-grab during fall; face while falling
    await settle();
    const r = makeRecorder('f4'), p = client(0, 1.4);
    await r.input('mouseDown', p);
    await paced(40, 16, async i => { await r.input('mouseMove', { x: p.x, y: p.y - i * 2 }); });
    await wait(300);
    const top = { x: p.x, y: p.y - 80 };
    await r.input('mouseUp', top, 'release');
    const fall = [];
    const t0 = Date.now();
    let shot = 0, regrab = null;
    while (Date.now() - t0 < 1800) {
      const s = await r.sample('fall');
      fall.push(s);
      const el = Date.now() - t0;
      if (shot < 4 && el > shot * 120 + 40) { await r.frame(`fall-${shot}`); shot++; }
      await wait(16);
    }
    // second run: try to re-grab 150ms after release at the body's current spot
    await settle();
    await r.input('mouseDown', p, 'second-lift');
    await paced(40, 16, async i => { await r.input('mouseMove', { x: p.x, y: p.y - i * 2 }); });
    await wait(300);
    await r.input('mouseUp', top, 'release-2');
    await wait(150);
    const before = await r.sample('before-regrab');
    // body is still high: aim at the head where it is now (rootY from state if available)
    const lift = Number.isFinite(before?.rootY) ? before.rootY : 0.8;
    const target = client(0, 1.0 + lift);
    const after = await r.input('mouseDown', target, 'regrab-down');
    await wait(50);
    const after2 = await r.sample('regrab+50ms');
    await r.frame('regrab');
    await r.input('mouseUp', target);
    // control: the same aim accepted once the body reaches settle
    await settle();
    await r.input('mouseDown', p, 'third-lift');
    await paced(40, 16, async i => { await r.input('mouseMove', { x: p.x, y: p.y - i * 2 }); });
    await wait(300);
    await r.input('mouseUp', top, 'release-3');
    let c = null;
    for (let i = 0; i < 200; i++) { c = await r.sample('wait-settle'); if (c?.dragMode === 'settle') break; await wait(5); }
    const aim = client(0, 1.0 + (Number.isFinite(c?.rootY) ? c.rootY : 0));
    await r.input('mouseDown', aim, 'control-down');
    await wait(50);
    const ctl = await r.sample('control+50ms');
    await r.input('mouseUp', aim);
    const descending = fall.filter(s => s?.dragMode === 'descending');
    r.save({ descendingSamples: descending.length,
      descendingBlankFaceIntent: descending.filter(s => s.faceIntent == null).length,
      fallFaceSequence: runs(fall.map(s => `${s?.dragMode}:${s?.faceIntent}`)),
      regrab: { dragModeBefore: before?.dragMode, rootYBefore: before?.rootY, modeAfter: after2?.mode, pointerHeld: after2?.pointerId != null },
      controlInSettle: { dragModeBefore: c?.dragMode, modeAfter: ctl?.mode, pointerHeld: ctl?.pointerId != null } });
    await wait(1500);
  },
  async f6() { // back-and-forth stroking while petting
    await settle();
    const r = makeRecorder('f6'), p = client(0, 1.4);
    await r.input('mouseDown', p);
    await wait(800);
    const held = await r.sample('after-800ms-hold');
    await r.frame('petting');
    const modes = [];
    await paced(90, 1000 / 60, async i => {
      const dx = 16 * Math.sin((i / 60) * 2 * Math.PI * 1.5);
      const s = await r.input('mouseMove', { x: p.x + dx, y: p.y }, 'stroke');
      modes.push(s.mode);
      if (i === 30) await r.frame('stroke-0.5s');
    });
    await r.frame('stroke-end');
    await r.input('mouseUp', p);
    r.save({ modeAfterHold: held?.mode, strokeModes: runs(modes), firstDragAtFrame: modes.indexOf('drag') });
    await wait(1500);
  }
};
Object.assign(scenarios, scenarios2);
// Test-side only: widen the pet WINDOW (the 220x220 canvas and its rendering cost
// are unchanged) so the bench's own stage offset (--stage-dx) keeps the dragged pet
// inside the window for the whole straight line, and paint an opaque page
// background so the X screen capture shows no stale transparent pixels.
async function widenStage() {
  await settle();
  const w = Number(process.env.GROK_WINDOW_WIDTH || 1000);
  const cw = Number(process.env.GROK_CANVAS_WIDTH || 680);
  await pet.webContents.insertCSS('html,body{background:#fff!important}' + (cw !== 220
    ? `#stage{width:${cw}px!important;left:calc(50% - ${cw / 2}px)!important} canvas{width:${cw}px!important}` : ''));
  pet.setContentBounds({ x: 0, y: 700, width: w, height: 220 });
  await wait(1500);
  rect = (await js('m.surface.readWindowGeometry()')).stageClientRect;
  fs.writeFileSync(path.join(OUT, 'environment-widened.json'), JSON.stringify({ stageClientRect: rect, windowBounds: pet.getContentBounds(),
    canvasWidth: cw, note: 'test-side window/canvas widening (height 220 unchanged) + opaque background for on-screen capture' }, null, 1));
  await pet.webContents.capturePage().then(img => fs.writeFileSync(path.join(OUT, 'idle-widened.png'), img.toPNG()));
}
// Screen capture of the pet window region from the X server (what Xvfb shows),
// timestamps are the capture wall clock (x11grab), stored as mkv pts in ms.
async function startScreenCapture(file) {
  const { spawn } = require('node:child_process');
  const b = pet.getContentBounds();
  const fps = Number(process.env.GROK_CAPTURE_FPS || 60);
  const out = path.join(OUT, file);
  const args = ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps), '-video_size', `${b.width}x${b.height}`,
    '-i', `${process.env.DISPLAY}+${b.x},${b.y}`, '-copyts', '-c:v', 'ffv1', '-f', 'matroska', out];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', d => { err += d; });
  const startedEpochMs = Date.now();
  await wait(700);
  return {
    async stop() {
      await wait(300);
      const stopEpochMs = Date.now();
      ff.stdin.write('q');
      await new Promise(res => { ff.on('exit', res); setTimeout(() => { ff.kill('SIGINT'); }, 5000); });
      return { file, fps, bounds: b, startedEpochMs, stopEpochMs, ffmpegErrors: err.trim() || null };
    }
  };
}
function runs(values) {
  const out = [];
  for (const v of values) { if (out.at(-1)?.[0] === v) out.at(-1)[1]++; else out.push([v, 1]); }
  return out.map(([v, n]) => `${v}x${n}`).join(' ');
}

app.whenReady().then(async () => {
  try {
    for (let i = 0; i < 120 && !pet; i++) {
      await wait(500);
      const w = BrowserWindow.getAllWindows().find(x => /realtime\/index\.html$/.test(x.webContents.getURL()));
      if (!w) continue;
      try { const ok = await w.webContents.executeJavaScript('import("./entry.mjs").then(m => m.surface.snapshot().ready && (m.surface.snapshot().stage?.renderedFrames ?? 0) > 10)'); if (ok) pet = w; } catch {}
    }
    if (!pet) throw new Error('realtime pet not ready');
    pet.focus(); await wait(1500);
    rect = (await js('m.surface.readWindowGeometry()')).stageClientRect;
    const env = await js('m.surface.snapshot()');
    fs.writeFileSync(path.join(OUT, 'environment.json'), JSON.stringify({ label: LABEL, graphics: env.stage?.graphics, stageClientRect: rect,
      windowBounds: pet.getContentBounds(), note: 'Frame timings are NOT G1 evidence.' }, null, 1));
    await pet.webContents.capturePage().then(img => fs.writeFileSync(path.join(OUT, 'idle.png'), img.toPNG()));
    const pick = (process.env.GROK_SCENARIOS || 'f1,f2,f3,f4,f6').split(',');
    for (const name of pick) { console.log('scenario', name); await scenarios[name](); }
    app.exit(0);
  } catch (error) { console.error(error.stack || error); app.exit(1); }
});
