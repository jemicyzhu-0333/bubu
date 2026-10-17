# Minimal API and data ownership

Version: 0.1.0. `spec/wire.schema.json` describes the four wire document shapes; `src/contracts.mjs`, `src/clip-contract.mjs` plus GLB preflight enforce semantic and resource constraints. There are no unknown-field compatibility aliases or runtime extensions.

## Public entry flow

1. `preparePack(read, {signal})` validates the complete pack. Each reader Uint8Array/Buffer is copied before the hash await or the next read. Returned ordinary metadata is deeply frozen; audits have a read-only view; data views return byte copies. Editing an assembly/profile requires new files/hashes and preparation. Readers must bound allocation before returning bytes.
2. Use one `new ActorPool({limits})` for the application's admission/ownership domain. `await pool.create(preparedPack, {signal})` reserves aggregate costs before parsing/cloning, uses its private shared cache, and rolls back failures/aborts. Its suite owns private skeleton/morph state and fitted rigid equipment. `pool.dispose()` cancels pending creates and disposes active actors; `pool.stats` is a snapshot. Lower-level `createSuite` remains an internal primitive for binding tests and isolated benchmarks; direct calls do not provide application admission. This is an application API contract, not a security boundary against arbitrary same-origin JavaScript constructing independent pools.
3. `suite.enqueue({time, type:'play', segment})` , `suite.enqueue({time,type:'playClip',clip,entrySec})` or `suite.enqueue({time,type:'cancel'})` schedules a validated canonical event. Time is monotonic seconds from the instance's clock origin. Past events and queue overflow are errors.
4. `suite.advance(time)` samples event boundaries and current state. It returns whether pose/face changed; `suite.isAnimating(time)` and `suite.nextDeadline()` drive demand rendering. It does not raycast, scan the skin, integrate physics, read pointer input, or render.
5. `suite.dispose()` is idempotent, removes the actor, disposes each instance skeleton once and releases shared leases. The last lease disposes shared source geometry/materials. Calls to `enqueue/advance` after disposal fail.

`DemandLoop` injects `now/requestFrame/cancelFrame/setTimer/clearTimer/draw`. `invalidate()` wakes, `pause()/resume()` preserve state across visibility changes, and `dispose()` cancels pending handles. The browser demo has generation-checked, abortable loading so a discarded asynchronous create cannot attach a late actor.

## Motion segment primitive

The first implemented normalized segment has phase 0..1 and a declared duration, and targets quaternion deltas for semantic joints/accessory IDs. Its `smoothstep` curve is a mechanical test primitive. It is not an authored bubu acting curve or a promise to use one easing function for every body part. The separate reviewed authored format below preserves independent key timing without applying this smoothstep.

Masks are the IDs present in the segment. Other channels retain their existing track. One resolved lane owns each joint or accessory local quaternion. Targets must be unit quaternions within the character cap. Delta multiplies the captured rest quaternion on the left. Translation, scale and actor root animation are unsupported.

Expression cues use a semantic path declared in the profile. Every path knot supplies each affected mesh's target weights; adjacent knots interpolate. Cross-path routing withdraws to neutral and then enters the destination using separate durations; the skeleton need not wait. `FaceLane.arrival` reports when the target will actually arrive. C0 state continuity is tested; C1 angular velocity continuity is not supported.

## Authored quaternion clip primitive

Optional manifest.clips references one hash-locked `bubu-clips` JSON library. `playClip` requires explicit entrySec0.02..1. At its event time it samples the current owned lanes, bridges by linear SLERP to their first authored values, then plays the declared clip duration. Other lanes keep running. STEP changes on the canonical absolute key instant; LINEAR is shortest-arc quaternion SLERP, including small angles. No additional smoothstep, looping, root motion, translation, expression key tracks or retargeting is inferred.

Final key values hold and the lanes become inactive. New target/clip events share priority and enqueue order; cancel wins the same timestamp and removes old queued events. Clip targets and existing segment targets are normalized and canonicalized before interpolation. See AUTHORED-CLIP03.md for exact limits and boundary rules. The `clips` metadata is deeply immutable and part of the same admitted pack as its target bindings.

## Error families

- `VERSION/UNKNOWN_FIELD/UNSUPPORTED`: this format/capability is unavailable. No implicit V1 branch or fallback.
- `PATH/INTEGRITY/LIMIT/JSON/GLB/GLTF_REFERENCE`: malformed, out-of-package, changed, oversized or unsupported resource.
- `REFERENCE/BINDING/AMBIGUOUS_NODE/UNBOUND_CAPABILITY/UNBOUND_MORPH_MESH`: semantic binding is incomplete or inconsistent.
- `QUATERNION/JOINT_LIMIT/FACE_SIMPLEX`: invalid transform or shape-path bounds.
- `EVENT/KEY_TIME/RANGE/DISPOSED`: invalid schedule, clock or lifecycle use.

A future approved fallback must be a named, versioned, validated binding with requirements of its own. It cannot be an instruction to ignore an error. No fallback mechanism is implemented in this first slice.

## Deliberate limits

The mechanical fixture can play authored skeletal/accessory motion. The distinct historical static05/r6 adapter remains neutral-only. Checkpoint05 adds only its registered seven-slot semantic face adapter, including authored brow/tongue layers. Art skeletal motion, general GLB animation playback, skinned clothing, textures, physical collision, ground support, surface grab, drag/pet control, independent gaze/brows, IK and visual LOD remain unavailable. Their old experimental evidence is not an implementation of these capabilities in this engine. The demo is a local browser shell; Node CPU tests are not browser/GPU measurements.

## Context and admission services

`ContextLifecycle({canvas,visibilityTarget})` is the sole visibility/context pause owner for its bound scheduler. `bind(loop)` pauses the previous scheduler and applies current gate state. Context loss uses standard preventDefault and pauses; restoration resumes only if visible, with explicit invalidation even from idle. Canonical wall time is not reset: the next frame samples queued events through now. `dispose()` removes listeners and disposes its bound loop; a late restoration cannot revive it. EventTarget/VM evidence verifies policy only, not GL resource restoration.

See MEASUREMENT02.md for aggregate limits. Source bytes count unique encoded GLBs and clip libraries, including unfinished parses after cancellation; they are not decoded heap/VRAM. Caller-retained prepared packs remain caller-owned memory.

## Checkpoint04 neutral adapter

`prepareNeutralPack(read, {signal})` accepts only the two fixed historical approved neutral hashes and the separate strict `bubu-neutral-suite` / `bubu-neutral-profile` contract. `ActorPool.create` remains the single application admission API; it returns a neutral actor with `root`, `budget`, `verification`, `readiness`, `assertNeutral`, `advance`, `isAnimating`, `nextDeadline`, `dispose`. There is no motion or expression event API. See NEUTRAL04.md for trusted-host scene mutation boundaries, exact resource accounting and portable fixtures.

`ActorPool.limits.decodedArrayBytes` defaults to64MiB (hard256MiB), deduplicated per versioned GLB cache identity. `stats.decodedArrayBytes` is a reserved allowance, not the measured backing size or total process/GPU memory. Neutral `verification.decodedArrayBytes` reports actual unique geometry buffers. All GLB modes reserve a BIN-copy allowance bounded by encoded asset size, plus every actually loaded bufferView's full byteLength once per view index, plus dense arrays allocated for sparse/zero-base accessors. Overlapping view indices are distinct allocations; accessors sharing a view share its backing. Unused views/accessors do not allocate loader buffers. The pool checks this allowance before calling GLTFLoader; a post-parse geometry check remains a backstop. Clip JSON contributes0 geometry bytes. See PREPARSE07.md for scope and exclusions.

## Checkpoint05 semantic face adapter

`prepareFacePack(read,{signal})` validates the separate fixed slice. `ActorPool.create` returns a face-only actor with `enqueue` (exact face/cancel cue), `advance`, `state`, `isAnimating`, `nextDeadline`, `assertCurrent` and `dispose`, plus the rendering root and resource/verification metadata. It has no playClip, skeleton, drag or pet entry. The actor starts in original Basis; semanticDefault R0 does not auto-play. Only the original eight-knot single semantic path can be active, across all8facial layers. See FACEPATH05-API.md and FACE-TIMELINE.md for duration/arrival, cancellation, scalar continuity and scene-host trust boundaries.
