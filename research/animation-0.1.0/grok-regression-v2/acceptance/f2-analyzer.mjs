// F2 acceptance-B analyzer v2 (test tooling, no product code). Replaces the v1
// move-only classifier after BUBU-V2-20261112-012:
//  1. controller layer: every logged DragController.move snapshot must follow the
//     r3 faceIntent contract (4eb3377 drag-controller.mjs updateAirborneFace):
//       pending -> null, pickup -> N3; airborne null -> T05 only if speed > 70,
//       T05 -> 01 only if speed < 64, 01 -> T05 only if speed > 76, and a
//       >= 120ms stationary gap only clears the latch (null displays as 01).
//     `threshold` mode replays the single-70 baseline contract instead.
//  2. display layer: every per-frame change of the displayed owner candidate must
//     match an expected controller transition (same from/to) whose time lies
//     between the previous-but-one frame and this frame; a timeout or timed
//     pickup exit may land anywhere in its gap. Chains of expected transitions
//     in that window may collapse into one displayed switch.
//  3. owner restarts: every requestId change must coincide with a displayed
//     candidate change, and every candidate change must carry a new requestId.
// Anything else is counted as unexplained. Same 64/76 rule as r3, so this
// proves conformance to the contract, not that no switch is visible.
export const CONTRACTS = Object.freeze({
  hysteresis: { enter: 70, down: 64, up: 76 },
  threshold: { enter: 70, down: 70, up: 70 },
});
const TIMEOUT = 0.12, PICKUP_SECONDS = 1.075;

function step(air, speed, c) {
  if (air === null) return speed > c.enter ? 'T05' : null;
  if (c.down === c.up) return speed > c.enter ? 'T05' : '01'; // single threshold: no latch
  if (air === 'T05' && speed < c.down) return '01';
  if (air === '01' && speed > c.up) return 'T05';
  return air;
}
const shown = (mode, air) => mode === 'pending' ? null : mode === 'pickup' ? 'N3' : (air ?? '01');

export function controllerLayer(moves, contract = 'hysteresis') {
  const c = CONTRACTS[contract];
  const events = [], violations = [];
  let air = null, prev = null, leftPickup = false, pickupT = null;
  for (const m of moves) {
    const before = prev ? shown(prev.mode, air) : null;
    let windowLo = prev ? prev.now : m.now;
    if (prev && !['pending', 'pickup'].includes(prev.mode) && m.t - prev.t >= TIMEOUT && air !== null) {
      // r3 contract: a stationary gap >= 120ms clears the latch (displays 01).
      if (contract === 'hysteresis') {
        if (air === 'T05') events.push({ from: 'T05', to: '01', lo: prev.now, hi: m.now, reason: 'stationary-timeout' });
        air = null;
      } else if (air === 'T05') { events.push({ from: 'T05', to: '01', lo: prev.now, hi: m.now, reason: 'stationary-timeout' }); air = '01'; }
    }
    if (m.mode === 'pickup' && pickupT === null) pickupT = m.t;
    var hit = true;
    if (['pending', 'pickup'].includes(m.mode)) {
      if (leftPickup) violations.push({ at: m.now, kind: 'mode-regressed-to-' + m.mode });
      air = null;
    } else {
      const candidates = [];
      if (prev && prev.mode === 'pickup') {
        leftPickup = true;
        // fast takeover at this move: rule applied with this move's speed only.
        candidates.push({ air: step(null, m.speed, c), via: 'fast-takeover' });
        // timed pickup exit in an earlier advance: old velocity first, then this move.
        if (pickupT !== null && m.t - pickupT >= PICKUP_SECONDS) {
          const a0 = (prev.t + TIMEOUT > pickupT + PICKUP_SECONDS) ? step(null, prev.speed, c) : null;
          if (a0 !== null) events.push({ from: 'N3', to: a0, lo: prev.now, hi: m.now, reason: 'pickup-exit' });
          candidates.push({ air: step(a0, m.speed, c), via: 'pickup-exit', a0 });
        }
      } else candidates.push({ air: step(air, m.speed, c), via: 'move' });
      var hit = candidates.find(k => shown(m.mode, k.air) === m.face);
      const chosen = hit ?? candidates[0];
      air = chosen.air;
      if (!hit) air = m.face === 'T05' ? 'T05' : m.face === '01' ? (chosen.air === null ? null : '01') : null;
      if (!hit) violations.push({ at: +m.now.toFixed(1), kind: 'controller-face', expected: shown(m.mode, air), logged: m.face, speed: +m.speed.toFixed(2), mode: m.mode });
    }
    const after = m.face; // follow the logged state so one violation is not double counted
    if (before !== null && before !== after && !(events.at(-1)?.hi === m.now && events.at(-1)?.to === after && events.at(-1)?.from === before))
      events.push({ from: before, to: after, lo: m.now, hi: m.now, reason: hit ? 'move' : 'controller-violation', invalid: !hit, speed: +m.speed.toFixed(2) });
    if (prev === null && after) events.push({ from: null, to: after, lo: m.now, hi: m.now, reason: 'first-move' });
    prev = m;
  }
  return { events, violations };
}

export function displayLayer(frames, events) {
  const seq = frames.filter(f => f.candidate !== undefined);
  const used = new Set(); const switches = []; let restartsWithoutSwitch = 0, switchesWithoutRestart = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const changed = a.candidate !== b.candidate, restarted = a.requestId !== b.requestId;
    if (restarted && !changed) restartsWithoutSwitch++;
    if (!changed) continue;
    if (!restarted && b.candidate !== null) switchesWithoutRestart++;
    if (a.candidate === null || b.candidate === null) { switches.push({ at: +b.now.toFixed(1), from: a.candidate, to: b.candidate, explained: true, reason: 'session-boundary' }); continue; }
    const lo = (seq[i - 2] ?? a).now, hi = b.now;
    // candidate expected transitions overlapping (lo, hi], in order, unused
    const win = events.map((e, k) => ({ e, k })).filter(({ e, k }) => !used.has(k) && !e.invalid && e.from !== null && e.lo <= hi && e.hi >= lo);
    let match = null;
    for (let s = 0; s < win.length && !match; s++) {
      if (win[s].e.from !== a.candidate) continue;
      let cur = a.candidate; const chain = [];
      for (let t = s; t < win.length; t++) {
        if (win[t].e.from !== cur) continue;
        cur = win[t].e.to; chain.push(win[t]);
        if (cur === b.candidate) { match = chain.slice(); break; }
      }
    }
    if (match) match.forEach(({ k }) => used.add(k));
    switches.push({ at: +b.now.toFixed(1), from: a.candidate, to: b.candidate, explained: !!match, reason: match ? match.map(m => m.e.reason).join('+') : null });
  }
  const missedExpected = events.filter((e, k) => !used.has(k) && !e.invalid && e.from !== null && e.reason !== 'first-move').length;
  return { switches, restartsWithoutSwitch, switchesWithoutRestart, missedExpected };
}

export function analyseF2(rl, { contract = 'hysteresis' } = {}) {
  const session = rl.moves.filter(m => m.tag && m.tag !== 'down'); // includes moves delivered after the 'end' mark
  const ctl = controllerLayer(session, contract);
  const frames = rl.frames.filter(f => f.tag && f.tag !== 'down');
  const disp = displayLayer(frames, ctl.events);
  const band = rl.moves.filter(m => m.tag && m.tag.startsWith('band'));
  const firstBandNow = rl.marks.find(m => m.name.startsWith('band'))?.now ?? 0;
  const settled = band.filter(m => m.now >= firstBandNow + 80);
  const inBand = settled.filter(m => m.speed >= 64 && m.speed <= 76).length;
  const bandFrames = frames.filter(f => f.tag.startsWith('band'));
  const bandRestarts = bandFrames.reduce((n, f, i, arr) => n + (i && f.requestId !== arr[i - 1].requestId ? 1 : 0), 0);
  const unexplained = disp.switches.filter(s => !s.explained).length;
  return {
    analyzer: 'f2-analyzer v2', contract,
    inBandFraction: settled.length ? +(inBand / settled.length).toFixed(4) : null,
    controllerViolations: ctl.violations.length,
    displayedSwitches: disp.switches.length,
    displayedExplained: disp.switches.length - unexplained,
    displayedUnexplained: unexplained,
    restartsWithoutSwitch: disp.restartsWithoutSwitch,
    switchesWithoutRestart: disp.switchesWithoutRestart,
    expectedTransitionsNotDisplayed: disp.missedExpected,
    ownerRequestRestartsInBand: bandRestarts,
    pass: ctl.violations.length === 0 && unexplained === 0 && disp.restartsWithoutSwitch === 0 && disp.switchesWithoutRestart === 0,
    details: { controller: ctl.violations, switches: disp.switches },
  };
}
