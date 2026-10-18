# Executable action configuration foundation

Scope: research candidate, no persistent writes. Existing source body, approved pointer trajectories and face shapes remain unchanged. This folder owns closed configuration admission and an application adapter; existing scene arbitration, quaternion interpolation and pointer/face owners remain authoritative.

## One schema, executable admission

`compileActionConfiguration(raw, context)` validates the closed strategy schema and returns immutable configuration and the existing SceneCoordinator recipe/resource format. `compileRuntimeConfiguration(raw, context)` is the required host boundary: it additionally checks actual executable capabilities. This is one schema with two checks, not two stores or competing state owners. A host must never install the structural result alone.

Context registries (`anchorIds`, `catalogue`, `clipIds`, `faceIds`) must come from admitted owning registries. Caller claims in JSON cannot create capabilities. Runtime capability flags mean concrete owned ports were supplied by composition, not user-controlled flags.

Only D2 is admitted. Inherited pointer actions are explicit immutable profile assertions, not configurable timing controls: a changed priority, timing, resource list, loop, duration, or nonempty added track rejects. The normal pointer action/face owner executes those existing profiles unchanged. Authored accessory actions have genuinely configurable timing and tracks through `createActionStrategy`.

## Runtime field mapping

- `actor.modelVariant`: D2-only fail-closed admission. `actor.id`: actor identity label. Body and face owner fields are exact ownership assertions.
- `mounts`: assetId resolves through the admitted host asset descriptor; anchor and tangent offset are applied by the final-pose anchor registry; layer becomes the host's bounded render ordering. `writer` is an ownership assertion. Original rest calibration must use zero configurable offset, otherwise offsets cancel algebraically.
- `secondaryMotion`: mode selects the authored rigid/chain adapter. `maxAngleRad` is a monitored rest-fallback threshold, not a three-vrm-springbone 3.5.5 hard clamp. The host binds it into the adapter profile; exceedance restores rest before display. Status retains research readiness, not a bypass of validation.
- `effects`: effectId, space and numeric budgets go to the bounded effects owner. At most four emitters / 96 particles, TTL <=3 s, rate <=12 Hz, finite source duration <=60 s. Reset/dispose cleanup is immediate.
- `actions.id/factKey/resources/priority`: consumed by the existing SceneCoordinator. Authored priorities are below longpress 50 and drag 100. Shared resources with equal priorities reject.
- `actions.body`: selects an immutable approved pointer strategy or `accessory-authored`. Authored means accessory-local work, never a new body bone writer.
- `bones`: already-validated `bubu-clips` tracks bound to accessory-owned delta nodes. `QuaternionLane.planClip`, `sample`, and `apply` are reused unchanged. Original mount matrix and body joints are never written. No clip/secondary chain dual ownership.
- `enterSec`: actual clip entry bridge and start of the normalized authored phase. `durationSec`: real clip/track phase duration, required to equal referenced clip duration. `exitSec`: actual neutral recovery using the existing lane primitive.
- `loop/maxLoops`: finite executes once; while-fact-active repeats only while its fact remains owned, with a hard limit of eight cycles. A consumed sustained fact cannot accidentally restart a finished action until that fact disappears and returns.
- `expressions`: canonical candidate/amount events at configured phase times, emitted through the single pointer owner's authored face port. Enter/exit timing tuples must be admitted before that owner is constructed. No second `completeBatch`, face state owner or shape writer is allowed.
- `contactWindows`: actual normalized start/end callbacks plus mandatory release on interruption/reset/disposal. The host's contact port owns attachment/detachment behavior. These callbacks are not proof of palm geometry or collision-free contact.
- `effectTracks`: actual timed bounded burst/stop commands. Stop count must be zero; burst count is 1..8. A late explicit burst requires the effects owner to recreate an expired emitter using the same admitted bounded policy, not silently ignore it.
- `interrupt`: exact sample-current policy. At interruption time existing quaternion lanes sample their present pose before recovery or the replacement clip begins. Pointer-owned modes preempt authored work.
- `input/lifecycle`: exact existing-owner policy assertions. Suspend/reset clears authored contacts, queues and face intents; resume requires fresh input and has no elapsed-time catch-up. Disposal prevents revival.

## Action adapter API and order

`createActionStrategy({plan, clipLibrary, nodes, facePort, contactPort, effectPort})` receives the runtime-admitted plan. `nodes` maps `accessory:<mountId>` to accessory-owned local delta nodes. SceneCoordinator owns winner selection; QuaternionLane owns interpolation; the adapter only schedules bounded work and delegates effects. It has no RAF, timer, filesystem, wall clock or random source.

`tick(time, {facts, pointerMode})` uses injected monotonic seconds, bounded to one day. Facts are bounded to 32. The adapter handles exact event boundaries even across skipped display frames and returns a read-only lifecycle snapshot. `reset`, `pause`, `resume`, and `dispose` clear pending work and release ports. No other owner state is mutated.

Run strategy before the body owner's same-time batch so authored face intents join that one batch. Local accessory deltas survive the final mount-root update. The owning pointer batch must independently discard authored intent whenever a gesture owns the face, including a new gesture recognized in that same frame; the previous pointer mode alone is not sufficient. Ordered host pipeline: action intent preparation → pointer body/face batch → final anchors → secondary motion → accessory local deltas → bounded effects → render.

The face port is `request({time,candidate,amount,enterSec,exitSec})` and `release({time})`. Contact port receives the configured window plus `active/time`. Effect port receives `effectId/event/count/time`. Ports must be generation-scoped so unequip cannot apply stale queued work.

## Five fixtures and honest coverage

`FIXTURES` are inherited continuous pointer fixtures. `AUTHORED_CASES` supplies five executable finite strategies, their optional clip libraries and face-profile admission tuples:

1. Ear sakura/leaf: accessory-local ear attachment acknowledgement, canonical face request, bounded particles. This remains a research comparison assembly, not wardrobe exclusivity approval.
2. Satchel: canonical timed face request while its secondary chain owns the bag; no competing clip writer. Known palm/strap seam remains unresolved.
3. Cape plus original tail: canonical timed face request while cape secondary motion owns its chain. Baseline tail is unchanged.
4. Book: actual accessory quaternion clip, contact begin/end and canonical face request. Exact palm-contact art and a full reading choreography are not certified.
5. Halo: actual accessory clip, canonical face request, bounded local/world effects.

`catalogue.json` and `catalogue.mjs` cover all 18 wearables, 39 props and two variants with source model/hash and semantic references. A supported mapping does not claim completed choreography. World/stage props remain blocked where no stage/world trajectory contract exists. All 59 retain full-action/native approval blocked; five bounded research strategies do not complete every production action.

## Evidence

Run `node --test bubu-animation-foundation-20261018/configuration/tests/*.test.mjs` from workspace root. Tests exercise the real existing SceneCoordinator and QuaternionLane, including changed timing changing actual quaternion output; configured finite loops/effects/contact/face-port calls; sampled drag interruption and recovery; stale replay prevention; all five finite strategies terminating; missing ports and unsupported pointer knobs failing closed; numeric, array, accessor and writer admission.

Face-port unit calls alone are not actual D2 facial animation evidence. Full-host integration must verify the single-owner batch changes rendered facial state, preserves gesture priority and drops stale intents. CPU evidence is not native Windows/macOS or GPU performance evidence.

### Explicit late face delivery policy

The D2 owner cannot backdate an already sealed batch. When a display frame crosses authored face key times, the adapter coalesces them to the last relevant face intent and delivers at the current observed owner frame. Its entry/exit transition starts there. A fully skipped completed face segment does not flash retroactively. This bounds pending face work to one intent per strategy tick, including long frame gaps and eight-cycle loops. Quaternion tracks still sample exact authored time through QuaternionLane; no frame-perfect historical face replay is claimed. Port cleanup remains immediate and attempts every owned release even if one callback throws.
