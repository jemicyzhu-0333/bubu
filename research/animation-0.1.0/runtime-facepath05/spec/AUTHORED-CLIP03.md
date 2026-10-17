# Authored quaternion clips — first bounded implementation

0.1.0, mechanics-only extension. Implemented for mechanical fixtures. Existing target-segment primitive remains explicitly distinct. No retarget/art/root-motion/expression-track activation.

## Wire shape

Manifest optionally supplies `clips: "clipAssetId"`; that asset has kind `clips`, a local package-relative path, bytes and SHA256. Required capabilities must include `authored-quaternion-clips` when present. Clip JSON is a separate referenced asset, not embedded geometry or executable code.

Library format `bubu-clips`, version `0.1.0`, `id`, `clips` array. Each clip has `id`, `durationSec`, `endBehavior: "hold"`, and `tracks`. Each track has `target` (exact semantic `joint:<id>` or `accessory:<id>`), `interpolation` (`STEP` or `LINEAR`), and `keys`. Each key has normalized phase `at` and quaternion `rotation` in parent-space delta convention. All fields are strict; unknown fields/channels/interpolation reject.

At least one track, at least two keys, exact first phase0 and last1, strictly increasing times. Minimum physical key gap0.0001sec (validation allows a scale-derived floating-point roundoff bound at that threshold; it does not shift sampling boundaries); duration0.02..10sec. No duplicate target within a clip. Joint keys must bind existing semantic joints and satisfy their combined-angle caps; accessory cap0.5rad. Finite unit quaternions within1e-6 norm tolerance, otherwise reject; sampler normalizes and uses the equivalent positive-w representative because admitted rotations are <pi.

Limits:128KiB library bytes,16 clips,72 tracks per clip,128 keys per track,2048 keys/10240 rotation+time scalars across the library. These supplement pack/JSON/deformation limits. ActorPool conservatively charges clipKeyScalars per actor (default100000, hard maximum500000; application limits may only lower the hard maximum) and includes the encoded clip library in shared source-byte admission. These are bounded workload costs, not exact heap/VRAM accounting.

## Playback and interruption

Event `{time,type:"playClip",clip,entrySec}`. entrySec is explicit0.02..1sec. At the same time, cancel has priority0; both play and playClip share priority1 and order by ascending enqueue sequence. Cancel invalidates all already queued plays at/after its time. A clip event is rejected if its bridge+authored duration exceeds the canonical clock range. Past events and queue overflow reject.

At the event time, sample prior motion first. For each owned channel, capture current value and LINEAR quaternion-slerp into that track's first key during entrySec. The authored phase clock starts only after this declared entry bridge. This preserves event-time C0 without replacing the author's key timing with a common smoothstep. Unowned channels continue their current lanes. Existing target-segment quaternions are also normalized to positive-w on planning, and their caps checked on normalized rotation, so a near-unit accepted source cannot create a normalization discontinuity at clip entry.

Inside the clip: STEP uses the previous key until the exact next-key time, then the next value (right-continuous). Sampling compares canonical absolute key instants (clipStart + phase × duration), without epsilon or a normalized-phase round-trip. LINEAR uses phase-linear shortest-arc quaternion interpolation; equal successive values are genuine holds. Tracks have independent key times. No spline, spring, sinusoid or hidden looping. STEP's deliberate key jumps are not claimed to be continuous animation.

At the final key, hold its value and stop animation for that lane. Clear active clip references; another event or cancel can overwrite it. Cancel uses the existing explicit neutral recovery policy. Interrupting any active clip begins from the exact sampled event-time pose, with no rest reset. Promise is C0 at interruptions, not C1 velocity or contact physics. Pure clip sampling still has intentional STEP key discontinuities.

## Verification scope

Independent joint/accessory tracks, hand-calculated boundaries, same-time ordering, early/late interruption, shortest clip, invalid/repeated time keys, invalid quaternion/caps, all budget limits, 24/30/60/120/144 Hz and large jumps, actor disposal/cache rollback. No GPU claim. Fixed art library and final long-press/drag remain gated.
