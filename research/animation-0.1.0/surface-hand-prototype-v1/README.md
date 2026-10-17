# Surface-hand prototype v1: unadmitted geometry research

User accepted rounded gliding-hand concept, with no-intersection requirement. This checkpoint is NOT a completed action, accepted hand shape, or host-admitted asset.

The original admitted D2 geometry, face paths, rig, drag and petting remain untouched. Tools evaluate a derivative in offline arrays with exact zero-deformation rest. They retain mesh topology; flatten the original side-fin patch through a frozen harmonic carrier map; then add a traveling rounded bump. No second owner, clock or runtime writer is created.

Current positive evidence: both local patches are disks (Euler1, one degree2 boundary loop); carrier-only actual renders are smooth at the old hand location; feet/outside-height samples unchanged; rest exact; sampled t→0 displacement tends to zero. Ten sampled poses have zero nonadjacent-triangle BVH overlaps after excluding shared vertices.

Limits: shared-vertex/neighbor folds were excluded by that test; faces and cup are not collision-tested; no continuous-motion guarantee. Terminal edge ratio maximum2.902 is NOT the overall sampled maximum: entry t=.18 reaches5.592. Minimum sampled area ratio .008095 remains a quality risk. Moving hands are still too conical/cheek-like and not accepted art. No cup is attached to hide shape defects.

Reproduce with baseline dependencies: run tools/export-base.mjs from the restored tree (Node/Three); run tools/audit.py and tools/render-samples.py (Python NumPy/SciPy); Blender tools/render.py using tools/samples.json; tools/bvh-probe.py in Blender reads locally generated audit-*.npy. Large frame JSON/npy/render directories stay local and excluded. QA image/evidence here records the checkpoint, not product acceptance.
