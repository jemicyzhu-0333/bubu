# bubu runtime 0.1.0 — foundation vertical slice

This is a new isolated engine foundation, not a port of V1 and not the completed bubu interaction. It loads and plays an explicitly mechanical fixture. No new bubu art/expression pack or final drag/pet behavior is enabled.

## Run

Requires Node 20+ and Python 3 only for the optional local preview server/generators.

```sh
npm ci
npm test
node tools/bench.mjs
npm run serve
```

Open `http://127.0.0.1:8040/` for the mechanical browser demo. Three.js is pinned to 0.186.1 in package-lock.json from the official npm registry. No CDN, credentials, remote asset URL or build step is required. node_modules is not part of the deliverable.

## What exists

- Strict versioned manifest, character profile and motion data, with SHA256, byte/complexity limits and self-contained GLB preflight.
- Semantic joint/socket binding, combined quaternion limits and complete morph-mesh roster.
- One canonical event clock; masked skeletal/accessory quaternion segments; single expression path with an exact-neutral bridge; C0 interruption and generation cancellation.
- Fitted rigid accessory inheritance plus its local track. Shared parsed resources, private actor skeleton/morph state, abort-safe leases and idempotent cleanup.
- Demand rendering with future-event wake, idle RAF stop, pause/resume, and abort/generation-safe demo loading.

The entire running fixture pack is described by `fixtures/manifest.json`; geometry remains in referenced GLBs. `fixtures/motion.json` contains only a bounded mechanical segment primitive, not production acting.

## Verified so far

See `evidence/tests.tap`, `evidence/schema-validation.json` and `evidence/cpu-benchmark.json`. Tests cover actual GLB loading, strict negative inputs, same-time event order, 30/60/120 Hz equivalence, interruption world-transform continuity, repeated face transitions, equipment composition, shared/failed/aborted cache loads, disposal and idle scheduling. Independent review also checked 24/144 Hz and a large time jump.

The CPU benchmark uses 148 mechanical vertices / 16 resolved nodes, with zero skinned-vertex reads during normal ticks. Batch mean costs are recorded, not a GPU frame budget or a comparison against the old 45k-vertex model. Zero JS allocation/GC is not claimed.

A local browser demo is supplied, but this environment did not run it in WebGL. The previous cloud Chromium sandbox blocker was not bypassed; the currently exposed CUA route targets the user's computer and was not used. Browser mouse latency, GPU rendering, native/Electron and power savings remain unverified.

## Scope and next gates

- C0 pose continuity only; no claim of angular-velocity C1 continuity.
- No V1 runtime imports, compatibility flags or silent fallback.
- No art profile activation; no gaze, brows, synthesized knees/neck, IK, cloth/collision guarantee, general surface-grab/landing solver or visual LOD.
- The approved body/selected faces and older interaction archives remain unchanged. Complete basic expressions must be approved and archived before new art adapters and the final long-press/drag test.

See `spec/CONTRACT.md`, `spec/API.md`, `spec/ART-ADAPTER-GATE.md` and `spec/wire.schema.json`. Only the parent project owner publishes the source; this workspace does not push it.

## Official API basis

Three supplies the scene/skin/morph structures used here; its general animation layer can later consume compatible authored clips. This slice uses its own bounded event/segment primitive and does not pretend AnimationMixer supplies contact physics.

- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html): object-local playback time, update and action/cache lifecycle.
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html): weights, time scale and crossfades; these do not validate artistic face-path compatibility.
- [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html): skeleton-aware cloning; shared geometry/materials need explicit ownership. Retarget helpers expose bone mapping/options, not missing anatomy.
- [glTF animation specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations): transform/morph tracks and interpolation are asset-level data; interaction, equipment and contact semantics require application contracts.
