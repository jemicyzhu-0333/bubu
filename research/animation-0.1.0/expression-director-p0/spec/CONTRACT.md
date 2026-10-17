# Expression Director P0 contract

Status: implementation contract, 2026-10-17. Observer isolation patch01: spec/OBSERVER-ISOLATION.md supersedes callback-failure behavior; diagnostic observer errors no longer escape into lifecycle processing. This isolated package must not change facepath06, its tests, static art, or rendering jobs. Numeric examples are mechanical test inputs, never product acting defaults.

## Scope and ownership

P0 adds fixed one-shot expression lifecycles only: request → actual arrival → hold → exit to Basis → gap → done. No autonomous repeat, probability, conditions language, cooldown, time-map, long-press input adapter, reduced-motion integration, or production ActorPool/render integration is claimed.

The director privately owns a fresh, unchanged FaceTimeline. The supplied trusted `apply(id,amount)` sink receives its scalar outputs; the host must connect only an admitted seven-slot binding and must not have another writer. It is not an untrusted-JavaScript sandbox. The timeline is never exposed. Approval binds the exact source/profile hashes. The approved source metadata and clock are vendored byte-identically for a portable scalar test closure; no new shapes or mesh data are made.

## Policy v0.1.0-p0

Strict own-data records, exact fields; reject prototype-bearing/nonplain records, accessors, symbols, unknown fields, coercion, NaN/Infinity. Arrays are dense plain arrays without extra fields. Deep-copy and freeze admitted data.

Policy: `format: bubu-expression-policy-p0`, `version: 0.1.0-p0`, `sourceSha256`, `profileSha256`, `candidates`.
Candidate exact fields: `key`, `faceId`, `amount`, `enterSec`, `exitSec`, `holdSec`, `gapSec`.
1..32 unique candidate keys (1..64 ASCII letters/digits/_/-); faceId in approved seven-slot source; amount >0..1. Enter/exit are 0.04..2 seconds. Hold/gap are 0.001..3600 seconds. These finite engineering caps do not pick product timing. Only fixed numeric timing is implemented. Reject weight, rng, conditions, range distributions and all unsupported fields rather than pretending they work.

## Event batches

`submit({time,events})` atomically validates and copies one complete timestamp batch. Input times 0..(1e8−7207) seconds; advance may reach 1e8. The 7207-second conservative headroom covers maximum inherited brake/withdraw, entry, hold, exit and gap; caller must collect all events for that timestamp before submission. Batches have strictly increasing times; no reopening a timestamp. At most 128 queued batches, each 1..32 events. Advance seals all timestamps through the reached time. Inputs at or before a sealed time are late and reject. No admission during partial catch-up, so the caller cannot retroactively change already arbitrated work.

Identity protocol: every request carries a `lifetime` integer in 1..Number.MAX_SAFE_INTEGER. Its scope is the entire Director instance, globally across owners. It must be strictly greater than every previously admitted request lifetime; requests in a batch are checked in input order using a temporary watermark, committed only after the whole batch validates. Losing requests and requests cleared by reset still consume admitted lifetimes. Reset never rolls this identity watermark back (it does reset only the cleared future timestamp horizon). No wrapping or reuse is allowed; exhaustion requires a fresh Director. Only one integer watermark is retained, not an unbounded history Set. Release carries exactly the same owner, requestId and lifetime. requestId remains a label and may be reused safely under a new lifetime. Internal accepted-request token is a separate counter used by lifecycle scheduling and need not equal the globally admitted lifetime. Read-only `maxAdmittedLifetime` and `activeLifetime` expose this protocol state.

Events:
- `request`: exact fields `type,owner,requestId,lifetime,priority,candidate,holdMode`; owner/requestId are bounded identifiers, priority exactly `interaction` or `idle`, holdMode exactly `keep` or `restart`.
- `release`: exact fields `type,owner,requestId,lifetime`. Only releases that exact current owner+requestId+lifetime. It never globally cancels, clears another owner, or erases future input batches.
- `reset`: exact fields `type,exitSec`. Explicit global reset only: last reset wins, suppresses every same-time request, invalidates the current generation, clears previously queued future batches and safely exits. Newly submitted future batches remain possible after completion of advance.

At each canonical boundary: sample existing scalar state; collect the already-complete external batch; resolve reset, matching release, then requests; only then process surviving internal expiry. Higher request priority wins over a retained active owner; last request in batch wins a tie. Candidate input cannot override this fixed priority policy. Release+new request can transfer ownership at the same instant with one winning face cue; no cancel+face pair. Losing/abandoned requests do not resume later.

Each accepted request has a monotonically increasing director token; same-time/late timer work must refer to the current token. A request to the already-visible destination has logical arrival at request time (even if the clock's actualArrival is older). During an unfinished transition, hold cannot start until the clock actually settles on the intended path and amount. Same owner+same candidate `keep` preserves an already-started logical hold; `restart` begins a fresh logical hold at the accepted request time when already settled. Neither changes the low-level clock's old actualArrival or forces a new fade. During entry, keep/restart both await actual arrival. A new owner never inherits the previous owner's hold timer.

An ordinary request uses the outgoing candidate's exitSec and incoming candidate's enterSec; inherited clock braking/withdraw durations remain authoritative. Releasing an active request safely targets Basis through a zero-amount face cue, not a global cancel. Release may shorten hold immediately; expiry does not block real input. Gap begins only at the actual Basis arrival. Owner priority remains associated with an unfinished exit/gap; matching release during gap finishes immediately. A new equal/higher-priority request can replace it. Completing gap relinquishes ownership.

## Clock, budget and scheduler

`advance(target,maxSteps=64)` returns a boolean indicating changed scalar output. `progress` reports `{complete,reached,target,steps}`. It processes each external/arrival/hold/exit/gap boundary at its canonical time, before sampling target. Up to maxSteps (1..4096) boundary batches per call; upon exhaustion it stops exactly at the last processed boundary, retains all events and target, and exposes incomplete progress. Retry at the same or later target; no fast-forward, dropping, replaying or wall-time rebasing. External timestamps contain at most32 events, giving bounded per-boundary work. No zero-duration self-rescheduling.

`nextDeadline()` returns the earliest external or lifecycle boundary; while catch-up is pending it returns current reached time to request immediate continuation. `isAnimating()` includes scalar transitions and incomplete catch-up. Thus a standard demand loop can use the boolean return and these methods without treating a report object as “changed”. Snapshots allocate only on request; this P0 does not promise allocation-free director processing. The low-level clock retains its original behavior. A trusted optional `onRecord` callback records accepted/released/reset/arrival/exit/gap events; no internal unbounded log is kept. Mutation from either callback rejects.

All temporal arithmetic uses exact returned canonical binary floating-point boundaries, never rounded display times or epsilon early arrivals. Events and all lifecycle completion reserve headroom below FaceTimeline maxTime.

P0 accepts logical monotonic seconds only. It has no hidden-page policy. A host that pauses must map both actor and director through one explicit logical clock (`logical=wall-pausedDuration`) and map inputs to it; it cannot freeze director deadlines while continuing actor with wall time. Hidden/resume mapping events must be recorded for later replay. Pause integration is not implemented or implied.

## Required tests before implementation

Strict schema and unsupported fields; fixed full lifecycle; true arrival under braking; delayed and stale request identity; logical keep/restart; unrelated release; owner transfer and same-time arbitration; global reset; no lower-priority takeover; cadence independence and large jumps; bounded catch-up retaining all events; unified deadlines and idle termination; admission/queue/bounds/reentrancy errors; approved source closure hashes. Rendering, GPU, aesthetic timing, and real device input are separate gates.
