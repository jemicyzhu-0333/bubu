# Drag readability revision 2: bounded comparison

This is a visual experiment, not integrated production motion. Frozen functional v1 is unchanged. Four comparable cells use identical full18 source, fixed face01, lighting, viewport and world pixel scale. Root stays at (0,.35,0); whole-body pivot is zero in every frame. Only the four approved limb quaternion channels move.

Reference: the historical r4 readable A/B poses in ../bubu-3d-a-drag-readable-20261016/pivot-probe02/v3-keyposes.json. Their static multi-view gate passed historically, but no final user approval of continuous acting is claimed. Reference images were inspected before this implementation.

Current full18 and r4 body data are byte-identical for POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0, indices and inverse bind matrices (evidence/body-bind-parity.json). No new rig, weights, bone rest transform, geometry, material or static face has been authored. The same .20 shoulder/.14 hip capability applies.

The new test uses r4 A/B nearly at that envelope, alternating limbs with .32-second extreme holds (the A hold is split into .16 seconds at each loop boundary) and .48-second smooth transitions over a 1.6-second cycle. The old comparison uses its existing weaker hover extrema with its 1.32-second smooth sinusoidal phase. Both views are rendered at 10 and52 degrees; the same 276px viewport/span5 world scale is preserved, so pose and orientation naturally change projected width. There is no per-pose zoom or whole-character sway to exaggerate limb motion.

At 276px/span5:
- Near-front hand centroid travel A↔B: old~1px, new3.7–3.8px; feet new1.9px.
- Quarter hand travel: old~1px, new3.9–4px; feet new3px, with far-limb occlusion.

Candidate40-frame sweep: finite geometry, minimum area ratio0.69266 and maximum edge stretch1.37324. Eleven sampled nonadjacent limb-root intersection screens found0 crossings. These are screens, not a proof of all-time collision freedom. The native-size still and short actual replay require visual selection.

Source geometry is actual Three CPU skin/morph output and is rendered offline in Blender. No browser/GPU/native-pointer certification. All videos and raw mesh buffers remain private local artifacts and must not be uploaded to Git. This revision does not touch mouth/blush design work.
