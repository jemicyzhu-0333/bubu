# Mature secondary-motion research proof

Not production admission. Exact npm artifacts: @pixiv/three-vrm-springbone 3.5.5 (MIT), @dimforge/rapier3d-compat 0.21.0 (Apache-2.0), Three.js 0.186.1 (MIT). Springbone peer range is Three >=0.137. The shared research-root package-lock.json records official registry integrity. Run npm ci --ignore-scripts at research/animation-0.1.0; repo-relative fixture imports and bare package imports resolve the shared Three instance. Run the research-root foundation:preflight check to verify it. An earlier 0.180.0 exploratory run was superseded and is not compatibility evidence.

## V2 authored admission and runtime

- asset-admission.mjs exposes async admitSecondaryAsset({asset, descriptor}). It validates bounded version-2 descriptor data, SHA-256 of canonical baked positions plus index topology, exact mesh names/counts, four-slot joint indices/weights and explicit pins. Validation runs once on loading an accessory, before any instance is created. Admission owns isolated geometry templates; dispose the admission after unloading the asset. Instances own their own clones and remain valid if the admission is disposed.
- Runtime index.mjs exports createSecondaryMotion({admission, parent, maxAngleRad?, assertCurrent?}). It has no kind dispatch, global-Y rule, nearest-X matching or fixture-specific import. Descriptors explicitly provide chains in any orientation and colliderLinks for each chain. Joint slot zero is the identity/pinned root. Four influences may cross chains. Runtime never guesses anatomy.
- descriptors/cape.json and descriptors/satchel.json are the actual admitted binding inputs. author-fixtures.mjs contains the old X/Y authoring heuristic strictly as an offline candidate generator for these two existing fixtures. It is not imported by runtime or invoked on load. Authoring new geometry requires a reviewed descriptor, not editing the solver.
- update({time, paused, reducedMotion, hidden, sampleAnchor}) uses injected seconds. The pure optional sampler may update only the private root. It must never advance body animation, pointer input or anchor revisions.
- Fixed 1/60 second with at most six substeps. Long gaps discard excess, rebase simulation time and clear spring history. Current root follows every frame, including zero-step and suspended frames.
- Pause/hidden/reduced motion resets library state and copies rest geometry only on entering suspension. Later suspended frames update the root and clock only. Resuming resets once and discards catch-up. No vertex or normal loop occurs on unchanged/no-tick frames. Preallocated skin matrices and vectors are reused; allocations inside Three/library routines are not claimed absent.
- reset(time), dispose(), diagnostics(). Teleport/reparent: set the new root, update matrices, reset. Dispose is idempotent. Source/body geometry and borrowed materials/textures remain untouched.
- maxAngleRad may only tighten the admitted bound. Each solved tick is checked against this angle and linked tail-proxy clearance. An unsafe candidate is discarded and the last accepted local joint poses retained. The library public setInitState method rebases Verlet history and equilibrium at that accepted pose; the next tick retries normally. This is a conservative acceptance/recovery wrapper, not a hard joint constraint or custom physics integrator. Explicit reset restores the original authored rest. Profiles whose rest tails already penetrate linked proxies are rejected at admission. A parent-frame change making the previously accepted pose infeasible fails closed.
- Active skinning computes private vertex positions, normals and bounds after actual solver steps. This remains a bounded CPU reference path, not a native performance guarantee or a substitute for a future measured GPU-skinning implementation.
- rapier.mjs is still the separate lazy isolated-world proof: createDetachedProp({object,parent,halfExtents,gravity,signal}), setHeldPose(rigidWorldMatrix), release(), update(), reset(), dispose(), diagnostics(). It is not a shared multi-prop collision world. Held transforms must be rigid unit scale. Its world is freed on disposal and failed construction.

## Reproduce

Run node secondary-motion/test.mjs from the animation-foundation-v1 directory after shared research-root installation and fixture preparation. Integration/asset-fixtures supplies a bake of the revised quiet-rest satchel, and the current corrected cape GLB. Source fixture modules and assets are same-repository inputs, not modified by this module. Integration has the real drag/longpress/tea tests and actual book geometry; this local test uses a cuboid book collider for contact solving.

evidence.json records runtime CPU, measured timing, 30/60/120 sampling, pin/angle/displacement, reset tolerance, 601 hidden frames, invalid-source/weight rejection, deliberately crossing horizontal-chain authoring, angle fallback, malformed time, long gaps and 30 equip/dispose cycles. Geometry SHA-256 values are embedded in each descriptor. Timings include vertex normal work; Node/Linux CPU measurements cannot predict Electron transparent-window or GPU cost. Process heap is one observed sample, not a leak plateau or WASM allocation measurement.

## Current outcome and limits

Corrected satchel: 1,590 vertices, 228 pinned. Cape: 4,807 vertices, 1,474 pinned. Test trace pin error zero, chain stretch below 3e-16, rate difference zero. Maximum local displacement approximately .1334 / .1424 model units; joint angles .0753 / .0973 radians. The isolated book proxy settles with .0001165 units floor penetration and zero velocity; it is not a high-speed thin-object proof.

Existing palm/wearable seam contacts remain unresolved. Sphere proxies constrain chain tails only; zero measured tail-proxy penetration does NOT establish mesh penetration, triangle contacts, seam continuity, grasp closure, fabric self-collision or correct tea interactions. Silhouette/motion/native visual acceptance remains blocked until reviewed. Body/face/source poses remain authoritative. This is research-branch checkpoint material, not production admission; main/release integration remains outside this scope.

Safety caps: 4 chains, 8 nodes each, 12 proxies, 512 source nodes, 64 meshes, 100k vertices and 32MiB geometry attribute bytes; finite bounded model coordinates and matrices. These are research resource limits, not product performance budgets. Fixed CPU work and memory ownership are bounded; allocation-free updates are not claimed.

## Recovery regression

The prior permanent-rest fallback has been removed. test-recovery.mjs replays the actual cape under x=.3*sin(8t), roll=.7*sin(4t), then stops movement at t=3. At 60/120Hz rejected-tick local mesh jump is zero; at30Hz a rejection frame may also include one accepted tick (maximum .05813 component change). Full active30Hz frame changes can reach .10991 in this deliberately aggressive trace; this is not visual/native approval. Final tails agree across30/60/120Hz; linked-tail penetration is zero. 107 rejections occur during motion and only one after stopping; recovery clears without manual reset. The intentionally impossible .055-penetrating rest profile now rejects before instance allocation. This only validates declared chain-tail spheres, not cloth triangles or wearable/palm seams.


## World-transform and failure contract

Secondary instances require finite rigid, unit-scale world transforms for both
parent and sampled attachment root. Translation and proper rotation are allowed;
scale, shear and reflection are rejected (orthonormal/determinant tolerance 1e-6).
This preserves the authored sphere and joint radii in world units. The check runs
on initialization, reset, every display update (including no-substep, pause and
resume), and sampled substeps/final poses. This does not add dynamic proxies or
whole-garment collision validation.

Any reset/update error invalidates and disposes that instance; callers must create
a new admitted instance rather than continue from partially modified state.
Disposal marks it invalid first, attempts every independent joint/geometry/root
release, then reports aggregated cleanup errors. Admission-token cleanup likewise
attempts every owned geometry even if one disposal observer throws. Retrying a
disposed instance is harmless and does not re-run failed observers.
