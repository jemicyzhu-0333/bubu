# Isolated cloth feasibility probe

The original feasibility probe uses the already-pinned Rapier 0.21.0 soft-body
implementation. The separate opt-in coupled CPU experiment is documented below.
Neither is imported by FoundationActor or replaces the approved body, cape
geometry or application spring chains.

After the shared research-root setup, run from `animation-foundation-v1`:

`node secondary-motion/cloth-probe/run.mjs`

A 100-particle vertical sheet follows moving pinned particles while a kinematic
sphere pushes through its original plane over 600 fixed 1/60-second steps. The
probe checks finite bounded particles, pin error below 1e-5, and every sampled
collision triangle's nearest distance to the sphere (penetration below 1e-4).
Particle clearance alone is insufficient. `World.free()` runs in `finally`.

The measured small-scene CPU cost is exploratory. Large outliers remain; this
cannot certify a native/GPU frame budget. It also does not establish continuous
collision, fast teleports, self-contact, garment fitting, render-mesh transfer,
multiple simultaneous garments or the fixed clasp's clearance from a cup.
Those are separate admission tasks before this route can become a runtime mode.

Official references:
- [Rapier soft bodies](https://rapier.rs/docs/user_guides/javascript/soft_bodies/)
  documents cloth, pinned particles, deformable surfaces and kinematic targets.
- [Rapier rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)
  explains that authored kinematic trajectories are not corrected by contact forces.
- [VRM sphere collider](https://pixiv.github.io/three-vrm/docs/classes/three-vrm-springbone.VRMSpringBoneColliderShapeSphere.html)
  is a sphere-to-target distance interface, not whole-cloth collision acceptance.

## Actual cape mapping research

The canonical high model remains byte-identical. An adaptive meridian grid uses
444 simulation vertices for its thin surface; 7,739 render vertices in five
parts bind to local simulation triangles. The fixed clasp remains separate.
Angular-panel checks keep mappings from crossing the front opening. Rest error
is approximately 1e-14; 38,695 comparisons against a separate Three vector
implementation have maximum error below 1e-7. These are geometric checks, not
full seam or contact acceptance.

From `animation-foundation-v1` after the shared setup:

1. `python3 ../external-assets-v1/shared/export-foot-inputs.py --repo-root ../../.. --out /tmp/bubu-cloth-input --all-parts`
2. `blender --background --python secondary-motion/cloth-probe/author-coarse.py -- --cols 64 --rows 18 --spacing .08 --body-input /tmp/bubu-cloth-input/Bubu_body.npz --out secondary-motion/cloth-probe/cape-coarse.json`
3. `node secondary-motion/cloth-probe/bind-render.mjs`
4. `node secondary-motion/cloth-probe/check-rest-clearance.mjs`
5. `node --test secondary-motion/cloth-probe/thin-surface-mapper.test.mjs`
6. `node secondary-motion/cloth-probe/verify-mapper.mjs`
7. `node secondary-motion/cloth-probe/run-cape.mjs --frames=30 --body-collider=trimesh`

Blender and Python/NumPy are offline authoring requirements. `/tmp` in the example
is a caller-chosen output directory; on Windows select an ordinary temporary
folder. The author checks both NPZ arrays against the hash-pinned repository GLB.
The approved builder's two geometry functions are reused without running its
model-export side effects.

**Blocked:** the real-shape 30-frame trial has no body intersections at its four
sampled instants, but excludes clasp/hands/cup, containment, self-contact and
continuous checking. Physics step P95 is approximately 585 ms, far outside a
real-time budget. `--skip-contact` and `--body-collider=none|convex` are diagnostic
isolation switches, never admission modes. Each run writes a unique running,
completed or failed record with accepted=false; a killed process may leave
running status and does not prove cleanup. The existing lightweight runtime is
not replaced. See DESIGN.md for the remaining gates.

The endpoint probe now also supports a bounded rest-initialized experiment:

`node secondary-motion/cloth-probe/endpoint-probe.mjs --output NEW_EXTERNAL_DIRECTORY --trajectory --convex-hands --bounded-body-hull`

The current private default is `tea-swept-51-v1`, selected by
`attachment-profiles.json`. Preserve historical reproduction by passing
`--attachment-profile legacy-local-55-v1`, or `original-65-v1` for the original
failed baseline. The cage author accepts the same option and catalogue; the
runtime rejects a cage with mismatched pins. No original coarse or render
binding file, source model, controller or production registry is rewritten.
The 65-pin contract came from the internal coarse author, not a located user
instruction. The user's repair/audit request permits correcting that internal
private binding; it does not permit replacing approved geometry/controllers.

`node contact/cape-pin-sweep.mjs NEW_EXTERNAL_DIRECTORY` (from the foundation
directory) records exact inside-hand witnesses for fourteen supports during
the complete tea motion. Six were visible in the old sixteen keyframes; the
old 55-pin candidate still fixes six additional entry/exit conflicts. The
51-pin profile releases exactly the fourteen witnessed supports and restores
two unnecessarily freed supports from that older candidate. Analytic bounds
on the frozen controller certify all retained points with their original
0.003 radius over the two full entry/lift parameter branches, including their
joins: 60 intervals for the original motion, 64 for the coherent cup-clearance
candidate. Every cancellation hand path of the pinned timeline lies on those
branches. These are fixed-point guarantees, not cloth-surface, finite-patch,
seam, body/cup or complete-wardrobe acceptance.

Actual render-edge strain is now checked for the thin mapper as well as for
detailed skins. The 51-pin thin path fails at 0.06667 s: a hem cross-section
edge compresses to 0.79473 although coarse edges pass. The optional
`--rigid-piping-sections` comparison keeps each of 360 authored sections rigid
in private output buffers; separate mapper inputs preserve one writer per
buffer. It removes that compression defect and reaches 0.51667 s, where actual
cloth compression is 0.76196. The original 0.8–1.2 limits are unchanged.
The mapping comparison has no matching piping collision envelope and remains
explicit research only, not a default simulation/admission mode. Full
trajectories stop at the first real failure and retain rendered geometry.

It samples the coherent tea-clearance candidate once per tick, moves the two
hand/cup obstacle bodies from that same snapshot, and checks actual render
surfaces. The initial pose is clear. With 55 retained pins, the first failure is
at 0.55 seconds: the back edge and one front edge intersect the body while the
coarse simulation surface remains clear and edge ratios remain within 0.8–1.2.
This identifies a missing render-detail collision envelope, not just a bad sip
initialization. Foot contact, self-contact, containment and continuous contact
are not established. The test stops at the first contact/pin/strain failure;
an early stop cannot be reported as a clear final endpoint.

`--render-envelope` derives one uniform radius from the maximum unchanged
binding offset plus 1e-5. That conservative shortcut is infeasible at rest:
40 retained pin spheres overlap the actual body surface. Its first simulation
step reaches 1.271 stretch, above the unchanged 1.2 limit. It is not adopted.
A localized collision representation for cloth and trim is still required;
this is an implementation gap, not a physical-GPU-only blocker. The original
65-pin endpoint exclusion does not exclude every possible 55-pin cloth path.

## Local contact audit, 2026-10-24

The original conservative body hull is **not sufficiently fitted to the trim**:
at rest it intersects the back edge, hem and both front edges, although the
actual body has positive gaps of approximately 0.000987–0.001141 from those
pieces. Containment alone was an incomplete proxy admission rule.
`local-body-proxy.mjs` now independently requires closed convex topology, full
source-body containment, the unchanged 0.01 global error bound, absence of
garment containment/crossings, and a positive whole-triangle rest gap. The
locally fitted candidate has 930 vertices / 1,852 triangles, maximum global
error 0.0089188, containment margin at least 1.52e-6, and minimum garment gap
6.4691e-5. Earlier failed approximations remain in the external evidence.

`author-collision-skin.py`, `collision-skin.mjs` and
`regional-collision-skin.mjs` are isolated mapping experiments. They never
write the approved model or register a production garment. A single expanded
cage can cover all 7,739 cloth/trim vertices, but it can compress piping and
move rendered attachment points even when its particle pins are fixed.
The probe now checks 29 matching **rendered** pin witnesses against the same
1e-5 limit. The centered, region-specific candidate reduces their error to
1.33e-7 while independently verifying every vertex's regional cell coverage;
it uses 2,007 particles / 3,657 cells within the declared 2,048 / 4,096 caps.
This is a binding correction, not full trajectory acceptance.

All dynamic candidates remain rejected:

The table retains each route's historical failing state. Older cage runs did
not yet check rendered pins; current code can reject those routes earlier.
Their contact-free prefixes are not a complete pin/contact acceptance result.

| Candidate | First failing sample | Actual render strain | Contact at that sample |
| --- | --- | --- | --- |
| Single detailed skin + fitted body | 0.5 s | minimum 0.71555 | none |
| Centered cloth + local piping, material reference 30 Hz | 0.06667 s | maximum 1.20646 | none |
| Same geometry, declared 60 Hz material comparison | 0.06667 s | maximum 1.20833 | none |
| Original thin cloth + detailed regional piping | 0.51667 s | maximum 1.28794 | none |

The final thin-cloth comparison has zero render-pin error, but its physics P95
is about 337 ms (maximum 1,159 ms). Its last failing sample spends about 184 ms
in collision detection and 149 ms in the solver. These are CPU implementation
gaps; a native GPU does not excuse them. Detailed skin collision, extra solver
iterations, volume-based masses and mesh-scaled axial material were compared
with their failures retained. Neither the original spring-chain demo nor its
motion amplitudes were changed. The thin comparison explicitly keeps the
original coarse cloth collision surface; only piping uses detailed collision
skins, so it does not certify complete cloth-surface collision coverage.

`body-hull-patches.mjs` additionally partitions the same admitted body volume
into 64 convex face-pyramid groups (23–33 vertices per group). Every original
boundary face remains covered; all patch points lie in the original convex
hull. This changes neither the union volume nor the source model. A compound
with Rapier's internal-face correction is checked against the unsplit volume,
including a sliding-across-seams regression. The actual garment comparison
reduces last-sample narrow phase from about 184 ms to 69 ms, but solver time
rises from 149 ms to 280 ms; physics P95 is about 351 ms. This route remains a
diagnostic option, with no default adoption or stable-frame-rate claim. Select
it explicitly with `--body-patches 64 --compound-body` alongside the fitted
body option. Per-step timings exclude model/proxy/cage construction and GPU work.

Short `--frames` runs cannot certify the nine-second action endpoint or its
real-time budget. Unknown and duplicate options reject before creating output.
`accepted` remains false; self-contact, complete seams, other attachment points,
containment, cancellation, continuous time and native/GPU acceptance remain open.

Reproduce with new external paths from the research root:

```sh
node --test --test-isolation=none animation-foundation-v1/secondary-motion/cloth-probe/*.test.mjs
node animation-foundation-v1/secondary-motion/cloth-probe/export-body-supports.mjs /tmp/body-supports.json
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 animation-foundation-v1/secondary-motion/cloth-probe/author-body-proxy.py --input /tmp/body-supports.json --output /tmp/body-proxy.json
node animation-foundation-v1/secondary-motion/cloth-probe/body-proxy-audit.mjs /tmp/body-proxy-audit.json --proxy /tmp/body-proxy.json
```

Refine global-error failures with the audit's accumulated `refinementNormals`
via `author-body-proxy.py --refine REPORT`; each returned proxy must pass the
independent runtime validator. Vertex samples alone never admit a proxy.
Generate an original full-skin cage with `author-collision-skin.py --output FILE`,
or a centered cloth-only cage with `--refine-boundary --cloth-region` (which
requires `--regional-trim` in the probe). The probe's `--local-body-proxy FILE`
replaces `--bounded-body-hull` only in the explicit candidate run. Its
`--collision-skin FILE --regional-trim --mesh-scaled-material --constraint-pgs 12`
selects the regional experiment. `--thin-cloth` selects the explicitly partial
cloth representation and requires the original full-skin cage input.

A final isolated triangle shape-matching comparison is retained only in the
local-contact evidence archive. It stops at 0.08333 s: a cloth-to-piping link
reaches 1.27659 while the displayed cloth reaches 1.19888. First-step physics
cost is 19,159 ms, including 18,619 ms of island construction; subsequent
physics median is still hundreds of milliseconds. The variant is not adopted.
`replay-triangle-coupling.mjs RESEARCH_ROOT RUN_DIR NEW_OUTPUT_JSON` reconstructs
rest links and independently reproduces the saved failure. The final unchanged
source verifier passes 828 Node cases, including 22 cloth-probe contracts, and
two Python cases. These checks do not override the failed production gates.

## Actual surface and seam audit

The `--body-frame-detail --rigid-piping-sections --joined-piping-sections`
comparison fixes the saved 0.5167 s mapping compression and joins all 360
piping centers to their authored cloth-border vertices. The original mapper
remains the baseline. Actual rendered triangles, edges, pins and seams are
checked together. The normal path still fails piping/body contact at 0.5333 s.
A path cancelled at 0.2 s completes all 540 steps with those sampled geometry
checks clear; other cancellation times and continuous cloth contact remain open.
The numerical seam-coincidence limit is 1e-5, against source gaps below 1e-7.
This is an added check, not a relaxation of existing 0.8–1.2 strain limits.

Use `--cancel-at SECONDS` to declare a cancellation within the original action
and `--sample-hz 60|120|240` for bounded temporal convergence comparisons.
The minimum duration remains nine seconds at each rate. Late cancellations
extend to the first sample at which the unchanged controller reports `done`;
`horizon` records the required endpoint, and a shorter `--frames` run cannot
pass it. Regional piping collision
with the corrected unique-sample center still fails at 0.55/0.5583/0.5583 s
for 60/120/240 Hz; no variant is admitted. More iteration/step searches are not
a substitute for repairing the coupled render/collision/material representation.
See `../../verification/cloth-surface-20261024/` for exact commands, failures,
source identities, sampled cancellation scope and same-path cost comparisons.

```sh
node animation-foundation-v1/secondary-motion/cloth-probe/endpoint-probe.mjs --trajectory --convex-hands --bounded-body-hull --rigid-piping-sections --body-frame-detail --joined-piping-sections --cancel-at 0.2 --output /tmp/new-joined-cancel-evidence
```

## Coupled local collision audit

`--conforming-wire-piping` is an explicit **failed research candidate**, not a
new default. It gives all authored border vertices and their first inward
neighbours physical degrees of freedom, retaining the original coarse particle
IDs and 51 supports within the existing resource caps. Four native wire bodies
provide local capsule envelopes at the actual piping radius; rigid rendered
sections remain inside those capsules. The source GLB, controller and baseline
coarse/binding JSON stay unchanged. Reproduce with `--trajectory --convex-hands
--local-body-proxy animation-foundation-v1/secondary-motion/cloth-probe/fixtures/wire-local-body-proxy-v2.json
--conforming-wire-piping --constraint-pgs 12 --output NEW_EXTERNAL_DIRECTORY`.

Two resting-state defects were isolated and repaired in this candidate. A joint
to a proxy containing only a pinned Rapier particle pulled the other end toward
the origin; duplicate wire particles now reuse exactly the same existing support
location. Near-coplanar refined dihedral constraints also produced resting motion
without forces. Opposite-vertex rest-distance bending retains local bending
resistance and restores equilibrium to below 1e-6. Free boundary points still
use bilateral joints, never one-way attachment or a frozen shape. These fixes
do not establish dynamic garment acceptance.

At 60 Hz the actual rendered cloth still fails at 0.01667 s, even though its
physical edges and actual contact check pass. At 240 Hz it fails at the same
absolute time: render strain is approximately 0.7234–1.2317 and seam error is
2.10e-5, outside the unchanged 0.8–1.2 and 1e-5 limits. The native coupling
retains residual seam error, while short free-cloth render edges remain outside
the physical constraint graph. Full normal/cancellation acceptance is therefore
failed, not unrun or passed. The first-step island construction alone costs
hundreds of milliseconds; the experiment gives no whole-pipeline speedup.

The separate `--closed-piping` regional comparison only adds collision caps to
the original open-ended tubes. It preserves every exterior triangle, but still
fails at 0.56667 s (contact, strain and separated seams). It is not adopted.
Native 3D `createDeformableCollider` rejects a polyline binding while accepting
a triangle mesh in the same minimal test; a shared cloth/wire degree of freedom
cannot be assumed from that API. These are implementation/engine representation
findings, separate from the unavailable physical-GPU acceptance environment.
See `../../verification/seam-coupling-20261024/` for counterexamples, source
identities, validation and explicit adoption decisions.

Follow-up failed candidates remain explicit comparisons:

- `--transfinite-wire-map` with the conforming wire option fixes the saved
  1/60-second cloth snapshot (0.98065–1.01995 edge ratios, 3.75e-6 seams), but
  fails front piping at 0.09583 seconds during the actual trajectory.
- `--resolved-front-piping` additionally makes all original front exterior
  vertices actual collision particles. Correct ring-centroid supports and
  explicit rigid-proxy solver iterations bring seam error below 1.34e-6, then
  the back piping reaches 1.20187 at 0.10417 seconds. Local rod bending and
  sparse physical section frames did not close the failure and are not defaults.
- `--coupled-regional-seams` requires `--regional-trim --thin-cloth
  --body-frame-detail --closed-piping`, the original full collision skin and
  certified local body proxy. Use `--mesh-scaled-material --constraint-pgs 12
  --sample-hz 240`. It retains 51 original supports, 1,812 particles and all
  original render triangles. Actual boundary-point joints replace the mixed
  triangle proxies that produced NaNs at 0.11667 seconds. Normal and
  `--cancel-at 0.2` paths then fail actual cloth/body contact at 0.21667 seconds,
  despite passing strain and seam limits at that prefix. Actual source-checked
  stills show the crossing. The transfinite display is not its native collision
  surface; this is still an implementation gap, not a GPU limitation.

Each failed variant retains its source hashes and counterexample externally.
Raw nonfinite particle buffers are preserved without converting NaNs to JSON
nulls. Candidate reports separate the original coarse reference from the actual
native collision mesh. Production admission and the original limits stay closed.

## Common native collision and display surface comparison

The opt-in `shared-surface-cloth.mjs` candidate reads every displayed vertex
from the actual native collision mesh. It preserves all original exterior
triangles, source files and retained support locations. Its private cage has
1,983 particles / 3,760 tetrahedra / 51 original supports. This construction
contract passes; the candidate is **not production accepted**.

The isolated shared-cage trajectory now defaults to a 1/120-second integration
step. The full normal and 0.2-second cancellation paths each reach 9 seconds /
1,080 finite steps at that cadence; the explicit `--sample-hz 60` comparison
retains the normal-path 7.55-second NaN. This is a bounded finite-state result,
not stable material/contact acceptance: inverted cells, strain and seams still fail.

```sh
python3 author-shared-surface-cage.py --output /tmp/NEW-shared-cage.json
node endpoint-probe.mjs --trajectory --convex-hands \
  --shared-surface-cage /tmp/NEW-shared-cage.json \
  --local-body-proxy fixtures/wire-local-body-proxy-v2.json \
  --constraint-pgs 12 --sample-hz 240 --profile \
  --output /tmp/NEW-shared-normal
```

Three real front-border points initially had correct rest positions but failed
native particle-to-skin displacement response. Consistent centimetre world
units fix that response; changing only the local/world skin constructor or
cell order did not. Gravity, colliders, translations and solver `lengthUnit`
are converted together; public coordinates and acceptance limits are unchanged.

At 240 Hz the corrected constraint candidate still stops at 0.129167 seconds:
maximum cage strain 1.20590 and seam separation 1.73747e-5 exceed the original
1.2 / 1e-5 gates. The source-scale predecessor failed there with a seam of
1.08733e-4. Neither reaches the saved 0.216667-second contact counterexample.
Removing all obstacles still reproduces strain/seam failure. A separate
56-step gravity-only FEM comparison bounds strain but takes roughly 10 seconds
per step; its elastic-constraint alternative becomes nonfinite at the second
step. Neither is adopted or evidence of native GPU performance.

To retain all failures through the full normal/cancellation horizon, add
`--collect-failures` and optionally `--cancel-at .2`. This preserves the first
failed geometry and writes all per-frame failures. The ordinary first-failure
mode remains unchanged. A finite complete run still fails acceptance if any
sample fails; nonfinite state always aborts and cannot claim the endpoint.
The normal and cancellation paths, source snapshots, actual-model diagnostic
stills and rejected alternatives are recorded separately from construction
contracts. Do not use a single clear frame or a shortened diagnostic as closure.

`--physics-diagnostics` records native velocities, kinetic energy, gravitational
change and signed cell-volume ratios in model units. Kinetic plus gravitational
energy excludes elastic/contact/actuator work; it is not a conservation proof.
`--snapshot-frame N` saves the entire native world after the target poses are
authored and before that zero-based step. Restore it with the same Rapier version
to replay a failing step without repeating the preceding action. Snapshot metadata
includes the native cloth handle, units, source hashes and binary SHA-256.

`--particle-centroids` is a separate, disabled-by-default comparison. It replaces
free single-point cluster spherical joints with native particle attachments to
the actual section proxy. Two sections sharing a center retain both constraints;
the second attaches to the first section's original local anchor. All 201 center
constraints remain (172 attachments and 29 joints), as do all cells, edges, masses,
surfaces and support locations. The saved 13-point front-section fixture reproduces
the previous joint's NaN and checks the replacement; this is local solver evidence,
not full contact/strain/seam or production acceptance. Full normal/cancel action
results belong in the current external evidence report. Keep failed candidates off.
The full 60 Hz particle-centroid comparison actually fails at 7.516667 seconds,
with a large kinetic-energy increase before NaN. Its local fixture success does
not generalize to the coupled garment. It remains disabled and is not the
adopted temporal-discretization change.

`--coupled-contact-stiffness` is another **disabled, rejected comparison**. It
matches native contact softness to the declared 2,400 Hz axial upper bound
(factor 80 rather than 4), without changing any geometry, margin or threshold.
The actual 0.216667-second front/body intersections fall from 28/22 triangle
pairs to zero. However, earlier contact failures remain and the complete normal
path becomes nonfinite at 2.158333 seconds, after a large energy increase.
Do not adopt this switch or infer full cloth acceptance from the cleared frame.
The normal/cancel comparisons, real native snapshots, coupling diagnostics and
minimal internal redesign are indexed in
[`verification/front-contact-20261025/EVIDENCE-INDEX.md`](../../verification/front-contact-20261025/EVIDENCE-INDEX.md).

The independent coupled CPU solver is an opt-in research implementation of the
internal redesign. It does not change the default native solver or application
animation. Install `requirements-coupled.txt` in an isolated environment, retain
the packages' license notices, then run from the research root:

```sh
python3 animation-foundation-v1/secondary-motion/cloth-probe/author-shared-surface-cage.py --output "$EVIDENCE/cage.json"
node animation-foundation-v1/secondary-motion/cloth-probe/coupled-export.mjs "$EVIDENCE/input.json"
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 animation-foundation-v1/secondary-motion/cloth-probe/coupled_probe.py --input "$EVIDENCE/input.json" --cage "$EVIDENCE/cage.json" --path normal --accelerate --output "$EVIDENCE/normal"
node animation-foundation-v1/secondary-motion/cloth-probe/coupled-verify.mjs "$EVIDENCE/input.json" "$EVIDENCE/normal"
```

Set `EVIDENCE` to an existing directory outside research sources; every output
file/directory must be new. Repeat with `--path cancel02` and another output.
Both paths include the full nine-second controller horizon. `--frames` is only
for labelled diagnostics, never full-action acceptance. The exporter includes
body, both hands and all three cup surfaces. `--strain-method admm` preserves
the initial penalty comparison; it cannot be combined with `--accelerate`.
The source hashes, numerical package versions, all failed steps, particle/actual
render streams, convergence and energy are retained. The independent verifier
checks the original body/cup triangles, actual f32 rendered edges, all seams and
matching rendered support vertices. Its report explicitly lists unmatched
supports; fixed physical particles alone do not prove fixed rendered supports.
Neither a prefix nor a finite full path establishes continuous contact, stable
frame rate or native GPU acceptance.

`--method newton` selects a separate disabled comparison, without `--accelerate`.
It uses consistent derivatives for cells, edges and rigid sections in the same
position QP, an interior volume barrier, and an edge-specific bound on actual
float32 rendering roundoff. Historical separating planes are re-selected for
the current geometry instead of becoming permanent extra contact constraints.
All original acceptance intervals remain unchanged. The projective baseline
and its full traces remain independently reproducible with `--method projective`.

The Newton contact constraints also bound float32 conversion on both moving
obstacles and cloth. The bound comes from coordinate precision and the linear
solve tolerance; it does not change model geometry, collider radii or the exact
triangle-intersection gate. Double-precision equality alone previously missed
actual hem/hand intersections after conversion. Positive cells at sampled
endpoints still do not imply positive cells between them. Independent original
triangles and complete normal/cancellation paths remain mandatory, even when
the numerical residuals or a saved local replay pass.
