# bubu runtime 0.1.0 — seven-path expression checkpoint 06 (candidate)

This is a new isolated engine foundation, not a port of V1 and not the completed bubu interaction. The mechanical fixture still plays authored tracks, and the separate neutral04 adapter remains neutral-only. This candidate adds a distinct hash-locked seven-slot expression adapter with complete brow/tongue layers and a single-semantic clock. The 18-slot static library is approved; this smaller runtime and its transition appearance have their own gates. Final drag/pet behavior is not enabled.

## Current checkpoint status

Checkpoint06 is a technical overlay on commit d3c5c76664d9a664e0cfdf22342476a880d8a301, under the retained research/animation-0.1.0/runtime-facepath05 directory. That directory name is historical; STATUS.json identifies the current revision. Unlisted source files, fixtures, model hashes and approved artwork remain unchanged. Checkout the base commit to reproduce checkpoint05 exactly.

- Current full suite: 167/167 passed; independent10-group reversal review passed.
- Safe return to the still-active face now brakes and reverses on the same path. Cross-face requests still require Basis and never mix semantics.
- The old tool-capacity interruption is no longer the current blocker: file reads, tests and offline rendering execute successfully in this task.
- Source-resolution Basis is pixel-exact to the approved reference. Fixed-scale source downsampling resolves the direct-small-render grain discrepancy without changing artwork.
- The same-scenario before/after continuous offline renders have been produced; comparative visual review is pending. No overall transition visual pass is claimed.
- Real WebGL/GPU, full18 runtime, drag and long-press remain untested.

See STATUS.json, spec/FACEPATH06.md, evidence/tests-final.log and evidence/review/SAME-FACE-REVERSAL-REVIEW.md. Historical05 evidence is retained with its original source hashes and must not be read as the current test or visual status.

## Run

Requires Node 20+ and Python 3 only for the optional local preview server/generators.

```sh
npm ci
npm test
node tools/benchmark-facepath.mjs
# Historical neutral-only benchmark:
node tools/benchmark-neutral.mjs
# Optional historical mechanical benchmark:
node tools/benchmark-authored-clips.mjs
npm run serve
```

Open `http://127.0.0.1:8040/face.html` for the seven-slot semantic diagnostic, `/neutral.html` for neutral-only loading, or `/` for the mechanical demo. Three.js is pinned to 0.186.1 in package-lock.json from the official npm registry. No CDN, credentials, remote asset URL or build step is required. node_modules is not part of the deliverable.

## New seven-slot expression adapter

- Fixed reviewed subset: 04, N3, A7, 07, S5, R0 and N2. Eight authored knots per face, all eight facial layers explicitly bound and cleared. The 45,945-vertex body is shared and unmorphed.
- One semantic path at a time; only its adjacent authored knots interpolate. Cross-face requests withdraw to original Basis before entering the latest destination. R0 is a separate short-horizontal face, not Basis and not automatically activated at load.
- Canonical event times, explicit fade-out/fade-in, bounded scalar braking, cancellation generations, observable predicted/actual arrival and settled holds. Scalar C1 does not imply vertex-velocity C1 through piecewise geometric knots.
- Static rig/body, semantic face/cancel API only; no arbitrary morph arrays, direct dual-face mixing, gaze, skeletal playback or pointer interaction in this adapter.
- One application ActorPool retains shared-source admission/cache ownership across all purposes. No runtime morph-bank swapping or body duplication.

See `spec/FACEPATH06.md`, the historical `spec/FACEPATH05.md`, `spec/FACE-TIMELINE.md` and `spec/FACEPATH05-API.md`. Tests and renderer evidence must retain their individual scope: source/numeric compatibility, scalar behavior, offline facial imagery and real WebGL are separate gates.

## Retained neutral-only compatibility

- Exact registered static05/r6 sources, unmodified GLBs bundled for portable tests. The old r6 face05 design is historical; every face weight stays zero.
- Separate bounded art parser for the actual specular/ior materials, COLOR/NORMAL and sparse accessors. Existing mechanical limits remain separate.
- Complete fixed semantic rig/mesh binding, source/rest/material checks and numeric geometry parity with the explicit Three skin-weight normalization exception.
- Same ActorPool active/pending admission and source cache; separate conservative shared decoded-geometry array reservation plus measured backing bytes. This is not total heap or VRAM.
- Static actor API has no play/face/clip/interaction entry. Its root is a trusted-host scene handle.

See `spec/NEUTRAL04.md`, `evidence/neutral-cpu.json` and the required real-asset tests. CPU/source compatibility does not verify rendered artistic appearance.

## Existing foundation

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

See `evidence/INDEX.md`, `evidence/tests.tap` and `evidence/neutral-cpu.json`. Current tests include required bundled neutral assets, sparse/parser adversarial cases, numerical source parity, all-zero morph/rest, profile/API restrictions, shared-source/independent-actor state, admission and cancellation. Historical `evidence/authored-clip-cpu.json` retains its own checkpoint03 hashes. The mechanical tests cover the existing loading/lifecycle/admission pipeline plus hand-calculated clip samples, right-continuous STEP edges, small-angle/cross-axis SLERP, C0 interruptions, same-time ordering, 24/30/60/120/144 Hz and large jumps, shortest clips, malformed times/quaternions, key budgets and release/rollback. The demo's authored button plays the new pack; target buttons can interrupt it.

The historical checkpoint03 focused CPU report uses actual prepared packs and pooled actors, including a near-limit key library (16 tracks ×128 keys; the separate72-active-track ceiling is unmeasured). It separates preparation, clone, event enqueue/entry, active sampling, jump/end and disposal. Reports label batch-throughput means separately from individual timing. These are Node CPU observations, not GPU frame rates. Changed-state ticks still propagate hierarchy matrices in O(nodes) work; binding discovery and full skinned-vertex scans are absent from normal sampling.

The previous ten-workload matrix in `evidence/cpu-matrix.json` is historical measurement02 evidence with its own source hashes. It does not measure this checkpoint's changed sampler. Its reproduction tool remains available. Encoded source-byte accounting is not decoded heap or VRAM; heap proxies do not establish zero allocation or complete leak freedom.

A local browser demo is supplied, but this environment did not run it in WebGL. The previous cloud Chromium sandbox blocker was not bypassed; the currently exposed CUA route targets the user's computer and was not used. Browser mouse latency, GPU rendering, native/Electron and power savings remain unverified.

## Scope and next gates

- C0 at event interruptions; authored STEP keys deliberately jump. No angular-velocity C1 or contact-physics claim.
- No V1 runtime imports, compatibility flags or silent fallback.
- Facial activation is limited to the registered seven-slot subset. Brows and tongue are authored face layers, not independent controls. No gaze, synthesized knees/neck, IK, cloth/collision guarantee, general surface-grab/landing solver or visual LOD.
- The approved body and all 18 static semantic faces remain unchanged. New runtime transition appearance, full-library residency and final long-press/drag tests each require their own gate.

`spec/ART-TRANSITION-NEXT-GATE.md` records the remaining runtime/library and genuine GPU evidence gates. The seven-slot closure does not automatically unlock full18 playback or final interaction.

See `spec/CAPABILITY-ROADMAP.md` for the retained full-capability backlog. See `spec/CONTRACT.md`, `spec/API.md`, `spec/ART-ADAPTER-GATE.md`, `spec/AUTHORED-CLIP03.md`, `spec/NEUTRAL04.md` and `spec/wire.schema.json`. Only the parent project owner publishes the source; this workspace does not push it.

## Official API basis

Three supplies the scene/skin/morph structures used here; its general animation layer can later consume compatible authored clips. This slice uses its own bounded event/segment and authored-quaternion sampler and does not pretend AnimationMixer supplies contact physics.

- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html): object-local playback time, update and action/cache lifecycle.
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html): weights, time scale and crossfades; these do not validate artistic face-path compatibility.
- [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html): skeleton-aware cloning; shared geometry/materials need explicit ownership. Retarget helpers expose bone mapping/options, not missing anatomy.
- [glTF animation specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations): transform/morph tracks and interpolation are asset-level data; interaction, equipment and contact semantics require application contracts.
