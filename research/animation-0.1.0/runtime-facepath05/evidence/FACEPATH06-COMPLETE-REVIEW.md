# Facepath06 five-scenario offline review and foundation handoff

## Exact implementation

Code checkpoint:0129612af4256007a6e4099e6227c1a8c5d31fc1; first focused evidence checkpoint:5c07f69b637ae9618f4dd627532537f0e163c3af. Current src/face-timeline.mjs SHA256:286ded8d6c6992cd0333e1985a0baee0e21dd951dcf3ab91b8bb790cd7641892. No runtime changes followed that technical commit. Approved seven-slot GLB:a9ae09635658ac15c55cf1571db53e284bd463eaab9a84ff24e7836270a1808e. Full asset/scene/replay/media fingerprints are in facepath-complete-audit.json.

## Executed scope

- Full package tests rerun after completion:167 passed,0 failed,0 skipped (tests-complete-visual.log).
- Independent reversal review:10 groups, including6000 interrupts, frame-rate equivalence, near-endpoint values, real8-layer binding and cancellation (review/SAME-FACE-REVERSAL-REVIEW.md).
- All five actual-controller exports:623 regular30Hz frames and74 selected exact diagnostic instants, each in4 views.919 PNG records were hash-verified. Original diagnostic exports retain additional near-event samples that are not all rendered.
- Every regular frame was inspected in23 fixed99px contact-sheet pages. All74 four-view diagnostic rows were inspected in17 sheets. This is still-frame inspection, not real-time playback observation.
- Each scenario has a normal-speed MP4. Combined movie has623 frames at30fps,20.766667s. Inclusive endpoints add one frame per scenario; no interpolated frames, retiming or artificial transitions are introduced. Concatenation cuts between separate scenarios are intentional.
- Static body/rig fingerprints held in all renders. All exact-zero states produce one identical Basis raster per view. Maximum Blender float weight error is2.9750239605164097e-08.
- Final cache pass validated919 existing records with0 new renders, after the real rendering runs. Cache reuse is content-addressed by look/settings/weights/view/resolution, not inferred from a filename.

## Findings by scenario

1. return_current (76 frames/9 diagnostic instants): the05 unnecessary round-eye/small-O detour was removed by safe same-semantic reversal. Before-return samples and final Basis match05 pixels. Current scalar velocity is retained, braking is bounded, cross-face mixing remains prohibited.
2. semantic_chain (145/13):04→N3→A7. No isolated wrong-face flash was found in frame inspection. N3 tongue retreats before the remaining brow clears; at3.18s exact Basis, all4 views show no residual brow/tongue before A7 enters.
3. eye_change (97/8):07→S5→Basis. No double eyes or brows left behind. Happy-to-sad path visibly visits neutral; this is the current cross-semantic route.
4. interruption (130/27): rapid replacement, same-face return, incoming-face cancellation, N3 amount reduction and N2 replacement. No overlapping semantic face or stuck layer was observed. Superseded intentions may never reach a full expression; that is latest-intent behavior, not evidence every requested face was displayed.
5. basis_brow_tongue (175/17):R0↔Basis, N2→N3→R0→Basis. Brow/tongue layers visually clear at exact boundaries across all4 views. R0's short horizontal mouth is a distinct semantic, never relabeled as original small-O Basis.

## Remaining visual boundary

Cross-semantic transitions still visibly pass through the small-O/round-eye neutral zone for several frames. No one-frame corrupted face was found, but the pacing may read as a short neutral beat. Do not describe it as zero dwell or final naturalness approval. Native-speed movies are generated and ffprobe-verified; this agent's tools did not play them in real time. Scalar C1 is tested; approved piecewise-linear geometry provides C0, not geometric velocity C1.

## Foundation-review scope and bottlenecks

This work is seven-slot face-only controller verification. It does not complete the full18-slot runtime, weighted idle scheduling, drag, long-press, gaze, skeletal expression acting or contact physics. The18 static faces are separately approved; their approval does not establish full-library residency or runtime performance. Pointer interaction is not enabled in this adapter.

No real browser/WebGL/GPU execution was performed; the prior browser permission denial was respected. Blender render time is not runtime frame time and is unsuitable for performance comparison. Numerical frame-rate equivalence does not measure interactive latency, GPU upload stalls or battery use.

Prior CPU evidence in the independent checkpoint05 review measured actual prepare/parse/clone paths; its stated cold preparation/parsing costs are historical, not rebenchmarked here. Potential priorities for the independent foundation review are cold source validation and GLB parsing, complete56-target-per-layer residency, total18-slot bank cost, actual backing-memory/GPU accounting, demand-loop scheduling/context recovery and sustained interruption behavior. Compare alternative open-source architectures against these exact requirements before selecting or claiming a faster design. Do not infer a performance win from this policy fix.

## Reproduce

npm test
node tools/export-facepath-replays.mjs
blender -b -t8 --python tools/render-facepath-replay.py -- --render --main-resolution source
python3 tools/make-facepath-media.py
python3 tools/make-facepath-frame-audit.py semantic_chain eye_change basis_brow_tongue interruption return_current
python3 tools/verify-facepath-render-evidence.py

Use the pinned approved authoring scene and asset from the sibling approved library, with their required hashes. The local final media folder retains the legacy combined filename facepath05-native99-normal-speed.mp4; facepath06-native99-normal-speed.mp4 is an identical-byte delivery alias. Both contain the06 controller exports. Videos and raw/cache frames are excluded from the Git evidence delta.
