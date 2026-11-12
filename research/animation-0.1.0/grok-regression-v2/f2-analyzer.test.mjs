// grok-regression: F2 acceptance-B analyzer v2 (BUBU-V2-20261112-012). Test tooling only.
// The two synthetic counterexamples dot built against analyzer v1 (synthetic
// analyzer inputs, NOT the recorded six runs) must now be reported, and legal
// contract transitions must still pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseF2 } from './acceptance/f2-analyzer.mjs';

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
