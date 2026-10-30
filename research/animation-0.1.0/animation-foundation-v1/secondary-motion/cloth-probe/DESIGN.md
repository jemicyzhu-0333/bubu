# Cloth research: bounded implementation and validation plan

Status: research candidate only. No garment admission or production integration.

## Fixed scope

- Keep the canonical body, its animation, and the finalized render mesh unchanged. Deform only a private runtime copy; do not rewrite source positions, topology, UVs, materials, or files.
- Investigate one garment in an isolated Rapier 0.21.0 world using the installed dependency. Do not migrate the existing detached-prop world or spring-chain adapters.
- Use a low-resolution, rest-shaped thin simulation surface plus an offline render-to-simulation binding. This is a candidate mapping, not a new physics solver.
- Separate fixed clasps and other rigid trim from simulated cloth. Existing clasp/cup interference remains an asset/trajectory compatibility blocker; cloth cannot resolve a fixed constraint occupied by an obstacle.

## Current evidence and limits

`run.mjs` / `evidence.json`: synthetic 100-particle sheet, 600 frames, moving pins and a kinematic sphere. Maximum pin error is approximately 2.97e-8; sampled particle/sphere and simulation-triangle/sphere penetration are zero. Latest measured world-step P95 is 2.325 ms and maximum is 266.916 ms. Performance is **not passed**.

These results do not establish continuous collision safety, render-mesh clearance, self-contact, real hand/cup contact, garment binding, multi-instance costs, or native/GPU behavior. They do not replace the round5 cape's failed tea-contact admission. Timing excludes the complete render-mesh update pipeline.

The later actual-shape prototype uses 444 adaptive particles and 7,739 render
vertices without modifying the approved model. Its 30-frame body-only trial has
no surface intersections at four sampled instants, but step P95 is about 585 ms;
this route is not real-time-ready. Fixed clasp/hand/cup and full seam checks remain
open. Rest mapping and independent vector-reference evidence are available in
`cape-binding.json` and `mapper-evidence.json`; they do not complete the checklist.

## Candidate adapter contract

1. **Offline inputs:** immutable render geometry identity; authored thin simulation rest positions, triangles, structural/bending constraints, pin IDs, and cloth-region/seam labels. Preserve openings and disconnected pieces; do not weld front/back surfaces by proximity alone.
2. **Offline mapping:** for each deformable render vertex, record a simulation triangle, barycentric weights, and a rest-local detail/thickness offset. Define a deterministic triangle frame and how offsets are transported. Reject ambiguous cross-region mappings, out-of-range weights, excessive offsets, and degenerate triangles. Record seam-equivalence groups explicitly.
3. **Admission:** hash both mesh inputs and mapping; validate indices, finite values, byte/particle/triangle caps, rest reconstruction, pin ownership, and coordinate/unit conventions. Old spring-chain bindings do not authorize the new mapping.
4. **Runtime inputs:** timestamped, revision-matched pin and obstacle snapshots in one declared world coordinate system. Advance canonical animation once; interpolate snapshots without advancing it again. Initially accept only rigid unit-scale transforms.
5. **Runtime output:** private deformed render buffers, normals/bounds, and explicit accepted/blocked diagnostics. Detect degenerate/inverted mapping frames and excessive strain. Never present stale accepted state as safe without checking it against current obstacles.
6. **Ownership:** one research instance owns its world, soft body, obstacle bodies, and private render buffers. Clean up in construction failure, cancellation, and idempotent disposal. Source geometry/materials remain borrowed. A future shared-world owner would step once per substep and adapters would remove only their own resources; that migration is out of scope.

Rapier's `setSkin` is documented as embedding a mesh in cells; in 3D those cells are tetrahedra. Do not assume it directly implements thin-cloth triangle mapping. A volumetric cage would be a separate experiment, not a prerequisite for this candidate.

The 2026-10-24 local-contact experiments implement that separate comparison,
with explicit 2,048-particle / 4,096-cell caps. `SoftMeshBinding.skinned()` on
separate region clusters keeps cloth and piping from binding to each other's
overlapping cells. Piping section shape constraints remain local; the entire
garment is never made one rigid shape. Input/rest coverage, actual rendered pin
positions, private-buffer ownership and idempotent disposal are tested.
Conservative body containment is now paired with the unchanged global error
bound and full garment/proxy rest checks. None of these construction contracts
is a dynamic acceptance claim. The detailed-skin and thin-cloth alternatives
still fail actual render strain and CPU budget; see README for retained values.
No material-frequency or topology comparison changes the frozen controller,
production attachment registry or approved art. The original 65-pin profile
remains an immutable failed baseline, not a user requirement to preserve an
infeasible private binding. `attachment-profiles.json` versions internal
boundary-condition repairs without overwriting that baseline. Its revised
51-pin profile releases fourteen supports with exact inside-hand witnesses;
the older 55-pin endpoint candidate still fixed six of those. Separate analytic
hand-motion bounds certify retained point clearance over both full motion
branches; they do not admit free cloth, finite attachment patches or render
contact. Private deformation is still subject to the original strain, pin,
contact, resource and visual gates. Repairing this internal binding is covered
by the user's request to finish and audit the defects; no source/model or
controller unfreezing is implied.

An optional `restPositions` input to the thin mapper selects body-frame detail
transport. `prepare` then takes an explicit unit body quaternion; the fixture
uses the identity frame. This removes independent triangle-offset rotation from
the shared displacement field, but does not model finite collision thickness or
prove validity under large bending. The triangle-frame baseline remains intact.
The optional joined piping mapper preserves each local ring and places its
center at its corresponding actual cloth-border vertex. The unchanged source
has coincident centers/borders within 1e-7; every output records their maximum
separation and applies a 1e-5 numerical coincidence limit. Regional collision
cages also use the twelve unique ring samples, excluding the duplicated seam
vertex. These are separate research representations; passing rest/section
contracts cannot admit their failed dynamic contact or strain behavior.
Cancellation and time-step convergence options retain the full nine-second
acceptance horizon. Higher-rate trials keep the original strain limits and a
per-step time budget of 1000/hz; individual substeps cannot each borrow a full
16.667 ms frame budget. Every actual render edge is checked; cached immutable
rest lengths remove duplicate work without reducing the tested edge set.

## Validation checklist and required evidence

Before implementation, declare numerical tolerances and resource budgets per fixture; do not choose passing thresholds after observing failures. Save asset/mapping hashes, dependency versions, commands, frame counts, and all failures alongside each report.

- [ ] **Rest reconstruction:** reconstruct every render vertex without stepping; report maximum/RMS position error, unchanged UV/topology, normals, and bounds. Test rigid transforms and reject unsupported scales.
- [ ] **Pins and seams:** measure pinned render vertices as well as simulation particles. Test attachment motion, seam gaps, fixed/moving boundaries, trim alignment, and impossible pin/obstacle overlap. Block infeasible cases instead of silently moving fixed parts.
- [ ] **Simulation contact:** retain full triangle/sphere distance tests, including pinned regions and declared thickness. Add fast crossing and between-sample cases; label sampled evidence separately from continuous guarantees.
- [ ] **Actual high-model contact:** test the deformed render triangles, including hems, offsets, and rigid clasps, against actual hand/cup geometry through the tea trajectory. Report each failing part/time. A clear simulation cage is insufficient.
- [ ] **Shape validity:** quantify stretch, triangle degeneracy/inversion, mapping discontinuities, and visible silhouette/seam changes. Self-contact remains explicitly unverified until tested with it enabled.
- [ ] **Time/lifecycle:** exercise 30/60/120 Hz, no-substep display frames, pause/reduced motion, resume, backward time, long jumps, hidden/unhidden, obstacle removal, stale revisions, interrupted creation, unload/reload, and double disposal. Validate the final displayed pose, not only solver ticks.
- [ ] **Multi-instance:** use a bounded small instance count; verify independent state, removal isolation, aggregate resource caps, and behavior when admission exceeds budget. Do not extrapolate one garment's timing linearly as a guarantee.
- [ ] **Full-chain cost:** separately measure snapshot sampling, physics step, particle readback, high-model mapping, normals/bounds, contact verification, and total frame wall time. Record P50/P95/max, warm-up policy, repeat runs, allocation peaks, and after-disposal state. Keep WASM capacity, live allocations, and GC-dependent process measurements distinct.
- [ ] **Platform/visual checks:** inspect the actual garment in motion and run native Windows/macOS/GPU validation before any production claim.

## Decision gates

Proceed first to rest reconstruction and pin/seam tests on an unchanged garment. Only then attempt its real contact trajectory. Keep the cape blocked if fixed geometry conflicts, the mapped high model penetrates, or any safety/budget gate fails. No full migration, automatic fallback to penetrating rest geometry, stable-frame-rate claim, or release follows from the synthetic probe.

## Material and nonlinear solve audit boundary

The October 26 minimum-counterexample review distinguishes source asset and
controller freezes from the internal discretization and solver. The private
particle count, material integration rule, numerical contact planes and Hessian
approximation are implementation choices. Their failure is not evidence that
the user's frozen geometry is infeasible. The source arrays, controller,
original edge/contact/seam/orientation gates and complete-action requirement
remain authoritative. No new principal-stretch threshold replaces those gates.

An independent actual-Float32 triangle audit finds a material representation
blind spot at conditional time 567/960. Authored cloth triangle 930, vertices
[490,509,510], has area ratio 0.0840628 and minimum principal stretch 0.0831981,
while its three edge ratios are 0.962883, 0.997050 and 0.934249. Its vertex
bindings span cells 411 and 427; those cells still have positive volume ratios
0.464113 and 0.295445. Positive cage cells and acceptable edge lengths therefore
do not imply a well-shaped displayed triangle. This is a measured diagnostic
gap, not proof that it alone causes the nonlinear solver failure.

The disabled authored-triangle membrane experiment integrates the corotated
material energy on the existing rendered cloth triangles, with thickness equal
to the existing cage volume divided by authored cloth area. It replaces only
the volume-corotated elastic term: masses, particles, cells, their orientation
barrier, piping terms, bindings, seams and all contact/strain gates remain.
It changes the internal constitutive discretization and cannot inherit a full
physical trajectory from the former model. Rest/rigid-motion, analytic stretch,
directional gradient/Hessian and offset controls pass. The actual two-update
counterexample still fails convergence and its second raw update grows to
0.364397. It is not adopted; changing material integration alone is insufficient.

Separately, eliminating an optimized interior contact time requires the
reduced Hessian `Hxx - Hxt * Htt^-1 * Htx`, before PSD projection. The local
derivative audit confirms a missing coupling, especially for the hem/hand pair.
The repaired metric nevertheless retains 1/256 and 1/512 accepted fractions
on the actual counterexample, so it is not adopted as a solution to stagnation.

A numerical trust box preserves the reference energy and all physical checks.
Whenever its proposed update is below the original 1e-7 stopping norm, it must
solve the unrestricted original problem before any stopping decision. Its
bounded trial achieves two full numerical updates but does not converge.
Adding temporary closest-domain tangents, with all branches or one active
branch per primitive, fails the strict convex certificate. Independent 70-digit
evaluation of zero increment satisfies every affine and exact norm constraint
at the original tolerance. These failures are optimization failures on a
known-feasible subproblem, not evidence of a frozen-source conflict.

The installed IPC Toolkit supplies contact primitives, derivatives and CCD;
its own documentation states it is not a full physics/solver library. Using
those primitives does not give this custom temporal-envelope solver the
guarantees of a complete IPC implementation. A complete endpoint IPC or shell
solver would still need explicit parity with controller curves, actual F32
rendering, seams and all existing acceptance checks. Prior sequential Rapier
failures also remain counterexamples. Neither engine substitution nor increased
iteration counts constitute acceptance.

Evidence and measured invocation costs are indexed in
`../../verification/coupled-solver-20261025/EVIDENCE-INDEX.md`. Every new candidate
remains disabled. The next solver comparison must first certify the saved
known-feasible convex problem, then close the original nonlinear interval,
before spending time on full normal/cancel action validation.

The subsequent feasible-start conic comparison closes the saved **convex**
counterexample at the original 1e-8 KKT gates. Its default dense factorization
exceeds the diagnostic budget; the isolated sparse SOC KKT implementation keeps
every original cone/row in independent 70-digit certification. The saved
problem has dual residual 2.88484e-9, not merely a feasible zero displacement.
This is not a nonlinear action or realtime result. Omitting the temporary trust
box still fails the original certificate and is not adopted.

Replacing the volume material with a log-area membrane weakens its original
through-thickness response: the actual trial becomes volume-step limited. The
successor instead **retains all original material terms** and adds a compression
energy directly on authored triangle singular values. Per singular value `s`,
the correction is `-.25*s*s + s - .75 - .5*log(s)` for `s < 1`, and zero otherwise.
It is nonnegative, diverges at rank loss and has zero value, gradient and Hessian
at rest. Thus it does not add linear rest stiffness or remove original bending,
volume, edge or seam response. The original acceptance thresholds are unchanged.

A numerical area line search uses outward-rounded Bernstein coefficients. An
independent check also encloses actual cloth area over the declared stored-F32
CPU replay, including its existing rounding radius. These do not certify GPU
arithmetic or resolve the original-JS controller enclosure premise. A modified
constitutive law must start a new physical trajectory; late-state diagnostic
improvement cannot inherit the old trajectory's admission.

The cold-start candidate reaches conditional 32/960 (four 1/120 s physical
steps), with original convergence, original-mesh sample contact/strain/seam/pin
checks, and independent original-body/area replay checks. Its first unscaled
converged update is 6.33323e-9. The 0.21667/0.625 s regressions, complete normal
and cancellation paths, full-outfit continuous contact, appearance and realtime
remain unclosed. All candidates remain unregistered. The newer evidence is
indexed under the surface-compression checkpoint in the existing evidence index.

## Coupled seam experiment boundary

The explicit conforming-wire experiment retains the original coarse IDs and
support locations, adding private boundary and inward-neighbour samples within
the existing 2,048-particle / 4,096-triangle cap. One world owns integration.
Capsule radii come from the exact source cross sections plus a proven Float32
rounding enclosure, not fitting or acceptance margins. The free cloth and every
piping piece are checked as the same actual rendered system.

Pinned-only native cluster joints are excluded after an isolated collapse
reproduction; their duplicate wire particles reuse the same original pinned
location. Free seam points retain bilateral force coupling. Near-coplanar angle
hinges are replaced by opposite-vertex rest-distance bending in this experiment
after a no-force rest-drift reproduction. No global shape matching or swing
suppression is used. Both changes restore static contracts but the candidate
still fails actual dynamic strain, seam coincidence and CPU budgets. It remains
opt-in and cannot justify a production admission. Full cancellation diagnostics
derive their endpoint from the immutable controller and include late tails.

The later transfinite mapping preserves authored rest geometry and propagates
the four actual border displacements through the cloth domain. It does not
prove that the mapped interior is enclosed by the native surface. Direct front
surfaces are a separate opt-in representation: every exterior sample is an
actual collision particle, with a freely rotating centroid joint at the seam.
The rigid proxies need their own declared extra solver iterations.

The full regional coupling comparison uses 732 cloth points and 1,080 local
piping cage points. Boundary triangulation retains every authored sample without
extra centroid fans; only the original retained cloth supports are pinned.
Each seam joins its actual boundary particle, avoiding mixed pinned/free rigid
triangle proxies. It clears their observed nonfinite failure time, but normal
and cancellation paths still show a real cloth/body crossing at 0.21667 seconds.
Neither this candidate nor the earlier front-section experiments is adopted.
Nonfinite failures retain raw Float32 state and the last finite geometry; a
reference coarse mesh must never be labelled the refined native collision mesh.

## Shared native surface experiment

`author-shared-surface-cage.py` builds an independent common volume from the
unchanged source. Its 1,983 particles, 3,760 cells and 51 original supports stay
inside the previous caps. The cage does not collide. All actual cloth and piping
exterior triangles collide, and the native collision vertices are also the sole
displayed deformation. Collision-only tube caps do not add displayed triangles.
Cell coverage uses complete bounding-box candidates and a containment predicate;
fixed-count nearest-centroid pruning lost valid elongated cells in an isolated
counterexample. Inserted material points split the entire incident feature star.

Static reconstruction does not establish a correct dynamic binding. Three
actual front-border points reconstructed correctly but did not respond when
their native particle moved. The issue persisted with primary world-space skin
and reversed cell order; uniform coordinate scaling restored the response.
This isolated world therefore uses centimetres consistently for coordinates,
gravity, obstacle shapes/translations and `lengthUnit`, with readback converted
to model units. Mass, time, frequencies and all acceptance thresholds stay the
same. This fixes that binding response, not the material model.

The common-volume constraint model still fails strain and seam coincidence.
An obstacle-free gravity reproduction establishes that those defects cannot
be attributed solely to tea contact or native GPU availability. Equal particle
masses, elastic cell constraints and FEM are isolated diagnostic comparisons,
not defaults: redistributing mass does not itself establish the correct cloth
material metric; the elastic-constraint trial becomes nonfinite; FEM is far
outside the CPU budget. Do not repeat frequency searches or promote any of
these routes on static coverage alone.

The explicit `--collect-failures` trajectory mode retains the first rejected
pose and every failed sample while proceeding to the unchanged action horizon.
It never turns a rejected sample into acceptance. Nonfinite state still aborts
with raw failed state and the last finite pose, so an aborted run cannot claim
the endpoint. This is evidence collection, not a production fallback.

The optional particle-centroid constraint owner represents a free material point
without inventing its rotational frame. A one-point cluster spherical joint
reproduces nonfinite state in the real distorted front-ring fixture; a native
particle attachment preserves that center relationship without the singular
proxy. Fixed supports still use fixed references. A second section at one center
must retain its own joint to the first section's anchor, never overwrite the sole
particle attachment. Counts, bidirectional transfer and the actual native rendered
surface are tested; no constrained cell, edge or collider is removed. This internal
solver comparison neither changes frozen assets nor enables production admission.
The complete action rejects this local attachment comparison: a 7.516667-second
nonfinite state supersedes the local fixture success. Keep the switch off.
The original constraint representation at 120 Hz completes both measured 9-second
paths with finite state, so the isolated CLI defaults to that integration cadence.
Explicit 60 Hz remains available to reproduce the failure. No default application
clock, controller, tolerance or production admission is changed.

Signed volume and energy diagnostics observe the same native particles, with
velocity converted from world units. Positive edge lengths alone cannot certify
orientation: a reflected tetrahedron retains every edge while reversing volume.
The reported kinetic/gravitational values exclude elastic and actuator work.
Native snapshots capture targets before stepping; failing coordinates and velocities
are retained separately. These probes do not clamp velocities or repair failed state.

The front-contact audit distinguishes active collision from adequate response.
Both actual front meshes are closed, oriented, directly bound and enabled;
disabling the body in a diagnostic replay increases penetration. Matching contact
softness to the axial material bound clears the saved .216667-second rendered
intersection, but destabilizes the complete normal path at 2.158333 seconds.
Keep that opt-in comparison disabled. At the earlier .170833-second failure,
removing the 38 front centroid joints improves contact while opening the seam
by millimetres; removing ring shape matching or matching the resweep threshold
does not solve it. Constraint removal is diagnostic only. The needed internal
boundary is a coupled material/seam/contact solve with valid element orientation,
not an independent display correction, broader collision radius or more tuning
of the failed sequential representation. Source assets and controllers remain
outside that change. See the front-contact evidence index for the reversible
implementation proposal and its original unimplemented scope.

## Isolated coupled solver

`coupled_surface.py` and `coupled_solver.py` now implement that internal boundary
as an opt-in CPU research candidate. The frozen source meshes, controller,
1,983 material points, all 3,760 cells, original f32 masses, 51 supports,
201 centroid relationships and 364 section groups remain. One sparse affine
displacement map supplies both collision and displayed surface vertices; its
constant source-roundoff offset preserves every original rest vertex.

The implicit global QP includes inertia, projected corotated cell/edge/section
energies, exact affine seams/supports and active real-surface halfspaces.
This is an internal material discretization change, not a claim that the
constitutive law is identical to the rejected sequential Rapier constraints.
The default research strain method activates linearizations near violated
physical/rendered edge bounds; every acceptance check still uses every exact
nonlinear edge length in [0.8, 1.2]. The earlier ADMM comparison is retained.
The source controller and application runtime do not import this solver.

Whole-triangle separation uses all supporting obstacle planes when a cached
certificate fails. Zero-thickness tea surfaces retain their original supporting
face and edge planes without an extrusion. An exact cubic domain check prevents
cell orientation reversal along each solver update, including a collapse and
recovery between two positive endpoints. Optional Anderson proposals require
both lower incremental energy and exact constraint feasibility. These guards
do not repair a failed step, certify self-contact, or establish continuous
contact along the nonlinear controller trajectory.

All evidence retains unconverged steps, failures and the complete requested
action horizon. A completed trace is not acceptance: finite values, strain,
seams, actual rendered intersections, orientation, convergence and performance
are separate gates. The candidate has no production admission path and must
remain disabled until all original gates actually pass.

The separate `coupled_newton.py` comparison addresses three implementation
defects found in that projective route: rotational stiffness retained by the
surrogate matrix slows constrained material convergence; accumulated obsolete
supporting planes change the feasible set; a uniform numerical strain cushion
does not bound rounding on every actual f32 surface edge. Consistent polar,
section and edge derivatives use positive-semidefinite projected curvature,
while every gradient still differentiates the declared material energy.
Finite-difference and no-force contracts cover these derivatives.

The cell barrier is active only near compression, with the original positive
orientation gate retained. Fraction-to-boundary Newton steps avoid entering its
singular boundary; failed or unconverged solves remain failures, never a velocity
clamp or a runtime fallback. The actual f32 edge bound tightens the solver's
interior constraints rather than widening the [0.8, 1.2] acceptance interval.

The volume barrier includes the determinant's second derivative. A tangent
direction can have zero first-order volume change while collapsing a cell
quadratically; the gradient outer product alone misses that curvature.
Float32 contact conversion is bounded separately for each normal and both
surfaces, including the linear solve residual. Final admission still requires
the independent original triangles and matching rendered support witnesses.
No local QP status proves global nonlinear infeasibility of the frozen design.

## Inexact constrained solve and energy descent

A strict absolute convex residual alone does not guarantee a useful Newton
search direction near equilibrium. The saved new-material 96→104 step meets the
original 1e-8 KKT gate but has positive quadratic-model change 4.56590e-12.
Solving exactly the same problem more accurately makes that change −8.56316e-13;
all source geometry, material terms and constraints are unchanged. This is an
internal solver-accuracy defect, not evidence that the frozen design is infeasible.

The isolated candidate checks the complete quadratic merit change, including
constraint restoration, curvature and all temporal maximum branches. Merely
checking the linear slope misses the saved 160→168 counterexample. A
nonstationary direction whose full model does not decrease gets one stricter
native solve within the same deadline. That accuracy
is retained through the current physical step and its unrestricted reference
solve. The original unscaled update, KKT, contact, strain, seam, orientation and
area checks still determine admission. An unresolved or inaccurate direction
remains a failure; increasing the iteration limit is not a repair.

Trust-radius updates separately avoid interpreting prescribed boundary work, or
energy/model differences beneath the existing Armijo roundoff allowance, as a
reliable model ratio. This only preserves a numerical search radius; it cannot
accept a physical state or replace unrestricted stationarity. The older truncated
and coarse-reference candidates remain reproducible and disabled.

The merit model must use the exact F64 coordinate reconstruction consumed by the
physical iteration. High-precision convex increments cannot claim a penalty
reduction that disappears when coordinates are stored. Exact rational checks can
identify a numerical trust box that contradicts moving-domain guidance; only that
internal box may be omitted, with original physical constraints and trajectory
checks retained. Retained geometric witnesses may guide continuation before the
barrier activation band. All such guide rows are removed when the prescribed
kinematic target is reached, and the original reference decides stationarity.
These research candidates remain disabled; multi-invocation timing must count the
entire same-step chain, never only its successful tail.

Failed barrier-domain checks must preserve the actual primitive identity for
contact recovery. Returning only a boolean can leave the next direction unaware
of a repeatedly rejected neighboring edge. Supported primitive identities must
be checked against original topology; unsupported vertex-only reports cannot
be expanded into invented geometry.

Native scaled optimality is insufficient for an original-unit KKT certificate.
Equivalent recentering or bounded active-face refinement may improve numerical
accuracy, but every original affine row, norm, multiplier sign and complementarity
product stays in the final independent audit. A guessed working face is never an
acceptance test. Numerical contact planes and trust boxes guide directions only;
the original unrestricted reference must decide stationarity. The 504→512
counterexample shows why reaching the prescribed boundary, or observing a small
trust-limited update, cannot establish physical convergence. Repeated budget
continuations must count their entire same-step cost and never masquerade as
realtime progress. These isolated candidate methods are not production defaults.

Retaining a contact primitive is not sufficient to retain its failure evidence:
the same primitive can fail at a new within-step time. The isolated temporal
witness candidate preserves every discovered time, invalidates the response
cache and saves/restores those times with the unchanged physical origin and
velocity. These added response branches are not a continuous collision proof.

The 0.533333 s counterexample also exposes an optimized-time curvature omission.
A retained edge pair can have an edge/vertex closest feature; the old time
elimination handled only native edge/edge collisions. The checked candidate
eliminates smooth contact time for the actual closest feature, using the retained
primitive's uncertainty guard. Signed material/contact curvature is used only
after the complete matrix passes Cholesky. The final stationarity solve restores
the original metric and removes every numerical guide and trust bound. Energy,
gradients, source geometry, controller and all physical thresholds are unchanged.
This closes the saved local counterexample, not the full action or realtime.
The subsequent 0.541667 s moving-boundary QP exposed a separate numerical
backend defect. The saved updated strain system is independently feasible, with
unchanged curvature and full equality rank. Full sparse KKT with certified
original-coordinate recovery passes that system and the preceding constraint
sets. Neither native `optimal` nor a failed active-face correction admits a step.

A future endpoint crossing a Float32 exponent bin must not impose its larger
quantization radius on the immutable start of the entire physical interval.
The isolated response correction bounds both conversions on each existing
controller piece: interpolated endpoint quantization plus the final sample cast
and outward arithmetic allowance. Compact and full contact evaluators use the
same piece-local bound, including both sides of piece boundaries. The independent
stored-endpoint trajectory proof remains unchanged. This removes an artificial
origin barrier and closes the local 0.541667 s counterexample under the existing
conditional JS premise. It does not remove that premise or admit production.

The 0.55 s follow-up also exposes future-bin inflation on the moving hand. Its
local bound uses the old global tube to conservatively enclose coordinates on
each piece before selecting cast-error bins. It retains both casts, arithmetic
error and the inherited JS allowance. A future hand bin therefore cannot force
an enormous displacement through a near-zero-time numerical guide. Original
trajectory proof remains separate and unchanged.

Every response consumer must call the same time-local radius operation. In
particular, a cached contact rejection cannot reconstruct a radius from the
whole-interval maximum when full energy uses a piece-local value. The saved
0.55 s case proves that mismatch can stall line search even though the complete
response accepts the candidate. The cache retains only identities/times, always
recomputes geometry and radius, and still calls the full reference after a miss.
Actual-collision and changed-geometry controls cover this contract.

Working-face corrections separately form residuals from original binary
coefficients at 70 digits. Extended-precision sparse products can still lose the
required absolute accuracy through cancellation in a stiff system. The factor
remains a numerical predictor; original primal, dual, sign and complementarity
checks decide acceptance. A speculative correction before native recentering
selects a singular face on the saved case and is not adopted.

Affine recentering must accumulate the original binary dot product and subtract
the bound before rounding the small residual. Rounding the large dot product
first can change an increment constraint even when that increment's KKT audit
passes. The saved 0.558333 s case exposes this discrepancy: an incremental solve
passed but its absolute-coordinate constraint violation was 6.97910e-8. The
isolated correction accumulates at 70 digits, rounds inequality bounds inward,
and retains the independent absolute-coordinate check. A finite native `unknown`
result may seed one bounded fresh solve; only its complete original-coordinate
certificate can admit a numerical direction. Neither operation admits a physical
frame, changes a tolerance, or makes this candidate a production default.

Temporary kinematic guide planes must not become equilibrium contact forces.
The saved 0.558333 s late iterate has two active guide planes outside the barrier
activation band; they contribute 6.31441e-5 of directional work and a maximum
force component 0.0495585. Actual energy/gradient and directional curvature
controls agree, so additional unchanged iterations do not address that bias.
The isolated equilibrium candidate removes only these numerical guide rows once
the prescribed boundary is exactly reached. The 690 physical affine rows, 21
exact length cones, all retained primitives, original barrier and trajectory
proofs remain. Its saved full-direction comparison passes the physical path and
Armijo checks; complete nonlinear convergence and full-action acceptance remain
separate requirements. Moving-boundary prediction keeps the existing guides.

The subsequent 0.566667 s audit distinguishes search controls from physical
constraints. New physical affine rows can contradict a small numerical trust
box; exact rational necessary checks cover all physical rows, not just temporary
moving-boundary guides. A certified contradiction omits only the search box.
After an unrestricted reference/restoration direction, the trust update must
use that direction's scale; shrinking an unused old box creates artificial
stationarity and repeated unrestricted retries. Original physical and unscaled
convergence gates remain unchanged.

Complete numerical resume also includes trust radius, native accuracy and any
pending one-use contact-guide request. Earlier physical-origin checkpoints did
not save those search controls and cannot establish bit-exact numerical replay.
Legacy recovery now requires explicit, hash-bound evidence. The isolated guide
policy requests one restoration direction only after an actual rejected
trajectory; all original trajectory checks still run, and unrestricted original
stationarity remains mandatory. The subsequent audit corrects the consumption
boundary: building a QP does not consume a direction request. A budget failure,
new strain cut or retry at the same iterate must retain its guidance. Numerical
position advancement expires the in-flight request. Checkpoint version 2 saves
both pending and in-flight state; version 1 cannot establish exact policy replay.
The actual saved 0.566667 s case loses 1,184 rows under the old policy. The new
retry/resume control preserves those rows bit-for-bit without physical advance.

Response-set closure must compare active native contacts against retained
families on the original mesh. Four active EE/FV contacts absent at inspected
phases were added through their original topology; unsupported provenance fails
closed. This phase inspection constructs response directions and is not a
continuous proof. Independent full declared-path checks remain mandatory. The
0.566667 s local continuation now passes original stationarity, geometry, strain,
cell and seam gates, but full normal/cancel action acceptance remains open.

A strictly feasible conic origin can be a poor numerical initializer when its
smallest slack is near 1e-13. Native primal-dual initialization is an isolated
comparison that changes neither constraints nor the iteration ceiling. On the
saved 0.575 s updated 87-cone problem, the original 70-digit KKT check passes
with dual 2.76731e-9; the earlier seeded/recentered attempt failed at 1.63582e-8.
This independently certified convex direction does not admit the nonlinear
physical frame. Native status and every original residual remain required.

The subsequent 0.575 s direction audit distinguishes the nonlinear contact
maximum from its numerical bundle of affine time-branch planes. At the late
iterate, one inactive time-branch plane contributes 9.55091e-12 of direction
work, while all norm constraints contribute only 1.03105e-14. Merely tightening
native accuracy or triggering the original reference earlier does not close
the step. An isolated fixed-boundary Newton direction uses the current active
time maxima, including every exact tie. Full nonlinear maximum energy,
discovered primitives, trajectory proofs, strain and seam checks remain intact.
The original reference restores every time branch before accepting stationarity;
the saved reference matrix independently verifies that restoration. This changes
direction construction, not contact admission or the energy law.

For a nearly complementary but uncertified convex norm subproblem, an isolated
active KKT Newton correction may refine the finite native seed. The nonzero
objective block must be SPD, all original affine rows and norm constraints are
audited at 70 digits, and signs/complementarity remain mandatory. Native
`optimal` or `unknown` alone never accepts the result. The shared wall budget
includes this correction. A saved 0.583333 s QP and two small active-norm
counterexamples pass this independent correction; physical continuation is a
separate gate. Full-action and realtime acceptance remain open.

Complete normal and cancel paths remain open: the current analytic/export helper
explicitly supports normal entry only, so cancellation and later phases need
their own verified controller enclosure. The 417.743 s 0.541667-step diagnostic
chain is not realtime; native GPU remains independently unrun.

The 0.591667 s runtime audit finds redundant domain validation during native
contact-family insertion. Discovery already collects the original witnesses
before mutation; an isolated batch inserts that set and its support times,
then checks the complete updated barrier domain once before any solver or
physical advance. A rejection retains every witness and invokes the existing
feasible-state recovery; exceptions restore the validation flag and the shared
deadline still applies. The actual initial 14-contact case preserves topology,
support times, response metric, gradient and boundary coupling exactly, while
reducing 14 domain checks to one. This local equivalence does not establish a
whole-step performance gain or physical admission. Independent contact, strain,
volume, area and original-stationarity checks are unchanged.

Temporary restoration guides are also a numerical representation choice. The
saved 0.591667 s failure has 2,068 such rows and a feasible primal point, yet the
complete native solves fail dual/complementarity. An isolated constraint
generation policy always retains physical rows, equalities and exact length
cones. It initially omits identified guide rows from factorization, evaluates
the complete original QP at 70 digits, restores every omitted violated guide,
and repeats under the same wall deadline. Only a complete original KKT
certificate with zero multipliers on omitted rows can accept the direction.
No geometric primitive, contact proof, time branch or physical threshold is
removed. The final stationary reference still strips all numerical guides.
The saved case requires two rounds and 266 internal guide rows; all 8,794
original affine rows and all original norms pass. Infeasible, missing-guide,
expired-budget and equality-omission controls remain fail-closed. Physical
action admission is separate.

Failure costs must remain visible. A sum over accepted rows alone is not total
runtime when an attempted step fails. The new isolated runner records each
attempt before solving, accumulates its runtime in `finally`, and distinguishes
accepted and failed attempt time from independent offline audit time. The
whole diagnostic wall time additionally includes checkpoint/export overhead.

Contact discovery does not by itself invalidate a subsequently checked short
step. At the saved 0.6 s iterate the original policy discards a 1/8 direction
despite its updated contact-domain, full declared-path and segment-strain
checks, and updated energy Armijo decrease. The isolated feature-aware policy
caches the physical gradient only at an identical position, rebuilds contact
forces/time maxima after discovery, then runs the original merit line search.
The refreshed gradient matches complete reassembly bit-for-bit on that saved
case. A stale position or moving boundary is rejected. Position advancement
expires a previously built in-flight direction, but must not consume a still
pending restoration request. The first short-step candidate confused these
states and lost the requested next QP. Its replacement preserves pending state;
only constructing the restoration QP transfers that request into in-flight
state, and retries at the same position reproduce the same rows. Stationary
acceptance is forbidden in the iteration that added features, so a fresh full
original-reference QP remains mandatory. The initial isolated attempt did not
pass the complete 0.6 s frame. Its later composite with feasible-face repair
and the full working envelope passes that local frame; this does not select
any candidate for production.

Near complementarity alone is insufficient to choose active KKT refinement
before recentering. The saved 0.591667 s native candidate has original dual
1.45396e-8, but early refinement diverges and is rejected. That ordering is not
adopted; the original recovery order remains the comparison baseline.

A feasible, complementary native seed can also fail during later active-face
refinement. Numerically nearby inequalities need not lie on one exact face.
Forcing every selected slack to zero can create large incorrect multipliers,
even when original feasibility already passes. The isolated stationarity
refinement preserves existing dual forces and feasible slacks, uses an
independent tangent basis only for corrections, and checks every original row,
norm, sign and complementarity residual after each correction. A seed failing
the original primal/dual-cone/complementarity gates is ineligible. Convexity and
the shared deadline remain mandatory. Preserving multipliers alone did not
resolve the saved case; the failed comparison is retained. Success on the
working QP cannot replace the full original time-model stationary reference.

The complete-reference counterexample still admits a much smaller correction
without changing any dual force: solve the positive-curvature physical block
for the exact Lagrangian residual, retain auxiliary coordinates, and admit only
a full original certificate. Its failed trials are discarded. This fixed-dual
fast path is insufficient on earlier cases and is not a replacement solver;
the isolated composite falls back from the untouched seed to the original
active-face method, within the same existing refinement budget. Native status,
working-face stationarity and physical animation acceptance remain separate.

Selecting only a strictly maximal time branch is insufficient for a finite
Newton direction. The frame576 counterexample has two almost equal contact
energy peaks on the same cloth/left-hand pair. An omitted branch can block the
proposed direction even though the active-only QP certificate passes. The
isolated full-envelope adapter retains every original branch in the working
QP as well as the final stationary reference. Temporary guide generation still
checks its complete original QP; no contact or time branch is dropped from
admission. A matched-state comparison is required before attributing speed or
progress to this policy, and single-iteration improvement is not frame closure.

The complete working time envelope closes frame576 but can overconstrain a
local smooth-peak model. In the saved frame584 direction, the exact gradient
matches reassembly and finite-difference curvature agrees at larger diagnostic
steps. Almost all opposing KKT work comes from neighboring time planes at the
same peak; physical strain and the numerical trust box are not the limiter.
This supports testing a working-model selection, not changing material
stiffness or acceptance tolerances. The isolated piecewise-peak adapter retains
the maximum recorded branch in each existing controller piece, exact ties and
both knot sides. It applies only at a fixed target boundary. Moving-boundary
models, full nonlinear merit, contact/path checks and the final original
stationary reference retain all branches. This is not exhaustive continuous
time maximization. Same-piece multiple peaks remain a limitation of the
direction predictor and must be rejected by the unchanged full checks if
unsafe. The earlier two-piece counterexample is retained as a regression.
Frame584 passes local original-reference and actual-mesh checks with this
candidate; production, full-action and cold-replay acceptance remain open.

Numerical cost policies need an action-level comparison as well as a saved-QP
benchmark. Keeping a small guide set directly saves repeated convex solves in
the frame592 subproblem, but its slightly different certified direction adds
an extra necessary strain cut. The one-iteration action comparison therefore
has different accepted progress and cannot establish a runtime benefit. This
cost policy remains isolated. The comparison also exposes a bounded-exit bug:
an iteration that only discovers cuts has no accepted displacement. The
diagnostic loop must report its current proposed direction, zero accepted
update and unchanged boundary, preserve every new cut, and remain unconverged.
It must not return stale locals or fail before writing a recoverable state.

The frame592 audit additionally finds that global trust-box feedback dominates
the saved direction after contact discovery shrinks every coordinate's radius
128-fold. The isolated feature-scope policy defers radius feedback when the
existing short-step event explicitly rebuilt the contact model after direction
construction; the next QP evaluates the new model. Ordinary same-model
contraction/expansion and all physical gates remain unchanged. Matched bounded
action trials improve full energy but still fail original convergence, so this
is an unadmitted numerical candidate, not a production policy or a proof that
the contact problem is solved. Complete normal/cancel and cold-replay coverage
remain necessary before selecting it.

Proxy active supports must be selected from the current geometry. A cached
facet can remain a valid separating certificate while another facet has much
larger clearance. Treating the cached facet's small gap as an active contact
adds a history-dependent numerical force. At the saved frame592 state, body
facet1653 contributes three old rows where fresh selection contributes one;
one old row has a nonzero multiplier despite other triangle support clearances
of about 2.2--2.6 mm. The isolated current-support contact adapter refreshes
near-activation selection on every QP query, using the unchanged full facet
set, activation, guard and original-mesh gates. Actual penetrating triangles
remain constrained. No model geometry or physical acceptance threshold changes.

The old numerical checkpoint omitted this ephemeral proxy-plane cache. Its
stored physical/search arrays were preserved, but an interrupted QP could
rebuild different affine rows. Earlier local physical admissions remain
separately verified; their checkpoints must not be interpreted as complete
cache-exact execution replay. The new selection policy removes that dependency
instead of preserving historical artificial contacts. It still requires action
and independent geometry validation before adoption.

## Primary sources

- [Rapier 0.21 soft bodies](https://rapier.rs/docs/user_guides/javascript/soft_bodies/): cloth, surfaces, kinematic particles, shared-world interaction, removal.
- [Deformable colliders and skinning](https://rapier.rs/docs/user_guides/javascript/soft_bodies/#deformable-colliders-and-skinning): volumetric cage/cell embedding and collision-skin distinction.
- Installed declarations: `@dimforge/rapier3d-compat/dist/dynamics/soft_body.d.ts` and `dist/pipeline/world.d.ts`; executable local evidence: `run.mjs` and `evidence.json`.


The current-support continuation now crosses the original **0.625 s** failure
point (`contact600-closed-checkpoint.json`,
`current-support-prefix600-continuation.json`). Original unscaled update
**9.39109e-8**, dual residual **2.18449e-12**, physical strain
**[0.80063944,1.199999999997]**, minimum cell-volume ratio **0.39152036**,
zero pin/boundary error and centroid residual **1.53566e-16** satisfy the
unchanged local gates. All **1,653** original time rows are restored from
**1,625** working rows. Whole-segment strain/direction and independent original
body, F32 and area enclosures pass only their stated conditional scope.
The actual rendered mesh has zero sampled crossings, strain
**[0.80992562,1.19999696]**, seam error **8.46223e-8** and zero matched render-pin
error. Full/front-contact/back diagnostic stills were inspected with no obvious
crossing or open seam; piping faceting persists and the body omits face/details.
This is not complete V2 appearance or full-outfit continuous acceptance.

No frame-specific solver branch was introduced for this step. The saved
same-frame continuations retain changing contact families, including the failed
budgeted attempts. Final invocation runtime is **93.646 s**, including
**35.963 s** convex-solve wall and **57.683 s** other runtime. Independent
body/area audit is **0.517 s**, discrete mesh audit **0.096 s**. Selected resumed
chain totals **663.527 s** runtime / **673.783 s** diagnostic wall, including one
instrumented iteration and excluding earlier physical frames. Overlapping
profile timers must not be summed: retained-feature energy searches alone
account for **29.638 s** within the final invocation, and their nested collision
and domain timers overlap. The separate one-iteration cProfile result identifies
sparse factorization, full-array retained FV/EV energy queries and geometric
checks as costs; its instrumentation overhead is not a runtime benchmark.
Production remains disabled. Cold replay, full normal/cancel paths, complete
original-JS and outfit continuity, final appearance and realtime remain open;
native GPU is unrun. No user-frozen model/controller change or new approval is
required for the remaining internal work. Next physical continuation begins at
frame600 and targets frame608, without treating this local milestone as closure
of the complete action.


The post-0.625 cost audit isolates scalar retained FV/EV queries. The first
compact-mesh candidate is rejected: native FV-to-EV reduction reverses one edge
when its local edge order differs from the original mesh. The preserved
`local-native-order-counterexample` contains the real primitive, coordinates,
original/reversed DOFs and the **2.46519e-32** energy discrepancy; no acceptance
threshold was changed to accommodate it. The ordered variant copies original
edge endpoint order into the compact native query. Only scalar search evaluation
uses that query; final branch geometry, native derivatives, all original
constraints, whole-segment and actual rendered-mesh checks remain full size.

`check_retained_native_local_energy_ordered.json` passes **497** scalar controls,
including **12** invalid-domain controls and all **9 FV / 3 EV** retained families
at frame600. Full branch times, values and world arrays are bit-exact. These
function-level checks cost **1.231 s** for the original branches versus
**0.303 s** locally and do not alone establish runtime improvement.
`local-native-ordered-normal-592-600` then replays the same saved input as
`current-support-normal-592-600-resume3`: all seven iteration numerics, initial,
attempt and accepted states and rendered bytes are bit-exact. Original-reference
and independent geometry audits pass again. The already inspected baseline
stills therefore apply to the optimized render without new capture.

`contact600-local-native-comparison.json` records runtime **93.646 → 83.078 s**
(**11.285%** less in this one matched invocation). Convex outer wall remains
**35.963 / 36.306 s**; other runtime falls **57.683 → 46.772 s**, and the nested
feature-envelope timer falls **29.638 → 18.075 s**. This is evidence of reduced
whole-step work, not a repeated P95, cold-start or realtime claim. Only the
ordered variant is retained for isolated research continuation;
`local-native-ordered-prefix600-continuation.json` binds its exact checked seed.
The naive ordering variant and all production promotion remain disabled.

Reproduce the ordered scalar comparison from the external `ipc-stage` evidence
root with `PYTHONPATH=../ipc-deps:../deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
python3 check_retained_native_local_energy_ordered.py` in a restored copy with a
fresh output path (the harness deliberately refuses to overwrite evidence).
The matched run's saved `arguments` in `coupled-cloth.json` specify seed, resume,
frame range and budgets for `run_local_native_ordered_refinement.py`; use a fresh
`--output`. Re-run `coupled-verify.mjs`, `check_full_time_reference.py` and
`admit_local_continuation.py` before treating any rerun as a continuation seed.


Further continuation to **0.633333333 s** is **unadmitted**. Both bounded attempts
in `local-native-ordered-normal-600-608` and `...-resume` end at the shared
180 s runtime deadline during contact-family closure. Their combined runtime is
**360.053 s**, and the last accepted numerical movement has unscaled update
**3.88038e-4**, above **1e-7**. Reaching the target boundary is not acceptance.
No full normal/cancel or native-GPU validation ran during this phase.

`audit_contact608_saved_state.json` reassembles the final position twice without
solving or advancing it: energy and gradient are bit-exact, with **50** retained
families before and after both queries. The saved final QP originated at the
preceding iterate and cannot certify this position; this diagnostic snapshot
limitation is not evidence of stale QP reuse by the runtime. Current material /
contact gradient norms are **0.8750 / 0.3686**. Although the initial force-balance
term was zero at this frame, the corresponding current-position estimate is
only **0.9669** times the fixed stiffness; it omits constraint reactions and does
not justify increasing stiffness. Current physical/F32 strain residuals are
within range, but these alone do not supply KKT, actual contact, seam or full-path
admission. `contact608-open-checkpoint.json` records this distinction and the
resume state. The next diagnostic must compare freshly assembled original and
working directions against contact/restoration and line-search witnesses, not
reuse the old QP or add unbounded iteration budgets. There is no proved conflict
with user-frozen files and no external permission/hardware blocker for this
internal solver work.

A concrete matched replay, from the external `ipc-stage` directory and with an
unused output name, is:

```sh
PYTHONPATH=../ipc-deps:../deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 run_local_native_ordered_refinement.py --seed-run current-support-normal-584-592 --seed-check current-support-prefix592-continuation.json --start 592 --stop 600 --resume current-support-normal-600-profile/frame-600 --output local-native-reproduction-600 --step-budget 180 --total-budget 210 --iterations 30
node /workspace/bubu/research/animation-0.1.0/animation-foundation-v1/secondary-motion/cloth-probe/coupled-verify.mjs ../inputs-portable.json local-native-reproduction-600
PYTHONPATH=../deps python3 check_full_time_reference.py local-native-reproduction-600 local-native-reproduction-600-reference.json
PYTHONPATH=../deps python3 admit_local_continuation.py local-native-reproduction-600 local-native-reproduction-600-admission.json
```

The second through fourth commands inspect the new run only. Acceptance still
requires their actual successful outputs; do not overwrite original evidence.
Repository executable sources were not modified in this phase. Earlier npm and
integration results were not rerun or counted as new evidence. `git diff --check`
passes; the 12 bound frozen source hashes match. The V2 worktree remains
uncommitted/unpushed, and experimental source is retained in the verified
external evidence chain. No new video, package, publication or deployment was
created.


The 2026-10-29 collaboration handoff is bound by external
`ipc-stage/collaboration-problem-20261029.json` and the member-verified
`collaboration-frozen-qp608-20261029.tar.gz`. It specifies the actual nonlinear
problem, original QP matrix/upper-triangle convention, norm cones, solver and
acceptance thresholds; the portable bundle is a frozen QP, not physical-action
acceptance. Dot research remains advisory and does not concurrently edit this
worktree. The last accepted local physical checkpoint is still **0.625 s**.
The earlier persistent-domain pilot completed with **zero accepted rows**:
after reaching 6.64e-5, its last update rose to **6.98961e-4** at iteration7,
then the 180 s shared deadline stopped the next inner solve. It is not selected
as a passing solver or automatically restarted past that failure.

`check_equivalent_search_rows.json` checks exact coefficient/bound aliases,
active lazy bounds, mandatory physical aliases, duplicate equalities, near-
duplicate non-merging, invalid roles, infeasibility and deadlines. It caught
an empty-index dtype bug in the isolated lazy generator; the typed version
preserves an integer index even when every search row is omitted. Original
bound source files were not edited. `check_search_full_fallback.json` then
checks a reduced unbounded/singular problem whose complete original problem
is bounded: restoring the original numerical rows passes complete KKT.
The first failures and their source/logs are retained under
`search-row-empty-control` and `search-row-singular-fallback-control`.

`compare_contact608_search_rows_ablation.json` replays the identical convex
QP in four modes, with the nonzero objective block checked SPD and zero
auxiliary columns retained. All complete original **1e-8** residual gates
pass: original **11.246 s**, exact row quotient only **10.749 s**, lazy trust
rows only **8.532 s**, both **8.053 s**. Group duals expand to one original row
with zeros on aliases, preserving their sum; no barrier/penalty term or later
physical constraint is removed. Rows are quotiented only within that frozen
QP. The largest original dual residual among these controls is **5.53659e-9**.
This isolates the principal saving to lazy numerical trust rows in this case;
redundancy itself is not proved to cause nonlinear stagnation.

`runtime-cost-model-20261029.json` separates the observed **83.078 s** step into
**36.306 s** convex wall and **46.772 s** other runtime; independent offline
audit is separate. Two 120 Hz substeps share at most **16.667 ms** before other
frame costs, so caching or excluding offline audit cannot close this gap.
The implementation roadmap requires consistent multi-step globalization,
warm active/primal-dual solves with original full certificates, exact structural
constraint elimination, compact local contact operators and validated compiled
kernels. These are research paths, not measured realtime or native-GPU success.
Physical action regression is required before any solver candidate is selected.


The 2026-10-29 domain-correction audit distinguishes numerical search rows from
physical constraints. At the same saved origin, the boxed full direction
decreases merit 2.21794e-5; removing the box requires 1/32 and decreases only
2.84430e-6. Box removal is not adopted. Two temporary rejected-trial Jacobian
corrections instead permit a full direction with original-energy decrease
5.42527e-5. Independent body/F32 contact, area, whole-segment strain, cell
orientation, seam and pin checks pass for this unadmitted numerical trial.
This does not establish original-reference stationarity or action completion.

Temporary correction rows expire after position advancement and are stripped
by the unchanged final reference solve. The first step-policy draft bypassed
response-time retention on correction-only retries. V2 preserves the captured
witness through the original feature/recovery protocol; a real-contact test
checks new-time persistence, checkpoint roundtrip and temporary-cut expiry.
Stored absolute guide bounds round inward and are checked by exact rational
original-coordinate sums. The first draft's sole correction time was already
retained by an earlier fallback in that run, so it did not trigger actual data
loss; the general control-flow defect is fixed regardless.

The latest V2 bounded attempt takes 180.212 s and remains unconverged at
608/960 s with raw update 3.93596e-5. Its continuation lineage costs 901.143 s
for that still-unadmitted physical step. The admitted checkpoint stays at
600/960 s. All solver candidates remain disabled. Full normal/cancel,
continuous outfit, original-JS allowance and realtime/native GPU remain open.
The latest 436 KKT factor callbacks take 25.946 s within 80.862 s completed-QP
wall; that factor bucket includes assembly, conversion, symbolic and numeric
work. Symbolic caching alone has no demonstrated saving and cannot close the
whole runtime gap. Freezing source models/controllers is not the cause of
these remaining internal implementation and numerical-solver limits.


The subsequent original-reference diagnostic at the latest saved 608 position
removes 1,987 guides, restores 2,059 time rows and the original metric, and
uses no numerical trust box. Complete original-unit QP residuals pass, but
the actual unscaled reference update is 2.72386757e-4, so physical convergence
still fails. Its direction needs two actual-domain backtracks (alpha=1/4).
Thus temporary guides alone do not explain the remaining nonlinear mismatch.
The observed working QPs have 72 retained families and 135→136 support times;
active guide rows 11→9, guide reaction norm .319→.202, and zero active trust
rows in this short control. These statistics belong to each QP origin, never
the post-move physical state.

Factory-local UMFPACK symbolic caching passes small-matrix behavior checks and
the frozen full-QP certificate. The isolated full-QP comparison is SuperLU
8.180 s, UMFPACK uncached 11.087 s, UMFPACK cached 10.715 s. Caching saves only
.372 s within that backend and loses to the existing backend; it is not adopted.
Original backend, frozen sources and all physical thresholds remain unchanged.


The time-max provenance audit at the latest saved 608 numerical point checks
72 families and all 2,059 branch worlds, values and gradients. History values
are evaluated at the current origin; the epigraph lower row is
`eta - grad(B_t) delta >= B_t - max(B)`, with zero boundary work at the fixed
boundary. Every family has objective coefficient 1 (stiffness already enters
branch values/gradients). Original-coordinate family multiplier sums match
that coefficient within 5.86e-16. This semantic check is distinct from total
complementarity. The missing-gap toy produces the expected false zero step;
the actual generator instead produces direction -1. Adding one nonmaximal
history time increases rows 2,059→2,060 while E, g, original metric and working
metric remain unchanged, including the count of applied Schur families.

Both fixed-origin shadow QPs retain the same baseline metric, all time rows
and physical constraints, with no numerical box. Without guidance, update is
2.72387e-4; with all 1,987 guides, it is 2.82256e-5. Both full KKT checks pass.
The unguided direction violates 28 guide rows; the guided aggregate original-
coordinate reaction norm is .04301585. Neither direction is applied, and
this is not evidence that artificial guidance can safely be removed.

The Schur correction remains a working metric approximation: current guards
exclude near-endpoint pieces, unsupported mollifiers/guards and nonnegative
Btt, with a local Newton-time test and global matrix SPD check. They do not
certify peak isolation, all competing peaks, a Btt error margin or a smooth
feature neighborhood. Fourteen signed probe pairs of two selected families
agree with the local reduced-curvature formula at small scales; fixed-time
EV→FV switching appears at larger steps. This does not establish the overall
nonlinear failure's cause or continuous-time global maximality.

Eight groups of distinct source families currently share a selected native
contact identity (up to eight source families). Times and guards differ;
these are not exact equivalent functions. The overlap affects the current
energy/gradient/curvature model together and must not be fixed by deleting
only Hessian terms or merging physical barriers without an equivalence proof.
No source model/controller, solver backend, acceptance threshold or physical
state was changed during these audits. Original-reference convergence at 608
and the production acceptance items remain open.

The subsequent reference-admission audit finds a real threshold-boundary
defect, separate from slow convergence at 608. The old adapter tests the ideal
QP increment, while the stationary gate tests reconstructed F64 positions.
For origin .75 and delta `nextafter(1e-7,+inf)`, the ideal increment is above
the cutoff but the actual displacement is below it; the old stationary gate
can accept without verifying that the unrestricted reference was solved.

The isolated `temporal_length_qp_reference_bound.py` adapter triggers the
original solve if either representation is small. Final admission requires
both unscaled norms below the unchanged cutoff, all original-reference flags,
and a certificate bound to the current physical state, prediction inputs,
contact history, strain cuts, length cones and exact reconstructed direction.
`domain_corrected_trajectory_step_v3.py` admits only before moving the current
iterate; any accepted displacement requires a fresh reference at its new
origin. Geometry checks also cannot add constraints and reuse the old proof.
The older source-bound runs and their implementations remain intact.

Fixed-state replay at 600 preserves local acceptance: the fresh reference
update is 4.37289e-10 and the existing physical checks pass. Replay at 608 has
working update 2.44542e-5 and remains unadmitted. Neither replay advances
physical time. The former is not a replacement full-action or F32 audit.
The complete-energy directional audit independently checks material plus
re-maximized contact energy: at numerically stable probe scales, relative
gradient errors are about 1e-7 and working-curvature errors about 2.6e-5 in
two directions. Smaller probes suffer cancellation; these finite differences
do not certify a neighborhood, global time maximum, or the convergence cause.
The reference-bound candidate remains production-disabled. Normal/cancel
completion, continuous full-outfit contact and realtime/native GPU admission
remain open, without any change to frozen sources or acceptance tolerances.

The subsequent 608 globalization audit distinguishes fresh guidance from
excessively conservative guidance. All 1,987 ordinary rows are rebuilt at the
current origin; 15 nevertheless exclude the already verified quarter-step of
the original-reference direction. Removing those numerical rows from one
frozen working QP preserves its physical rows and full residual certificate,
but its direction still requires actual-domain backtracking. Rejection-driven
cuts, plain backtracking and hierarchical material/contact curvature trials
do not establish convergence. A contact-supported Schur diagnostic isolates
one negative mode on 90 of 5,796 coordinates; its convexified working QP is
SPD, but the stored correction is not strictly PSD after rounding. The bounded
actual run still fails, with fresh reference update 1.20863e-4. None is enabled.

A coupled second-order restoration (SOC) trial uses the original mass metric
to minimize correction of a proposed direction, retaining every physical
affine row and exact active length cone. It generates numerical trials only.
The reconstructed F64 result must pass the full original-coordinate 1e-8 QP
certificate, absolute constraints, nonlinear trajectory, area/orientation,
unchanged Armijo and strain gates. Physical equilibrium still requires the
fresh, state-bound unrestricted reference. At the original 608 numerical
point, three corrections allow one full trial with energy decrease 3.64846e-5
and maximum correction 2.00374e-5. This is not an admitted animation frame.
The following numerical iterate exposes a different failure: the squared
distance gradient is evaluated almost at intersecting edges. Independent
replay exactly reproduces the failed row and its objective. Trial distance is
8.386e-14, and the gradient shrinks by a factor 2.215e-10. The row requires
infinity-norm displacement at least 226,519.95, versus numerical radius
.00150917. This is an unusable local tangent, not physical infeasibility.

Origin-side separation planes fix that local QP failure and their normal,
four endpoint-pair coverage and tB mapping are independently checked. They
still fail later nonlinear contacts in the bounded trial, so are not adopted.
Neither two sampled rounding guards nor finitely many contact times establish
a continuous certificate. A separate exact conflict guard skips provably
incompatible temporary restoration QPs and returns to ordinary backtracking;
it never deletes a physical constraint or a numerical box to force success.

Contact discovery also exposed a trust-control issue: deferring an obsolete
energy-model ratio unintentionally discarded actual geometric backtracking
feedback. An isolated correction preserves the original small-alpha rule
while keeping the old energy ratio disabled. Its first actual replay shrinks
the radius after alpha=1/256, but later unboxed directions reveal an omitted
effective-radius reset. The v2 variant matches the existing unboxed reset and
passes six behavior groups; those tests do not confer physical acceptance.
All failed runs, numerical snapshots and original acceptance gates remain.

The full-original-reference-only control also fails its bounded continuation;
changing only the working metric therefore does not explain the obstruction.
Rows 724/725 are body proxy supports for cape_hem vertices 5204/5205. At the
saved numerical origin the existing support residual is about 4.3e-6 and
fails; strain still passes. Independent static SAT identifies triangles 9672
and 9675 as strictly separated from the same, unchanged body convex hull by
an edge-cross-edge axis. The outward-rounded gap is 1.408374e-4, or
1.407397e-4 after the existing rounding guard. Requiring one existing body
facet to separate the entire cloth triangle is sufficient but incomplete.
This is an internal representation restriction, not a frozen-model conflict.
The original-mesh F32 verifier independently finds zero intersections at that
one unadmitted numerical state, strain [.80274017,1.19821112], seam error
9.8344e-8 and zero render-pin error. Neither static result admits a frame or
proves the whole trajectory. An isolated full-convex-support fallback is being
validated with identical obstacle vertices and unchanged physical thresholds.

The fixed-boundary context path also needlessly constructs ordinary guide
rows before discarding them. Direct physical-context construction preserves
the entire returned context exactly, including physical rows and time models;
behavior checks additionally retain temporary correction rows and delegate
moving boundaries unchanged. This removes construction work, not a physical
constraint. Initial micro timings had concurrent application tests and must
not be quoted as isolated whole-frame performance evidence.

Application `npm run check` passes in the runtime permitting subprocess IPC
and local test listeners: 6,742 tests pass, 29 skip and none fail, followed by
lint, boundaries, architecture and asset checks. The initial restricted run
failed because Node spawnSync and loopback listen returned EPERM. This does
not establish V2 convergence, native hardware performance or skipped pixel
validation; the limb-pixel scan remains explicitly skipped.

The isolated `convex_contact_support_sat_v2.py` fallback now separates axis
search from certification. Every proposed plane bounds all original hull
vertices and all three cloth vertices outward. Its norm upper bound scales
the unchanged length tolerance, and quantization terms are bounded outward.
Exported normals have norm upper bound at most one, preserving the original
affine residual guard. Invalid/uncertain axes cannot admit separation. Eight
geometry groups include the actual cape triangles, F32 output, boundary cases,
true crossing despite three exterior vertices, transformations, axis scales,
and cache/pose behavior. The old unit-normal assumption is a general numerical
gap; the saved cape axis had norm below one and was already conservative, so
that assumption is not the cause of this particular failure.

At the identical failed 608 state, original P, q, gradient, physical energy
and all temporal models remain bit-exact. Six obsolete facet rows disappear
because the two triangles have a verified whole-hull separation; the original
support residual falls to zero without moving a vertex. Newly cached support
planes are also included in the isolated original-reference state binding,
including the post-geometry recheck. Fresh 600 replay still certifies with
original update 4.37289169e-10 and unchanged positions.

The matched-origin 608 continuation from numerical-000 remains unadmitted:
120.33795 seconds yield four numerical moves and no physical frame. Main QP
calls account for 54.60010 seconds; complete self/hand path proofs account
for 4.98113 seconds. Other existing profile buckets overlap and are not summed
as exclusive costs. No post-convergence offline body/area audit ran because
convergence failed. A fresh full original-reference solve at the final state
passes its 1e-8 KKT certificate but has unscaled update .002085498697, far
above 1e-7. The independent F32 snapshot check has zero intersections, strain
[.80272384,1.19821819], seam 9.8344e-8 and zero pin error; this is one unadmitted
state, not continuous animation acceptance.

The fresh reference direction requires seven domain backtracks to alpha=1/128
before its actual path and unchanged Armijo pass. The full direction first
fails cape_cloth edge [468,487] against right-hand edge [10507,10510] at physical
step fraction .36476935; the final rejection involves [10510,10532] at
.70662814. This is the remaining nonlinear solver limitation after the body
representation repair. All candidates remain opt-in and production-disabled;
full normal/cancel actions and native realtime acceptance are still open.

The subsequent same-origin reference-ray audit separates the limiting smooth
contact from temporal feature changes. For cape edge [468,487] and right-hand
edge [10510,10532], the fixed-time gap is 1.92353165e-10 and its directional
derivative is -1.99681614e-8. At alpha=1/64, the actual fixed-time gap
-8.52565391e-11 agrees with the quadratic prediction -8.52558822e-11; searching
time changes it only to -8.52589679e-11. The native feature remains interior EE,
with the same controller piece and guard winners. These are diagnostic scalar
searches, not a continuous proof. A contact-normal rank-one working metric
allows alpha=1/16, but gives less merit decrease and a larger remaining original
model decrement than ordinary backtracking; it is not adopted.

Full-reference backtracking without restoration QPs, followed by the existing
working curvature, reaches original updates below 1e-9 at 608. The remaining
rejection is a second implementation defect: F64 direction construction and
F32 residual evaluation select different valid body support planes for
triangles 9672/9675. Residual evaluation changes the cache bound by the freshly
solved reference problem, so the unchanged strict guard correctly rejects it.

The opt-in `convex_contact_support_projection_query.py` evaluates the complete
existing projection on a private copy of the proxy caches. It returns the same
projected geometry and active count without changing direction-construction
state. Isolation must be at `proxy.project`: the actual ExactHands residual
path bypasses `proxy.residual`. The ineffective first variant and its failed
real-state regression remain recorded. Actual-state regression verifies
bit-exact P/q/A/bounds/incremental gradient before and after F64/F32 queries,
bit-exact residuals, unchanged shared current-list identity and fail-closed
NaN handling. Five independent route tests additionally retain true-penetration
and exception behavior. No reference binding or physical threshold is removed.

The local 600-to-608 step now passes its original certificate with raw update
1.65839418e-10 and reconstructed update 1.65839428e-10. Independent original-body
CCD, stored-F32 body enclosure and positive cloth-area enclosure pass. Actual
F32 mesh checks have zero crossings, strain [.80270659,1.19821185], seam
7.75934e-8 and zero pin error. The 600 baseline also remains stationary with
unchanged positions. This is conditional research continuation through
0.633333 seconds, retaining the existing unresolved original-JS evaluation
assumption; it is not full-animation or full-outfit continuous acceptance.
Actual-model stills retain a visible angular piping bend near the right hand;
contact clearance is not a general appearance approval.

The same physical step consumed 500.25526 seconds across this stage's five
continuation attempts, excluding earlier inherited-state work and separate
diagnostics. Its final 17.25154-second admission call is not a cold frame cost.
The subsequent unseeded 608-to-616 solve fails its 120-second budget after
four numerical moves, with boundary error .01439487 still unresolved; QP calls
consume 99.85005 seconds. No 616 or 624 frame is admitted. Full normal/cancel,
continuous original-controller/full-outfit checks and native GPU acceptance
remain open, with no proven external blocker.

Control-flow review also adds a separate v2 step policy: final admission and
final residual work remain inside the shared deadline, and a failed final
Armijo geometry check retains its new witness before raising. Five controlled
tests preserve fresh-origin admission, reject stale certificates and verify
both deadline exits. These changes do not turn an expired proof into a frame.

### 2026-10-29: moving-boundary 616 and omitted static-body trial checks

The saved 616 moving boundary is consistent with the admitted 608 start,
velocity, pins and controller knots. Independent finite differences confirm
the kinematic path and guard derivatives. On exactly the same working QP,
retaining 36 numerical target-plane rows permits a geometrically checked
fraction .79858474; deleting them requires .00037639. Their removal is not
adopted. Neither result is a physical frame admission.

Resuming the old step reaches the complete hand target, but exposes a distinct
design omission: numerical trials certify hand/self paths while static-body
continuous checks run only after convergence. A large accepted numerical move
therefore enters the body. Independent original F32 triangles confirm the
later `cape_back_edge/body` crossing. The first saved crossing starts at
`cape_hem` edges against original body faces; it is not a body-SAT false reject.

The isolated `coupled_ipc_joint_body_path.py` policy applies the existing
original-body F64, stored-F32 chord and replay-envelope tests before accepting
each numerical trial. It uses the shared deadline and clears stale hand
witnesses on body rejection; body indices are not inserted into the hand
feature registry. The independent final body/area audit remains in place.
An actual regression preserves 608 and the safe four-move 616 origin while
rejecting the old penetrating numerical state. Synthetic late-proof and
witness tests plus the existing final-admission deadline tests pass. All are
research checks, not production or original-JS completeness claims.

The revised numerical path reaches the original hand target without that body
penetration. A subsequent actual-F32 snapshot has no crossings, strain
[.81277129,1.19692708], seam 9.15964e-8, and zero pin error. Its full original
reference still has update .01197836 despite valid KKT and feasible geometry;
the snapshot is explicitly unadmitted. Reference backtracking is subsequently
tested with the same joint-body gates, retaining every failure and deadline.

A frozen-QP performance comparison also identifies lazy search-row overhead:
full rows take 4.88055 seconds versus 7.42442 seconds for lazy rows, with both
original 1e-8 certificates passing and objective difference 9.23e-13. The full
policy changes only whether numerical rows are introduced incrementally; it
removes no constraint. Its actual-trajectory experiment still fails the shared
120-second budget. This is a limited solver improvement, not a real-time or
native-GPU result. The checkpoint records the latest independent reference,
failed attempts, cumulative cost, and remaining contact-limited convergence.
Models, controllers, physical thresholds and production defaults are unchanged.

At this stage's final saved origin, a fresh original reference has update
.00578485758, valid original KKT, zero support correction and feasible endpoint
residuals. It still fails 1e-7 stationarity. The independent F32 audit reports
zero crossings, strain [.81318588,1.19344177], seam 8.42940e-8 and zero pin
error. Four joint-body continuation attempts cost 480.03820 seconds, excluding
the inherited 616 attempt, rejected control and diagnostics. No physical frame
after 608 is admitted; the current resume origin is
`joint-body616-original-descent-20261029/frame-616`. A numerical snapshot and a
passing QP certificate must not be substituted for the uncompleted physical
step or the normal/cancel trajectories.


### Unified numerical-trial and physical-admission contract

The acceptance-path audit identifies two further real control-flow omissions:
final admission previously only reported the physical-old-to-final volume
Boolean, and warm/cold recovery did not run the same physical cloth-area
check as ordinary numerical updates. Tiny real-geometry counterexamples
reproduce an interior volume inversion despite positive endpoint volumes and
an interior cloth-area collapse despite allowed edge lengths. These are
implementation defects; they are not new user constraints or evidence that
the actual 616 origin is infeasible.

The opt-in `coupled_ipc_verified_trials_v3.py` owner now gates ordinary updates,
target progress, warm/cold recovery and final-reference queries through the
same physical-start-to-candidate contract. It includes original hand/self and
body paths, physical volume and edge bounds, rendered cloth-area enclosure,
physical pins/centroid, and declared CPU replay bounds for seam and render-pin
witnesses. A ticket binds the physical origin, current numerical state,
velocity, target, topology, mappings, candidate and boundary before commit.
Recovery preserves physical history and new contact features; unconverged
iterations preserve the admitted incoming velocity. Independent final body,
area and actual-triangle checks remain separate. This does not prove original
JS/controller/GPU evaluation or replace full attachment-patch acceptance.
Inactive historical SOC runners are not certified by this change.

`trial_attempt_evidence.py` gives repeated iterations distinct evidence paths,
persists pre/post-recovery and rejected candidate states, and serializes a
private owner copy. Nested body timeouts retain partial proofs. The current owner
also clears previous-body proof metadata before early structural exceptions,
so an untested candidate cannot inherit the preceding trial's body certificate.
Six controlled flow regressions plus the early-error evidence test pass.
Real-state checks preserve admitted 608 and reject the known old penetrating
616 state. Fresh original-reference and common-path checks preserve both 600
and 608: actual updates 4.37289e-10 and 1.65839e-10, respectively. These are
local research regressions, not complete normal/cancel admission.

A same-origin convergence experiment adds only a PSD time-peak curvature
predictor, leaving energy, gradient, every temporal row and physical constraint
unchanged. Frozen P/A/q/bounds/origin equality is checked. Both original and
predictor directions require 1/512 under complete contact checks. The predictor
reduces energy by 5.32595e-6 versus 5.35581e-6 and costs 22.27889 versus
21.25782 seconds. Fresh original updates are .00292701 versus .00293538;
both fail 1e-7. That small reference difference establishes no useful gain,
and the predictor is not adopted. The comparison does not rule out time-peak
curvature at other states. Safety restoration and original stationarity remain
separate requirements; no numerical trial in this comparison admits frame616.


Finalization audit also reproduces a late residual exception/timeout after
`self.v` was already changed to the outgoing physical velocity. The actual
resume serializer still wrote the incoming physical velocity, so persisted
resume data was safe; raw in-memory finalization was not transactional.
`verified_trial_trajectory_step_v2.py` computes prospective velocity locally
for the reported energy/speed and commits it only after the final measurement
and deadline check. Six old/new success, exception and timeout comparisons
verify failure rollback semantics and unchanged successful reports.

The rejected-contact callback previously saved before caller-side witness
retention. Its candidate snapshot needed the running log to identify the
rejected primitive/time. The current owner stores mode, fraction, witness and
current retained-domain rejection directly in that snapshot, clearing previous
trial metadata at entry. Actual serialization tests cover mesh witnesses,
barrier-domain witnesses and early exceptions, including NumPy IDs. This is
an evidence repair, not a new contact acceptance rule. The final opt-in runner
is `run_verified_trial_original_refinement_v4.py`; older evidence sources are
immutable and their specific scope is retained.


The final runner replays the admitted 608 origin through the complete call,
including independent final body/area and actual F32 audit, with unchanged
position and original update 1.65839e-10. Three 616 continuations take
226.57588 seconds in this stage alone and accept eleven safe numerical moves;
none admits the physical frame. The latest saved original reference is
.00214167362 against 1e-7, with all original QP KKT residuals below 1e-8.
Actual F32 endpoint crossings are zero, strain [.81329728,1.19314813], seam
7.75934e-8 and pin error zero. The last candidate exhausts the shared deadline
inside body-path proof; its partial proof and rejected candidate are retained.
The resume origin is `verified-trial616-continuation-20261029/frame-616`.
Remaining convergence restrictions include retained EE barrier-domain contacts
near physical phase .0016 and changing segment-strain cuts. No independent
infeasibility proof or user-freeze conflict has been established.

Application `npm run check` passes 6,742 tests with 29 skips, and integration
passes 71 tests, after a restricted-sandbox run was retained as failed due to
local socket/Node child-process EPERM. The complete foundation run passes all
but one cloth-probe test, whose subprocess lacked osqp. Repeating only that
55-test stage with the task's existing dependency paths passes all 55; combined
stage evidence covers 875 passing tests, while the original full-run report
remains marked failed. Functional tests do not pass the open physical gates.
Full normal/cancel, original-JS/full-outfit continuous and native GPU/frame-rate
acceptance remain open. All twelve frozen source hashes are unchanged.


### Fixed-origin nonlinear feasibility correction evidence

At the saved 616 origin, the unrestricted original direction is blocked by
retained EE open-domain checks and accepts only 1/64. Current gaps are positive;
the open-domain tangent cone is therefore full space. The studied origin rows
`a*delta >= 0` are conservative numerical margin restrictions, not new physical
constraints. They differ from old failed trial-tangent restoration, but are a
stricter variant of previous origin guidance. Guard-aware two-sided samples
separate distance and guard-square variation; no relevant guard jump occurs
in these probes. This is a local differential diagnostic, not a neighborhood
or continuous-time proof.

Four rejected trials of the margin-guided direction have positive linear gap
prediction and negative actual gap, with unchanged interior EE closest type.
For the first, independent Fraction geometry gives original gap 2.5619191e-19,
linear prediction +4.2358870e-19, second-order distance term -7.5444049e-19,
and actual gap -3.3085237e-19. The second-order remainder is -5.85e-25;
one-ULP bounds on the reported squared guard preserve all signs. Independent
segment minimization agrees with the line triple-product formula and strictly
interior closest parameters. This supports a smooth geometric-curvature
mechanism, rather than native gradient degeneration at these saved points.
It does not imply an omitted term in the objective Hessian itself.

The bounded comparison leaves the same original P/q/linear constraints and
four norm cones unchanged. Three origin rows are followed by four trial
linearizations targeting the current-origin gap; all preserve the zero
increment. Original 1e-8 certificates are required for each augmented QP, with
actual reconstructed F64 row residuals checked. These certificates never count
as original stationarity. Full physical contact/strain/area/volume/seam/pin
checks and a fresh unguided original reference remain mandatory.

| Same-origin alternative | Safe fraction | Actual energy reduction | Fresh original update |
| --- | ---: | ---: | ---: |
| Original direction | 1/64 | 1.2708162e-5 | .0020421512 |
| Three margin rows | 1/16 | 4.1669304e-5 | .0020986608 |
| Plus nonlinear correction rows | 1/4 | 1.5008873e-4 | .0018933406 |

All three fail the 1e-7 stationary gate. Corrected-state actual F32 triangles
have no intersections, strain [.81323127,1.19295035], seam 7.75880e-8 and zero
pin error. Isolated replays take 22.10,21.05,19.95 seconds, respectively; these
exclude prerequisite direction/witness/correction preparation. The explicitly
executed control, margin, correction and correction-assembly pipeline totals
69.63 seconds before fresh references, with repeated setup. It is not a measured
integrated solver, and establishes no end-to-end speedup or real-time result.
The first margin invocation's longdouble report-serialization failure remains
recorded; its compute time is unknown. A serialization-only repeat supplies the
usable comparison. The declared ceiling of three correction-QP invocations,
including that failed-report run, is retained.

Returning the corrected state to the unchanged ordinary driver accepts three
more safe numerical moves, then rejects the fourth QP in 79.57351 seconds:
original dual residual .00162092433 exceeds 1e-8 despite native `optimal`
status. Primal, cone and complementarity residuals alone cannot admit it. A
reported 24-coordinate Hessian block ranges from49.8053 to4.82429e16. Whether
this is an original-scale representation/refinement limit needs independent
frozen-QP analysis; it is not proof of physical infeasibility. The last retained
origin independently remains geometry-safe, but its failed direction's update
is not a stationary certificate. The recommended certified-QP numerical origin
is `tangent616-current-nonlinear-correction-20261029/frame-616`; the subsequent
failed-QP origin is separately retained for diagnosis.

No generic automatic correction policy is installed by this experiment. The
complete acceptance implementation, twelve frozen files and production default
are unchanged. Last admitted physical time remains .6333333333; normal/cancel,
full-outfit/original-JS continuous and native performance acceptance remain open.

### Original-QP precision and integrated correction audit

The following stage isolates two numerical implementation defects in the saved
616 QP without changing its original H, q, affine bounds or norm cones. The
reported condition near9.69e14 belongs to the eigenvalue ratio of an unscaled
24-coordinate H subblock at QP generation4, before the interior-point W
iterations. It is not a full-KKT condition estimate or physical infeasibility
evidence. The reduced system retains1034 of2330 exactly duplicated affine rows,
603 equalities of observed rank603,49 epigraphs and4 norm cones.

Independent90-digit products distinguish scaled native stationarity from
original-coordinate stationarity. The original `D.T H D` construction has
cancellation error6.32164e-7 when applied to the first native solution; q and
row/dual-map errors are approximately1e-18 and3e-17. Native stationarity is
3.96e-16 while original stationarity is3.22. After recentering, congruence error
2.66888e-10 still corresponds to original residual .00162. Saved full native
KKT systems retain W and every RHS. Their final original-W linear residual is
approximately1.02e-17; the callback returns W*u_z as required. A known dyadic
solution test improves from7.78e-6 to3.46e-21 residual with one high-precision
residual/accumulation correction using the same LU. These are linear-system
diagnostics, not final-QP or physical certificates.

Reconstructing cancellation-prone congruence entries at90 digits reduces the
metric action error to2.03e-17, but that alone fails the original certificate.
Wide-precision translated coefficient construction and single-component
recombination still lose necessary bits. The adopted isolated precision path
also constructs H*origin+q, A*origin and norm offsets at90 digits and retains
the solution as two longdouble components. Native translated coefficients are
still rounded; a fresh complete unshifted original KKT certificate is decisive.
The unchanged frozen QP then passes: dual3.79065e-10, primal1.64e-26 and
sum-complementarity7.36e-14. The15.24-second replay is not real-time acceptance.
The precise-metric-only local block correction violates primal tolerance and
remains a rejected alternative.

The expanded QP witness and rounded execution proposal have separate reports.
Problem coefficients, both primal components and all duals are hash-bound;
snapshots preserve both components. Original reference admission uses an upper
bound on the expanded raw update, the actual F64 update, current-state binding
and the complete geometry contract. A certificate is never transferred to a
single-component value that fails its own stationarity test. Mutation, stale
generation, snapshot round-trip, exact-sum and update-bound checks cover this
boundary. The608 baseline still passes with actual update1.65839e-10.

The isolated integrated predictor now tries at most two temporary numerical
QPs per unchanged origin: current-gap rows, then trial-linearized correction
rows. All original rows remain; zero direction is retained, actual F64 row
residuals are checked and original merit/complete geometry gates decide each
trial. These numerical rows are discarded after the call. A new original QP
is mandatory before stationary admission. At the first frozen origin this
selects a full step with4.46 times the ordinary backtracked energy decrease.
Two accepted updates followed by four bounded continuation updates improve the
fresh original update to .000226179835, still above1e-7. One predictor loses its
geometry certificate on final recheck and is rejected; another attempt times
out under the shared180-second budget. Neither is admitted. This remaining
trial-domain consistency/convergence question is retained for investigation.

The latest actual F32 snapshot passes contact, strain, seam and pin checks;
the fresh original QP and complete conditional CPU physical path also pass.
No physical616 frame is admitted. The precision-only control costs72.53 seconds
for3 numerical moves; integrated runs cost91.86 seconds for2 and180.86 seconds
for4 moves plus unfinished work. These include correction attempts and safety
checks; overlapping profile buckets must not be added. Exported snapshot
verification time is not frame runtime. Full normal/cancel, complete original-JS
and outfit continuous proof, and native GPU/stable performance remain open.
All implementations stay in isolated research drivers; production default and
the12 frozen source files are unchanged. Evidence is indexed by
`precision616-20261029-checkpoint.json`.

### Retained-response domain closure and conditional frame616 admission

The next audit reproduces a cold/warm domain inconsistency at the same exact
candidate, boundary, physical origin and radius. The scalar response search
passes until a previously found EE time is retained. Independent rational
segment arithmetic at that time gives gap-squared -7.86096849e-18 for
EE[444,463,10469,10470]. This is a failed declared barrier domain, not evidence
by itself of an actual triangle intersection. Radius implementations agree;
the new witness does not change energy, its derivatives or the physical model.
The scalar search missed a narrow negative interval. Earlier sampled-domain
successes therefore cannot establish continuous open-domain coverage.

The isolated v3 domain query proves every retained EE/FV/EV source primitive
on all eight original response pieces with outward interval bounds. Center and
radius arithmetic enclosures are charged only to the proof, not to runtime
geometry or guard values. Missing proof rejects; no unresolved interval is
labeled a proven intersection. It validates full operand layouts and supported
implementations before any empty-set success. The old counterexample fails
with cold and warm caches, cannot obtain a commit ticket, and leaves x/v and
boundary unchanged. Seven domain behavior groups,41 input-boundary cases and
the real acceptance counterexample are preserved. Frame608 still passes the
new full contract at original update1.65839e-10.

A same-origin direction comparison isolates another search limitation. Nine
related time-envelope families around cloth edge[467,486] and hand vertex11254
switch active affine branches around alpha .993-.999. Their finite QP model
predicts increasing energy past the unit step, whereas the actual energy keeps
decreasing to alpha16 with complete geometry/domain checks. All original affine
and norm constraints remain feasible there; two tight norm constraints reach
their ray boundaries around16.19 and17.42. This does not authorize removing
families or interpreting a finite bundle increment as the true energy derivative.

The bounded isolated search now tests expansion only after an ordinary full
step at a fixed target, without newly added features or a nonlinear correction.
Each selected trial must satisfy the complete contract and original merit test;
a failed later probe causes a final recheck of the selected candidate. A fresh
unrestricted original QP at the new origin remains mandatory. Four expansion
probes are the maximum;32 seconds limits starting another probe, not a hard
completion bound. Every call and final recheck remains under the shared physical
step deadline and counts as runtime. Seven policy boundary tests cover rejection,
final-recheck failure, energy deterioration and deadline propagation. A discovered
profile-key reporting exception is retained in the first run; the next version
uses a zero baseline for newly added counters without weakening physical gates.

Frame616 (.6416666667s) now passes conditional research admission after the
precision/domain/correction/search changes: raw reference update3.42150999e-8,
actual F64 update3.42150999e-8, original dual5.42899756e-9, primal1.14e-23,
cone0 and sum-complementarity4.45659e-11. The actual source F32 mesh has zero
reported contact intersections, strain[.8137137162,1.1938945405], seam8.00937e-8
and zero pin error. Independent body replay and area checks pass. Diagnostic
front/contact/back stills use the actual stored source mesh; they are not the
complete V2 renderer or a native performance test.

The last resumed phase takes120.940806 seconds, including all four QP calls,
three numerical moves and the complete acceptance checks. Its independent
post-solve body/area audit takes .526131 seconds. This is not the cold solve
cost of frame616: earlier unsuccessful and partial invocations remain in the
checkpoint. No realtime claim follows. Original native tolerance remained1e-10;
the later update below1e-7 refutes a hypothesized fixed1.8e-6 accuracy floor, so
an additional strict-tolerance QP replay was not run.

Automatic continuation to frames624/632 preserves the new616 seed but stops at
624 (.65s) after six bounded iterations/84.675201 seconds. Prescribed boundary
motion is incomplete, with real retained-EE open-domain rejections;632 is not
run. This is not proved infeasibility or a hardware blocker. The unrestricted
adapter removes22 already constructed numerical target-guide rows during the
moving-boundary search; an isolated same-origin comparison is needed before
adopting those rows for direction construction. Final original stationarity
must still remove all such rows. Full normal/cancel paths, cold replay of this
complete method, original-JS/full-outfit continuous proof and native realtime
acceptance remain open. No model/controller/baseline, production default,
commit, push, packaging or recording changes accompany this stage.

The624 same-origin comparison subsequently completes: original-only search first
passes the full physical contract at1/256 of its target direction (19.818s);
retaining the existing22 numerical guide rows passes at1/8 (27.581s). Both use
the same saved state and original metric/physical constraints; neither advances
state. The integrated isolated adapter uses those rows only while the boundary
is moving and marks its certificate explicitly non-reference. At the exact
full target it strips the rows and restores the unrestricted original QP.
A zero guided direction cannot trigger stationarity. Analytic-fixture tests
exercise the actual precision wrapper, adapter, full certificate and snapshot
binding, while mocking only the native numerical answer.

Integration initially fails after a valid QP because the observer equates every
non-reference solve with a trust box. No move is committed. Its replacement
reads the actual current construction flag; nonzero primal/dual fixtures confirm
that observation leaves the solve unchanged and classifies all three branches
correctly. The next bounded integrated attempt reaches the exact624 target
(boundary error0) through verified moves, then switches to the original reference
and accepts one fixed-target update. It remains unadmitted: the latest original
unscaled update .01955212444 exceeds1e-7. Six iterations take124.744159 seconds.
This establishes moving-target progress, not stationary/frame completion or
real-time suitability. `tube616-20261029-checkpoint.json` records both the admitted
616 seed and separately retained unadmitted624 state.


### Deferred contact feedback and explicit path identity (2026-10-29, isolated)

A further fixed-target624 continuation remains unadmitted after180.128786s.
New support times discovered during ordinary backtracking changed the model
before the same-origin nonlinear correction could run. The ordering candidate
collects those rejections first, attempts the already bounded correction against
the still-current original QP, then retains every witness and refreshes forces
before complete geometry/merit revalidation. No new physical frame is admitted
without a fresh unrestricted original reference at its final state.

At one identical saved origin, ordinary1/256 and corrected1/8 trials both pass
an independent complete geometry recheck. Energy decreases from.113517803378
by.000051244272 versus.001027939450 (20.059597 times). The correction costs
16.420563s in addition to the original QP/search. This is a same-state local
search result, not a physical-frame, cross-frame or realtime pass. The initial
diagnostic's outer JSON writer failed on a numpy boolean; its inner evidence
and saved trials are intact, and a separate no-QP replay verifies both trials.

A flow audit found two lost-feedback exits: a helper's final selected-trial
rejection lived outside its reported trials list, and ordinary search exhaustion
raised before insertion. Geometry remained fail-closed, but these witnesses
were absent from retained history. The new PendingContacts owner records every
complete-trial rejection through the common evidence callback, drains before a
fresh QP and after the correction, and preserves unconsumed records on timeout.
Its resume sidecar binds the path, checkpoint metadata and all state payloads;
missing evidence is allowed only for an explicit legacy migration. The complete
geometry ticket still controls numerical commits, and only final fresh original
stationarity controls physical velocity. Seven mocked-flow cases and seven
save/resume cases exercise these boundaries; they do not prove real-model
convergence.

The canonical path constructor previously consumed times without retaining
owner attributes; the legacy reference digest therefore did not explicitly bind
them or all knots/coefficient operands. Fresh-owner usage and independent trial
checks prevented a demonstrated false admission, but the isolated path contract
now binds actual operands, implementation identity, and explicit restore
provenance. A first real616 integration exposed a defect in this new audit code:
marshal serialization of code objects changed after an ordinary bind with no
path/numeric change. That failed version is retained and must not be used.
A stable semantic code identity requires actual bind-lifecycle regression before
any further numerical use; resetting the frozen fingerprint is not a fix.

Full-path coverage remains an implementation gap: the present analytic enclosure
and exporter cover normal entry only below1.2s. Both normal and cancel02 acceptance
still require the original9s endpoint. Cancel02 changes its curve at.2s and.8s;
its derivative jump must be enclosed or split explicitly. A controller reporting
cancellation done at.8s does not authorize truncating the9s acceptance trajectory.
Original-JS/full-outfit continuous proof and native GPU realtime remain separate
open gates. These gaps do not require altering the frozen source model/controller.


Stable semantic path fingerprints now pass six real response/proof binds,
actual temporal-contact cache miss/hit, unchanged physical/reference operands
and genuine method/default/closure mutation rejection. The path-bound616
baseline reproduces the original reference exactly (raw3.42150999e-8,
dual5.42899756e-9) and passes complete geometry plus actual F32 mesh checks.
Its24.073402s runtime is revalidation of a saved stationary state, not a cold
physical-frame solve.

The integrated ledger/deferred-correction624 run completes six verified numerical
updates before its240.083547s budget is exhausted in contact-family closure.
Three corrections improve on their ordinary trial; no current-frame branch or
threshold is introduced. Energy moves from.113517803378 to.111552751010.
The last completed original QP, evaluated BEFORE the final numerical move, still
has raw update.012099340887; no fresh original stationary certificate exists
at the last saved iterate. The target is fully reached, positions are finite,
incoming physical velocity is unchanged, and its independent actual F32 snapshot
has no reported contact/strain/seam/pin failures. This remains an unadmitted
numerical state. The final path-bound checkpoint and pending-ledger hashes validate.

Measured runtime includes110.357622s of QP wall time (six original and six
helper QPs),84.260887s in complete trial contracts, and45.465038s in remaining
assembly/energy/check/evidence operations. The helper QPs do not emit the outer
convexSolveWallSeconds event and must be counted separately; adding the entire
helper duration would double-count its geometry and energy work. Nested native,
factorization and certificate profiles cannot be added again. The post-solve
F32 snapshot audit is separate. This is still far from realtime.
