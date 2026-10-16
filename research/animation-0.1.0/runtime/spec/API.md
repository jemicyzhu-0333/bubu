# Minimal API and data ownership

Version: 0.1.0. `spec/wire.schema.json` describes the three wire documents; `src/contracts.mjs` plus GLB preflight enforce semantic and resource constraints. There are no unknown-field compatibility aliases or runtime extensions.

## Public entry flow

1. `preparePack(read, {signal})` reads `manifest.json`, verifies each declared file's exact byte count and SHA256, preflights all self-contained GLBs, validates profile/motion references and resolved instance budgets. It does not create a renderer or expose a partial actor. `read(path, maxBytes, signal)` must bound bytes before allocation; browser and local examples are included.
2. `createSuite(preparedPack, resourceCache, {signal})` acquires shared parsed sources and creates private skeleton/pose/morph state. It binds all declared channels and fitted rigid equipment before returning. Any failed binding releases acquired leases.
3. `suite.enqueue({time, type:'play', segment})` or `suite.enqueue({time,type:'cancel'})` schedules a validated canonical event. Time is monotonic seconds from the instance's clock origin. Past events and queue overflow are errors.
4. `suite.advance(time)` samples event boundaries and current state. It returns whether pose/face changed; `suite.isAnimating(time)` and `suite.nextDeadline()` drive demand rendering. It does not raycast, scan the skin, integrate physics, read pointer input, or render.
5. `suite.dispose()` is idempotent, removes the actor, disposes each instance skeleton once and releases shared leases. The last lease disposes shared source geometry/materials. Calls to `enqueue/advance` after disposal fail.

`DemandLoop` injects `now/requestFrame/cancelFrame/setTimer/clearTimer/draw`. `invalidate()` wakes, `pause()/resume()` preserve state across visibility changes, and `dispose()` cancels pending handles. The browser demo has generation-checked, abortable loading so a discarded asynchronous create cannot attach a late actor.

## Motion segment primitive

The first implemented normalized segment has phase 0..1 and a declared duration, and targets quaternion deltas for semantic joints/accessory IDs. Its `smoothstep` curve is a mechanical test primitive. It is not an authored bubu acting curve or a promise to use one easing function for every body part. More sophisticated authored clips/breakdowns require a later explicit format extension and review; they are not silently interpreted now.

Masks are the IDs present in the segment. Other channels retain their existing track. One resolved lane owns each joint or accessory local quaternion. Targets must be unit quaternions within the character cap. Delta multiplies the captured rest quaternion on the left. Translation, scale and actor root animation are unsupported.

Expression cues use a semantic path declared in the profile. Every path knot supplies each affected mesh's target weights; adjacent knots interpolate. Cross-path routing withdraws to neutral and then enters the destination using separate durations; the skeleton need not wait. `FaceLane.arrival` reports when the target will actually arrive. C0 state continuity is tested; C1 angular velocity continuity is not supported.

## Error families

- `VERSION/UNKNOWN_FIELD/UNSUPPORTED`: this format/capability is unavailable. No implicit V1 branch or fallback.
- `PATH/INTEGRITY/LIMIT/JSON/GLB/GLTF_REFERENCE`: malformed, out-of-package, changed, oversized or unsupported resource.
- `REFERENCE/BINDING/AMBIGUOUS_NODE/UNBOUND_CAPABILITY/UNBOUND_MORPH_MESH`: semantic binding is incomplete or inconsistent.
- `QUATERNION/JOINT_LIMIT/FACE_SIMPLEX`: invalid transform or shape-path bounds.
- `EVENT/RANGE/DISPOSED`: invalid schedule, clock or lifecycle use.

A future approved fallback must be a named, versioned, validated binding with requirements of its own. It cannot be an instruction to ignore an error. No fallback mechanism is implemented in this first slice.

## Deliberate limits

Only a mechanical fixture can currently activate. No art-target adapter, GLB animation playback adapter, skinned clothing, textures, physical collision, ground support, surface grab, drag/pet controller, gaze, brows, IK or visual LOD is implemented. Their old experimental evidence is not an implementation of these capabilities in this engine. The demo is a local browser shell; Node CPU tests are not browser/GPU measurements.
