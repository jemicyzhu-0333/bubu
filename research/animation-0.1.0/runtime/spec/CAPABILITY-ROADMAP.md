# Remaining foundation capabilities

This checkpoint adds historical static05/r6 neutral-only loading to bounded mechanical authored quaternion playback. Expression activation and product interaction remain gated. It does not remove the following requirements from the 0.1.0 plan. Each needs its own small contract, implementation, tests and review; order can change with user priorities.

## Can use mechanical fixtures before art approval

- Retarget/profile calibration: semantic axis and rest-frame mappings, bone-length/body-shape limits, missing-anatomy errors and explicitly reviewed fallback bindings. No automatic knees or neck.
- Authored clip extensions: expression cues, optional glTF-animation adapter, controlled masks/layers and blend policies, author-defined arcs/breakdowns. The current STEP/LINEAR quaternion library is a limited first capability, not a general animation graph.
- Interaction/contact: raw versus accepted input, final deformed grab registration, support probes with a debug full-mesh oracle, original-ground landing, continuous interruption/regrab. No old controller import.
- Equipment transactions: resolved wearing snapshots versus live changes, attachment ownership/rollback, held-prop contacts, skinned garment adaptation and collision capabilities. Depth occlusion alone is not collision.
- LOD and sleep: fixed screen-scale budgets, morph/skin/interaction-aware reductions, explicit wake reasons, deterministic resume. Existing demand scheduling is only the initial sleep mechanism.
- Real browser/GPU/native measurement: approved own-cloud WebGL route, context restoration, rendering and input latency, device/driver evidence, Electron/native verification. Simulated events and CPU timing remain separate evidence.

## Require reviewed art/profile or user gates

- Extend the neutral-only diagnostic into an explicit, newly reviewed expression/motion adapter for the complete approved library. Include all eye/highlight/mouth/brow meshes and neutral semantics, each single-face intensity path, unsupported cross-face blends and updated semantic labels.
- Gaze and brow channels: actual bounded geometry and attachment contracts. Historical highlights do not constitute implemented pupil/gaze motion.
- Character-specific retarget fits, footwear/support, clothing/held-prop contact and visual motion read tests at the approved fixed display scale.
- Final two-step long-press/drag behavior, expressive response, graceful release and interruptions. Complete basic expressions must be approved and archived first.

Historical art approval does not imply current library completion or runtime activation. Expression05 revision and new reference/model candidates remain subject to their own review. The 0.1.0 package version is a development checkpoint, not a complete product release.

Current sequencing: pause new runtime features after neutral04. Prepare the contract and actual own-cloud GPU test prerequisites in ART-TRANSITION-NEXT-GATE.md; wait for the complete library before implementing its activation.
