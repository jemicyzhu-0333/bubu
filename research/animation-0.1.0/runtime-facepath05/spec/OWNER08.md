# owner08 contract and boundaries

## One driver and lifecycle owner

ExpressionOwner({pool, pack, policy, visibilityPolicy: 'freeze', wallTime,
onRecord?, scheduler?, draw?}) immediately owns its asynchronous loading attempt.
Await owner.ready before accessing state or binding lifecycle. dispose can be
called before ready, repeatedly, or after failure. Late successful loads are
released; late cache parse ownership remains reserved until disposal completes.
Observe/reject the ready promise when closing a pending owner.

The pool must be the shared application ActorPool. Its createDirected path
reserves the prepared pack first, clones the admitted asset, validates rest and
binds the approved eight layers, then constructs only ExpressionDirector's
FaceTimeline. No actor.enqueue, second timeline advancement or double
interpolation exists on this path. The old create API remains for legacy users;
do not mix old actors with new owners to control one scene actor.

Policy is copied/validated/frozen before asynchronous admission, at both owner
and direct pool boundaries. Retirement uses that same snapshot. No policy or
artistic timing is changed by this patch.

owner.root is trusted **render-only** scene access. Do not mutate its morph,
geometry, skeleton or material fields; JavaScript/Three scene access is not a
security sandbox. No driver, binding, timeline or low-level actor is exposed by
owner. On disposal owner.root becomes null; a previously retained root is empty.
Direct low-level pool.createDirected handles are trusted implementation/testing
access, not the public interaction layer. The pool owns admission; closing the
pool synchronously closes its live owners too.

## One time mapping and complete batches

Use one monotonic wall-clock source in seconds for input, frames and lifecycle.
owner.logicalTime accumulates visible/unpaused seconds only. wallTime is an
absolute wall timestamp in that source; initial wallTime establishes logical 0.
The host must explicitly select visibilityPolicy='freeze'. This is the reviewed
minimal safety policy, not a general product default or a new art timing choice.

completeBatch({wallTime, epoch: owner.epoch, events}, maxSteps=64) validates the
whole batch, submits it, then advances to its mapped time. Batch/event/candidate records must contain exactly their JSON-compatible own
enumerable data fields; getters, symbols, sparse arrays, extra fields and
non-enumerable fields are rejected before copying or traversal. Events are
bounded to 1..32 before enumeration. A batch is the entire
set of same-time intents; merge co-timed request/release/reset before this call.
A frame/advance already seals its timestamp: do not advance(t) then submit(t).
Do not manufacture epsilon timestamps. A late same-time batch throws before
changing the watermark or queue. No partial input acceptance is reported.

Ordinary input batches are current-time transactions, not an unbounded host
future queue. The director can temporarily retain the just-accepted batch behind
prior canonical boundaries when maxSteps is exhausted. Returned progress makes
this explicit: call advance at the same or a later wall time until complete.
While catch-up is pending, a new batch is rejected *before acceptance*. Its
caller retains it and retries after completing catch-up; the owner does not
silently drop or replay it. This is a foundation contract, not a DOM gesture
adapter. maxSteps is 1..4096. Direct low-level director future queues retain
their existing bounded limits.

Each request lifetime is a globally increasing positive safe integer. The
watermark is atomically checked for the entire batch and survives director
retirement. Every batch also carries an owner epoch. Stale epochs return
{accepted:false,reason:'stale-epoch'} before examining time or advancing; they
cannot consume current lifetimes or release a newer interaction. Invalid input
is not automatically retried or converted to a different gesture.

Owner state and record timestamps are mapped to continuous logical time; the
private director uses time relative to its current epoch origin. No wall-clock
hidden interval enters a hold or exit duration. State is diagnostic only, not a
restartable snapshot.

## Freeze and immediate safety invalidation

suspend(wallTime) cancels owned RAF/timers and freezes logical time. If either the
active lifecycle (enter, hold, exit, gap) or any queued request has interaction
priority, it immediately retires that driver, clears its entire queue, increments
the epoch and constructs the sole replacement driver at Basis. This is a hidden
or non-drawable safety invalidation, never a visible-expression transition.

A purely decorative lifecycle remains in its current phase and epoch and
resumes its remaining logical duration. Ordinary batches while paused reject.
The separate invalidate(epoch) API is allowed only while paused; it immediately
retires that epoch, even at an already sealed timestamp. Old epochs are ignored.
This supports loss of input eligibility without waiting for restoration or
inventing a timestamp. No pending gesture qualification is left alive.

resume(wallTime) is idempotent. It does not replay old interaction input. It
schedules a next RAF when a scheduler is installed, without synchronously
advancing; host code can first submit the complete current-epoch batch. Resume
at exactly the suspend wall time permits the new epoch's first input at local
0. Later batches retain strict timestamp sealing. A new interaction must carry
a fresh lifetime. Decorative epoch release still uses matching owner/requestId/
lifetime and a nonstale timestamp; it cannot release a new lifetime.

Visible release must use completeBatch and the director's normal safe exit
path; invalidate refuses visible use. dispose immediately revokes the owner and
releases the actor. Nothing here implements drag capture or press recognition.

bindLifecycle({canvas,visibilityTarget,now}) is optional after ready. It owns
webglcontextlost/restored and visibilitychange listeners, combines hidden/lost
conditions, and uses the same wall mapping. Loss calls preventDefault for
standard restoration opt-in. It does not claim that restoration succeeded at
GPU level. The optional scheduler's now must match lifecycle and input clocks.

## Scheduling and failure

Optional scheduler methods are now, requestFrame, cancelFrame, setTimer,
clearTimer. Call wake after committing a batch to request rendering. Frames draw,
then continue only while animating or schedule the next canonical deadline;
idle has neither RAF nor timer. Resume always wakes a suspended renderer. All
callbacks carry a generation ticket, so an already-dequeued callback from a
retired/paused/disposed generation cannot write, draw or schedule work.

Observation is noncontrolling. observer01 isolates and permanently disables a
throwing observer; owner does not re-enable it on epoch retirement. Observer
reentry into owner mutation is refused and does not damage animation. Native
Promise observers remain unsupported, as in observer01.

Core sink/assertion/advance failures and scheduled drawing failures are
fail-stop: owner changes to faulted, revokes the epoch, stops scheduling,
unbinds listeners, releases the actor and clears owned references. Subsequent
inputs fail; no automatic recovery can continue a half-committed director.
Basis-reset failures use the same route. Caller validation errors before core
execution reject without changing state. Cleanup attempts remain independent
and release resources even if scheduler cancellation fails. Application-owned
pool is not disposed by one failing actor.

Draw and observer callbacks cannot synchronously dispose/mutate the owner.
Draw failures stop the owner; observer errors remain isolated. Resource count
zero is ownership-accounting evidence, not proof of browser heap/VRAM release.
