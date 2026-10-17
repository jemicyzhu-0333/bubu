# Surface-hand experiment review log

Scope: user approved surface-swimming short-hand concept and requested no penetration throughout motion. Isolated geometry experiments only; no production asset/host approval. Earlier fixed-patch transport proof is not generalized to this new representation.

## v1, 2026-10-17 15:23 UTC: reject raw radial residual mapping

Read actual `bubu-surface-hand-experiment-v1-20261017/build.py`, metrics and side image 0006. Independently recomputed extreme edges and triangle from saved pose arrays.

At t=.25, edge [1435,1436] has rest length .008196277 and stretch 19.307793. Neighboring points move from x -.948743/-.950529 to -.959176/-1.115538, a large local displacement discrepancy. Triangle 9349 [11792,12326,12327] has area ratio .000263318. Visible black root cracks agree with the numeric failure.

Original fin projection is not a single-valued radial height field: in the inspected side region, 1,820 of 11,930 triangles have inward radial normal sign versus 10,110 outward. This diagnostic is not an inversion count; it reveals the original overhang. Interpolating residuals using only height/angle can mix different material layers and collapse them onto the same carrier surface. This failure is limited to that raw projection/interpolation implementation.

Recommendation sent: construct a frozen local carrier parameterization using actual mesh adjacency and bounded tangential relaxation; preserve indices and domain boundary; verify local orientation/self-intersections before a new moving bump. No per-frame angle sorting or nearest-neighbor splice.

## v2, 15:26 UTC: improved carrier, still not geometry-approved

The author implemented adjacency-based harmonic angle/height coordinates with fixed boundary, retracted carrier with boundary transition, and a compact smooth bump. Inspected actual frames 0006, 0010, 0016 and 0018. The v1 black crack is no longer obvious and the shape migration reads clearly, but the root has dimples/dark regions and the endpoint is conical rather than the concept's rounded hand. Do not hide this behind a cup.

Independent continuity check re-evaluates the author's mathematical sampler without writing to its output files (`surface-v2/check.py`). At t=1e-6 maximum displacement is 1.29350e-11; at t=1e-4 it is 1.29302e-7. Rest zero is exact and all tested vertices below .4 or above 1.0 height remain unchanged. This supports entry continuity, not full motion collision safety.

At t=.25 the worst original-patch edge [41948,41961] is interior, not boundary: length .002609435 grows by 7.400321. Later minimum area ratio is .028107. These changes may partly reflect original irregular sampling but cannot be waved away with percentile statistics. Record absolute edge lengths, local shape, and distinguish remapping distortion from visible carrier deformation.

Author-reported additional diagnostics (not independently rerun yet): both final harmonic UV patches have a consistent triangle orientation (R 6,136 / L 6,159); 12,943 affected rebuilt triangles have positive radial normal dot. These are useful local unfolding checks, not complete self-intersection proof. Still require a simple patch boundary and intermediate-entry checks.

Next bounded work: carrier-only render and metrics; weighted-harmonic candidate to reduce short-edge distortion; then a rounded-cap bump. Do not add cup yet. Verify all intermediate entry blends, not just final carrier. The existing 1.35 guard is historical/proposed, not silently replaced by 7.4 or a 99th percentile.

## Pending gates

- Carrier-only root continuity in clay/wireframe/grazing light; one visible hand bump and smooth old-hand retraction along the route.
- Full route influence/exclusion mask; rest/source/face/feet and index parity; verify after exit/repeat cycles.
- Sampled local orientation and nonadjacent triangle collision; explicit coverage/timestep and limitation disclosure.
- Actual cup ceramic-volume collision plus physical grip/rim residuals only after the hand surface passes; currently there is no cup in these experiments.
- Continuous path clearance requires swept/adaptive bounds or an equivalent justified conservative check. Discrete sample success alone is not proof of no penetration at every instant.
- No runtime admission before geometry/art gates. Later: one existing logical clock, one exclusive body writer (including new body morphs), the existing face owner, and original drag/pet asset/profile untouched.

## v3, 15:30 UTC: smooth retracted carrier, remaining entry/shape gates

Inspected actual carrier-only side image `bubu-surface-hand-experiment-v3-20261017/rendered/0012.png`, plus endpoint front/side 0008/0009. Old-hand region is visibly smooth in the carrier-only image. Endpoint bump remains cheek/cone-like rather than the intended distinct rounded mitten. Retain carrier progress; improve the cap before introducing cup occlusion.

Independently recomputed 12 saved `audit-*.npy` geometries (results `surface-v3/independent-metrics.json`). Important distinction: endpoint max edge ratio is 2.902284, but the maximum among all tested times is 5.592359 at t=.18, rest edge .018042714 becomes .100901335. The smallest area ratio is .008095294 at t=.5 and later. Every tested below-.4/above-1 height vertex is exactly unchanged. These are accurate sampled metrics, not a claim of geometric acceptance.

Read the author's BVH code and output: ten sampled times report zero overlapping nonadjacent triangle pairs after excluding any pair sharing even one vertex. This is useful discrete evidence but excludes adjacent-fan foldback, face-layer collisions, cup collisions, and all times between samples. No minimum clearance or continuous swept guarantee is supplied. Do not summarize as whole-action no-penetration.

Author reports topology-audit.json verifies both parameter patches are disks (Euler characteristic 1, one boundary loop, boundary degree 2, no nonmanifold edges). Keep that source provenance explicit until independently checked. Next work is a slightly lower, rounder near-constant-width hand cap, plus adjacency/fan checks; do not change the body silhouette or hide an unresolved root behind a cup.

## v4 rounded cap, 15:34 UTC: sufficient art progress for isolated contact study

Viewed actual `bubu-surface-hand-experiment-v4-20261017/rendered/0008.png`, 0009 and 0005. The revised cap is rounder/blunter than v3; the old root appears smooth in the sampled side view without a long connecting arm or obvious crack. This is enough to proceed to isolated cup contact feasibility after current-configuration collision checks. No need to introduce topology subdivision merely because the cup-free front view reads as cheek bumps; evaluate intended grip context while retaining separate unobscured root views.

Not geometry/runtime approval: reported inverse-length configuration has sampled max edge stretch 5.126 at entry and min area ratio .01445. Do not reuse v3's BVH result for changed v4 geometry. Require current triangle/fan/face-layer checks; cup must not conceal unresolved intersections.

At 15:36 the author reported a same-topology positive-clamped cotangent parameterization candidate improving eight-sample max stretch to 3.178 and min area ratio .06642. This has not yet been independently recomputed or visually reviewed. Asked the author to freeze configuration identity/hash and regenerate all 12 samples/images before review; avoid replacing files under one path while retaining stale evidence. Positive solver weights alone do not prove the final embedded mesh is intersection-free.

## Frozen cotangent configuration, 15:43 UTC: independent verification

Configuration: `surface-hand-cotangent-spherical-cap-r1`, source `bubu-surface-hand-experiment-v4-20261017/build.py`, SHA-256 `f82d672d678fd15256375a0063db3c88e9205b9f53863abef47b30afbbde6988`. CONFIG matches source. Current images are `cotangent-render/`; `rendered/` is the earlier inverse-length candidate and must not be mixed with current measurements.

Recomputed all 12 saved poses independently: source hash, finite coordinates, every reported edge maximum and area minimum match, and height-excluded vertices remain exactly unchanged. Max edge ratio 3.177906888 at t=.25; min area ratio .066422969 at t=.5 and later. Source/evidence hashes and independent results are retained in `surface-cotangent/verification.json`. Inspected current endpoint front/side pixels; rounded shape direction remains consistent with the previous art review.

Read current-configuration collision/fan evidence. Ten discrete nonadjacent BVH samples have no reported overlap; nine face-layer samples report no new intersections. The explicit fan test covers five times and yields a few near-shared-vertex numerical hits; the author's float64 strict-interior follow-up rejects those examples. This is not full clearance certification: coplanar adjacent overlap remains uncovered, strict-interior segment tests do not cover all edge/coplanar cases, and all checks are discrete. Face results apply to the sampled face state, not every one of the 18 expressions during tea. These are script/output inspections, not an independent rerun of Blender collision machinery.

The current normal-cup fit is not a valid grasp: right/left socket residuals .168933470/.264510647 model units are well outside proposed contact tolerances. The fit uses nearest vertices in a selected hand region and bounded cup dimensions/orientations. Nearest-vertex distance is an upper bound on distance to the triangle surface, and the nonconvex bounded fit does not prove every cup/contact design impossible. Next adjust the already-permitted surface route endpoint/attachment orientation and cup placement, then evaluate actual triangle contact and ceramic-volume clearance. Do not solve it with hidden floating sockets, enlarging into long arms, or misleading front-camera occlusion.

Review disposition: retain this frozen isolated shape candidate; permit further isolated contact feasibility research under the existing task. No claim of whole-action no-penetration, approved geometry envelope, completed tea action or runtime admission. The original admitted source/drag/pet remain separate.

## Frozen near-mouth HOLD r1, 15:59 UTC: reproducibly verified static milestone

Reviewed `bubu-surface-hand-experiment-v4-20261017/frozen-near-mouth-hold-r1`. Every SHA256SUMS entry passes. Fit/pose/cup geometry hashes agree across reports and render manifest. Inspected actual front/45-degree/side cup renders (0004/0005/0006); the two rounded hands are more readable than the earlier hidden-behind-cup candidate.

Copied only the frozen inputs/check scripts into an independent review directory, supplied the referenced parent `base.json`, and reran the analytic ceramic-volume test and both Blender triangle/distance tests. All three resulting JSON reports equal the frozen originals exactly. No writes were made to the frozen source directory.

Verified scope: current static body-versus-cup shell/handle/tea triangle intersections 0; neutral face layers versus cup 0; nonadjacent body self-intersections 0; body vertices inside the analytic ceramic solid 0. Left/right hand-vertex-to-real-cup-triangle distances .000402339/.000502993. Mouth distance .011990472, so this is a near-mouth HOLD, not a sip or lip contact result.

It is reasonable to preserve this as a static technical/art milestone. It does not approve motion, all face states, coplanar/shared-vertex contact in this altered hand pose, whole-action nonpenetration, or host admission. The candidate has amplitude .24 (a separately acknowledged art revision), not the older .22 prototype limit; do not propagate this into old drag/pet caps.

Reproduction notes: the frozen scripts require `base.json`, which was absent from the initial frozen directory. Asked the author to provide a dependency manifest/hash or bundle it as an explicit new manifest revision. Rerun evidence is under `near-mouth-hold-r1/` in this review folder. The next sip study must use the selected approved face geometry and its transition path rather than assume neutral-mouth contact.

## Frozen fixed-08 hold–sip–hold trajectory, 16:09 UTC

Reviewed `bubu-surface-hand-experiment-v4-20261017/trajectory/FREEZE.json`. All 75 declared file/source/geometry hashes verify. ffprobe confirms 9.000 seconds, 12fps and 108 frames. Inspected actual starting, sip and returned-hold images. This is already-held-cup motion, not a rest-to-rest action.

Reran the full 33-point Blender audit in an independent review output directory, using read-only links to the frozen input geometry. The resulting audit JSON is exactly identical to the author's. At u spacing 1/32, all tested body/cup, fixed08-face/cup, new body/face, nonadjacent self-intersection and ceramic-inside-body counts are zero. Maximum nearest hand/cup distance upper bound across both vertex-to-triangle directions is .004529147. Existing exclusions remain: shared-vertex body fans are not rechecked in this trajectory audit, face08 is fixed, and there is no intersample clearance bound.

Also compared preview binary geometry at frames 0/24/48/72/84 against corresponding frozen samples 0/16/32, after the exact 22-degree view rotation and float32 conversion. Body, shell, handle and tea match exactly at all five checked frames. This checks both endpoints and intermediate forward/reverse positions and excludes stale geometry at those samples; it is not a complete every-frame video reconstruction.

Disposition: valid reproducible isolated motion milestone, suitable to preserve and preview. No approval of rest entry/exit, face transitions, full action cancellation or host integration. Source dependency hashing should additionally bind the hold fit, sip fit, sip cup input and base geometry; source-code hashes alone do not freeze those inputs. Future preview builds should avoid silently retaining an existing binary via `if path.exists()` without verifying its content.

Rerun evidence: `hold-sip-hold/freeze-verification.json`, `preview-binding.json`, `trajectory/audit.json` and `rerun.log`. Input symlinks in that review folder point to the frozen source and are review conveniences, not a self-contained delivery archive.

## Full rest-chain initial freeze, 16:19 UTC: late-cancel face-history bug

Inspected FINAL-FREEZE, full-chain keyframe sheet, isolated lifecycle, scene resources, actual-owner exporter and full-audit code. This broadens the candidate to normal 9-second rest-to-rest with cup appearance/disappearance, steam, actual approved08 owner enter/exit, and nine cancellation scenarios. It remains isolated; the body and prop samplers consume supplied time without their own RAF.

Found a concrete cancellation continuity defect before accepting this freeze: normal at 7.5s is already idle/neutral, path null, amount 0 (release at 7.2, completed 7.4). The cancel-7.5 first frame instead has path08 amount1 with exit until7.7. The cancellation exporter reconstructs history with release=cancelAt+fade and loses the earlier normal release. It therefore tests the wrong historical face state and could make a late cancel visually pop back to08.

Evidence is preserved in `full-chain/late-cancel-face-discontinuity.json`. Notified author/root immediately. Required repair: preserve historical owner events, release no later than the already scheduled/consumed normal release, and test cancel-first-frame face state/geometry against the unmodified normal timeline at the same time. Do not simply reset the face or instantiate another face owner. Existing lifecycle unit tests compare hand/lift/cup only and missed this face-history case.

This invalidates the claim that all nine cancellation trajectories are continuous in this initial freeze. It does not invalidate the ordinary 9-second preview or previous fixed08 hold-sip-hold milestone. Await a separately traceable corrected freeze before final acceptance.

## Late-cancel repair independently verified, 16:29 UTC

The author preserved rejected-r1 and repaired release scheduling with the earlier of normal release and cancellation release. Independently compared each of nine cancel-first-frame files to its freshly exported actual-owner normal(c) reference, matching by mesh name: all 72 face-layer position byte arrays match exactly, and path/amount agree. Cancel7.5 now stays neutral. Reran six Node tests (normal bounds/boundaries, cancellation body/prop behavior, reduced motion, late face release, resource idempotent disposal): 6/6 pass. Evidence: `full-chain/cancel-fix-verification.json`.

The clean r2 removes visible steam per root art review. A remaining black shape was identified as the approved08 mouth corner partly occluded by the cup, so cup sip orientation/readability is still being revised. Do not spend a full audit run on geometry still changing or carry collision approval over into that revision. Await the next stable joint source/pose/face/cup/render freeze; the cancellation logic fix can be retained independently.

## Final r2-clean sign-off, 16:32 UTC

See FINAL-SIGNOFF.md for exact frozen identities and scope. All4044 hashes verified; full334-sample independent rerun matches frozen JSON exactly, tested collision terms zero. Terminal rest byte recovery and nine cancellation face-start continuity independently verified; six tests pass. Accepted only as complete offline candidate pending visual review. Mouth-corner occlusion, disabled steam, shape quality and intersample/neighbor-fan limitations remain open. Production admission is not granted.
