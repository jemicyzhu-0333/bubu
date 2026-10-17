# 04 · milestone.scarf · 彩虹围巾

Reference-first V1 accessory. The original palette is lavender edges and a pale mint center stripe. The continuous low U-shaped collar passes below the mouth, rises above the hands, returns behind the body and meets a short tail on the viewer-right rear side. Generated character pixels are reference only; every actual render imports the unchanged approved D2 body.

## Geometry and bounded motion
Closed soft variable-width collar and closed thin curved tail; material stripes use faces rather than additional floating strips. Collar follows the approved torso profile. Collar half-width varies smoothly from .13 in front to .055 above hands; front center .32, side center .93. Rounded transverse profile replaces the earlier narrow hard band. Tail root is .88 high, bottom .32; rest thickness .036 and width .26. Two embedded 128px deterministic woven-color textures provide subtle fiber variation without strand geometry. The two-material tail is duplicated privately by each ScarfAdapter while collar geometry and materials remain shared. Host time drives a 2.8-second quadratic shear, maximum x .025 and depth .018, root pinned. Analytic normal transform preserves material seams. No new clock, physics solver, skeleton or body write is introduced.

ScarfAdapter imports ../01-sprout/src/sprout-adapter.mjs (relative to this item directory). Instantiate with actorRoot, external parent BodyRigAdapter.offset, and loaded asset.scene; update after body pose. Do not attach under the validated actor subtree. Loader must retain shared resources until the last adapter is disposed. Adapter disposes only its private tail geometries. Reduced motion and disabled motion restore exact rest positions and normals. Wardrobe owner handles neckwear exclusivity; resource-manager/UI wiring is not included.

## Validation
- All18 endpoint face states, eyes/brows/highlights/mouth/tongue, five yaws and three elevations: 270 face/view cases, each tests rest plus four tail-envelope corners (1350 placements). Body-hidden and degenerate feature vertices excluded.
- Real weighted D2 ActorPool and four-bone BodyRigAdapter, 241 frames, anchor/invariants/ground/cleanup.
- 361 tail phases, displacement bounds, private geometry, immutable source, second-actor isolation, exact reduced-motion reset, private-only disposal.
- 51 actual Three.js shoulder/hip poses across xyz at .20/.14 caps, multiplied by five tail positions. Closed-volume ray parity tests every limb-weighted vertex against BOTH collar and tail, including shoulder/hand region. This is discrete coverage, not a continuous collision proof.
- Closed-manifold and zero-degenerate geometry audit. Actual GLB four-view, 360, sixteen bounded motion frames from both ±45 views (tail-visible +45 sheet), and expressive face renders.

## Reproduce
From research/animation-0.1.0/accessories-v1/04-scarf, restore neighboring 01-sprout and 03-satchel sources, the shared D2 runtime fixture, and Three.js 0.186.1 in animation-0.1.0/node_modules. Build reuses the approved radius/material helpers in 03-satchel.

blender -b -t 2 --python-exit-code 1 --python src/build_scarf.py
blender -b -t 2 --python-exit-code 1 --python src/audit_mesh.py
node src/test-host.mjs
blender -b -t 2 --python-exit-code 1 --python src/render_scarf.py
python src/compose_review.py

Default render body: ../../runtime-facepath05/fixtures/face-d2/asset.glb. BUBU_RUNTIME_ROOT overrides the Node runtime root; render --body/--look override optional inputs. The captured default studio is portable. To reproduce the all18 audit, run Blender --python src/audit_occlusion.py -- --body <approved-D2.glb> --mapper <approved-face_library.py>. The mapper is an explicit upstream expression-library dependency; optional render --mapper enables expression sheets.

For limb audit, run EXPORT_LIMB_POINTS=/absolute/temp.json node src/test-host.mjs, then Blender --python-exit-code 1 --python src/audit_limb_clearance.py -- --points /absolute/temp.json. Large generated point data is excluded from version control. Published GLB is checksum-locked; Blender re-export need not be byte identical.

## Limits
No production wardrobe integration, WebGL/native window or pointer interaction validation. Body pose caps and face endpoints only; future poses and in-between facial transitions require renewed checks. Tail deformation is a bounded visual adapter, not physical cloth. Ray parity checks limb vertices, not full continuous triangle-triangle collision. Body itself legitimately occludes back cloth.

## Visual acceptance
The first technical candidate was not visually accepted. This revised narrow-side/broad-front candidate was reviewed by root for continued validation; the user subsequently approved the actual appearance on 2026-10-17 (see acceptance record below). Prior low-side experiments were rejected as waist-belt-like and are not published geometry. Node uses a clearly labeled metadata-only texture hook; real texture decoding is exercised by actual GLB Blender renders.

Frozen candidate measurements: 255 limb/envelope combinations; minimum cloth/limb surface separation 0.007248003967106342; minimum animated ground clearance 0.16947828828862385. All18 audit has 270 reports × five tail-envelope positions.

## Acceptance record · 2026-10-17
The user approved the actual satchel and lavender/mint scarf appearance with “可以”, message Sentinel_399ea445ad4481919406fb8778c51017, replying to the actual-model presentation Sentinel_ff70efb30d3c8191919ab34e3d923f54. Appearance is now user-approved and frozen. This documentation update does not change the GLB, material, geometry or adapter.

A separate independent combined-runtime audit exercised both accessories with actual drag/landing, settling smile and petting-r2 timing: 2162 numeric frames and 722 geometry frames. Within three frontal view angles, it found zero additional face/head-tip occlusion and zero non-strap limb penetration; following, mid-sequence unload/rebuild and shared-resource lifetime checks passed. This is bounded tested coverage, not global pose/camera/interaction acceptance.

Known stable inner-layer overlap remains: strap into collar up to .019929 model units; collar/body overlap in 30 sampled frames up to .009079. Same-angle close-ups and central-strap visibility checks did not show obvious popping or flicker in the tested sequences. Contact/inner-layer embedding is not a guarantee of disjoint closed volumes. Production UI, arbitrary future combinations and untested poses remain outside this result.

Combined audit evidence: [independent review](../../accessory-action-review-v1/REVIEW.md), [exact statistics](../../accessory-action-review-v1/evidence/robust-summary.json), and [frozen input hashes](../../accessory-action-review-v1/evidence/source-hashes.json).
