# Bubu action props: first batch

Local isolated assets only. No production source, persistent state, action timing, unlock, window, remote branch or character geometry changed.

## Deliverables

- `models/cup.glb`: existing hollow ceramic cup at the exact tea-scene dimensions; coffee/milk reuse geometry, not a newly approved beverage choreography.
- `models/open-book.glb`: real open covers, separate ivory page blocks, spine and thin fanned leaves, from `prototypes/book-v3.png`.
- `models/paper-board.glb` and `models/pencil.glb`: independently reusable writing kit, from `prototypes/paper-pen-v2.png`.
- `manifest.json`: geometry, material, dimensions, sockets, local clearance envelopes, provenance and per-stage status.
- `mount-profiles.json`: independent reading/writing static fits; never equate shared geometry with shared action grip.
- `renders/model-review.png`: real GLB renders, front/side/quarter/back.
- `renders/static-fit-review.png`: original body/feet/face plus original rigid hands and actual props, four angles.

The generated character studies guide relationships only. Extra-paw versions were rejected and repaired. Generated PNGs are not mapped onto 3D planes and do not replace the approved character.

## Reproduction

This folder reuses the recovered Three 0.186 dependency through its local node_modules symlink. Blender is the installed CPU renderer. No external paid conversion service or credentials.

1. `node src/inventory.mjs`
2. `node src/export-models.mjs`
3. `node src/contact-probe.mjs` (restricted existing tea-carrier comparison, not the final independent fit)
4. `node src/build-static-fit.mjs`
5. `python src/prepare-static-render.py`
6. `blender -b --python src/audit-static-fit.py`
7. `node --test src/test-*.mjs`
8. `python src/test_frame_visibility.py`
9. `blender -b --python src/render-models.py`
10. `blender -b --python src/render-static-fit.py -- --input reports/static-render-input.json --out renders/static-0 --angle 0 --span 3.1 --size 512 --samples 24` (repeat 45,90,180)

`src/rigid-hand-fit.mjs` preserves original hand vertices and lengths. It aligns a real source grip vertex, preserves the seed palm orientation, then pivots about the unchanged contact. A valid point match alone is insufficient: inspect real hand-surface distance, grip penetration, shoulder-cap burial, face/body collision and all four views. No extra or stretched hands.

`src/prop-mount.mjs` owns props only. Action props dispose on drag/longpress/cancel/switch/reduced-motion; static preview props use explicit static mode. No clock or new action scheduler.

## Evidence boundaries

46 Node tests cover actual GLB loading, finite geometry/materials, sockets, rigid transforms, failure rejection, separate-instance disposal, input-interruption cleanup and actual fitted mesh constraints. One Python test covers A → B → empty frame visibility without deleting borrowed/shared resources. Existing tea tests: 9 passed. Existing actual DOM host drag and longpress baseline: 271/1891 frames; all actor/cache resources released. That baseline is not a new-prop full animation replay or native GPU/OS acceptance.

Actual fitted hand-neighborhood minimum distances are measured against prop triangles, separately from the exact alignment socket. For hand contact, a tiny local overlap is intentional: book <0.004 design units, board support <0.025, pencil grip bounded by its 0.0311 scaled shaft radius (threshold 0.032). Contact surface tolerance 0.003 design units corresponds to approximately 0.125 CSS px at 99px body width. Outside gripping regions, prop/body and prop/face triangle boundary intersections must be zero.

Clearance envelopes are prop-local reservations with 0.035 margin. The final complete accessory set must still be transformed and tested against them; this batch does not claim all wardrobe combinations passed. Back views legitimately hide front-held objects behind the unchanged body.

## Inventory

`reports/inventory.json` links all 44 original actions, 12 activity-story sequences and Halloween. The 39 semantic prop field values are not an object count. Geometry-family inventory currently has 39 families after explicit splitting/merging, coincidentally the same number. `workout` is pushup/headband, so no invented dumbbell. Writing is paper/pencil, not a new notebook action. Headband, sleep cap and gloves belong to the wearable workstream; feedback and anatomy are excluded. Magic hat remains a stage/hand prop. Other context mirror assets are parent-owned.

## Known limitations

- First-batch files only; other inventory families are delegated separately.
- No new complete action choreography or production integration.
- Static fits use original source geometry and CPU renders. Native Windows/macOS/WebGL tests remain separate.
- Existing hidden-original interaction proxy still supplies the old host's hit/ground behavior.
- Model-level contact checks do not prove every future hand motion or accessory combination.
- Leaf/cover shapes are modeled interpretations of the generated design, not a claim of automatic image-to-mesh reconstruction.

## High-sample paper contact recheck

192-sample, 1024px front/45° renders confirmed the remaining jagged line was a geometric boundary seam, not sampling noise. The complete paper/pencil kit moved inward by 0.05 design units and the unchanged original hands were rigidly refitted. The seam disappeared in both views. See `renders/paper-high-sample-comparison.png` and `reports/paper-high-sample-review.json`. Exact closure plus old boundary-ring diagnostics are in `reports/hand-cap-audit.json`: left outside points 53 → 0; the right ring retains 19 nearest-normal-positive points (max 0.01351), so this is not a claim of full right-ring burial. Four-angle visual review remains the acceptance evidence. No book geometry was changed.
