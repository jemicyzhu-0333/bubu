# Bare action rig extension: independent review

Date: 2026-10-17. Read-only architecture review; no source edits or runtime approval.

## Decision

1. Keep the approved four-limb drag/pet profile and existing adapter unchanged.
2. Create a separately admitted action-body profile only for authored action candidates. Larger angles are an admission capability, not evidence that an action is reachable or visually safe.
3. Test a normal cup's full grip-to-rim rigid transform against the current arm reach before adding bones. A wrist or local contact correction may solve orientation; neither elbows nor IK solve a missing reach envelope by themselves.
4. If the intended cup cannot bridge the gap without body penetration or implausible size, an independently reviewed action deformation/rig variant is necessary. Do not claim a new elbow alone fixes it, and do not silently replace the action with straw drinking.

## Evidence and limits

Authoritative measured fixture: `bubu-petting-continuous-r2-20261017/research/animation-0.1.0`; measurement supplied by the bare-action author and independently recalculated from `bubu-bare-action-migration-20261017/space-measurement.json`.

- Current actual D2 shoulder right world position at yaw zero: (.800000012, .665000021, -.085000001); mouth center (0, .695000023, .779398978).
- Shoulder-to-mouth distance: 1.178170452 model units.
- Maximum radius from shoulder among the measured >.5 shoulder-weight hand-region vertices: .389900378 right, .389900497 left.
- Therefore those measured hand points remain at least .788270 units from the mouth center under any shoulder-only rotation. This is a lower bound, not a collision-free achievable grip distance. It does not claim to classify every low-weight transition vertex as a hand.
- The historical rig05 build script uses shoulder x=.94; the actual current fixture uses .8. Current measured data wins.
- Skinning is linear blend. Current bone roster is Body, Shoulder_L/R, Hip_L/R, HeadTouch, AccessoryAnchor. No elbow or wrist.
- Both `runtime-facepath05/src/body-profile.mjs` and `drag-body-prototype-v1/src/body-adapter.mjs` enforce .20 shoulder / .14 hip quaternion caps. The adapter also caps its external body pivot at .10. Changing only the validator would not change motion.
- Current source admission requires an exact registered D2 GLB/profile hash. A modified skeleton or weights cannot honestly retain the old asset hash or bypass source verification.

## Minimum implementation boundary

Use the existing host, actor, clock, face director, leases, and stage. Add only:

- A small immutable action capability record, selected explicitly at actor admission and keyed to the exact asset/rig hash.
- One action pose sampler producing desired joint quaternions and one prop pose/contact record. It does not write bones, face channels, or materials.
- One action-aware body writer selected by the host. Existing drag/pet use the old writer/profile without relaxed limits. No two adapters may attach to or write the same actor.
- An action-owned cup instance using the existing resource cache/lease lifetime. A nondeforming attachment frame is enough if the current rig and cup pass the geometry test.

The host arbitrates body ownership before sampling. During tea, action owns body; a drag/pet request performs an explicit interrupted exit and hands ownership over only after body and prop cleanup. Face intent goes through the existing director. Prop transform is written once after final body evaluation. No second RAF, face driver, mixer, physics world, or generic IK engine.

A mutable global `BODY_PROFILE` or a union of the action and interaction bounds is unacceptable: it would let drag accidentally consume action permissions. If action and interaction share an actor admitted for wider capability, the host must still validate against the active mode's narrower profile before every body commit; actor-wide maximum permission is not sufficient isolation. The smallest first candidate can instead use a separate action fixture while preserving production drag/pet untouched.

## Escalation order

A. Current rig + independent larger-angle action profile + authored cup transform. Require a real contact-feasible, collision-free pose path. This may fail; no approval is inferred.

B. If reach passes but cup orientation fails, add a virtual grip frame or, only if visible palm articulation is required, a local wrist bone with local hand weights. A virtual frame does not deform skin and must not be used to float the cup away from its physical grip.

C. If reach fails, solve the actual shape requirement offline: authored action-specific arm deformation or a meaningful multi-segment action rig with an approved reachable envelope. Adding an elbow to the same short chain cannot increase its maximum reach. Any longer-chain/rest-pivot redistribution or deformation changes motion behavior and requires visual approval even if rest vertices remain identical. Do not add legs, fingers, a neck, or a whole-body IK system for tea.

For C, keep the baseline GLB byte-identical and register a derived action asset with its own hash and provenance. Preserve POSITION, index/topology, vertex colors/materials, face morph arrays and D2 mask/style identities; changed JOINTS/WEIGHTS, hierarchy and inverse binds are separately declared and audited. Rest evaluated surface must agree within export precision. Original drag/pet remains on its original asset/profile. A new skeleton's rest geometry parity does not prove old animations remain identical.

Runtime IK is optional, not the first implementation. For one fixed character and cup, bake an authored joint/prop path after offline contact solving. If small dynamic correction is later needed, bound it to the one arm, deterministic iteration count and joint limits, with residual failure rejecting/aborting the candidate rather than stretching or moving the cup independently.

## Minimal capability/config declaration

A strict record can hold:

- `id`, `version`, `sourceSha256`, `rigRevision`, `restGeometrySha256`, existing face/D2 profile identity.
- Explicit supported action IDs and allowed body channels, per-joint quaternion envelope, immutable position/scale policy, optional named corrective channel only if separately reviewed.
- `requires`: exact rig capability plus cup asset revision and named grip/rim frames. No implicit action permission from having an accessory equipped.
- `contacts`: physical hand surface anchor (triangle + barycentrics or separately validated hand frame), cup grip frame, cup rim point/normal, mouth contact anchor tied to the active approved expression, contact intervals, authored release intervals, position/orientation tolerances.
- `collision`: tested cup closed-volume proxy, relevant body/face/ground proxies, safety clearance and narrow named intentional-contact pairs. No broad cup-versus-character ignore rule. Rim touch is allowed locally; cup volume intersecting body is not.
- `ownership`: exclusive body, shared director-mediated face, action-local cup; interrupted exit policy; acquired resource IDs and bounded maximum counts.

A whitelist registry with one tea record is sufficient; do not build a plugin registry or policy language. Pair manifests with V1 accessory capability declarations so incompatible face/head/hand accessories fail admission or are deferred predictably rather than hidden or mutated.

## Required gates before integration

1. Identity: unchanged baseline hashes; exact rest POSITION/index and face/morph/D2 data comparisons for any derivative; evaluated rest maximum error <=1e-5 model units, justified against export precision. Render all 18 approved faces and original D2 shape in fixed-camera baseline comparisons.
2. Reach/contact: record candidate cup dimensions and grip/rim transforms; evaluate whole authored path including lifting and return, not just final drink pose. Starting numerical targets: grip/rim position residual <=.01 model units, orientation <=5 degrees, noncontact clearance >=.005 where feasible. These are proposed engineering thresholds, to be approved with actual cup scale and 99px visual readability, not preexisting project promises.
3. Collision: conservative full swept-path bounds or adaptive sampling of contact/collision motion, plus narrow phase near contacts. Fixed 30fps samples alone are not proof against between-frame penetration. Keep original full deformed-skin floor gate; six sole points alone are insufficient.
4. Visual: front/three-quarter/side, full size and 99px, normal-speed continuous lift/drink/return and interrupted exit. Confirm hand-cup contact, no torso tearing, shoulder dents, cup-through-face, hidden grip floats or sudden prop teleportation. Enlarged profile bounds are accepted only after this gate.
5. Strict regression: old face-only rejects any pose delta; old drag/pet still rejects .201 shoulder/.141 hip and any position/scale mutation. Replay identical inputs with identical times and compare original body matrices, face outputs, ground support, and cleanup counts against the unchanged baseline. Action capabilities must not appear in the old profile.
6. Ownership: instrument one body commit and one prop commit per actor frame; reject simultaneous writers and missing mode grant. Drag/pet takeover, blur, pointercancel, lost capture, hidden page, repeated play, action replacement, stale async completion and dispose all return to a valid owner without orphan prop or lingering pose.
7. Lifecycle: all new props/skeleton variants have budgeted leases and actor-private mutable state. Test failed admission, failed prop load, cancellation during load, two actors sharing cached source, idempotent dispose, and late completion after dispose; all active/reservation/resource counters return to baseline/zero as appropriate.

## Stopping point

Review complete. No new rig, expanded angle, cup design, contact path, or visual result is approved by this document. The next concrete decision comes from the author's normal-cup rigid-contact feasibility sample. If it fails, select an explicit action deformation candidate rather than pretending caps, elbows or IK alone solve reach.

## Follow-on static experiment review, 14:36 UTC

Reviewed `bubu-bare-action-migration-20261017/ACTION-RIG-PROPOSAL.md`, `experiment.mjs`, exported `experiment-frames.json`, `experiment-metrics.json`, render manifest, and actual prepare-front/rim-front/rim-side images. The proposal is an appropriate isolated experiment boundary, but the first executable probe is narrower: it blends offline vertex positions using existing shoulder weights around Y arcs (left 75°, right -65° at amount 1). It does not yet construct the proposed derived skeleton or new bounded-patch weight field.

**Reject this original-weight carrier probe.** Independently recomputed all triangle edge/area ratios from exported frames rather than trusting the report:

- Rest: zero changed vertices; edge/area ratios exactly 1.
- Prepare .25: 6,112 changed vertices; edge ratio .097284–3.140722; area ratio .023802–2.730426.
- Grip .7: edge ratio .089732–8.094769; area ratio .098240–7.112090.
- Rim contact 1: edge ratio .024712–11.102671; area ratio .014315–10.230339.

This already fails the proposed edge<=1.35 and area [.65,1.5] guards by very large margins, without needing a self-intersection proof. Side render `experiment-render/0014.png` shows a large shoulder-root cavity and severely extended connecting surface. Front `0012.png` can misleadingly look like a held cup. Do not approve on the front image.

Independently confirmed for all three nonrest yaw-zero exports: skin indices unchanged; all eight A_* facial layer position/index arrays identical to rest; body vertices below y=.35 have exactly zero motion. The admitted input GLB SHA-256 still equals `84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`. This preserves the source; it does not constitute a new all-18-face or drag runtime regression run.

Evidence scope corrections:

- `normalReversalsVsRest` is accurately named; a negative rest-normal dot product is not itself a triangle inversion or self-intersection proof.
- Current renders cover four yaws 0/45/90/180, not the proposed five including -45. Wireframe/stretch overlays, signed collision, quantified hand/cup contacts and intermediate path validation are not present in this probe. They are not needed to reject it, but cannot be described as passed.
- Contact-shaped pose names are target labels, not verified contact success.
- Failure rejects existing-weight direct carrier transport, not every possible new continuous root-patch design. Any next experiment must explicitly change and freeze that patch with domain/boundary checks, rather than relaxing thresholds or repackaging this failed mapping.

The author stopping this branch is correct. No runtime or asset whitelist admission should follow from it. No new implementation was made in this review.

## Second local-patch proposal: reach-bound rejection, 14:38 UTC

The author proposed preserving fin main-region weight near 1, smoothing weights inside `|x|>.72, .43<y<.98, -.38<z<.40`, fixing one boundary ring, and retaining the same carrier angles. Before a second render, independently tested a necessary condition on the actual rest mesh graph. Reproducible read-only analysis: `patch-reach-bound.py`; results `patch-reach-bound.json`.

For a fixed boundary vertex b and fin vertex p with desired position p', take any original edge path from b to p of total length L. If every edge may lengthen by at most k, the deformed path length is at most kL; triangle inequality requires |p'-b|<=kL. Violation proves that changing weights alone cannot satisfy the prescribed endpoint and edge-stretch bound. This uses real mesh paths, not a surface-distance approximation. Outside-patch fixed edges also satisfy the bound.

The script finds the inner boundary ring (364 vertices) and shortest edge paths from it, then tests 1,243 old-weight>.95 fin-region vertices per side against the proposed same full carrier arc. At rim, all 1,243 tested endpoints per side violate k=1.35. Strongest lower bounds: left k>=5.437385; right k>=4.893890. Already at prepare .25, strongest bounds are >=1.972752 and >=1.834209.

Concrete left witness: fin vertex 11796, fixed boundary vertex 12758, original graph path length .237425280, required new endpoint distance 1.290972584. No choice of smoothstep can make every edge on that path <=1.35 times its rest length while those endpoints remain fixed/prescribed. This also rules out a small near-1 weighting adjustment as a plausible fix, though the exact numerical bound quoted is for the full rigid-fin target.

Recommendation: do not spend a second render on the same patch/boundary and fin target. A different cup/contact target, a substantially different permitted deformation domain, or an explicitly redesigned articulation could change the assumptions; those are new design decisions. This is not proof that all conceivable continuous articulation is impossible. No runtime change is justified.
