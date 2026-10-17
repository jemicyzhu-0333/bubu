# Explicit full18 weighted actor/owner integration

This adds a capability-limited production wiring path. It does not populate an
artistic policy, introduce gestures, or certify real browser/GPU execution.

## API

Import WeightedExpressionOwner from src/expression-owner.mjs and instantiate
with {pool, pack, policy, initialFacts, visibilityPolicy:'freeze', wallTime,
onRecord?, scheduler?, draw?}. pack must be prepareFullFacePack's explicitly
admitted full18 result. policy is the explicit P1 schema and initialFacts is its
complete {context, source, enabled, interactionOwned} record. The current
production policy remains null/empty and cannot create a weighted actor.
Only clearly identified testfixture policies are used by the tests.

Await owner.ready. A visible batch is
{wallTime, epoch:owner.epoch, facts:{context,source,enabled,interactionOwned},
events:[...]}. Facts-only updates use an empty events array. The entire batch
is committed before advancing its timestamp; one sealed timestamp cannot accept
a second batch. At most 30 external events are allowed, leaving room for P1's
internal release/request in the canonical Director's 32-event budget. A request
has {type:'request',owner,requestId,lifetime,candidate,holdMode}; it has no public
priority field because this path makes these explicit external requests real
interaction priority. A release identifies the same owner/requestId/lifetime.
Visible release retains the normal outgoing path; it never invokes hidden
hard invalidation. Input facts are current host facts, not permission to infer
new interactions. Call wake after committing the current complete batch when
using the optional demand scheduler.

Owner state remains the canonical flattened Director diagnostic state, with
continuous logical timestamps and epoch. weightedState adds the P1 facts,
scheduler RNG/history/decision diagnostics, and the same mapped director state.
The random selection weight is distinct from face amount. Arrival/hold/gap
records (time, actualArrival, releaseAt, nextAt) map to the same continuous
logical time. Returned bounded-advance progress remains local to the current
epoch, as in the existing owner contract; finish pending advancement before
submitting another batch. No persistence/restart protocol is added.

## Exactly one writer

ActorPool.createWeighted(pack, policy, {initialFacts, signal?, onRecord?,
onDispose?}) is the trusted low-level factory used only by the weighted owner.
It performs the same prepared-admission reservation before parse/clone and
creates the same actual full18 eight-layer binding. Its private factory selects
P0SchedulerBinding as the sole driver. P1 constructs exactly one canonical
runtime ExpressionDirector and FaceTimeline, whose sink applies directly to
that admitted binding. No actor.enqueue bridge, second Director, duplicated
clock, generic driver parameter, or caller-supplied plugin factory is accepted.

The runtime imports the canonical sibling
../expression-scheduler-p1/src/p0-binding.mjs; P1 imports this runtime's canonical
Director and Timeline. That sibling dependency must be installed in the Git
layout. Existing ActorPool.create, createDirected and ExpressionOwner keep their
slice7/full18 behavior and are included in the regression suite.

## Ownership and retirement

The same owner controls loading, source lease, actor, RAF/timer tickets,
lifecycle listeners, fail-stop cleanup and epoch/lifetime checks. An ordinary
weighted decorative hold freezes while hidden with no redraw of RNG and no
retirement. Interaction qualification includes current/future interaction
requests and facts.interactionOwned. Hiding an interaction retires it at once,
clears future intents and resets Basis through the same single sink.

The binding is retained while only its sole private Director is retired. It
rebases its local time to zero, keeps the RNG stream positions, recent history,
remaining face cooldown and host lifetime watermark, and sets enabled=false /
interactionOwned=false. The owner advances its logical origin to the retired
time and increments epoch. No random draws occur during retirement, hidden
waiting, or disabled restoration. A fresh current-epoch complete facts batch
must enable scheduling again; the old facts/gesture do not replay. The first
new-epoch batch may arrive at local time zero. Old epochs do not consume fresh
lifetimes or clear current interactions.

Observer errors/reentry disable observation without changing core output;
this remains disabled across retirement. Core sink or Basis-reset failure
fault-stops and releases the actor. Pending load close, pool close, repeated
dispose and already-dequeued callbacks follow the existing owner contract.
No automatic recovery proceeds from a half-committed P1 state.

## Evidence and limits

The integrated runtime suite is 289 tests (the prior 277 plus 12 real weighted
actor tests). P1's suite is 26 tests. The added runtime tests use the admitted
18-slot GLB, all eight layers/144 morph slots, real resource budgets, every
approved semantic, interaction preemption/release, hidden freeze/retirement,
cooldown/RNG/lifetime continuity, observer faults, sink faults, pending load,
late callbacks, disposal, and strict bounded data batches.

The existing full18 default admission limits and asset/profile bytes are
unchanged. Production artistic weights, hold ranges and contexts remain
unfilled; testfixture values are not art approval. This is CPU/API functionality,
not performance optimization, native-speed visual review, real GPU validation,
DOM gesture recognition, or full-scene acceptance. The inherited facepath06
623 regular frames plus 74 four-view instants remain canonical-clock offline
evidence; they are not integrated full18 weighted browser captures.
