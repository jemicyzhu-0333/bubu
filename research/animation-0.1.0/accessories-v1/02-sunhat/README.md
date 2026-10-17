# 02 · milestone.sunhat · 小草帽

Reference-driven independent accessory candidate. Follows 01-sprout in the original V1 Dango wardrobe order. Does not change the body, face library, wardrobe unlock rules, saved selection or UI.

## Source and design
V1 source: ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a, src/content/appearance.mjs:76. ID milestone.sunhat, level 5, exclusiveGroup headwear, priority 50. Warm wheat dome, broad brim, plain brown ribbon and small flat rear ribbon join follow the inspected V1 front/quarter/back raster assets. Generated worn-plus-isolated design reference is preserved in references/ with exact prompt. The parent visually accepted the reference direction on 2026-10-17.

The generated character is NOT used as the production body. Every worn render imports the unchanged approved D2 GLB, SHA256 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a. The original two pink head points remain inside the real hollow crown. No head flattening, hidden head mesh, cut-out body or face modification.

## Construction and fit
- Four separately closed components: hollow double-shell crown, thin curved annular brim, brown band, small rear band join. Crown base z=1.43, outer XY radii .785/.615, height .62, shell thickness .026 (Blender Z-up).
- 256×256 embedded woven-color PNG, generated deterministically by the source script. No per-strand geometry and no procedural shader lost at GLTF export. Texture is packed into the GLB; woven-wheat.png is the authoring copy.
- The initial gently downturned brim obscured some raised brows in N2/N3/S3/S5. The final brim with raised inner seat, softly down-curved edges and 0.036 thickness fixes this while retaining crown fit and the face. pre-fix-all18-hat-occlusion.json records the actual failure. The corrected all18-hat-occlusion.json checks 18 states × 5 yaw views × 3 elevations (-6/0/+6 degrees), ignoring already body-hidden feature vertices and degenerate faces.
- All 8705 body vertices above the seat plane fit inside the designed inner ellipsoid; max normalized level .99275 (<1). This tests the real original top points, not just the generated reference.
- Export origin is the same local scalp anchor used by 01. The hat seat is below this root; the root itself is not an exposed physical contact point. Side fit comes from the hollow inner crown around the upper head. Depth determines occlusion.

## Integration contract
SunhatAdapter reuses the reviewed external attachment mechanism in ../01-sprout/src/sprout-adapter.mjs (relative to this directory; the source import uses ../../ from src/), with no leaf sway. Attach outside the validated actor tree, under BodyRigAdapter.offset; update after body pose using host time. The wardrobe owner enforces mutual exclusion with sprout/other headwear. This candidate does not equip itself.

The loader owns immutable shared geometry/material/texture and must retain them through the last live adapter. dispose removes only this adapter's cloned tree. No asset resource manager, cache admission, slot selector or persistence is wired here. Do not claim production integration or bounded-resource guarantees from this candidate.

## Checks and evidence
- Real shared-r5 weighted D2 ActorPool plus finite four-bone BodyRigAdapter: 241 frames, exact same actor invariants and second-actor isolation as 01, cleanup verified. Node uses a clearly labeled metadata-only texture hook because it lacks a browser image decoder. Embedded PNG presence/byte count are checked; texture decoding and appearance are verified by actual Blender GLB renders, not this Node test.
- Four worn views, isolated views including open underside, 12-view 360 sweep, eight bounded-body motion fixtures and four formerly affected expressions front/quarter. Exact final GLB is imported for these renders.
- Mesh topology audit welds coincident GLTF normal/UV seams at 1e-6 solely in the audit copy. All four components must have zero nonmanifold/boundary edges and zero degenerate faces.
- fit-audit.json, all18-face-clearance.json and all18-hat-occlusion.json describe their exact scope. Vertex ray checks are not a proof for every pixel, transition, camera or future deformation.

## Reproduce
From research/animation-0.1.0/accessories-v1/02-sunhat, with Three.js 0.186.1 installed in animation-0.1.0/node_modules and its D2 fixture restored:

blender -b -t 2 --python-exit-code 1 --python src/build_sunhat.py
blender -b -t 2 --python-exit-code 1 --python src/audit_mesh.py
node src/test-host.mjs
blender -b -t 3 --python-exit-code 1 --python src/render_sunhat.py
python src/compose_review.py

Default D2 input is ../../runtime-facepath05/fixtures/face-d2/asset.glb. BUBU_RUNTIME_ROOT overrides the runtime directory for Node. Render --body overrides the GLB and optional --look uses the original approved look scene; default light/world settings are captured in src/review-studio.json and require no external blend. All18 checks require an explicit --body and --mapper /path/to/approved/face_library.py; pass both after Blender's -- separator. The same optional --mapper on render_sunhat.py enables the four expression-regression renders. Historical absolute reference paths in PROVENANCE.json are evidence, never execution dependencies.

Published GLB is checksum-locked. Blender rebuilds may reorder triangles or alter tiny normals; byte-identical export is not promised.

## Remaining limits
Production wardrobe/UI integration, actual pointer-hand contact with the hat, host loading/failure fallback, resource admission, browser/WebGL texture upload, Electron window clipping and dynamic facial transition occlusion are unverified. Motion fixtures are bounded four-bone/body tests, not a claim that all production actions fit. Full headwear interaction behavior remains an integration task.
