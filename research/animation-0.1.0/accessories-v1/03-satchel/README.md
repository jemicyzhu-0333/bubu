# 03 · milestone.satchel · 小挎包

Reference-first independent wardrobe candidate, following V1 Dango catalog order. Runtime source body and full18/D2 face remain unchanged. No wardrobe selector, unlock, persistence or UI is modified.

## Reference and design
V1 source: ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a, src/content/appearance.mjs:85. ID milestone.satchel, level 8, exclusiveGroup sidebag, priority 40. V1 raster placement evidence confirms viewer-left hip pouch, diagonal low front strap, continuous return behind body. This is a low waist sling, not a strap across the face or over the head.

The generated worn/isolated four-view concept and exact prompt are in references/. All actual worn renders load the unchanged D2 GLB (SHA256 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a). Generated character pixels never replace the body.

## Geometry and binding
Four closed components: continuous low diagonal ribbon, rounded pouch, thin rounded-outline flap, square brass catch. Pouch center in Blender coordinates (-.91,-.35,.32), width .58, depth .28, height .42; faces outward 35° toward character-right/front. Bottom remains above the feet. The folded flap silhouette is built independently from thickness to avoid the square thin-cube bevel problem.

Strap follows the approved measured torso radius profile, including its superellipse cross section, with a small clearance. Height varies .48+.15 cos(theta)+.07 sin(theta), with ±.039 ribbon half-width. Its front passes below the most demanding mouth, while the back return stays continuous. The body/near hand legitimately occludes parts of the strap; no hand-shaped permanent holes are cut. Pouch is sewn to the returning belt, with no floating connector tabs.

SatchelAdapter uses the external read-only attachment mechanism from ../01-sprout/src/sprout-adapter.mjs, with sway disabled. Attach outside the validated actor subtree under BodyRigAdapter.offset; call update(hostTime) after body pose. The source loader owns shared immutable geometry/materials until the last adapter is disposed. Wardrobe owner is responsible for sidebag mutual exclusion. This candidate is not connected to a production resource manager or clothing selector.

## Actual validation
- 270 vertex-ray cases: all18 face endpoints including mouth and tongue × five yaw angles × -6/0/+6° elevation. Zero accessory occlusion for feature vertices that are not already body-hidden. Degenerate invisible feature faces are excluded.
- Real shared-r5 weighted D2 ActorPool + finite four-bone BodyRigAdapter: 241 frames; actor invariants, second-actor isolation, transform anchor and cleanup. Also measures the lowest accessory vertex against the actual deformed body's foot ground at every frame.
- Extra actual Three.js limb deformation: 51 samples across x/y/z at shoulder .20 and hip .14 caps, >.5 limb-weighted source vertices. Blender convex nearest-surface check against pouch/flap/catch finds no limb penetration; minimum clearance is recorded in limb-clearance-audit.json. Strap is explicitly excluded from this volume check because it routes behind limbs; this is not an assertion of global cloth collision correctness.
- Four worn views, isolated views, 12-view 360 rotation, eight bounded motion fixtures and N2/N3/S3/S5 expression front/quarter renders. These import the actual final GLB.
- Mesh audit welds only coincident GLTF normal seams in an audit copy; all four meshes have zero boundary/nonmanifold edges and zero degenerate faces.

## Reproduce
From research/animation-0.1.0/accessories-v1/03-satchel, after restoring the shared runtime D2 fixture and installing Three.js 0.186.1 in animation-0.1.0/node_modules:

blender -b -t 2 --python-exit-code 1 --python src/build_satchel.py
blender -b -t 2 --python-exit-code 1 --python src/audit_mesh.py
node src/test-host.mjs
blender -b -t 3 --python-exit-code 1 --python src/render_satchel.py
python src/compose_review.py

Default body is ../../runtime-facepath05/fixtures/face-d2/asset.glb. BUBU_RUNTIME_ROOT overrides the runtime location. Optional render --body and --look override body/studio; the default captured studio is portable. All18 audit requires explicit --body and --mapper /path/to/approved/face_library.py after Blender's -- separator. Optional --mapper on render enables expression-regression images.

For actual limb clearance, set EXPORT_LIMB_POINTS=/absolute/temporary-points.json when running test-host.mjs, then run Blender --python-exit-code 1 --python src/audit_limb_clearance.py -- --points /absolute/temporary-points.json. The ~49MB intermediate is deliberately excluded from source control; the small audit summary and reproducer are retained.

The published GLB is checksum-locked. Blender exports are not guaranteed byte-identical across rebuilds.

## Limits
Production wardrobe/UI and resource-admission wiring, pointer-hand interactions, arbitrary future body poses, dynamic facial transition occlusion, WebGL/native window presentation, and complete cloth collision remain unverified. The low strap is rigid within this bounded approved actor; it is not a cloth simulation. No physics engine or new body skeleton is introduced.
