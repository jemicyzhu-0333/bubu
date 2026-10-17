# Approved satchel + scarf: actual action combination review

## Assets and runtime
This review keeps the approved appearance geometry unchanged and mounts both accessories simultaneously outside the validated actor tree.
- D2 body: 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a.
- 03 satchel: 8ba471d1218fd1f848720f32242c74b397adeaba5f9dbaa911b482cfc3aad9a6.
- 04 revised scarf: b0a797290977fe8b275d95707f0ec70aa9e1a74c1cd34b25d470b9111a84f09e.
- Shared pointer host restored from petting-continuous-r2; its drag controller is byte-identical to approved landing-smile-tail, SHA256 0413b3b1604b32fa4e969ce29a8ebc1885e36316b8f94e16fea8f60e7a91efb1.
- Complete module hashes are in evidence/source-hashes.json.

## Sampling and method
Actual shared weighted D2 actor, real pointer fixture, actual morph/skinned vertices, no replacement expression mapper:
- 9-second drag with pickup, held struggle, lateral sweep, release at 5.4s, landing and lingering smile through controller rest.
- 63-second petting-r2 with qualification, continuous hold, small strokes, sparse response, release at 60.2s and return to idle.
- 30fps numeric simulation: 2162 frames. Geometry sampled every third frame (10fps), 722 frames total. Whole sampled timeline is covered; not continuous-time collision proof.
- Face visibility uses actual nondegenerate feature vertices and three orthographic views (front and ±45°), body-depth filtering. Ear evidence is the original upper-head/tip region with initial world Y > 1.6, followed by stable vertex indices; it is not an arbitrary-camera all-ear guarantee.
- Closed-volume body/accessory and accessory/accessory tests use BVH nearest surface plus majority of three independent ray directions; penetration threshold 0.0005. Cross-accessory checks sample vertices, not exhaustive triangle/triangle intersection.
- Single-ray preliminary anomalies were cross-checked; isolated deep collar false positives disappear with independent directions. Only robust results should be used.

## Completed numeric and lifecycle checks
- Maximum scalp anchor follow error: 8.88618767673134e-16 across all 2162 frames.
- End-of-sequence resource cleanup is clean; source accessory resources remain owned by the loader.
- Separate live-petting unload test: remove satchel while scarf/actor continue, recreate it, remove scarf while satchel/actor continue, recreate scarf, hide/resume host, and reduced-motion exact rest. All passed; each private tail geometry disposed once; no shared source geometry/material/texture disposal; final actor pool active/decoded bytes/cache references zero. See evidence/active-unload-result.json.
- In sampled geometry frames, satchel minimum floor clearance .09697942 and minimum clearance above current foot .08230475; scarf .18308423 for both. See evidence/ground-result.json.

## Layering finding and visual evidence
There is genuine closed-volume overlap between the two accessories, already present at rest. Three independent ray directions give identical initial evidence: 212 strap vertices inside scarf collar (maximum depth .01992877), 71 collar vertices inside strap (.00663825), and one near the tail/strap connection each way. This is not a new claim of globally collision-free clothing.

Root/author clarified that bag-back/body contact and scarf-tail root hidden behind the back/hand are intended attachment areas. Existing separate accessory tests did not cover complete torso or cross-accessory volumes. Geometric overlap alone does not establish a visible defect.

Actual CPU-world meshes were rebuilt with the source GLB materials, embedded textures and body vertex colors for Blender diagnostic renders. These are not a browser/WebGL shader validation; the custom runtime D2 shader effect is not reproduced by these diagnostic renders.
- evidence/0000-front.png, evidence/0000-right-quarter.png show initial layering.
- evidence/seam-pickup-contact.png shows same-angle consecutive 0.0–0.9s closeups.
- evidence/seam-landing-contact.png shows 6.0–6.8s closeups including the small edge visibility change at 6.4s.
- Central front strap sampling: 104 triangle-centroid samples through all 722 geometry frames. 719 frames retain the same 14 visible samples; only 0.2, 0.3 and 6.4 seconds of drag have the outermost one hidden (13 visible). All 63s of petting retain the same 14. See evidence/central-seam-visibility.json.gz.
- The thin brown edge is visually persistent and changes smoothly in those closeups. No whole-strap popping or alternating exposed strip was observed. Recommend documenting this as stable inner-layer overlap rather than blocking solely on its volume intersections; root retains final visual decision.

## Limits
Finite 10fps geometry and vertex samples, three front-facing camera directions, two particular action traces. This does not prove arbitrary future poses, transitions, views, complete triangle collision safety, cloth simulation, native window clipping, production wardrobe/resource-manager integration, or browser/WebGL texture upload. No appearance source was edited.

## Robust full-sequence result
Complete: all 722 manifest frames reconciled (91 drag/landing, 631 petting), no missing IDs. Zero face/top-tip occlusion frames and zero non-strap limb penetration frames in the tested geometry/cameras. Stable strap/hand, bag-back/body, tail-root/body, occasional collar/body and cross-accessory intersections remain as documented. See evidence/robust-summary.json for exact maxima. The 4489-point upper-head region remains at least .52314234 world units above the accessories across these samples.

Technical recommendation: no action-follow or lifecycle blocker found for these two sampled traces. Treat stable hidden/inner-layer overlaps as documented scope, not a claim of collision-free apparel; root decides visual acceptance.
