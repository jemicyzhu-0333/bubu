# 01 · milestone.sprout · 小芽

Reference-first independent 3D wardrobe candidate. V1 catalog order is retained in ../MIGRATION-ORDER.json. The next item is milestone.sunhat. Temporary action props are excluded.

## Contract
- Source V1: ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a, src/content/appearance.mjs:67. Persistent wardrobe ID milestone.sprout, level 3, headwear group, priority 20, sprout-sway. This package does not change unlock rules, save data or the wardrobe selector.
- Approved body: D2 full18 GLB SHA256 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a. Unchanged source loaded for every actual-body render. Generated worn images are design references, never body replacements.
- Inspected references: approved D2 front/quarter/side, approved model back silhouette, and existing V1 sprout-front-outer-piece.png. Exact prompt in references/prompt.txt; untouched generation in references/generated-worn-and-turnaround.png. Built-in image generation, no seed/model version supplied.
- Parent reviewed the generated reference as usable on 2026-10-17. Generated image has a wider rounded leaf design; current modeled candidate uses gently tapered curved leaves, not ellipsoids or flat planes.

## Geometry and fit
sprout.glb is accessory only, under 400KB. Source build_sprout.py creates closed curved blades, softened root cap, short stem and subtle central veins. Blades are 0.036 units thick at the center and taper at edges; cupping max 0.065 units. Opposed ±28° yaw prevents the pair behaving like one paper plane. Left/right rise differs slightly (.28/.32) for readable side overlap. No base, hat band or scalp deformation.

Blender Z-up root is (0,0,1.62766); Three.js Y-up equivalent (0,1.62766,0). Actual nearest body surface point is used at runtime. Root begins 0.04 units beneath contact plus a rounded cap: intentional hidden insertion. Leaves/stem above surface; face, hands and feet stay exposed. Back/side occlusion comes from depth, not permanent cutouts.

## Minimal integration
Load sprout.glb once. Construct SproutAdapter({actorRoot, parent: bodyAdapter.offset, asset: gltf.scene}) AFTER the admitted actor and body adapter. The parent must stay outside the validated actor subtree. Call update(hostSeconds, {reducedMotion, enabled}) after body pose, before render. No clock/timers. No body/face/material writes. Remove with dispose before disposing the actor. Asset resource lifetime remains with the loader; clones share immutable geometry/materials. Do not dispose shared GLB resources while other adapters use them.

The existing wardrobe selector remains responsible for headwear mutual exclusion, unlock/skin selection and user intent. This module does not autonomously equip it. Sway is bounded at ±0.06 radians, 3.2 seconds; reduced motion zeros sway. Root contact remains anchored as the body rotates, lands or moves.

## Verification
- src/test-sprout.mjs: 361 samples over 12-radian rotation, exact source hash and body geometry/material nonmutation, contact error below 1e-6, reduced-motion, enable/disable, invalid time and idempotent disposal.
- src/test-host.mjs: actual shared-r5 weighted D2 ActorPool + BodyRigAdapter; 241 frames within four-bone and body limits. a.assertCurrent and second actor invariants at every frame; clean cache release. No shared API modified.
- render_sprout.py imports the actual final GLB and unchanged D2 source. Four worn views, four isolated views, 12-angle full turn and eight bounded motion fixture frames. Fixed approved look/lighting, 384px RGBA. Blender CPU evidence, not a WebGL/Electron claim.

## Remaining limits
Not wired into the production wardrobe/UI. Actual pointer hand touching a worn sprout, drag proxy hit testing, cold loading/fallback under host resource admission and Electron window clipping are unverified. The bounded body fixture and host invariant tests do not establish those. Do not label this production-integrated. Full18 face geometry remains untouched; this package does not rerun all 18 facial visual endpoints because the accessory stays above the head and outside facial mesh ownership.

## Reproduce from repository layout
Requires Blender 4.3.2, Python/Pillow, Node and Three.js 0.186.1 installed in research/animation-0.1.0/node_modules. First restore the existing shared runtime D2 fixture by its documented restore flow. Run from research/animation-0.1.0/accessories-v1/01-sprout:

blender -b -t 2 --python src/build_sprout.py
blender -b -t 3 --python src/render_sprout.py
blender -b -t 2 --python src/audit_mesh.py
python src/compose_review.py
node src/test-sprout.mjs
node src/test-host.mjs

Default body input is ../../runtime-facepath05/fixtures/face-d2/asset.glb; test-host resolves ../../ as the animation-0.1.0 runtime root. Alternate restores use BUBU_RUNTIME_ROOT=/absolute/animation-0.1.0 and BUBU_BODY_GLB=/absolute/asset.glb. Renderer accepts --body /absolute/asset.glb and optional --look /absolute/approved-look.blend after Blender's -- separator. Without --look it reconstructs the captured approved light/world configuration from src/review-studio.json; no unpublished look blend is required. The reference paths in PROVENANCE.json are historical source evidence, not execution dependencies.

The host must keep accessory geometry/materials alive until its last adapter has been disposed. This candidate has no resource-manager admission or budget wiring and makes no bounded-cache/lease-count promise.

The published GLB is checksum-locked. Rebuilding with Blender may change export triangle ordering or tiny normal values even when positions are identical; the build is not promised to reproduce identical bytes.
