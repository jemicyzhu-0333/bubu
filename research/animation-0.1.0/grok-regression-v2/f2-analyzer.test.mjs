// grok-regression: F2 acceptance-B analyzer v2 (BUBU-V2-20261112-012). Test tooling only.
// The two synthetic counterexamples dot built against analyzer v1 (synthetic
// analyzer inputs, NOT the recorded six runs) must now be reported, and legal
// contract transitions must still pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseF2 as analyseStrict } from './acceptance/f2-analyzer.mjs';
// The layer tests below use tiny synthetic logs, so they relax only the coverage
// minimums; the hardening tests at the end use analyseStrict.
const LOOSE = { minSettledBandMoves: 0, minInBandMoves: 0, minBandFrames: 0, strictBoundaries: false };
const analyseF2 = (rl, opts = {}) => analyseStrict(rl, { ...opts, coverage: LOOSE });

// Build a synthetic renderer log: moves every 17ms at `speed`, frames every 17ms.
function log({ moves, frames }) {
  return { moves, frames, inputs: [], marks: [{ name: 'down', now: 0 }, { name: 'band-74', now: 0 }] };
}
const mv = (now, speed, face, mode = 'drag') => ({ now, t: now / 1000, x: 0, y: 0, speed, face, mode, tag: 'band-74' });
const fr = (now, candidate, requestId) => ({ now, tag: 'band-74', candidate, requestId, owner: 'interaction', phase: 'enter', faceIntent: candidate });
function steady(n, speed, face, t0 = 100) { return Array.from({ length: n }, (_, i) => mv(t0 + i * 17, speed, face)); }

test('grok-regression F2 analyzer: counterexample 1, move log always T05 but frames T05->01->T05', () => {
  const moves = steady(20, 72, 'T05');
  moves[0] = mv(100, 80, 'T05');
  const frames = moves.map((m, i) => fr(m.now + 1, i >= 8 && i < 11 ? '01' : 'T05', i >= 8 && i < 11 ? 'p2' : i >= 11 ? 'p3' : 'p1'));
  const a = analyseF2(log({ moves, frames }));
  assert.equal(a.controllerViolations, 0);
  assert.equal(a.displayedUnexplained, 2, JSON.stringify(a.details.switches));
  assert.equal(a.pass, false);
});

test('grok-regression F2 analyzer: counterexample 2, T05 then 200ms later N3 at speed 70 is not a timeout', () => {
  const moves = [mv(100, 80, 'T05'), mv(117, 75, 'T05'), mv(317, 70, 'N3')];
  const frames = [fr(101, 'T05', 'p1'), fr(118, 'T05', 'p1'), fr(200, 'T05', 'p1'), fr(318, 'N3', 'p2')];
  const a = analyseF2(log({ moves, frames }));
  assert.ok(a.controllerViolations >= 1, JSON.stringify(a.details.controller));
  assert.equal(a.displayedUnexplained, 1, JSON.stringify(a.details.switches));
  assert.equal(a.pass, false);
});

test('grok-regression F2 analyzer: a >=120ms gap only explains T05 -> 01, and re-entry needs > 70', () => {
  // legal: T05, stop 150ms, display 01 inside the gap, resume at 72 -> stays 01 (null latch needs > 70: 72 is > 70 so T05)
  const legal = analyseF2(log({
    moves: [mv(100, 80, 'T05'), mv(117, 74, 'T05'), mv(267, 69, '01'), mv(284, 69, '01')],
    frames: [fr(101, 'T05', 'p1'), fr(118, 'T05', 'p1'), fr(240, '01', 'p2'), fr(268, '01', 'p2'), fr(285, '01', 'p2')],
  }));
  assert.equal(legal.pass, true, JSON.stringify(legal.details));
  // illegal: 01 then gap, display jumps to T05 with no move > 70
  const illegal = analyseF2(log({
    moves: [mv(100, 80, 'T05'), mv(117, 60, '01'), mv(267, 69, '01')],
    frames: [fr(101, 'T05', 'p1'), fr(118, '01', 'p2'), fr(240, 'T05', 'p3'), fr(268, '01', 'p4')],
  }));
  assert.equal(illegal.displayedUnexplained, 2, JSON.stringify(illegal.details.switches));
  // illegal controller: after the gap, 01 -> T05 at 69 (re-entry must exceed 70)
  const reentry = analyseF2(log({ moves: [mv(100, 80, 'T05'), mv(117, 60, '01'), mv(267, 69, 'T05')], frames: [] }));
  assert.equal(reentry.controllerViolations, 1);
});

test('grok-regression F2 analyzer: owner restart without a candidate change is reported', () => {
  const moves = steady(10, 72, 'T05'); moves[0] = mv(100, 80, 'T05');
  const frames = moves.map((m, i) => fr(m.now + 1, 'T05', i < 5 ? 'p1' : 'p2'));
  const a = analyseF2(log({ moves, frames }));
  assert.equal(a.restartsWithoutSwitch, 1);
  assert.equal(a.pass, false);
});

test('grok-regression F2 analyzer: hysteresis crossings at < 64 / > 76 are explained', () => {
  const moves = [mv(100, 80, 'T05'), mv(117, 66, 'T05'), mv(134, 63, '01'), mv(151, 74, '01'), mv(168, 77, 'T05')];
  const frames = [fr(101, 'T05', 'p1'), fr(118, 'T05', 'p1'), fr(135, '01', 'p2'), fr(152, '01', 'p2'), fr(186, 'T05', 'p3')];
  const a = analyseF2(log({ moves, frames }));
  assert.equal(a.pass, true, JSON.stringify(a.details));
  assert.equal(a.displayedExplained, 2);
  // the single-70 baseline contract would not hold the 66 sample in T05
  assert.ok(analyseF2(log({ moves, frames }), { contract: 'threshold' }).controllerViolations >= 1);
});

// Hardening after BUBU-V2-20261112-013 (dot's three analyzer counterexamples).
// A full synthetic session: down, pending, pickup (N3), fast enter (T05), long
// in-band run, end. Strict coverage applies.
function session({ bandFace = () => 'T05', frameFace = null, pickupFace = 'N3' } = {}) {
  const moves = [], frames = [];
  const tag = (now) => now < 50 ? 'down' : now < 150 ? 'enter-110' : now < 1400 ? 'band-74' : 'end';
  const push = (now, speed, face, mode) => moves.push({ now, t: now / 1000, x: 0, y: 0, speed, face, mode, tag: tag(now) });
  push(60, 0, null, 'pending'); push(77, 110, pickupFace, 'pickup'); push(94, 110, 'T05', 'drag');
  for (let now = 160, k = 0; now < 1400; now += 17, k++) push(now, 72, bandFace(k), 'drag');
  const shownAt = now => { const m = moves.filter(x => x.now <= now).at(-1); return m ? (m.mode === 'pending' ? null : m.face) : null; };
  for (let now = 61, k = 0; now < 1450; now += 17, k++) {
    const c = frameFace ? frameFace(k, shownAt(now)) : shownAt(now);
    frames.push({ now, tag: tag(now), candidate: c, requestId: 'r-' + c, owner: 'interaction', phase: 'enter', faceIntent: c });
  }
  const marks = [{ name: 'down', now: 0 }, { name: 'enter-110', now: 50 }, { name: 'band-74', now: 150 }, { name: 'end', now: 1400 }];
  return { moves, frames, inputs: [], marks };
}

test('grok-regression F2 analyzer: a clean full session passes strict coverage', () => {
  const a = analyseStrict(session());
  assert.deepEqual(a.coverage.problems, []);
  assert.equal(a.pass, true, JSON.stringify(a.details));
});

test('grok-regression F2 analyzer: mid-run displayed T05 -> null -> T05 is unexplained (013 #1)', () => {
  const a = analyseStrict(session({ frameFace: (k, c) => (k >= 30 && k < 33 ? null : c) }));
  assert.equal(a.displayedUnexplained, 2, JSON.stringify(a.details.switches));
  assert.ok(a.details.switches.every(s => s.explained || s.reason === 'mid-session-null'));
  assert.equal(a.pass, false);
  // and a mid-run null in the controller log is a controller violation
  const b = analyseStrict(session({ bandFace: k => (k === 20 ? null : 'T05') }));
  assert.ok(b.controllerViolations >= 1, JSON.stringify(b.details.controller));
  assert.equal(b.pass, false);
});

test('grok-regression F2 analyzer: pickup with face T05 is a controller error (013 #2)', () => {
  const a = analyseStrict(session({ pickupFace: 'T05' }));
  assert.ok(a.details.controller.some(v => v.mode === 'pickup' && v.logged === 'T05'), JSON.stringify(a.details.controller));
  assert.equal(a.pass, false);
  // pending must log null
  const s = session(); s.moves[0].face = '01';
  assert.ok(analyseStrict(s).details.controller.some(v => v.mode === 'pending'));
  // a displayed N3 after the airborne face started is unexplained
  const late = analyseStrict(session({ frameFace: (k, c) => (k === 40 ? 'N3' : c) }));
  assert.ok(late.details.switches.some(x => x.reason === 'late-pickup-face'), JSON.stringify(late.details.switches));
  assert.equal(late.pass, false);
});

test('grok-regression F2 analyzer: empty, low-coverage or unbounded logs fail (013 #3)', () => {
  const empty = analyseStrict({ moves: [], frames: [], marks: [], inputs: [] });
  assert.equal(empty.pass, false);
  assert.ok(empty.coverage.problems.includes('no-moves') && empty.coverage.problems.includes('no-frames'));
  assert.equal(analyseStrict(undefined).pass, false);
  const short = session(); short.moves = short.moves.filter(m => m.now < 400); short.frames = short.frames.filter(f => f.now < 400);
  const a = analyseStrict(short);
  assert.equal(a.pass, false);
  assert.ok(a.coverage.problems.some(p => p.startsWith('settled-band-moves')), JSON.stringify(a.coverage));
  const open = session(); open.marks.pop();
  assert.ok(analyseStrict(open).coverage.problems.includes('session-not-closed-by-end-mark'));
  const late = session(); late.moves.splice(0, 2);
  assert.ok(analyseStrict(late).coverage.problems.includes('session-does-not-start-in-pending-or-pickup'));
});
