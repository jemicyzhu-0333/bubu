# bubu runtime 0.1.0 — authored clip checkpoint 03

This is a new isolated engine foundation, not a port of V1 and not the completed bubu interaction. It loads and plays an explicitly mechanical fixture. No new bubu art/expression pack or final drag/pet behavior is enabled.

## Run

Requires Node 20+ and Python 3 only for the optional local preview server/generators.

```sh
npm ci
npm test
node tools/benchmark-authored-clips.mjs
npm run serve
```

Open `http://127.0.0.1:8040/` for the mechanical browser demo. Three.js is pinned to 0.186.1 in package-lock.json from the official npm registry. No CDN, credentials, remote asset URL or build step is required. node_modules is not part of the deliverable.

## What exists

- Strict versioned manifest, character profile, target-segment and optional authored clip data, with SHA256, byte/complexity limits and self-contained GLB preflight.
- Semantic joint/socket binding, combined quaternion limits and complete morph-mesh roster.
- Independently timed joint/accessory authored quaternion tracks, STEP and phase-linear shortest-arc SLERP, unequal holds and explicit entry bridges. Authored key timing is preserved.
- One canonical event clock; masked skeletal/accessory quaternion segments; single expression path with an exact-neutral bridge; C0 interruption and generation cancellation.
- Fitted rigid accessory inheritance plus its local track. Shared parsed resources, private actor skeleton/morph state, abort-safe leases and idempotent cleanup.
- Demand rendering with future-event wake, idle RAF stop, pause/resume, and abort/generation-safe demo loading.
- ActorPool application admission reserves aggregate active/pending actor work before asynchronous creation and keeps source reservations through uncancellable late parses. Prepared packs are immutable snapshots.
- ContextLifecycle combines hidden/context-lost/disposed state and explicitly redraws after restoration. This policy is tested with simulated EventTargets, not a GPU context.

The entire running fixture pack is described by `fixtures/authored/manifest.json`; geometry remains in referenced GLBs. `fixtures/authored/authored-clips.json` has three independent tracks and fourteen keys. Its separate motion.json keeps the original bounded target primitive for interruption tests. Neither is production bubu acting.

## Verified so far

See `evidence/INDEX.md`, `evidence/tests.tap` and `evidence/authored-clip-cpu.json`. Tests cover the existing loading/lifecycle/admission pipeline plus hand-calculated clip samples, right-continuous STEP edges, small-angle/cross-axis SLERP, C0 interruptions, same-time ordering, 24/30/60/120/144 Hz and large jumps, shortest clips, malformed times/quaternions, key budgets and release/rollback. The demo's authored button plays the new pack; target buttons can interrupt it.

The focused CPU report uses actual prepared packs and pooled actors, including a near-limit key library (16 tracks ×128 keys; the separate72-active-track ceiling is unmeasured). It separates preparation, clone, event enqueue/entry, active sampling, jump/end and disposal. Reports label batch-throughput means separately from individual timing. These are Node CPU observations, not GPU frame rates. Changed-state ticks still propagate hierarchy matrices in O(nodes) work; binding discovery and full skinned-vertex scans are absent from normal sampling.

The previous ten-workload matrix in `evidence/cpu-matrix.json` is historical measurement02 evidence with its own source hashes. It does not measure this checkpoint's changed sampler. Its reproduction tool remains available. Encoded source-byte accounting is not decoded heap or VRAM; heap proxies do not establish zero allocation or complete leak freedom.

A local browser demo is supplied, but this environment did not run it in WebGL. The previous cloud Chromium sandbox blocker was not bypassed; the currently exposed CUA route targets the user's computer and was not used. Browser mouse latency, GPU rendering, native/Electron and power savings remain unverified.

## Scope and next gates

- C0 at event interruptions; authored STEP keys deliberately jump. No angular-velocity C1 or contact-physics claim.
- No V1 runtime imports, compatibility flags or silent fallback.
- No art profile activation; no gaze, brows, synthesized knees/neck, IK, cloth/collision guarantee, general surface-grab/landing solver or visual LOD.
- The approved body/selected faces and older interaction archives remain unchanged. Complete basic expressions must be approved and archived before new art adapters and the final long-press/drag test.

See `spec/CAPABILITY-ROADMAP.md` for the retained full-capability backlog. See `spec/CONTRACT.md`, `spec/API.md`, `spec/ART-ADAPTER-GATE.md`, `spec/AUTHORED-CLIP03.md` and `spec/wire.schema.json`. Only the parent project owner publishes the source; this workspace does not push it.

## Official API basis

Three supplies the scene/skin/morph structures used here; its general animation layer can later consume compatible authored clips. This slice uses its own bounded event/segment and authored-quaternion sampler and does not pretend AnimationMixer supplies contact physics.

- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html): object-local playback time, update and action/cache lifecycle.
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html): weights, time scale and crossfades; these do not validate artistic face-path compatibility.
- [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html): skeleton-aware cloning; shared geometry/materials need explicit ownership. Retarget helpers expose bone mapping/options, not missing anatomy.
- [glTF animation specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations): transform/morph tracks and interpolation are asset-level data; interaction, equipment and contact semantics require application contracts.
