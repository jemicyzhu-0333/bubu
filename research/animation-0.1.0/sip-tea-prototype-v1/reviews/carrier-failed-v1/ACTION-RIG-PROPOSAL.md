# Bare sip-tea: isolated capability gate

## Decision requested
Authorize an isolated action-rig experiment with continuous short-arm root deformation, before any runtime admission or full scene implementation. Do not change the approved drag profile, existing asset hashes, rest mesh, rest face, or existing pointer host.

## Why not just wider rotation or elbow/wrist
Actual D2 yaw-zero measurement: right shoulder (.8,.665,-.085), mouth (0,.695,.779399); distance 1.1781705. Vertices with >.5 right shoulder skin weight have maximum shoulder radius .3899005. Arbitrary pure shoulder rotation therefore leaves at least .78827 between that set and mouth. A normal cup bridges some distance but its near lip must touch the front of the body while a handle/support point lies still farther forward. Increasing radius enough to hide this discrepancy is visually unacceptable and creates body collisions. Elbow/wrist without added rest-chain reach does not fix the reach domain. Whole-body lean transforms shoulder and mouth together and does not reduce their relative distance.

The original skin is one connected 45,945-vertex component. Detaching/repositioning a fin as an independent mesh is rejected. The generated concept successfully describes cup appearance and the intended cup-to-mouth moment, but relocates the hand attachment to the front surface and is NOT implementation evidence.

## Minimal experiment, not a new runtime contract
1. Keep a byte-identical rest geometry/indices, existing face targets and transforms as immutable source. Fork only experiment data, never overwrite the admitted asset.
2. Add two experimental shoulder-carrier transforms plus short-fin terminal orientation transforms in a derived skeleton. Carrier follows a short, explicitly authored arc around the body surface from side toward front; terminal maintains the short rounded fin silhouette. This is a deliberate action-specific articulation extension, not permission to translate the whole arm arbitrarily.
3. Use continuous normalized skin weights on a bounded shoulder-root patch, preserving the connected skin. No face/eyes/mouth/feet vertices may receive new weights. Pure rest pose must reproduce every original vertex within 1e-7 model units. Existing face-path deltas stay byte-identical.
4. First build only rest, preparation, grip and rim-contact poses. No owner, animation clock, persistent state, pointer adapter or global cap edits. Cup is independent real hollow geometry with a handle and drink surface.
5. Produce front, ±45°, side and back actual skinned geometry renders. Show root patch wireframe and per-edge stretch color overlay in addition to beauty frames.

## Pre-admission numerical gates (proposed, to calibrate in experiment)
- Rest vertex error <=1e-7; face/mouth/eyes/feet changes <=1e-7 for body-only pose.
- Connected topology unchanged, normalized nonnegative weights, no new disconnected hand meshes.
- No inverted triangles in shoulder patch; cap edge-stretch ratio initially <=1.35 and local triangle area ratio in [.65,1.5]. These thresholds are proposed guards, not claimed accepted aesthetics.
- Handle/support contact gap <=.015, cup near-rim to mouth contact gap <=.008 during sip. Cup/rim/handle must not penetrate non-contact body surface; evaluate signed surface distance plus multi-view inspection.
- Sole support remains at baseline .006 with no new knee/neck behavior. Cup never covers eyes; transient lip occlusion at the sip moment is intentional.
- Bilateral support geometry and wrist orientation are tested as real contact, not drawn-over hands.

If these gates cannot produce the target without visibly lengthening the tiny fin or distorting the torso, stop and show the failed actual-model comparison. Then ask for a different bounded articulation design; do not silently relax the approved body identity.

## Later runtime integration, only after visual approval
A separately named closed action-body profile must declare every permitted channel and bound, validate root-patch weights and asset hash, and have a single body writer arbitration boundary in the existing host. Existing drag profile remains separately admitted. The current P1 owner remains the only face owner; scene stages submit face intentions through its existing complete batch. Do not instantiate a parallel owner or clock. Cup resource lease, enter/hold/exit, interrupt and stale-release rejection belong to one focused scene adapter. This is later work, not part of the rig experiment approval.

## V1 ordering and semantic mapping
V1 catalog order is not migration feasibility order. #1 workout needs grounded prone support and additional articulation; #2 chase-butterfly needs believable locomotion; #3 hiccup includes a cup; #27 sip-tea is the first clean representative of food-ritual coffee/milk→sip-tea and reusable cup contact. Select #27 as the first representative only to establish this missing shared action capability, then return to the evidence-ordered catalog. No claim that skipped actions are migrated. V1 expression labels surprised→hungry→satisfied are source semantics, not new V2 face IDs or automatically approved timing.

## Current deliverables
- space-measurement.json: original actual D2 bones, mouth bounds and weighted hand vertices.
- cup-model.mjs: real hollow ceramic cup, handle, liquid, model-unit contact sockets and deterministic resource cleanup; 2 tests pass.
- probe frames: actual unchanged D2 with cup at low and mouth heights, front/quarter/side, explicitly ungrasped, to expose reach gap.

## Experiment 1 outcome
Rejected. Four authored static carrier amounts 0/.25/.7/1 were evaluated from the original connected skin, without mutating the admitted actor or its source. Rest vertex changes: 0; foot error: 0. At preparation the shoulder-patch max edge ratio is 3.1407; rim pose is 11.1027. Side views expose severe shoulder-root dents. Reported normal reversals against rest are diagnostics only, not an inversion proof. Self-intersection, full contact and swept-path collision gates were not reached and are not claimed passed.

Proposed second experiment patch: |x|>.72, .43<y<.98, -.38<z<.40, with frozen boundary ring and exact zero deformation outside. Before attempting any reweight, independent review is testing a necessary boundary-to-fin path-length bound against the same 1.35 per-edge limit. If the target is geometrically impossible inside this patch, stop rather than widening into the torso or relaxing the stretch limit.
