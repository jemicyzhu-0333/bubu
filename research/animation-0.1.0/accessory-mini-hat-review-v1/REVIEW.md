# Redesigned exposed-ear miniature hat: independent technical review

This review concerns only frozen GLB 06516ab90d747416c1749469b76aa24bff8e5ecea529f4e47134726112fa5227 and package SHA256SUMS e544e6b397e43c6d4c956c6474d243998ea0f2986f75081f43eb22a315ce015f. The old large hat and its ellipsoid fit result are rejected design history and not evidence for this candidate. Concept approval and final actual-model visual acceptance are separate.

## Portable restore and actual geometry
- Original package checksum entries all verified before running tests. Approved D2 fixture hash remains 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a.
- Standard repository relative default Node host: 241 real weighted D2 frames plus 361 dual-adapter lifecycle samples pass, max contact error 6.71891344611886e-16. Geometry/material/texture remain shared, transforms private, source resources not disposed.
- Default Blender renderer, without --body/--look, regenerated 31 images and exited 0.
- Default source builder was run in a separate repository-relative smoke copy using the default D2 fixture. It exited 0 and reproduced the exact frozen GLB bytes in this Blender 4.3.2 environment. This is an observed successful rebuild, not a universal cross-version deterministic-export promise.
- Four component topology: zero nonmanifold/boundary edges and degenerate faces after audit-only coincident-seam welding.
- Additional self-intersection check finds zero nonadjacent BVH triangle-overlap candidates per component after seam welding. It does not classify intentional separate-component construction overlaps.
- Re-ran actual head/hat fit in both directions with .002 tolerance: zero hat vertices inside skin beyond tolerance and zero tested head vertices inside closed hat material; closest surface distance .002951432019472122. The inner brim/lower crown contour is custom fit to the unchanged scalp, not a flattened head or an old full-head enclosure.
- Embedded PNG actually extracted and decoded: 14739 bytes, 256×256, nonempty varied color data, no external image URI. Node texture hook remains metadata-only; Blender renders decode the texture.
- Re-ran 270 endpoint-face/yaw/elevation ray cases, including mouth/tongue: zero accessory occlusion of body-visible face feature vertices. Actual geometry-derived minimum vertical face clearance .23477637767791748.

## Ear visibility is explicitly scoped
The author diagnostic was independently rerun over 8 yaws × 3 elevations, separating ear surface, sampled silhouette crest and z>1.76 tip region. At level camera, front, ±45° front-quarter, ±135° rear-quarter and back preserve every body-visible tip-region vertex.

This does not mean all ear surfaces are unobstructed at all viewpoints:
- Strict side ±90°, level: 12 / 9 far-ear tip vertices occluded.
- Strict side ±90°, +6° elevation: 158 / 158 far-ear tip vertices occluded (330 body-visible tip vertices in each view).
- Rear quarter ±135°, -6° elevation: 24 / 18 far-ear tip vertices occluded.
- Additional independent near/far classification: all of those occluded tip vertices belong to the far ear; near-ear tip occlusion is zero in all 24 cases.
- Full inner-ear surface and small silhouette segments have their own nonzero counts in the retained report. They are not silently replaced by the tip-only pass condition.

## Actual action combination
Uses the same approved shared pointer runtime as the satchel/scarf combination review, including the byte-identical landing lingering-smile controller and petting-r2. Actual D2 morph/skinned vertices are exported, not remapped Blender expressions.
- 9s drag/landing and 63s petting trace, 30fps numeric simulation, 10fps geometry samples.
- Complete and reconciled: 2162 numeric frames, 722 geometric frames (91 drag/landing and 631 petting). Max attachment follow error 8.88618767673134e-16. Source accessory resources not disposed; actor pools cleaned after both sequences.
- Three front-facing view samples: zero face-feature or tip-region occlusion frames; zero body-vertex penetration into hat material. Full inner-ear surface is not entirely visible: up to 177 ear vertices occluded in one sampled view; this is separate from tip exposure.
- Rigid-fit verification over all 722 frames: 9376 upper-head points and 11445 hat points retain the same relative rigid transform; maximum residuals 1.4983e-7 and 1.9873e-7 respectively, preserving the static head/hat fit within sampled geometry precision.
- Technical candidate-backup recommendation: no blocker found within these tests. Final actual-model visual acceptance remains separate.

## Limits and interpretation
Finite sampled poses and vertex rays are not every-pixel, arbitrary-camera, continuous-time, all-headwear-combination or production-integration proof. Dynamic checks cover three front-facing views. Strict side/elevated far-ear occlusion remains a documented physical depth effect. Diagnostic Blender shading is not a browser/WebGL/D2-custom-shader validation. No frozen asset or adapter was edited.
