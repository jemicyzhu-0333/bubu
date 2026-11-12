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
  async f2() { // drag around the 70 DIP/s threshold. sendInputEvent only takes
    // integer DIP, so the path is an integer-pixel circle and each event is
    // timed by its true step length / target speed (constant real speed).
    await settle();
    const r = makeRecorder('f2'), start = client(0, 1.4), radius = 50;
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
