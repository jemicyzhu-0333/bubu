# Bounded accessory effects, isolated candidate

Owner: presentation-only effect runtime. Writes only its own scene subtree, instance buffers and cloned/shared-owned materials. No body, source-mesh/material, physics-state, persistence, Electron, main/controller/renderer, or production changes. Three.js dependency is injected; tests use the existing exact 0.186.1 installation. No new particle/physics library.

## Contract

`createEffectRuntime({ THREE, scene, seed, limits })` creates one runtime per scene/actor owner. `enter({ effectId, anchor, space, maxParticles, lifetimeSec, rateHz, durationSec, glowMesh })` returns a handle or `null` when full. Semantic IDs: `leaf-stream`, `petal-stream`, `halo-sparks`. Instanced opaque double-sided planes provide small leaf/petal flecks; halo may overlay an existing static mesh geometry with an owned additive material. It never invents/replaces the body or halo mesh. This is restrained accent art, not textured/rotating camera-facing botanical simulation.

`anchor` is either an Object3D (world matrices refreshed at sample) or `(targetMatrix, poseRevision) => void`. Prefer the revision-checked anatomical registry provider. The provider must write the final world transform into the supplied Matrix4 and reject stale registry revisions. Registry calls returning new matrices should be wrapped with a caller-owned cached target where supported. Object3D sampling refreshes transforms but cannot prove the caller already performed physics; the frame coordinator is responsible for order.

Host order: authored clip/base pose → secondary solve → final accessory transforms → registry sampleFinalPose(revision) → runtime.tick({dt,poseRevision,paused,hidden,reducedMotion}) → render. No autonomous clock, RAF, RNG globals or solver. Each tick requires a fresh increasing safe-integer revision. Inputs are seconds. Sampling reads final matrices; it never writes attachment position/quaternion/scale. The runtime validates its scene transform before inverse conversion. Anchor/root/inverse matrix components must be finite and at most 10,000 in magnitude; outgoing instance/glow matrices must be finite and at most 100,000,000, preventing finite-double to infinite-Float32 overflow. This is an explicit bounded scene coordinate domain.

Limits are hard ceilings and may be reduced: 4 emitter slots × 24 particles = 96 aggregate particles, 3-second particle lifetime, 12 emissions/second/emitter, 8 per burst/update, 4 material variants, 0.05-second maximum advancement per tick, effect duration ≤3600 seconds. Capacity exhaustion drops new effects/emission. Slots, typed arrays, temporary matrices/vectors/quaternions and render objects are allocated at creation; no application per-frame allocations. Handles and RNG closure are created at equip time. Diagnostics intentionally allocate snapshots outside hot loops. A runtime's cap is per runtime, so the composition root must cap the number of actors/runtimes; this is not an unlimited global budget service.

## Lifecycle and ownership

States: entering → emitting → draining → disposed. `stop({immediate:true})` removes immediately; `stop({immediate:false})` converts local tails to world coordinates and detaches anchor/glow references. Natural duration expiry uses the same drain path. World space means scene/window-local Three world, not trails across OS windows. Paused/hidden freezes age, clears emission credit and keeps capacity reserved; resuming never replays missed time. Reduced motion clears decorative particles and retains a static halo overlay/unchanged original accessory. Static glow has no pulse/flicker.

Handle `reset()` clears and restarts only a still-emitting/entering instance; drained/disposed handles cannot resurrect. Runtime reset removes all effects and starts a new revision epoch. `dispose()` is terminal and idempotent. Old handles have invalid generations after slot reuse. There are intentionally no asynchronous loads/listeners in this module: callers capture handle.generation and check `handle.isCurrent(token)` before accepting an async completion; stale callers must dispose only their own returned resources. No shared resources are attached through an unchecked async method.

Runtime owns one plane geometry, four materials, instance buffers, and its scene subtree. Existing glow geometry, original material/mesh, anchor, scene, and body are borrowed. Never dispose them through this module. Halo overlay uses depth test, additive blend, depthWrite=false; ordinary sparse flakes are opaque and depth-writing. No bloom, texture atlas, sorting/overdraw workaround or source mutation. Transparent alpha/glow compositor correctness is not established by CPU renders.

## Validation and evidence

Run `node --expose-gc animation-foundation-v1/effects/test-effects.mjs` from `research/animation-0.1.0` after the [shared setup](../integration/README.md#running). `cpu-evidence.json` records 120,000 deterministic churn frames (2,000 simulated seconds), fixed-pool/aggregate caps, CPU update percentiles and six post-GC memory samples. Tests cover pause/hidden/large resume, reduced motion, stale/disposed handles, local/world detach, repeatable seeded replay, borrowed resource disposal, invalid numeric inputs, full capacity and shutdown. Heap samples are descriptive; this is not a heap-allocation trace or GPU memory measurement.

`export-prototypes.mjs` reconstructs actual existing exported forest/sakura/halo accessory geometry, anchors the runtime to its actual accessory bounds (outer edge for petals/leaves, top edge for halo), runs real runtime emission, and exports the exact resulting instance matrices. `render-prototypes.py` renders that geometry using Blender CPU, preserving the existing source-body geometry. These renders are **not** the live registry integration, Three WebGL shader acceptance, native-window evidence, or GPU performance evidence. The separate integration worker checks the anatomical registry pipeline.

Remaining release gates: actual 99 CSS-pixel body width and DPR checks, native transparent-window alpha over light/dark/color backgrounds, occlusion and halo overlay z-fighting, hardware GPU timings/counters and context loss, actual event/wardrobe lifecycle wiring. This candidate may be backed up on the research branch; it is not production acceptance.

### Enter, burst and release contract

All `burst(count)` calls enqueue bounded requests, for both entering and emitting
handles. The return value is the accepted request count, not particles already
spawned. Pending requests total at most `maxBurst` and never exceed emitter
capacity. The next ordinary `tick` samples the current anchor, consumes the queue
once and spawns only if the current frame policy allows it. No call manufactures
an extra tick or uses the preceding frame's anchor/suppression policy.

Hidden, paused and reduced-motion ticks discard pending requests. A resume-frame
request can emit on that frame; a hide-frame request cannot emit early. Discarded
requests never replay on resume. Stop cancels pending requests; reset and disposal clear them.
Draining or disposed handles cannot restart themselves; authored action re-entry
creates a fresh generation. Lifetime, capacity and normal rate limits still apply.

Disposal invalidates the runtime before cleanup. Each instanced mesh, owned geometry
and material is released independently; observer errors are aggregated after all
cleanup attempts. Borrowed glow geometry remains outside this ownership. Diagnostics
of zero ownership mean cleanup was attempted, not proof that an external observer or
GPU driver completed reclamation. Foundation frame lifecycle preparation (including
suspend/resume and strategy pause/resume) shares the frame failure cleanup boundary.
