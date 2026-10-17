# Expression Scheduler P1 — 0.1.0-p1

This is an independent, opt-in reference module, not production activation or art approval. It imports the unchanged canonical owner08/full18 Director and its real FaceTimeline. No morph writes, production face-to-emotion mappings, generic condition DSL, time-map, ECS, renderer or video changes. Production policy remains `null` in `production-policy.mjs`.

## Configuration and admission

`validatePolicy(policy, admission)` requires exact plain-data records with enumerable fields, dense standard arrays, no unknown/accessor/symbol fields, finite numbers and cross-references. Admission is an explicit trusted source/profile SHA-256 pair plus approved face IDs. The binding supplies the actual pinned P0 admission. Copies are frozen. All candidate timing and random parameters are mandatory.

Policy fields: format=`bubu-expression-scheduler`, version=`0.1.0-p1`, sourceSha256, profileSha256, rng, candidates, contexts.

- rng: algorithm=`xorshift32-split-v1`, nonzero uint32 seed.
- Candidate: key, faceId, amount (strictly positive through 1), selectionWeight (uint32 including 0), enterSec/exitSec (.04–2), hold, gap, cooldownSec (0–3600), sources (explicit source-ID allowlist).
- hold/gap: `{kind:'fixed',sec}` or `{kind:'uniform',minSec,maxSec}`. Durations .001–3600 seconds; uniform requires min < max; fixed consumes no duration RNG. Uniform is half-open [min,max).
- Context: key, candidates (ordered unique candidate-key allowlist), excludeRecent (0–32). There are at most 32 candidates and 32 contexts, each source allowlist has at most 32 IDs. Candidate weights across the entire policy sum to at most 2^32-1.
- Context and source IDs are explicitly supplied host facts, not inferred feelings, calendar state or content. No condition functions or arbitrary predicates.
- Pure scheduler accepts an empty candidate array; binding intentionally requires explicitly authored nonempty candidates because P0 requires at least one. Do not construct the binding for the empty production policy.

## Pure scheduler

`new WeightedScheduler(policy, admission)`; `validateFacts({context,source,enabled,interactionOwned})`; `decide(time,facts,accept)`; `lose(time)`; `state`.

At a decision point, filter context allowlist, source allowlist, positive weight, face-level cooldown and recent candidate-key OR faceId exclusion. The context's candidate list fixes selection order. Exclusion is not relaxed when the set is empty. Empty returns the earliest relevant cooldown deadline or Infinity; conditions/history that cannot change with time do not create polling deadlines. Blocked, disabled and rejected decisions do not advance any RNG stream or accepted-selection history. The synchronous `accept(intent)` must return a boolean, must not reenter the scheduler and must only return true for an admitted intent. Exceptions do not commit random state.

A proposed intent includes key, faceId, amount, enterSec, exitSec, sampled holdSec and sampled gapSec. Weight changes probability only; amount remains the authored path coordinate. One accepted choice commits all three RNG stream snapshots atomically. A single eligible candidate still performs one selection draw; fixed durations perform zero duration draws.

PRNG: each stream starts with `(seed XOR salt) >>> 0`, replacing zero with 0x6d2b79f5. Selection/hold/gap salts are respectively 0x9e3779b9, 0x243f6a88, 0xb7e15162. Each draw uses xorshift32 shifts 13,17,5 and JS uint32 overflow. Since xorshift32 outputs only 1..2^32-1, selection first subtracts one, then rejects values >= D-(D modulo totalWeight), D=2^32-1. Duration fraction is (draw-1)/D. All raw draws, including rejection draws, are counted. This is deterministic simulation RNG, not cryptographic randomness.

`lose(time)` ends the current semantic ownership and sets that face's cooldown using the selected candidate's cooldownSec. Existing longer face cooldown is retained. History is accepted-selection history, NOT exposure statistics. A selection interrupted before visibly entering still counts for repetition prevention; this module does not claim exposure analytics. The last 32 accepted selections are retained.

## P0 reference binding and clock ownership

`new P0SchedulerBinding(policy, initialFacts, apply)` owns one P0 Director. Its only actor-facing operations are P0 `submit(request/release/reset)` and `advance`; apply is the same existing P0 callback. The binding never writes morphs or calls FaceTimeline directly. Do not separately drive that Director.

`submit({time,facts,events})` queues one authoritative facts snapshot and external intents per timestamp. Times are strictly increasing, nonnegative and <= 99,990,000. Already advanced timestamps are sealed. Facts are all four explicit fields above. Events:

- request: type, owner, requestId, lifetime, candidate, holdMode (`keep`/`restart`). `interactionOwned` must be true. External lifetimes are safe positive integers strictly increasing across all admitted requests, including repeated labels.
- release: type, owner, requestId, lifetime. Only the exact current external identity is mapped to its P0 lifetime. An old same-label release cannot release a new interaction.
- reset: type, exitSec. P0 actor reset semantics apply; no autonomous intent is submitted at this timestamp. This is an actor-intent reset, not cancellation of already admitted future host facts/events: the binding retains its external queue. Those future batches remain authoritative. Supply a later facts snapshot to authorize fresh autonomous work after reset completion.

`p1_idle` is reserved. The adapter allocates a separate globally increasing P0 lifetime. Upstream batches are atomically validated before enqueue. At most 128 batches, 30 external events each (two P0 slots reserved for binding intents); replay preserves their sequence. Host facts must truthfully reflect whether a real interaction owns the face. An unmatched release does not override the authoritative owner fact.

`advance(target,maxSteps=128)` processes input/internal decision boundaries chronologically, then advances P0 to target. External requests/resets suppress autonomous choice at the same timestamp before RNG sampling. Inputs that invalidate an active autonomous selection release that exact P0 lifetime. New real requests and matching release share one batch; no cancel+face trick or epsilon timestamp is used. At a completed real-owner gap, the binding explicitly releases the old P0 identity in the same batch as a new idle request, because P0 otherwise retains interaction priority until its gap-expiry processing. This is necessary to make the intent acceptance real.

P0's candidate hold is explicitly set to its 3600-second technical maximum; its gap is explicitly .001 seconds. These are reference adapter sentinels, not production artistic defaults. The sampled autonomous hold starts ONLY when P0 confirms actual arrival. A future matching release ends it. At actual Basis arrival, the sampled autonomous gap starts. Input facts changes within that gap cannot shorten it. Thus long enter/exit, sparse ticks and large advances cannot swallow the hold or count exit time as gap. Real interactions retain P0's 3600-second safety ceiling; applications requiring indefinite ownership need a separately approved interaction lifecycle API, not repeated hidden cues.

Normal autonomous cooldown starts at actual Basis completion. On external interruption, cooldown starts at semantic ownership invalidation time. P0 does not expose a separate old-path-visible-ownership-loss callback during cross-face transitions, so this module does NOT claim physical disappearance-based interrupted cooldown. This distinction is explicit and tested at the pure scheduler boundary; physical exposure/cooldown telemetry is outside this P1.

When paused (`enabled:false`) or owned, no new random choice occurs. Pause is a semantic suppression/release, NOT wall-clock freezing. P0's clock continues advancing safely; no queued autonomous backlog is replayed. Resume consults the latest full facts and eligible candidates. Actual wall/visibility clock remapping remains host work and must be shared with the actor if added later.

## Demand, bounded continuation and diagnostics

`nextDeadline()` merges P0 boundaries, future inputs, release and next-selection times. `isAnimating()` delegates real animation or pending continuation. Stable hold, gap and cooldown need only a deadline wake; no per-frame candidate scanning. Empty contexts sleep with Infinity. A budget-limited advance retains its target and reached point; finish it before submitting more input. `progress.complete` must be true before claiming target reached. Budget defaults are technical only, not implicit random/time policy.

`drainRecords()` returns selected/arrival/hold-ended/gap-start/interrupted observations. The diagnostic ring retains at most 2048 records; it is not a complete replay archive. Persist inputs plus policy/asset digests and drain records periodically for an external archive. Read-only `state` includes all PRNG counters and selection history. No performance claim about rendering, morph/GPU work, or natural artistic appearance is made.

## Verification

Run `node --test test/*.test.mjs` from this package. Tests import actual frozen P0 code, not a mocked arrival clock. Test faces are mechanical fixtures selected from the admitted IDs; they are not production emotion assignments.
