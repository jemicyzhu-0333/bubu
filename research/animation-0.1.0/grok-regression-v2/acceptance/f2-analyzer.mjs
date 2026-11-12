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
//  4. hardening after BUBU-V2-20261112-013: pending moves must log face null and
//     pickup moves N3; a displayed null is only legal before the first displayed
//     face (start pending) or after the 'end' mark, and N3 only before the first
//     airborne face, so a mid-run T05->null->T05 or a late N3 is unexplained;
//     empty or low-coverage logs fail (coverage block), and the session must open
//     with the 'down' mark and close with the 'end' mark.
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
      const want = m.mode === 'pending' ? null : 'N3';
      if (m.face !== want) { hit = false; violations.push({ at: +m.now.toFixed(1), kind: 'controller-face', expected: want, logged: m.face, speed: +m.speed.toFixed(2), mode: m.mode }); }
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
      const expected = shown(m.mode, chosen.air);
      air = chosen.air;
      if (!hit) air = m.face === 'T05' ? 'T05' : m.face === '01' ? (chosen.air === null ? null : '01') : null;
      if (!hit) violations.push({ at: +m.now.toFixed(1), kind: 'controller-face', expected, logged: m.face, speed: +m.speed.toFixed(2), mode: m.mode });
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
  const atEnd = f => f.tag === 'end';
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const changed = a.candidate !== b.candidate, restarted = a.requestId !== b.requestId;
    if (restarted && !changed) restartsWithoutSwitch++;
    if (!changed) continue;
    if (!restarted && b.candidate !== null) switchesWithoutRestart++;
    if (a.candidate === null || b.candidate === null) {
      // null -> face is only legal while nothing has been displayed yet (start pending);
      // face -> null only after the 'end' mark (release). Mid-run nulls are unexplained.
      const legal = b.candidate === null ? atEnd(b) : !seq.slice(0, i).some(f => f.candidate !== null && !atEnd(f)) || atEnd(b);
      switches.push({ at: +b.now.toFixed(1), from: a.candidate, to: b.candidate, explained: legal, reason: legal ? 'session-boundary' : 'mid-session-null' });
      continue;
    }
    if (b.candidate === 'N3' && !atEnd(b) && seq.slice(0, i).some(f => f.candidate === 'T05' || f.candidate === '01')) {
      switches.push({ at: +b.now.toFixed(1), from: a.candidate, to: b.candidate, explained: false, reason: 'late-pickup-face' }); continue;
    }
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

export const COVERAGE = Object.freeze({ minSettledBandMoves: 30, minInBandMoves: 20, minBandFrames: 20, strictBoundaries: true });

export function analyseF2(rl, { contract = 'hysteresis', coverage: cov = {} } = {}) {
  cov = { ...COVERAGE, ...cov };
  rl = { moves: rl?.moves ?? [], frames: rl?.frames ?? [], marks: rl?.marks ?? [], inputs: rl?.inputs ?? [] };
  const markNames = rl.marks.map(m => m.name);
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
  const coverageProblems = [];
  if (!rl.moves.length) coverageProblems.push('no-moves');
  if (!rl.frames.length) coverageProblems.push('no-frames');
  if (markNames[0] !== 'down') coverageProblems.push('session-not-opened-by-down-mark');
  if (cov.strictBoundaries && markNames.at(-1) !== 'end') coverageProblems.push('session-not-closed-by-end-mark');
  if (cov.strictBoundaries && session.length && !['pending', 'pickup'].includes(session[0].mode)) coverageProblems.push('session-does-not-start-in-pending-or-pickup');
  if (settled.length < cov.minSettledBandMoves) coverageProblems.push(`settled-band-moves ${settled.length} < ${cov.minSettledBandMoves}`);
  if (inBand < cov.minInBandMoves) coverageProblems.push(`in-band-moves ${inBand} < ${cov.minInBandMoves}`);
  if (bandFrames.length < cov.minBandFrames) coverageProblems.push(`band-frames ${bandFrames.length} < ${cov.minBandFrames}`);
  return {
    analyzer: 'f2-analyzer v2.1', contract,
    inBandFraction: settled.length ? +(inBand / settled.length).toFixed(4) : null,
    coverage: { settledBandMoves: settled.length, inBandMoves: inBand, bandFrames: bandFrames.length, problems: coverageProblems },
    controllerViolations: ctl.violations.length,
    displayedSwitches: disp.switches.length,
    displayedExplained: disp.switches.length - unexplained,
    displayedUnexplained: unexplained,
    restartsWithoutSwitch: disp.restartsWithoutSwitch,
    switchesWithoutRestart: disp.switchesWithoutRestart,
    expectedTransitionsNotDisplayed: disp.missedExpected,
    ownerRequestRestartsInBand: bandRestarts,
    pass: coverageProblems.length === 0 && ctl.violations.length === 0 && unexplained === 0 && disp.restartsWithoutSwitch === 0 && disp.switchesWithoutRestart === 0,
    details: { controller: ctl.violations, switches: disp.switches },
  };
}
