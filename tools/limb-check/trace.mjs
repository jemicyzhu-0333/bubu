// Limb detectors (geometry). For every catalogue action and session activity
// in every rig view, steps the production rig artist on a 30 fps clock and
// records each arm's unified-limb trace (usagi-limbs.mjs traceUsagiLimb):
//   pop     – limb mode switches while its visible length jumps (> popLen)
//   stretch – visible length change per frame NOT explained by wrist/socket
//             motion (|Δlen| - |Δwrist| - |Δsocket| > maxStretch): painter or
//             bone-length pops, as opposed to the paw simply moving
//   reach   – visible length beyond the fixed bone reach (stretch)
//   jump    – non-contact wrist jumps between consecutive frames (> maxJump)
// Pure geometry: no canvas required, deterministic, runs in CI.
import path from 'node:path'; import { pathToFileURL, fileURLToPath } from 'node:url';

export const LIMB_THRESHOLDS = Object.freeze({ popLen: 1.5, maxStretch: .6, maxJump: 6, fps: 30 });

export async function traceLimbs(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), { ids = null, views = null, thresholds = LIMB_THRESHOLDS } = {}) {
  const imp = p => import(pathToFileURL(path.join(root, p)).href);
  const P = 'src/capabilities/companion/presentation/';
  const { default: rig } = await imp('assets/companion/usagi/rig/usagi.rig.mjs');
  const { PET_ACTIONS } = await imp('src/content/behaviors.mjs');
  const { SESSION_ACTIVITIES } = await imp('src/content/session-activities.mjs');
  const { sampleActivityStory } = await imp(P + 'activity-playback.mjs');
  const { createRigArtist } = await imp(P + 'rig/rig-art.mjs');
  const { createPathCache } = await imp(P + 'rig/paint.mjs');
  const { default: support } = await imp(P + 'usagi-support.mjs');
  const limbs = await imp(P + 'usagi-limbs.mjs');
  const reach = limbs.USAGI_LIMB_RIG.arm.upper + limbs.USAGI_LIMB_RIG.arm.lower;
  const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
  const targets = [...Object.keys(PET_ACTIONS).map(id => ['action', id]), ...Object.keys(SESSION_ACTIVITIES).map(id => ['session', id])]
    .filter(([, id]) => !ids || ids.includes(id));
  const report = { thresholds, reach, targets: {}, failures: [], warnings: [] };
  for (const [kind, id] of targets) {
    for (const view of views || Object.keys(rig.views)) {
      const data = rig.views[view], channel = `limb-check:${kind}:${id}:${view}`;
      const duration = kind === 'action' ? PET_ACTIONS[id].duration || PET_ACTIONS[id].durationMs || 8000 : 24000;
      const step = 1000 / thresholds.fps, frames = [];
      for (let t = 0; t <= duration; t += step) {
        let action, progress;
        if (kind === 'action') { action = PET_ACTIONS[id]; progress = t / duration; }
        else { const beat = sampleActivityStory(SESSION_ACTIVITIES[id], t / duration); action = beat.action; progress = beat.progress; }
        if (!action) continue;
        const a = artist.resolve(rig, { action, view, motion: action.motion, progress, elapsedMs: t, channel });
        frames.push({ t, l: limbs.traceUsagiLimb(a, data, 'l'), r: limbs.traceUsagiLimb(a, data, 'r') });
      }
      const s = { pops: 0, maxRate: -Infinity, maxLen: 0, maxJump: 0, kinds: new Set() };
      for (let i = 0; i < frames.length; i++) for (const side of ['l', 'r']) {
        const c = frames[i][side]; s.maxLen = Math.max(s.maxLen, c.len); if (c.kind) s.kinds.add(c.kind);
        if (!i) continue; const p = frames[i - 1][side];
        const dl = Math.abs(c.len - p.len);
        // Intent cross-fades are opacity ramps on the channel clock (not geometry):
        // they are checked for duration, not length rate.
        if (c.mode === 'fade' || p.mode === 'fade') { s.fades = (s.fades || 0) + 1; continue; }
        const j = Math.hypot(c.wrist[0] - p.wrist[0], c.wrist[1] - p.wrist[1]); s.maxJump = Math.max(s.maxJump, j);
        const ds = c.socket && p.socket ? Math.hypot(c.socket[0] - p.socket[0], c.socket[1] - p.socket[1]) : 0;
        // A support limb scales its width/length with reach (continuous); allow its ramp slope.
        const ramp = c.kind === 'support' || p.kind === 'support' ? j * 4 : 0;
        s.maxRate = Math.max(s.maxRate, dl - j - ds - ramp);
        if ((p.mode !== c.mode || p.kind !== c.kind) && dl - j - ds - ramp > thresholds.popLen) { s.pops++; report.failures.push(`${kind}:${id}/${view}/${side}@${frames[i].t | 0}ms pop ${p.mode}:${p.kind}->${c.mode}:${c.kind} Δ${dl.toFixed(2)}`); }
      }
      if (s.maxRate > thresholds.maxStretch) report.failures.push(`${kind}:${id}/${view} unexplained limb stretch ${s.maxRate.toFixed(2)}/frame`);
      if (s.maxLen > reach + 1e-6) report.failures.push(`${kind}:${id}/${view} visible limb ${s.maxLen.toFixed(2)} > reach ${reach}`);
      if (s.maxJump > thresholds.maxJump) (report.warnings ||= []).push(`${kind}:${id}/${view} wrist jump ${s.maxJump.toFixed(2)}/frame`);
      report.targets[`${kind}:${id}/${view}`] = { ...s, kinds: [...s.kinds].join(','), maxRate: +s.maxRate.toFixed(3), maxLen: +s.maxLen.toFixed(3), maxJump: +s.maxJump.toFixed(3) };
    }
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.find(a => a.startsWith('--ids='))?.slice(6).split(',') || null;
  const r = await traceLimbs(undefined, { ids });
  const n = Object.keys(r.targets).length;
  console.log(`limb trace: ${n} target-views, ${r.failures.length} failures, ${r.warnings.length} warnings`);
  for (const w of r.warnings.slice(0, 10)) console.log('  warn ' + w);
  for (const f of r.failures.slice(0, 40)) console.log('  ' + f);
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(r, null, 1));
  process.exitCode = r.failures.length ? 1 : 0;
}
