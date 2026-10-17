# FACE-TIMELINE: bounded face-only scalar clock

Status: a new standalone mechanical component for facepath05. It imports no legacy
controller, V1 graph, skeleton lane, Three object, mouse handler, or interaction
blocker. Passing these checks is **not artistic approval** and does not open the
body, drag, or interaction gates.

## Public surface

```js
import { FaceTimeline } from './src/face-timeline.mjs';
const clock = new FaceTimeline(allowedIds, (path, intensity) => {
  adapter.apply(path, intensity);
});
clock.enqueue({
  type: 'face', time: 0, id: 'A', amount: .7,
  fadeOutSec: .2, fadeInSec: .4
});
clock.enqueue({ type: 'cancel', time: 2, fadeOutSec: .2 });
const changed = clock.advance(nowSeconds);
```

- `allowedIds`: an array or Set of 1..128 unique nonempty strings, each at most
  128 characters. The clock copies it. IDs have meaning only to the separately
  validated adapter.
- `apply(path|null, intensity)`: synchronous callback; it must not throw or
  reenter clock mutation. Construction calls `apply(null, 0)` once. During
  sampling, it is called only when path or intensity changes. A null path means
  exact original Basis, never a synthesized neutral expression.
- The two cue shapes above are exact own-data-field whitelists. Missing, extra,
  symbol, inherited, accessor, direct morph-weight, second-face, or unknown-type
  fields are rejected. Face IDs must be admitted even when amount is zero.
- `amount`: finite number in `[0,1]`; `fadeOutSec` and `fadeInSec`: finite numbers
  in `[.04,2]`. No coercion, silent input clamping, or hidden default durations.
  A zero-amount face cue means a neutral destination, without cancel's queue
  invalidation.
- `time`: finite absolute seconds in `[0,1e9]`. `advance` is nondecreasing;
  equality is allowed. Enqueueing in the sampled past is rejected. Admission
  reserves a conservative `maxBrakeSec + maxFadeSec + fadeInSec` of completion
  headroom before `1e9` (cancel omits fade-in), preventing unreachable deadlines.
  The outgoing term uses the maximum fade because a replacement can inherit an
  already-committed withdrawal longer than its own requested fade-out.
  `advance(1e9)` itself is valid. Segment endpoints use their canonical absolute
  sum, not an epsilon comparison or repeated frame-time integration.
- At most 128 cues are pending; overflow is an error. Enqueue copies validated
  primitive data, so caller mutation cannot modify an admitted cue.
- `advance(t)` returns whether any callback write occurred. Large jumps process
  all intervening cue/segment boundaries at their canonical times, including an
  explicit Basis write before a new face ID.
- `isAnimating()` reports an in-progress scalar segment. A settled nonzero
  expression is a hold, not perpetual animation. `nextDeadline()` is the first
  queued cue time, or `Infinity`; RAF handles the active segments.
- Primitive read-only getters: `time`, `path`, `value`, `velocity`, `phase`,
  `arrivalTime`, `actualArrival`, `holdSince`.
- `snapshot()` and `state` return a fresh frozen diagnostic record. Deliberate
  diagnostic reads allocate. Steady active/idle `advance`, `isAnimating`, and
  `nextDeadline` allocate no JavaScript objects, arrays, or closures in this
  component. Event admission and explicit diagnostic snapshots may allocate.

## One semantic face, then exact Basis

The visible state is one ID and one scalar. An adapter may use two neighboring
knots **within that ID's approved path**; this clock never mixes semantic IDs.
The phases are `idle`, `enter`, `hold`, `adjust`, `brake`, and `withdraw`.

Cross-ID change follows:

1. Preserve the current scalar value **and velocity** at the interruption.
2. If velocity is nonzero, decelerate on the current path to zero velocity using
   the bounded brake below.
3. Withdraw the current path to scalar `0`, velocity `0` over the requested
   fade-out. At that canonical endpoint, write `(oldId, 0)` then `(null, 0)`.
4. Only then write `(newId, 0)` and enter the new path over its fade-in.

A new cross-ID or cancel intent during withdrawal changes only its destination
and incoming fade; it never restarts or shortens that outgoing trajectory.
Returning to the still-active non-null ID instead cancels the pending Basis
bridge: preserve the current value and velocity, apply the bounded brake, then
adjust directly on that same semantic path. This avoids an unnecessary
small-O/round-eye detour when the user returns to the face already on screen.
If already braking, a same-ID return cancels the pending withdrawal without
restarting or extending the brake. A subsequent cross-ID or cancel intent
reinstates withdrawal after that same brake; distinct semantic paths still
never overlap and still meet only at Basis.

A same-ID amount change preserves its current value/velocity, brakes if moving,
then adjusts to the new amount. An updated goal during this brake does not
restart the brake. Changing to another ID while a same-ID brake is running
commits the pending withdrawal without restarting the brake. Repeating the
identical ID and amount is idempotent: no phase, arrival, or hold restart, even if
the repeated cue supplies different durations. To change the duration of an
already-running identical target is intentionally unsupported.

Cancel uses the same C1 withdrawal; it does not snap a moving face to zero.
Cancel during a committed withdrawal removes the pending destination without
resetting withdrawal. Cancel is bounded work, not a mouse/event lock.

## C1 scalar construction and the timing tradeoff

This section refers **only to the scalar intensity clock**. The approved art
paths interpolate POSITION/NORMAL piecewise linearly between knots. Their
world-vertex velocities need not be C1 at internal art knots, even when this
scalar is C1. Neither the implementation nor these tests assert whole-face
world-space C1, C2/acceleration continuity, anatomical quality, or artistic
approval. The scalar does not alter approved path geometry.

For a rest-to-rest move from `a` to `b` of canonical duration `D`, set

```
u = (t - start) / D
s(u) = 3u² - 2u³
x = a + (b-a)s(u)
v = (b-a)6u(1-u)/D
```

The value is a convex combination of `a,b`, and both endpoint velocities are
zero. The implementation uses equivalent symmetric convex weights to reduce
endpoint cancellation. It writes the exact stored endpoint at the canonical
end; there is no approximate-neutral threshold.

An interrupt at `u₀` with nonzero velocity cannot immediately reverse direction
while preserving that velocity. In particular, restarting a fresh smoothstep
from the current value would preserve C0 but reset the derivative to zero. We
therefore explicitly spend a brake duration

```
B = min(.04, currentSegmentEnd - interruptTime)
z = (t - interruptTime) / B
vBrake = v₀(1-z)
xBrake = x₀ + v₀ B (z - z²/2)
```

This is constant deceleration to zero velocity. New intent while this brake is
running updates its pending destination without restarting the brake. It is at
most 40 ms in real arithmetic and no longer than the remainder of the original
segment. Absolute IEEE-754 clock sums have normal sub-ULP representation error
(for clocks admitted up to `1e9`, under one microsecond); published diagnostics
use the actual representable endpoint and duration. Values and velocities are
never silently clamped to disguise an overshoot.

Why it remains in the shape domain: the original remaining distance divided by
its current speed, doubled, is

```
2 * remainingDistance / |v₀| = D(1-u₀)(1+2u₀)/(3u₀)
                             >= D(1-u₀) >= B.
```

Thus the stop point lies between the interrupt point and the original segment
endpoint. The entire brake is monotone between those points. The next
rest-to-rest segment remains between its own admitted endpoints. Inductively,
all scalar values stay in `[0,1]`, with finite velocity and no domain overshoot.

The code evaluates the brake by the equivalent convex weight

```
r = B / remainingOriginalTime
w = (1-u₀)² [1 + 2u₀ - 3u₀ r z(2-z)]
xBrake = a*w + b*(1-w)
```

For `0<=r,z<=1`, its bracket is nonnegative and `w` stays in `[0,1]`.
This form avoids subtracting almost equal current/target values near 0 or 1.
The derivative equals `v₀` at interruption and zero at the join. Repeated
interruptions do not create nested brake representations or an unbounded
history. Stored data is one segment, one pending destination, and the bounded
cue queue.

The visible value can keep moving in its old direction briefly after reversal
or cancel, which is required for C1. It may pass a newly requested smaller
amount during that brake; it cannot leave the approved scalar domain. Fade-in
and fade-out are the durations **after any required brake**, not a promise that
an interrupt has already arrived at `cue.time + fadeInSec`. This tradeoff is
explicit in the API rather than hidden by a derivative reset.

## Arrival and hold diagnostics

- `requestedAt`, `requestedFadeOutSec`, `requestedFadeInSec`: last accepted,
  non-idempotent intent (cancel always counts).
- `brakingSec`, `brakeEndsAt`: actual canonical brake duration/end for that
  intent. Updating a pending intent mid-brake reports the remaining brake time;
  it does not extend it. A cross-ID/cancel update during withdrawal has no new
  brake. A same-ID return brakes the currently inherited withdrawal velocity.
- `neutralAt`: the planned/achieved neutral bridge for the current intent, or
  null for a direct same-ID adjustment or same-ID return. During withdrawal,
  its original neutral deadline is retained for cross-ID/cancel replacements;
  returning to the current semantic removes that planned bridge.
- `arrivalTime`: predicted canonical attainment of the current intent,
  including required brake and withdrawal. Replacing the destination can
  change its incoming duration and arrival without changing the current value.
- `actualArrival`: null while that intent is moving; set only when it really
  reaches its target. `holdSince` is likewise null until arrival. Both record
  the canonical segment endpoint, not the later RAF time that observed it.
- Holds have no implicit expiry. Cancel, a new cue, or a future separately
  authorized hold scheduler can end them. A repeated identical intent does not
  move the hold's start. No hold-duration input is silently accepted.

For example: interrupt at `.13`, brake to `.17`, withdraw for `.17`, enter for
`.31`. The arrival is the actual canonical sum `(.17 + .17) + .31`. An
`advance(10)` can observe that arrival, but does not move its timestamp to 10.
If a replacement or cancel intervenes, that obsolete target is never credited
with an actual arrival.

## Event order and cancellation generations

Cues are ordered by time, retaining insertion order within equal timestamps.
The last equal-time face destination wins. Before dispatching a timestamp, the
clock checks the entire admitted group for cancel:

- Any cancel beats every face cue at that timestamp, independent of insertion
  order. No losing face is transiently applied.
- If there are several equal-time cancels, the last inserted cancel supplies
  the fade-out duration.
- Processing cancel clears **all already-enqueued cues**, including future
  face/cancel cues: they belong to the old generation. The diagnostic
  `generation` increments. This is dispatch-time invalidation, not merely
  removal of cues enqueued before the cancel object.
- New cues enqueued after that cancellation has been processed form fresh
  work. Faces at the exact canceled timestamp still lose, even if enqueued
  after another `advance` at that time. Later timestamps may set a new target.

A later fresh face can replace cancel's pending neutral destination during an
ongoing withdrawal. A different ID still completes the withdrawal before entry;
the currently active non-null ID may brake and reverse directly on its own path.
This does not resurrect canceled queued work or bypass same-timestamp cancel.

## Focused verification

Run `node --test tests/face-timeline.test.mjs` from the facepath06 checkout.
The focused tests cover:

- Exact entry/hold endpoints and actual rather than sampled arrival timestamps.
- Basis callback order across a large time jump.
- Current intensity and velocity equality at interruption; numerical derivative
  checks; explicit brake and zero-velocity joins.
- Same-ID reversal in both directions; cross-ID mid-entry change; repeated
  destinations; target replacement during both brake and withdrawal; return to
  the old ID during withdrawal.
- Cancel during idle, entry, hold, both brake purposes, adjustment, and
  withdrawal; stale future invalidation and fresh-generation work.
- Equal-time cancel dominance, same-priority order, zero-amount neutral intent,
  and cue mutation isolation.
- Exact event-time snapshots under large jumps and 30/60/120 Hz sampling.
- Minimum durations, near-end braking, clocks near `1e9`, deterministic
  interruption stress, finite bounds, strict cue shapes, queue capacity,
  invalid inputs, read-only state, and callback mutation reentrancy.

These are mechanical checks. Approval of the art paths, visual transition
review, POSITION/NORMAL behavior, resource lifecycle, browser demand scheduling,
and body/drag integration are separate gates owned by their respective adapters
and integration tests.
