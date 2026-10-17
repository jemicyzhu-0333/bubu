# A05 continuous petting prototype (not final art approval)

Independent long-press acting controller and host integration using the shared drag prototype's explicit body capability. This does not modify the frozen face-only runtime or its assertions. No second face writer, invented neck joint, body squash, or 2D warp.

## Reference actually viewed
- `petting-library-20261016/petting-contact-v6.png`: historical 2D sequence; inspected as a counterexample, not reused as motion geometry.
- `bubu-3d-a-pet-contact-20261016/pet-contact-large.png`: actual A05 grounded crown/side contact poses, release from current pose, bounded single-foot lift. It is prior prototype evidence, not a claim that all behavior has current user approval.
- Full18 approved static semantic mapping from the frozen expression library. Uses 08 → P2, occasional 07/S2, R0 release; semantic changes follow the existing Director's Basis route.

## Acting proposal
1. Eligible upper-body hit held for 0.4 seconds qualifies. Movement beyond 8 screen pixels before or during entry hands off to drag. These numbers are prototype values.
2. Enter on 08 while gently orienting the entire body toward the supplied contact side; settle into P2.
3. Stable enjoyment is genuinely quiet. No per-frame RNG, oscillating loop, or perpetual body wobble. Only actual contact changes update the pose target.
4. Deterministic sparse response opportunities occur roughly 14–25 seconds apart, with a short 07 or S2 response and return to P2. This is an interaction-owned storyboard, never autonomous P1 selection. Timing and face choice remain subject to user visual review.
5. Release, cancellation, capture loss, contact loss or another event smoothly releases from current position and velocity. Body returns exactly to rest. The R0 closing beat then relinquishes the single face owner to the caller's normal scheduler (the isolated fixture leaves Basis).

## Contracts
`PettingController.input(event)` / `advance(logicalSeconds)` / `drain()` / `snapshot()` are pure. Input eligibility and normalized side come from the host's actual surface hit; the pure controller does not pretend to perform raycasting. Process complete same-time input before rendering. Drain output at event boundaries when replaying large time jumps.

`createPettingHost()` is the runnable test fixture: actual full18 `WeightedExpressionOwner`, explicit four-limb body-enabled `ActorPool`, one shared clock, original face mapper. It batches semantic requests before advancing the owner, suppresses P1 for the complete interaction, and catches up missed foreground frames with bounded returned diagnostics. `suspend(wallSeconds)` retires the capture and freezes logical time; `resume(wallSeconds)` continues the release without replaying hidden elapsed time. `inputSurface` raycasts only this actor's actual skin; `inputHit` validates actor identity, real triangle topology, barycentric bounds and current surface registration before deriving side from mesh-local position. The provisional eligible band is local y=1.2–1.65, excluding upper ear tips. The API is not DOM wiring; real pointer capture/browser event wiring remains integration work.

Body uses the shared `BodyRigAdapter`. Body angles are small rigid whole-character rotations, shoulder motion is tiny, hips remain neutral. Ground correction samples actual skinned vertices. It guarantees nonpenetration, not two-foot IK: keyframes currently show a maximum opposite-foot lift about 0.01372 model units, sole-centroid horizontal drift 0.02471, and material-anchor movement 0.04350 from its initial world point. Contact markers are actual material triangle/barycentric anchors, recomputed after pose. Marker following is distinct from a fixed-pointer constrained contact solve; no such solve is claimed.

## Validation and artifacts
Run `node --test petting-prototype-v1/tests/*.test.mjs` from the shared workspace. Seventeen tests cover qualification/early release, dragging during entry, stale/repeated pointers, loss of the actual surface during qualification, quick regrab during recovery, interruption and capture loss, four-hour pure hold, 30/60/120 Hz body equivalence, actual full18/body rig admission, actual visibility freeze, two-hour missed-frame catch-up, P1 suppression, grounding and disposal.

`tools/export-keyframes.mjs` emits actual CPU-skinned/morphed world vertices from the real Three.js actor, plus face owner state, bone/body transforms, contact anchors and per-foot minima. The shared Blender renderer only renders those evaluated vertices using materials from the exact full18 GLB. It does not independently reconstruct the motion or face. This is offline evidence, not browser/WebGL/OS performance certification.

Preview media and large raw vertex exports are private review artifacts. Do not publish them to Git. Source/fixture contracts and compact numeric test evidence may be published by the parent on the authorized research branch, never merged to main without authorization.
