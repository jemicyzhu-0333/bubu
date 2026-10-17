import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceTimeline, FACE_TIMELINE_LIMITS as L } from '../src/face-timeline.mjs';

const face = (time, id = 'A', amount = 1, fadeOutSec = .2, fadeInSec = .4) =>
  ({ type: 'face', time, id, amount, fadeOutSec, fadeInSec });
const cancel = (time, fadeOutSec = .2) => ({ type: 'cancel', time, fadeOutSec });
const close = (a, b, eps = 1e-11) => assert(Math.abs(a - b) <= eps, `${a} != ${b}`);
function rig() {
  const writes = [];
  const timeline = new FaceTimeline(['A', 'B', 'C'], (path, value) => writes.push([path, value]));
  return { timeline, writes };
}
function current(s) { return [s.path, s.value, s.velocity]; }

// Independent analytical value for the un-interrupted cubic, not the class's implementation.
const smooth = u => 3 * u * u - 2 * u * u * u;

test('face-only construction is neutral; settled sampling is unchanged and diagnostics are read-only', () => {
  const { timeline: s, writes } = rig();
  assert.deepEqual(writes, [[null, 0]]);
  assert.equal(s.isAnimating(), false);
  assert.equal(s.nextDeadline(), Infinity);
  for (let t = 0; t < 10; t++) assert.equal(s.advance(t), false);
  assert.equal(writes.length, 1);
  assert(Object.isFrozen(s.snapshot()));
  assert.throws(() => { s.state.value = .4; }, TypeError);
  assert.throws(() => { s.value = .4; }, TypeError);
});

test('entry has exact endpoints and a canonical hold/actual arrival after a large jump', () => {
  const { timeline: s } = rig();
  s.enqueue(face(2, 'A', .7));
  assert.equal(s.nextDeadline(), 2);
  assert.equal(s.advance(1), false);
  s.advance(2);
  assert.deepEqual(current(s), ['A', 0, 0]);
  assert.equal(s.phase, 'enter');
  assert.equal(s.arrivalTime, 2.4);
  assert.equal(s.actualArrival, null);
  assert.equal(s.holdSince, null);
  s.advance(2.2);
  close(s.value, .7 * smooth(.5));
  close(s.velocity, .7 * 1.5 / .4);
  s.advance(30);
  assert.deepEqual(current(s), ['A', .7, 0]);
  assert.equal(s.phase, 'hold');
  assert.equal(s.actualArrival, 2.4);
  assert.equal(s.holdSince, 2.4);
  assert.equal(s.isAnimating(), false);
  assert.equal(s.nextDeadline(), Infinity);
});

test('cross-face emits exact original Basis before entering the next ID even on one large jump', () => {
  const { timeline: s, writes } = rig();
  s.enqueue(face(0, 'A', .8, .2, .2));
  s.enqueue(face(1, 'B', .9, .2, .4));
  s.advance(10);
  assert.deepEqual(current(s), ['B', .9, 0]);
  assert.equal(s.actualArrival, 1.2 + .4);
  const neutral = writes.findIndex((x, i) => i > 0 && x[0] === null);
  assert(neutral > 0);
  assert.deepEqual(writes.slice(neutral - 1, neutral + 2), [['A', 0], [null, 0], ['B', 0]]);
});

test('interrupted entry is C1 in scalar value and velocity, with an explicit <=40 ms brake', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0));
  s.advance(.13);
  const before = current(s);
  s.enqueue(face(.13, 'B', .65, .17, .31));
  s.advance(.13);
  assert.deepEqual(current(s), before);
  const plan = s.state;
  assert.equal(plan.phase, 'brake');
  close(plan.brakingSec, .04);
  assert.equal(plan.actualArrival, null);
  assert.equal(plan.arrivalTime, plan.brakeEndsAt + .17 + .31);
  const dt = 1e-6;
  s.advance(.13 + dt);
  close((s.value - before[1]) / dt, before[2], .001);
  assert(s.velocity > 0 && s.velocity < before[2]);
  s.advance(plan.brakeEndsAt);
  assert.equal(s.velocity, 0);
  assert.equal(s.phase, 'withdraw');
  const brakeValue = s.value;
  s.advance(plan.brakeEndsAt + dt);
  close((s.value - brakeValue) / dt, 0, .001);
  const neutralAt = s.state.neutralAt;
  s.advance(neutralAt);
  assert.deepEqual(current(s), ['B', 0, 0]);
  s.advance(s.arrivalTime);
  assert.deepEqual(current(s), ['B', .65, 0]);
  assert.equal(s.holdSince, plan.arrivalTime);
});

test('same-face mid-entry reversal preserves velocity, brakes, then reaches the lower amount', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0));
  s.advance(.2);
  const before = current(s);
  s.enqueue(face(.2, 'A', .1, .2, .3));
  s.advance(.2);
  assert.deepEqual(current(s), before);
  assert.equal(s.state.targetAmount, .1);
  const brakeEnd = s.state.brakeEndsAt;
  s.advance(brakeEnd);
  assert(s.value > before[1]); // Velocity cannot reverse instantaneously under C1.
  assert.equal(s.velocity, 0);
  assert.equal(s.phase, 'adjust');
  s.advance(brakeEnd + .1);
  assert(s.velocity < 0);
  s.advance(brakeEnd + .3);
  assert.deepEqual(current(s), ['A', .1, 0]);
  assert.equal(s.actualArrival, brakeEnd + .3);
});

test('interrupting a downward same-face adjustment preserves its negative velocity', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0, 'A', 1, .2, .04));
  s.enqueue(face(.1, 'A', .1, .2, .6));
  s.advance(.37);
  assert(s.velocity < 0);
  const before = current(s);
  s.enqueue(face(.37, 'A', .9, .2, .2));
  s.advance(.37);
  assert.deepEqual(current(s), before);
  const end = s.state.brakeEndsAt;
  s.advance(end);
  assert(s.value < before[1]);
  assert.equal(s.velocity, 0);
  s.advance(end + .2);
  assert.deepEqual(current(s), ['A', .9, 0]);
});

test('destination replacements during brake and withdrawal never restart the visible trajectory', () => {
  const a = rig().timeline, b = rig().timeline;
  for (const s of [a, b]) {
    s.enqueue(face(0));
    s.enqueue(face(.1, 'B', .8, .3, .2));
    s.advance(.11);
  }
  const originalBrakeEnd = a.state.brakeEndsAt;
  a.enqueue(face(.11, 'C', .6, 2, .5));
  a.advance(.11);
  assert.deepEqual(current(a), current(b));
  assert.equal(a.state.brakeEndsAt, originalBrakeEnd);
  assert.equal(a.state.neutralAt, b.state.neutralAt);
  a.advance(.21); b.advance(.21);
  const before = current(a), neutralAt = a.state.neutralAt;
  a.enqueue(face(.21, 'A', .3, 2, .4)); // Returning to the outgoing ID still completes the bridge.
  a.advance(.21);
  assert.deepEqual(current(a), before);
  for (const t of [.25, .3, .4]) {
    a.advance(t); b.advance(t);
    assert.deepEqual(current(a), current(b));
  }
  assert.equal(a.state.neutralAt, neutralAt);
  a.advance(neutralAt);
  assert.deepEqual(current(a), ['A', 0, 0]);
  a.advance(a.arrivalTime);
  assert.deepEqual(current(a), ['A', .3, 0]);
});

test('same-face retarget during an existing brake changes only the pending goal', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0));
  s.enqueue(face(.15, 'A', .2, .2, .2));
  s.advance(.16);
  const before = current(s), end = s.state.brakeEndsAt;
  s.enqueue(face(.16, 'A', .65, .2, .3));
  s.advance(.16);
  assert.deepEqual(current(s), before);
  assert.equal(s.state.brakeEndsAt, end);
  assert.equal(s.arrivalTime, end + .3);
  s.advance(s.arrivalTime);
  assert.deepEqual(current(s), ['A', .65, 0]);
});

test('identical destination cues do not extend entry, brake, withdrawal or hold', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0)); s.advance(.1);
  const firstArrival = s.arrivalTime;
  s.enqueue(face(.1, 'A', 1, 2, 2)); s.advance(.1);
  assert.equal(s.arrivalTime, firstArrival);
  s.enqueue(face(.12, 'B', .8)); s.advance(.13);
  const brakeEnd = s.state.brakeEndsAt, nextArrival = s.arrivalTime;
  s.enqueue(face(.13, 'B', .8)); s.advance(.13);
  assert.equal(s.state.brakeEndsAt, brakeEnd);
  assert.equal(s.arrivalTime, nextArrival);
  s.advance(brakeEnd + .05);
  s.enqueue(face(s.time, 'B', .8)); s.advance(s.time);
  assert.equal(s.arrivalTime, nextArrival);
  s.advance(nextArrival);
  s.enqueue(face(nextArrival + .1, 'B', .8)); s.advance(nextArrival + .1);
  assert.equal(s.holdSince, nextArrival);
  assert.equal(s.actualArrival, nextArrival);
});

for (const scenario of [
  { name: 'idle', events: [], at: .15 },
  { name: 'entry', events: [face(0)], at: .15 },
  { name: 'hold', events: [face(0, 'A', .8, .2, .04)], at: .15 },
  { name: 'same-face brake', events: [face(0), face(.1, 'A', .2)], at: .11 },
  { name: 'cross-face brake', events: [face(0), face(.1, 'B', .8)], at: .11 },
  { name: 'withdrawal', events: [face(0), face(.1, 'B', .8)], at: .25 },
  { name: 'adjustment', events: [face(0, 'A', .8, .2, .04), face(.1, 'A', .2)], at: .25 }
]) test(`cancel during ${scenario.name} preserves the sampled state, clears old future cues and ends neutral`, () => {
  const { timeline: s } = rig();
  for (const event of scenario.events) s.enqueue(event);
  s.advance(scenario.at);
  const before = current(s);
  s.enqueue(cancel(scenario.at, .17));
  s.enqueue(face(scenario.at + 1, 'C'));
  s.advance(scenario.at);
  assert.deepEqual(current(s), before);
  assert.equal(s.state.queued, 0);
  assert.equal(s.state.generation, 1);
  const arrival = s.arrivalTime;
  s.advance(arrival);
  assert.deepEqual(current(s), [null, 0, 0]);
  assert.equal(s.actualArrival, arrival);
  assert.equal(s.holdSince, arrival);
  s.advance(scenario.at + 2);
  assert.deepEqual(current(s), [null, 0, 0]);
  assert.equal(s.isAnimating(), false);
});

test('zero amount is a neutral destination without cancel generation side effects', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0));
  s.enqueue(face(.2, 'B', 0));
  s.enqueue(face(1, 'C', .3));
  s.advance(.8);
  assert.deepEqual(current(s), [null, 0, 0]);
  assert.equal(s.state.generation, 0);
  assert.equal(s.nextDeadline(), 1);
  s.advance(2);
  assert.deepEqual(current(s), ['C', .3, 0]);
});

test('cancel wins its timestamp independent of insertion order and invalidates all already-queued cues', () => {
  for (const events of [
    [face(.2, 'B'), cancel(.2), face(.2, 'C')],
    [cancel(.2), face(.2, 'B'), face(.2, 'C')],
    [face(.2, 'B'), face(.2, 'C'), cancel(.2)]
  ]) {
    const { timeline: s, writes } = rig();
    s.enqueue(face(0));
    for (const event of events) s.enqueue(event);
    s.enqueue(face(1, 'C'));
    s.advance(2);
    assert.deepEqual(current(s), [null, 0, 0]);
    assert(!writes.some(([path]) => path === 'B' || path === 'C'));
    assert.equal(s.nextDeadline(), Infinity);
  }
});

test('last inserted cancel supplies the fade, and post-cancel generation can schedule fresh work', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0, 'A', 1, .1, .04));
  s.enqueue(cancel(.1, .2)); s.enqueue(cancel(.1, .7));
  s.advance(.1);
  assert.equal(s.arrivalTime, .1 + .7);
  s.enqueue(face(.1, 'B')); // Dominance persists even across advance calls at the same time.
  s.enqueue(face(.2, 'C', .3, .2, .1));
  s.advance(.1);
  assert.equal(s.state.targetPath, null);
  s.advance(2);
  assert.deepEqual(current(s), ['C', .3, 0]);
});

test('equal-time face cues retain insertion order; last destination wins without artificial travel', () => {
  const { timeline: s, writes } = rig();
  s.enqueue(face(0, 'A', .3));
  s.enqueue(face(0, 'B', .4));
  s.enqueue(face(0, 'C', .6));
  s.advance(0);
  assert.deepEqual(current(s), ['C', 0, 0]);
  assert.equal(s.phase, 'enter');
  assert.equal(s.arrivalTime, .4);
  assert(writes.every(([, value]) => value === 0));
  s.advance(1);
  assert.deepEqual(current(s), ['C', .6, 0]);
});

test('large jumps and 30/60/120 Hz produce identical event-time state and canonical arrival metadata', () => {
  const events = [face(0), face(.133, 'A', .2), face(.149, 'B', .7, .23, .41),
    face(.203, 'C', .6, .3, .37), face(.537, 'C', .2), face(.601, 'A', .75), cancel(.81)];
  const goals = [0, .033, .133, .149, .173, .203, .4, .537, .601, .81, .9, 1.3, 3];
  const runs = [];
  for (const hz of [0, 30, 60, 120]) {
    const { timeline: s } = rig();
    events.forEach(e => s.enqueue(e));
    const samples = [];
    let now = 0;
    for (const goal of goals) {
      if (hz) while (now + 1 / hz < goal) { now += 1 / hz; s.advance(now); }
      s.advance(goal); now = goal;
      samples.push(s.snapshot());
    }
    runs.push(samples);
  }
  for (const run of runs.slice(1)) assert.deepEqual(run, runs[0]);
});

test('new intent at a phase endpoint uses the exact settled value and zero velocity', () => {
  const { timeline: s } = rig();
  s.enqueue(face(0, 'A', 1, .04, .04));
  s.enqueue(face(.04, 'B', 1, .04, .04));
  s.advance(.04);
  assert.deepEqual(current(s), ['A', 1, 0]);
  assert.equal(s.phase, 'withdraw');
  assert.equal(s.state.brakingSec, 0);
  s.advance(.08);
  assert.deepEqual(current(s), ['B', 0, 0]);
  s.enqueue(cancel(.08, .04)); s.advance(.08);
  assert.deepEqual(current(s), [null, 0, 0]);
});

test('near-end reversal uses the shorter remaining interval for braking and never leaves [0,1]', () => {
  for (const origin of [0, 1e9 - 10]) {
    const { timeline: s } = rig();
    s.enqueue(face(origin, 'A', 1, .04, .04));
    const time = origin + .04 - (origin ? 1e-6 : 1e-10);
    s.advance(time);
    const before = current(s);
    s.enqueue(face(time, 'A', 1e-12, .04, .04)); s.advance(time);
    assert.deepEqual(current(s), before);
    assert(s.state.brakingSec > 0 && s.state.brakingSec <= .04 + 1e-7);
    const end = s.state.brakeEndsAt;
    for (let i = 1; i <= 100; i++) {
      s.advance(time + (end - time) * i / 100);
      assert(s.value >= 0 && s.value <= 1);
    }
    assert.equal(s.velocity, 0);
    s.advance(s.arrivalTime);
    assert.deepEqual(current(s), ['A', 1e-12, 0]);
  }
});

test('deterministic interruption stress stays strictly bounded, has one path, and eventually holds', () => {
  let seed = 81723;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const origin of [0, 1e9 - 50]) {
    const { timeline: s } = rig();
    let time = origin;
    for (let i = 0; i < 1500; i++) {
      time += .0001 + random() * .06;
      s.advance(time);
      const before = current(s);
      const amount = i % 4 === 0 ? 1 : i % 4 === 1 ? 1e-12 : random();
      s.enqueue(face(time, ['A', 'B', 'C'][Math.floor(random() * 3)], amount,
        .04 + random() * .08, .04 + random() * .08));
      s.advance(time);
      assert.equal(s.value, before[1]);
      assert.equal(s.velocity, before[2]);
      assert(s.value >= 0 && s.value <= 1, `outside bounds at ${time}: ${s.value}`);
      assert(Number.isFinite(s.velocity));
      if (s.path === null) assert.equal(s.value, 0);
    }
    s.advance(s.arrivalTime);
    assert.equal(s.phase, 'hold');
    assert.equal(s.velocity, 0);
    assert(s.value >= 0 && s.value <= 1);
  }
});

test('admission is bounded, immutable, finite, canonical and atomic on invalid input', () => {
  assert.throws(() => new FaceTimeline([], () => {}));
  assert.throws(() => new FaceTimeline(['A', 'A'], () => {}));
  assert.throws(() => new FaceTimeline('A', () => {}));
  assert.throws(() => new FaceTimeline(['A'], null));
  const { timeline: s } = rig();
  for (const bad of [null, {}, { ...face(0), type: 'play' }, face(0, 'unknown'),
    face(-1), face(NaN), face(Infinity), face(1e9 + 1), face(1e9),
    face(0, 'A', -.001), face(0, 'A', 1.001), face(0, 'A', NaN),
    face(0, 'A', .5, .039), face(0, 'A', .5, 2.001),
    face(0, 'A', .5, .1, NaN), face(0, 'A', .5, .1, 0), cancel(0, Infinity),
    { ...face(0), morphWeights: [1] }, { ...face(0), secondFace: 'B' },
    { ...face(0), duration: 1 }, { ...cancel(0), id: 'A' },
    { ...face(0), [Symbol('hidden')]: 1 }, Object.create(face(0))]) {
    assert.throws(() => s.enqueue(bad));
    assert.equal(s.state.queued, 0);
  }
  const accessor = face(0);
  Object.defineProperty(accessor, 'amount', { get() { throw new Error('getter must not run'); } });
  assert.throws(() => s.enqueue(accessor), /documented data fields/);
  const cue = face(0, 'A', .3, .04, .04);
  s.enqueue(cue); cue.id = 'B'; cue.amount = .8;
  s.advance(.04);
  assert.deepEqual(current(s), ['A', .3, 0]);
  for (const bad of [-1, NaN, Infinity, '1', 1e9 + 1, 0]) assert.throws(() => s.advance(bad));
  assert.throws(() => s.enqueue(face(.03)));
  s.advance(1e9);
  assert.equal(s.time, 1e9);
  const q = rig().timeline;
  for (let i = 0; i < L.maxQueue; i++) q.enqueue(face(i));
  assert.throws(() => q.enqueue(face(L.maxQueue)), /capacity/);
  assert.equal(q.state.queued, L.maxQueue);
});

test('callbacks cannot reenter timeline mutation', () => {
  let timeline;
  timeline = new FaceTimeline(['A'], path => {
    if (path) {
      assert.throws(() => timeline.advance(0), /reentrant/);
      assert.throws(() => timeline.enqueue(face(0)), /apply/);
    }
  });
  timeline.enqueue(face(0));
  timeline.advance(0);
});

// A short new fade-out must not conceal a longer already-committed withdrawal.
test('end-of-clock admission reserves completion time for an inherited withdrawal', () => {
  const { timeline: s } = rig();
  const max = L.maxTime;
  s.enqueue(face(max - 6, 'A', 1, .04, .04));
  s.enqueue(face(max - 2.2, 'B', .8, 2, .04));
  s.advance(max - .5);
  assert.equal(s.phase, 'withdraw');
  assert.throws(() => s.enqueue(face(max - .5, 'C', .5, .04, .4)), /headroom/);
  s.advance(max);
  assert.deepEqual(current(s), ['B', .8, 0]);
  assert(s.actualArrival < max);
});
