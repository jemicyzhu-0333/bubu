# Coupled cloth correctness and design audit

**Production acceptance remains false.** Research checks passing does not
close the normal tea trajectory, real-time cloth, complete wardrobe contact,
continuous/self-contact or native GPU gates.

The owning capability is the isolated secondary-motion cloth probe. It writes
only caller-selected external evidence; no application state, production
registry, frozen model, source controller or canonical attachment catalogue is
changed. The branch is `feature/pet-animation-v2`, based on
`c0a8281bbc721f1f7d01afdb0ece6920aebc90f9`. All changes remain uncommitted.

## Evidence location and reproducibility

The external evidence root is
[`/workspace/artifacts/bubu-v2-coupled-solver-20261025`](/workspace/artifacts/bubu-v2-coupled-solver-20261025).
Its [`checkpoint.json`](/workspace/artifacts/bubu-v2-coupled-solver-20261025/checkpoint.json)
records running and completed experiments separately. Source snapshots,
per-step streams, rejected trials and hashes are retained there. Historical
Rapier failures and native snapshots remain in the
[front-contact index](../front-contact-20261025/EVIDENCE-INDEX.md).

For the current portable research solver, follow the isolated dependency and
export commands in the [probe README](../../secondary-motion/cloth-probe/README.md).
Use `--method newton` without `--accelerate`, run both `--path normal` and
`--path cancel02`, and independently run `coupled-verify.mjs` on each output.
Use new external destinations. Both requested horizons are nine seconds;
prefixes and isolated state replays never count as complete actions.

The older exact-barrier results use `exact-newton-source/`, whose manifest
preserves the pre-rounding-fix implementation. Later experiments have distinct
source directories and hashes. Do not describe one candidate's result as
another candidate's acceptance.

## Implemented research corrections

- Collision and display use one affine material-displacement map, preserving
  all frozen rest vertices. The cage retains 1,983 particles, all 3,760 cells,
  8,364 material edges, 201 center relationships and 364 section groups.
- Consistent cell, section and edge gradients replace the projective surrogate
  in the explicitly selected Newton comparison. Positive-semidefinite
  curvature, a joint position QP, fixed supports and all material constraints
  remain part of one solve.
- The volume barrier includes the determinant's second derivative. The saved
  tangent-collapse regression has zero first-order volume change but negative
  second-order change; a gradient outer product alone misses it.
- Float32 edge bounds and contact bounds reflect the actual output buffers.
  Contact bounds include conversion on both surfaces and the linear-solve
  tolerance. They do not enlarge collider geometry or relax any acceptance
  threshold. The original hem/left-hand intersection at 0.608333 seconds is
  reproduced with a double gap near zero and a float gap of about -3.43e-8.
  The corrected isolated replay has zero original-triangle intersections.
- Independent verification now measures matching rendered support vertices,
  in addition to physical pins, actual edges and seams. It explicitly lists
  unmatched supports instead of claiming that fixed particles prove fixed
  visible attachments.

These are disabled research implementations, not an application cloth mode.

## Complete cancellation result and its limits

`exact-full-cancel02/` completed all 1,080 steps to nine seconds, with all steps
converged and finite. Original body, hands and all cup surfaces against actual
cloth, both front edges, back edge, hem and clasp have zero sampled crossings.
The independent result is `exact-full-cancel02/actual-contact.json`.

| Gate | Measured result |
| --- | --- |
| Physical/mapped edge ratios | 0.897494–1.170989, within 0.8–1.2 |
| Actual float32 edge ratios | 0.971394–1.113952, within 0.8–1.2 |
| Maximum actual seam gap | 9.94e-8, below 1e-5 |
| Physical pin motion | Zero |
| Matching rendered pins | 25 witnesses, zero motion |
| Minimum signed volume ratio | 0.250264, positive |
| Straight interpolation cell orientation | Positive for every interval |
| Full normal action | **Failed separately** |
| Stable real-time performance | **Failed** |

`render-pin-audit.json` preserves the full-stream pin measurements and hashes.
`exact-cancel-midpoint-audit/` additionally checks all 1,080 interpolated
midpoints against the original controller. No contact, strain or seam failures
were found there. These additional samples are **not a continuous surface
certificate**. Diagnostic actual-model stills are in `verified-stills/`; they
are not a replacement animation demo.

The current float32 contact correction's separate regression,
`precision-full-cancel02/`, also completed all 1,080 steps. All steps converged;
independent original-mesh intersections are zero, physical edge ratios are
0.897494–1.170989, actual edge ratios 0.971394–1.113951, maximum seam error
1.025e-7 and matching rendered pin motion zero. These results belong to this
specific source snapshot, not to the newer exact-hand experiment below.

Two subsequent certificates cover all 1,080 intervals of this cancellation
replay, conditional on linear interpolation of the actual float32 output
buffers and a bounded final float32 conversion. `static-body-replay-certificate.json`
separates the dynamic cloth/trim from the original static body; its fitted
body hull contains the original vertices with an 8.991e-6 margin.
`hand-cancel-replay-certificate-v2.json` covers every original garment part,
including the clasp, against both original moving hands using analytic bounds
on the frozen controller. All three cup surfaces are provably invisible on
this branch. Neither certificate covers normal tea, arbitrary simulation or
GPU interpolation, self-contact or the complete wardrobe. The body certificate
does not include the fixed clasp. Conservative hand hulls are valid for these
separation certificates; that does not make them accurate response colliders.

## Failed normal paths and bounded redesign experiments

All original strain, seam and pin thresholds remain 0.8–1.2 and 1e-5. The
adaptive trials count all accepted substeps and rejected work against the same
120 Hz tick budget. Their minimum declared step is 1/960 second. No rejected
trial is silently accepted, and no original cell or collision is deleted.

| Evidence directory | Last saved step, not acceptance | Failure |
| --- | --- | --- |
| `exact-full-normal` | 0.616667 s | Frame interpolation reverses cell orientation; next step at 0.625 s exhausts the positive domain. Original f32 hem/left-hand crossings occur at 0.608333 and 0.616667 s. |
| `precision-full-normal` | 0.608333 s | All 73 endpoint samples have zero actual intersections, but cell 2559 reverses during the last interpolation interval. |
| `adaptive-full-normal` | 0.608333 s | At 0.609375 s, strain, convergence and interpolation orientation fail even at the minimum step. |
| `adaptive-globalized-normal` | 0.609375 s | At 0.610417 s, the local QP reports infeasibility. Merit line search improves iteration control but does not close the trajectory. |
| `adaptive-compressible-normal` | 0.608333 s | Compression-energy comparison, with matching rest tangent stiffness, still fails at 0.609375 s. Not adopted. |
| `adaptive-surface-support-normal` | 0.589583 s | Fifty-one anchors on actual source-surface material points pass swept support clearance, but interpolation reverses a cell at 0.590625 s. Not adopted. |

The compression comparison preserves its derivative/rest-stiffness checks in
`compressible-derivatives.json`. Surface anchoring retains all 51 logical
supports and all cells; it corrects up to 0.000507 of internal point-to-surface
offset without changing source geometry. Its failure demonstrates that this
binding correction alone does not solve the coupled motion.

`adaptive-clasp-diagnostic-normal/` is a **constraint-isolation diagnostic**:
only the two clasp-side supports remain fixed. The removed 49 constraints are
declared in `clasp-support-diagnostic.json`; this experiment cannot count as
acceptance of the existing 51-support design. It was stopped after retaining
its nonconvergence witness and logs; 55 timestamped rows end at 0.3625 s.
Unindexed stream records are not claimed as verified frames. No default
binding changes.

The local conflict audit identifies right-hand contact near back-edge vertices
3356, 3357 and 3369, center relationship 23, and cells 2556/2559 around internal
support 1306. The OSQP infeasibility certificate is numerically insufficient.
An independent HiGHS solve finds a feasible **linearized** solution, but even
minimizing its maximum coordinate change requires about 6.12 units. Neither
result proves global nonlinear infeasibility of the frozen models. See
`infeasibility-audit.json`, `infeasibility-independent.json` and
`constraint-conflict-isolation.json`. Removing constraints in the latter is
diagnostic only, never a passing candidate.

## Original-hand collider defect and bounded repair

`minimal-cell-counterexample.json` preserves the exact interval [0.6, 0.608333]
and cell 2559. Both endpoint volume ratios are positive, but the exact cubic
has minimum -0.0665078 at time 0.604324. Support 41, particle 1306, is involved.

`hand-hull-gap-audit.json` identifies a concrete representation error: at
0.608333 this support is outside the original right hand with surface distance
0.034533, while the response hull reports depth 0.006795. The original hand is
nonconvex; its hull encloses 20.25% additional volume. A hull-filled concavity
therefore forces artificial cloth motion. This is an internal collision
implementation defect, not evidence that the frozen source model or controller
must change. The attempted star-shaped tetrahedral fan has no positive kernel
for either hand and was rejected in `hand-kernel-fans.json`.

The external candidate `exact-hand-contact-service.mjs`, `exact_hand_contact.py`
and `exact_hand_newton.py` uses every original hand triangle, closed-surface
containment and whole-triangle crossing checks. It discovers contacts before
accepting a Newton trial and derives separating planes from the geometry
before penetration. Source models, controller, all 51 supports, cells and
original thresholds are unchanged. The first API error, unprotected QP failure
and post-penetration-plane oscillation are preserved; none was adopted.

The single-step `exact-hands-reference-witness/` converges in 10 iterations at
0.608333, with actual edge ratios 0.820942–1.188495, seam 7.768e-8, zero matching
pin motion, positive cell interpolation and zero independent original-triangle
crossings. `exact-hands-failure-window/` then reaches 0.616667 and 0.625 with
converged, positive-interpolation steps and independent endpoint contact,
strain, seam and pin checks passing. These are three bounded replay steps,
not a complete normal action. Actual diagnostic front/back images are in
`exact-hand-stills/`; four real-geometry behavior checks, including a crossing
triangle whose three vertices are all outside, are in `exact-hand-contact-tests.json`.

**The candidate remains disabled.** `exact-hands-window-interpolation/` finds
14 actual hand crossings among 21 interior samples over these three intervals.
The first is at 0.609375: cloth/both hands and hem/left hand. Thus the endpoint
repair does not establish continuous contact. This counterexample motivates
constraints on the hand trajectory within the same physical step; increasing
the number of output samples alone is not a fix. All newer candidate code is
external research evidence and is not imported by the application or included
in the earlier passing repository test totals.

The three exact-hand steps cost approximately 14.0, 45.7 and 19.0 seconds each,
including candidate contact queries. They fail the runtime budget by orders of
magnitude. Different background loads prevent a claimed speedup over the
earlier instrumented run.

### Frame-interior correction, still not admitted

The next experiment retains the seven interior hand poses as constraints on
the same endpoint unknowns, including their affine time weights and float32
conversion bounds. Restarting that contact set at every Newton iteration
oscillated; keeping all roughly 12,000 rows in every OSQP solve repeatedly
reached its iteration limit. Those two trials were safely stopped with their
last states and logs preserved (`temporal-stop-request.json` and
`temporal-working-set-step/`). They are not passing trajectories.

`contact_working_qp.py` instead adds violated rows in bounded batches and
rechecks **every original inequality** after each QP. It retains all material,
pin, seam, volume and acceptance limits. This is constraint generation, not
discarding contacts. The recorded final solve selects 64 of 12,255 contact
rows; the maximum full-system violation is 1.39e-16, with no omitted violation.
The largest selected set in the step is 256 rows. See
`temporal-row-generation-audit.json` for all 20 QP checks.

`temporal-row-generation-step/` converges at 0.616667 in ten outer iterations,
with positive cell interpolation, actual strain 0.834937–1.187444 and zero
independent endpoint intersections. `temporal-row-interpolation-audit/` checks
31 interior actual-float32 samples, 24 not used by the solver: all contact,
strain, seam and matching-pin checks pass. This closes the saved sampled
0.609375 counterexample for this bounded replay. It does not replace a full
normal/cancellation rerun or prove arbitrary times. The step still takes
16.05 seconds, far outside the runtime budget.
The first former interior failure at 0.609375 is also reconstructed from the
actual float32 buffers in `temporal-first-witness/` and inspected from front
and back in `temporal-first-stills/`, with no observed tear or spike. These are
diagnostic views of frozen geometry, not a complete-character animation demo.

The explicit continuous-proof attempt remains **unresolved**. In
`temporal-hand-continuous-certificate-v2.json`, the first depth-28 interval has
measured pair distances around 9.8e-8 but conservative motion/conversion bounds
of 3.1e-7–4.1e-7. That negative certificate margin is not a measured penetration.
The sixty-second diagnostic stops without claiming certification. A sharper
local rounding/motion enclosure or a certified continuous collision constraint
is still needed; more ordinary samples cannot establish this gate.

The prototype protocol now rejects mismatched source inputs or omitted render
triangles before starting its owned child and bounds a geometry query at thirty
seconds. `exact-hand-contact-protocol-tests.json` has six focused checks. The
physics evidence above used the pre-protocol adapter, preserved byte-for-byte
as `exact_hand_contact_pre_protocol.py`; the transport hardening does not
retroactively extend earlier test or physics coverage.

To reproduce just this one temporal step into a **new external directory**:

```sh
PYTHONPATH=/workspace/artifacts/bubu-v2-coupled-solver-20261025/deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 /workspace/artifacts/bubu-v2-coupled-solver-20261025/reproduce-temporal-hand-step.py --output /workspace/artifacts/NEW_UNIQUE_REPLAY
node research/animation-0.1.0/animation-foundation-v1/secondary-motion/cloth-probe/coupled-verify.mjs /workspace/artifacts/bubu-v2-coupled-solver-20261025/inputs-portable.json /workspace/artifacts/NEW_UNIQUE_REPLAY
```

Run the verifier command from the repository root. The reproduction refuses
an existing output directory, uses the saved initial state and frozen inputs,
and remains a bounded diagnostic. No new full validation, video or delivery
package was launched during this execution-health/minimal-reproducer phase.

## Performance and remaining implementation scope

The sequential same-state replay in `profile-baseline/` and `profile-precision/`
retains the same initial-state hash. Other validations were running, so these
are instrumented CPU diagnostics, not a stable-frame-rate benchmark.

The precision-corrected step takes about 18.64 seconds wall time / 15.31 seconds
process CPU time, versus 11.61 / 9.35 seconds for the prior step. It needs 40
outer iterations instead of 25. Approximately 57% of corrected wall time is QP
solve, 26% cell/section/edge assembly, 6% QP setup and 6% contact constraint
queries. Output mapping/strain measurement is about 1 ms. This is a correctness
fix with a performance regression, not a speedup.

The 120 Hz physics share is 8.33 ms; two ticks share a 16.67 ms display frame.
The solve alone exceeds both budgets. Initialization, I/O, independent triangle
verification, GPU work and display submission are excluded from those replay
times and must not disappear from a future complete runtime measurement.

Normal-path material/contact/orientation coupling and efficient execution remain
implementation gaps. Native GPU availability does not explain those defects.
Continuous dynamic cape/satchel contact, containment, self-contact and complete
wardrobe admission remain unestablished. Existing 481 sampled outfit poses
retain zero crossings; only three common rigid headwear pairs have the earlier
conditional continuous certificate. Windows/macOS native input, hardware GPU
memory/recovery and stable hardware frame time remain **not run** here.

## Verification and saving

- Root `npm run check`: 6,742 passed, 29 existing skips, zero failures.
- Root integration: 71 passed.
- `/tmp/bubu-coupled-precision-verify-20261025/summary.json`: all 37 stages and
  875 Node tests passed; source hashes unchanged; productionAccepted=false.
  The coupled Python wrapper runs 17 numerical/geometry tests.
- Browser verification used SwiftShader. Its software-frame P95 under concurrent
  validation was about 456 ms, failed; it is not hardware GPU evidence.
- `frozen-hashes-precision.json` rechecks all 12 frozen files unchanged.
- `source-backup-precision-audit.json` verifies the 611-file worktree archive
  member by member. Subsequent documentation is retained in the live worktree;
  the final checkpoint names the newest verified archive.
- Later execution-health work changed this evidence index and external
  candidates only; no new full repository test run is claimed. The six protocol
  checks and bounded geometric audits are listed separately above.

No commit, push, publication, deployment, video recording or new demo package
was performed. Existing delivery artifacts and failed counterexamples remain.

## Runtime and nonlinear acceptance audit

The subsequent work is isolated under the external evidence root's
`performance-stage/` and `ipc-stage/` directories. It does not register an
application solver. All candidates remain disabled, and the earlier complete
cancellation results do not transfer to these implementations.

`performance-stage/cost-ledger.json` separates the measured runtime from the
independent verifier. On the same saved state, lossless binary transport,
conservative triangle-axis rejection and dual warm starts reduce the
instrumented step from 14.619 to 10.088 seconds, with identical physical and
float32 output bytes. Allocation/packed-bound changes had no whole-step benefit
and were reverted. The independent endpoint check took about 111 ms, 31 interior
samples about 1.805 seconds, and an unresolved continuous proof consumed its
60-second budget. These offline costs are recorded separately, not deleted;
runtime exact geometry queries remain inside the step cost. None is a native
GPU measurement or a stable-frame-time distribution.

The same-state interval through 0.633333 seconds passes three endpoints and
93 interior samples. A separate run from rest exposed an earlier, real
0.541667-second strain failure: a tangent upper-bound plane does not enforce
the nonlinear edge norm. True-norm cutting planes close that saved failure.
Its badly scaled but feasible QP is retained in `qp-counterexample-065/`;
independent feasibility and unscaled KKT certificates prevent an inaccurate
solver status from being reported as a pass. Certified warm refinement reduces
that corrected isolated step from 49.025 to 21.705 seconds with identical
actual float32 output. Its endpoint and 31 interior samples pass.

The bounded run from rest, `strain-warm-normal-initial-075/`, advances through
68 steps to 0.566667 seconds. All 68 independently checked endpoints have zero
original-mesh intersections and pass strain, seam and matching-pin checks.
The next constructed QP is genuinely infeasible: four competing contact
halfspaces alone form a numerical certificate with stationarity residual
3.6e-15 and negative bound -0.0303754. This is an internal contact-branch
representation defect, not evidence that user-frozen geometry or controllers
are incompatible. Finite contact-point constraints reduce but do not remove
the contradiction; local-iterate and two-subinterval comparisons also fail.
Their sources and failed outputs are retained, never selected as defaults.

Endpoint checks also missed a real interpolation error. At
0.5666663646697998 seconds, render vertices 2544–2545 have actual float32 edge
ratio 1.2000011798876877. The independent JavaScript verifier confirms failure
in `swept-strain-witness068/`. The original margin covered one cast; declared
replay casts stored float32 endpoints a second time. The isolated repair in
`render-replay-guard-068/` retains the original [0.8, 1.2] threshold and passes
the endpoint and 31 interior contact samples. `swept-strain-replay-guard068.json`
certifies all 22,038 render-edge bounds over that entire declared CPU replay
interval using analytic extrema and monotone float32 interval bounds. This
certificate covers strain only, not continuous contact or GPU interpolation.

`ipc-stage/` evaluates original finite-feature distances, derivatives and CCD
using the isolated MIT-licensed `ipctk==1.6.1` dependency, and all-row QPs using
`clarabel==0.11.1`. Both dependency license files are preserved in `ipc-deps/`.
All 23,226 cloth/hand triangles remain. The pair scope is the existing cloth/
hand response scope; body/cup handling stays separate and self-contact is not
silently admitted. A native CPU primitive probe measures about 10.64 ms for
candidate generation/distance, 3.65 ms for derivatives and 69.63 ms for a CCD
step bound. This is neither an integrated runtime nor hardware GPU evidence.

Joint barrier/material solving, force scaling, an unscaled KKT check and
Armijo descent close the isolated 0.575-second **endpoint** from its original
physical state in 56.212 seconds (`counterexample069-global-cold/`). The saved
late-iterate recovery has separate costs and is not counted as a cheap full
step. Its endpoint interpolation still fails all 31 contact samples, with
minimum actual strain 0.794692; solver-iteration CCD is not a proof about the
rendered controller trajectory. Real intermediate integration states remain
under investigation. The newer experiments retain a shared bounded wall-time
budget and reject nonconverged or uncertified results. See `checkpoint.json`
for the currently running or most recently completed subwindow; no full action
or performance pass is inferred from these local tests.

The later numerical audit retains `non-descent-constraint-audit.json`,
`non-descent-edge-audit.json`, `qp-centering-audit.json` and the centered QP
counterexamples. It distinguishes nonlinear guard consistency, absolute-
coordinate cancellation and complementarity error. A complete KKT certificate,
including the sum of complementarity errors, is required before the new
incremental-coordinate candidate advances an internal iterate. Large rejected
active-set trial multipliers never become physical positions.

The latest frozen-file recheck is `frozen-hashes-runtime-audit.json` (all 12
match). Main repository implementation files remain as in the preceding
checkpoint; this evidence index and external research files are the new work.
The repository test totals above are historical checks of that unchanged
implementation, not fresh tests or admission of these external candidates.

### Physical trajectory versus optimizer trajectory

The incremental candidate in `ipc-stage/physical-window069-incremental/`
finishes two real 960 Hz integration steps, at 0.567708333 and 0.568750 seconds,
before rejecting an uncertified QP at 0.569791667 seconds. The two independently
checked endpoints pass actual mesh contact, strain, seam and matching-pin
checks. Their 62 independent interior samples expose 58 actual cape-hem/hand
crossings; strain and seams still pass. These are failed intervals, not two
accepted pieces of a continuous action.

`physical-chords-audit.json` isolates the cause: even double-precision cloth
with linearly interpolated hands crosses in both intervals. The conservative
CCD step fractions are 0.0275241 and 0.0128299; static intersection witnesses
also exist. The optimizer's collision-free continuation route differs from
the physical route between its final states. Neither float32 rounding nor
controller curvature alone explains this failure. The frozen user assets
have not been shown incompatible.

The saved numerical problems now have a stronger bounded alternative:
analytical incremental gradients, an exact metric/row coordinate change,
and feasible primal active-set refinement. `primal-qp-cases.json` records
three original saved QPs passing full unscaled KKT checks, including summed
complementarity <= 1e-8. The first two take about 0.27 seconds each; the third
needs another 0.85 seconds of refinement. Five analytical/rejection cases
pass in `check-metric-primal.json`. Block active-set replacement still fails
one saved case and is not a general solution. These checks are numerical
evidence only, not full animation or performance acceptance.

The subsequent `physical-window069-trajectory-primal/` candidate adds temporal
barrier terms and mandatory whole-physical-chord checks in both double and
float32 endpoint coordinates. It fails the first physical substep after
98.690 seconds because physical-chord line search cannot advance. Its costs
include 56.553 seconds of optimizer CCD, 9.299 seconds of physical-path CCD,
10.395 seconds of collision construction and 2.391 seconds of derivatives.
No state from that failed substep is admitted. Critical-time discovery and
minimum-distance diagnostics are retained as counterexamples; more samples
are not described as a continuous proof. The candidate remains disabled.

`chord_separation.py` supplies a separate sufficient certificate for the
declared linear binary64 endpoint trajectory. It enumerates swept original
edge-edge and face-vertex candidates and recursively proves separation using
outward-padded projections over dyadic time intervals. Computed distances
select axes only; they cannot confer acceptance. Unresolved intervals, initial
intersection, nonfinite values and exhausted budgets fail. Three saved paths
which the conservative CCD step rejected are certified; both known crossing
paths remain rejected. Six analytical/negative checks have their expected
outcomes. This does not certify controller curvature or float32 replay.

The physical-path candidate using this fallback still fails its bounded
temporal discovery. The audit then identifies two internal defects: using
a conservative CCD fraction instead of the unresolved physical time, and
renormalizing existing contact forces whenever another time sample is added.
The latter dilutes an already active contact; repeated times for seven edge
pairs fill the sample limit. The isolated feature-based candidate keeps the
base contact weights fixed and tracks unresolved times by original primitive
pair. Its current result is recorded in the external checkpoint. No source
model, controller, contact threshold or application default is changed.

Reproduce the saved numerical checks without overwriting evidence:

```sh
N=/workspace/artifacts/bubu-v2-coupled-solver-20261025
PYTHONPATH="$N/ipc-deps:$N/deps" OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  python3 "$N/ipc-stage/replay-saved-qps.py" --output /tmp/v2-qp-replay.json
```

The output path must not exist. `replay-physical-window.py --output NEW_DIR`
replays the documented bounded witness candidate, not a complete action or
the subsequently edited feature-based candidate. The run captures its source
hashes and requires the same dependency path. Historical full repository test
totals remain unchanged and do not admit these isolated candidates.

### Verified short physical intervals and remaining convergence defect

`physical-window069-trajectory-envelope/` evaluates each discovered finite
feature near its minimum distance over the current physical chord. Its scalar
gradient has an independent analytic/finite-difference check. The first real
960 Hz step converges in 90.678 seconds. Its endpoint and 31 actual-controller
float32 interior samples pass contact, strain, seams and matching pins;
`swept-strain-envelope069.json` certifies every rendered edge over the declared
float32 replay interval. Three actual-model diagnostic stills were inspected
in `envelope069-stills/`: no exploded geometry or visible tearing. These are
geometry diagnostics with no face-overlay/full-outfit admission, rendered by
SwiftShader; they are not a complete demo or native-performance evidence.

The API audit in `ccd-rescaling-contract.json` and
`ccd-predicate-contract.json` distinguishes an optimizer step reserve from a
boolean physical-trajectory query. A rescaling factor of 0.8 rejects paths
independently proved nonintersecting. `linear_trajectory_clear.py` uses unit
rescaling, preserves `min_distance=0`, rejects endpoint intersections and
nonfinite data, and retains the independent interval proof as fallback.
Three certified safe paths and six analytic/negative cases keep their expected
outcomes, including both original crossings and endpoint contact rejection.
No source triangle, pair scope or user acceptance threshold is changed.

The resulting `physical-window069-trajectory-query/` completes two real
physical steps at 0.567708333 and 0.568750 seconds, taking 42.187 and 23.627
seconds respectively. The first step's float32 bytes differ from the preceding
candidate, so its verification is repeated rather than transferred. Both
endpoints and all 62 independently checked actual-controller float32 interior
samples pass, replacing the earlier candidate's 58 crossing samples in these
same intervals. `query-physical-chords-audit.json` independently certifies
both linear double and float32-endpoint chords; `swept-strain-query069.json`
certifies all 22,038 rendered edges, including final float32 replay rounding.
The contact proof still excludes controller curvature and final float32 replay
rounding; the original-controller checks remain samples, not a general proof.

The third step at 0.569791667 seconds does not converge within the shared
120-second diagnostic budget. Its last unscaled update is about 1.38e-5 while
the accepted Armijo increment is only 3.37e-9; the unscaled 1e-7 criterion is
preserved, so this is a failure. The whole diagnostic takes 121.877 seconds,
including rejected work and final reporting. Source code and the failed
iterate are retained for a temporal-curvature audit, not admitted as a physical
state. Full normal/cancel actions, full outfit continuous contact and real-time
performance are still open implementation/validation work. Native GPU tests
remain separately not run. All experimental solvers remain disabled.

### Constraint restoration and nonsmooth temporal envelope

The retained third-step QP is feasible. Its current numerical iterate violates
three sufficient lower-strain halfspaces by up to 7.614e-5, although its actual
physical and rendered edge norms already lie in [0.8,1.2]. Energy-only Armijo
rejects the work needed to satisfy those halfspaces. This is an internal
globalization defect, not inconsistent user constraints. A second defect is
the temporal maximum switching between the fixed start and moving endpoint;
a single selected branch cannot represent that nonsmooth objective reliably.
The saved gradient/energy comparisons are in `max-envelope-line-audit.json`
and `max-envelope-merit-audit.json`; the physical edge bounds are not relaxed.

The disabled `coupled_ipc_trajectory_merit.py` candidate uses a joint epigraph
QP for the retained temporal branches and an exact constraint-penalty merit
function. The original QP rows, total complementarity gate, physical strain,
contact, seam, pin and orientation acceptance remain mandatory. The zero
curvature epigraph variables use active branch constraints in refinement;
no artificial primal stiffness is added. The saved failing QP's total
complementarity improves from 1.2054e-8 (rejected at the original 1e-8 limit)
to 3.82e-16, with dual residual 6.97e-13. Four analytical/negative checks pass.

`physical-window069-trajectory-merit-resume/` restores the failed third step
at 0.569791667 seconds in 8.019 additional seconds, preserving its real
physical start and inertial prediction. The prior 121.877-second computation
is not excluded from its cost. Unscaled position update is 9.31e-8; minimum
cell-volume ratio is 0.03548. The independent original-mesh endpoint and 31
actual-controller float32 interior checks pass contact, strain, seams and
matching pins. Independent double and float32-endpoint linear chord proofs
pass, as does continuous float32 replay strain for all 22,038 rendered edges.
Actual curved-controller/final-float32 contact is still sampled, not proved.

The first cold retry is rejected for an uncertified QP, and the second for
total complementarity above 1e-8; both failures and source snapshots remain.
The next cold run retains the verified positive-metric refinement and adds
the null-metric branch refinement. Its outcome belongs in the external
checkpoint; these local results do not admit a complete action or real-time
performance. Full normal/cancel actions and native GPU validation remain
separate, open gates. No model, controller, application default or Git commit
is changed by these external solver candidates.

The completed cold comparison (`merit-runtime-costs.json`) uses the same
physical seed and 120-second budget. The original query candidate accepts two
steps; `physical-window069-trajectory-merit-cold-v3/` accepts three, reaching
0.569791667 seconds before the fourth step exhausts the remaining budget.
The three solves take 40.403, 27.256 and 48.543 seconds. Their three original
surface endpoints and 93 controller-driven float32 interior samples pass all
discrete contact, strain, seam and pin gates. `merit-cold-linear-chords.json`
and `merit-cold-replay-strain.json` independently certify the declared linear
chords and all rendered edge strains, with the same curvature/rounding contact
limitations above. Actual-model front, rear and close diagnostic stills are
retained in `merit069-stills/`; no exploded geometry or obvious tearing was
observed. These stills omit the facial overlay/full outfit and cannot substitute
for the requested final animation or native performance validation.

The runtime profile is explicit: 47.327 seconds in interval fallback,
15.761 in native trajectory queries, 23.675 in QP solves/refinement,
12.902 in collision/barrier/envelope construction, and 20.433 in remaining
assembly, body contact, strain measurements and reporting. Offline independent
audit and diagnostic rendering are measured separately, not charged to those
runtime bins. All rejected numerical work is included.

Direct native feature extraction at already intersecting endpoints improves
one isolated query (0.507 to 0.218 seconds) but regresses the whole comparison:
`physical-window069-trajectory-witness-cold/` accepts only two steps in
120.311 seconds, spending 49.281 seconds scanning for forcing features.
That optimization is rejected; its fixtures and code remain external evidence.
There is no active solve at this recorded checkpoint, no native GPU result,
no complete new normal/cancel action, and no production admission.

### Native array layout and bounded forward validation

The failed witness scan exposed repeated full-mesh copies at the pybind/Eigen
boundary: `CollisionStencil.dof` and `vertex_ids` require column-major arrays.
`endpoint_collision_witness_layout.py` converts coordinates/topology once per
query; `chord_separation_layout.py` does the same for proof topology. No value,
index, collision pair or numerical threshold changes. `check-native-layout.json`
checks the same 4,000 candidate objects with an identical input SHA256: the
row-major calls take 0.664 seconds, column-major 0.015 seconds. A preceding
projection-pruning experiment has no isolated benefit and is not adopted.

The whole cold comparison confirms a benefit: the first three physical steps
take 78.270 seconds instead of 116.203, and four steps complete within the
same 120-second diagnostic budget instead of three. All four endpoints, 124
controller-driven interior samples, independent linear chord certificates,
all rendered rounded-edge strain bounds, and six positive/negative geometry
fixtures pass. This remains a disabled correctness candidate, far from the
real-time frame budget.

`physical-window069-layout-548-552/` then completes the remaining four steps
to 0.575 seconds in 101.842 seconds; its independent checks also pass. An
isolated 120 Hz physical-step trial from that state fails its 60-second budget
with unscaled update 0.00126 versus the original 1e-7 gate, and is not adopted.
The smaller physical steps continue using unchanged criteria.

`advance-layout-to-0625.json` records bounded batches with independent checks
before every continuation. Its first stage pauses at the planned wall-clock
budget after verifying through frame 578/960 = 0.602083333 seconds. Together
with the first eight steps this is 34 distinct physical intervals starting
at the retained frame-544 seed. It is not a revalidation of the earlier
from-rest prefix, a full normal/cancel action, or a proof for the curved
controller with final float32 contact rounding. No running solver is abandoned.
The next stage uses smaller batches to avoid spending a shared budget on an
unconverged final step; the per-step gates and numerical tolerance are unchanged.

Reproduce a bounded continuation into a new external directory:

```sh
N=/workspace/artifacts/bubu-v2-coupled-solver-20261025
PYTHONPATH="$N/ipc-deps:$N/deps" OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  python3 "$N/ipc-stage/continue-physical-layout.py" \
  --seed-run "$N/ipc-stage/physical-layout-forward-576-580" \
  --start-frame 578 --end-frame 580 --budget 120 --output /tmp/v2-next-window
```

`audit-interpolation-hz.py`, the repository `coupled-verify.mjs`,
`audit-variable-linear-run.py`, and `audit-replay-strain.py` remain separate
required audits. The orchestration script refuses continuation after a failed
independent gate. The earlier 481-pose outfit evidence uses the Foundation
cape, whose identity differs from the frozen round5 tea cape; neither result
admits the other asset or a combined full-outfit cloth/tea integration.

### Self-contact coverage correction and first coupled repair

The second layout stage completes through frame 601/960 = 0.626041667 s.
The earlier external-contact, strain, seam, pin, finite-state and positive-volume
checks pass through that point. This is **not overall contact acceptance**:
subsequent original-cloth self-contact checks expose intersections at frames
549, 550 and 551. The old Three audit discarded entire face pairs sharing a
vertex, while the response mesh labels suppressed all cloth self-collisions.
Both are internal coverage defects, not frozen user constraints.

`self-original-exact-witness.json` independently proves a strict interior
intersection of edge [512,531] with triangle [491,511,492] at 0.571875 s using
exact rational arithmetic on the saved float32 coordinates. The native geometry
query nominates the pair; the rational calculation independently proves the
positive witness. A missing witness is not an exhaustive independent proof.

The disabled `coupled_ipc_self.py` candidate adds the original cloth-only
collision domain to the existing joint material, seam and hand-contact solve.
Native primitive adjacency is retained; no source geometry, controller, material,
original inequality or convergence gate changes. `self-domain-bridge-check-v3.json`
checks identical barrier energy and gradient between local and globally mapped
candidates, with zero force on unrelated vertices. Piping/seam self-contact
classification is still open and not silently included as passed.

`physical-self-548-549/` converges across the first old failure in 31.692 s,
with actual strain [0.800052218,1.199980334], zero pin error, seam/centroid error
1.57e-16 and minimum volume ratio 0.03384. The saved endpoint and 31 actual
float32 replay interiors have no external or cloth-self intersections. Independent
interval proofs pass for both physical-double and float32-endpoint linear
hand/self chords; all 22038 rendered edge norms retain their rounded replay
proof. These limited chords and samples do not certify curved controller motion
or final float32 contact rounding. Complete normal/cancel actions remain open.
The candidate remains disabled and its runtime is far outside the real-time
budget. The old frame-601 trajectory is retained as failed-self-contact evidence.

`physical-self-549-551/` closes the next two saved self-intersection counterexamples
under the same local gates. All three endpoints and 93 replay interiors are clear
against external geometry and cloth self-contact. `chord_separation_float32.py`
adds componentwise final-float32 interpolation error bounds and broad-phase
inflation; the three cloth-self intervals pass this stronger sufficient proof.
`check-rounded-self-certificate.json` also rejects a constructed rounding-only
collision that passes the unrounded linear proof. This closes the rounding gap
for these cloth-self intervals only, not controller-driven hand/body/cup paths.
Actual-model before/after stills are in `self549-comparison-stills/`; the region
is partly hidden by the hand, so visual similarity does not override exact
intersection evidence. No new visible tearing was observed in the two views.

The first optimization (`cloth_self_domain_active.py`) is **rejected** despite
a local speedup: rebuilding raw candidates from active normal stencils loses
duplicate weights. `check-active-self-types.json` retains EE/FV/EV/VV counterexamples.
`cloth_self_domain_mapped.py` instead maps complete native normal stencils,
including weights, minimum distance and mollifier data. Four stencil types and
17 actual configurations match energy, gradient and Hessian within floating
reduction roundoff (physical/numerical admission gates remain unchanged).
The full same-seed step takes 23.193 s versus 31.692 s. The output is not byte
identical; `self-mapped-runtime-comparison.json` records maximum differences,
and `self-mapped-549-audit.json` independently reruns all local gates. It passes.
This implementation is selected only for further disabled diagnostics.

Reproduce the complete local audit in a fresh evidence prefix:

```sh
N=/workspace/artifacts/bubu-v2-coupled-solver-20261025
PYTHONPATH="$N/ipc-deps:$N/deps" OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  python3 "$N/ipc-stage/audit-self-run.py" \
  --run /tmp/new-self-run --output-prefix /tmp/new-self-audit
```

All 12 frozen source hashes still match (`frozen-hashes-self-audit.json`).
No production source/default, commit, push, package or video is changed by these
external candidates. New full normal/cancel runs, piping self-contact topology,
full-outfit cloth/tea integration and real-time performance remain open; native
GPU is separately unavailable/unrun.

### Seven-interval self-contact checkpoint and audit limitations

`advance-self-to0583.json` pauses at its planned bounded budget after complete
audits through frame 555/960 = 0.578125 s. Including the mapped initial step,
seven intervals (548→555), seven endpoints and 217 actual-float32 interior
samples pass the local gates. All 225 final QP certificates satisfy the original
criteria. This is a local continuation, not either complete action.

`self-runtime-cost-breakdown.json` keeps independent audits separate and avoids
double-counting overlapping self-collision construction timers. The latest two
steps take 104.075 s: collision trajectory queries 37.692 s, native QP plus
refinement 25.817 s, barrier system assembly 17.017 s, and other assembly/body/
strain/line-search/reporting 23.548 s. This remains an implementation-level
real-time failure; native hardware absence is a separate gate. A bounded cache
of static starting geometry matches 48 direct native-query controls but its
whole-step result regresses from 23.193 to 24.650 s. The cache candidate is
**not adopted**. No repeated optimization trial is justified by that result.

Four piping meshes initially trigger native self-contact even at rest because
UV/seam vertices duplicate exact coordinates. `piping-exact-seam-topology-audit.json`
records 161/161/19/19 duplicates, still bit-identical in the checked pose.
`audit-piping-self-run.py` reconstructs exact-coordinate adjacency, retains every
original face, and refuses the proof if any duplicate separates. It moves no
rendering vertex and uses no distance-based weld. All four individual piping
components pass rounded linear self-contact proofs over these seven intervals.
Contact between cloth and piping, or between piping components, remains open.

Audit provenance also needed repair: copied self-proof scripts recorded the
older certificate helper, omitting the helper actually imported. The `-v2.py`
self linear/rounded audit scripts now hash the actual certificate, domain,
original surface, discretization and cage inputs. All seven intervals are
re-proved with these records; old reports remain available with the archived
source snapshots. No geometric threshold changed.

Current performance investigation: 30 of 72 QPs in the latest two-step batch
were followed by newly discovered strain cuts (178 added rows). A direct convex
upper-length formulation is the next isolated numerical experiment; it is not
implemented, adopted or admitted by this checkpoint. There is no hung solver,
model/controller change, Git commit/push or new video.

### Exact upper norms and the remaining rounded-contact counterexample

`conic_length_qp.py` retains the entire linear/epigraph problem and adds exact
convex upper-length cones; lower-length branches and all geometric gates remain.
Analytic projection/equality/infeasible controls pass. A real saved 909-row QP
with 28 added norm cones passes original-unit KKT in 0.413 s. The first runtime
trial is correctly rejected at total complementarity 1.67e-7 > 1e-8.
An invertible Lorentz-cone coordinate change balances radial gap and diameter;
it does not alter radius or constraints. Original-unit certification then gives
7.04e-15 total complementarity on the same failed problem.

The disabled balanced candidate completes frames 548→551 with all v2 independent
audits, including individual piping-self proofs. Same-seed three-step runtime
improves from 97.514 s to 82.020 s; the first step alone improves from 23.193 s
to 18.049 s, reducing QPs from 22 to 15 and strain rediscovery solves from 9 to 3.
These are local correctness/performance results, not real-time or full-action
admission. All SOC matrices, offsets, limits and duals are retained in the newer
augmented-vector snapshots.

A single 120 Hz step (551→559 on the original 960 Hz controller timebase) first
fails its strict primal certificate at 2.38e-8 > 1e-8. Re-aligning only cone
coordinates to that approximate solution fixes the saved problem: primal
4.34e-18, total complementarity 2.12e-12. At most one such coordinate-only retry
is allowed and counted; the native iteration limit and all acceptance tolerances
remain unchanged. The physical retry nevertheless fails the 120 s budget,
with no accepted physical step. Interval proofs consume 72.714 s and external
native trajectory queries 30.180 s.

`probe-coarse-rounding-gap.json` reconstructs this failed step without another
integration run. A right-hand edge [10226,10227] and hem edge [5499,5511] have
a physical gap 1.77e-8 in a trial chord, below the derived two-cast error bound
2.06e-7. `probe-exact-rounded-crossing.json` proves an actual intersection of
the float32-endpoint linear chord using exact rational cubic root isolation
and rational interval bounds on both segment parameters (approximately
0.51461 and 0.53387). The crossing is at relative trial parameter 0.049114775;
it is **not** a claimed accepted action timestamp or a curved-controller proof.
Positive/negative controls are included.

This exposes a response gap: the physical barrier can accept a separation
smaller than display rounding while the independent rendered trajectory gate
correctly rejects it. The next isolated repair is a derived per-primitive
numerical-clearance response, checked for initial feasibility and derivative
consistency. No global collider enlargement, tolerance relaxation, frozen
source edit, default adoption or native-GPU claim is authorized by this evidence.

### Numerical-clearance response and strict cone refinement

The local two-cast uncertainty response is now implemented in the external,
disabled `coupled_ipc_rounding*.py` candidates. The original physical start is
certified feasible for both hand and cloth-self uncertainty margins. Each
primitive receives its derived rounding radius; source vertices, contact pairs
and the original zero-intersection gates remain unchanged. This implementation
has not completed a physical step or either full action.

A proposed known-stencil native-CCD shortcut falsely rejects a certified-safe
zero-displacement control and is not used. Its replacement only rejects after
an exact rational positive witness: approximate closest points propose convex
weights and time, then rational arithmetic proves their distance below the
unchanged numerical margin. No witness means the full-domain proof still runs.
Skipping additional axes for already-separated pairs preserves all three safe
control outcomes and interval counts, reducing those isolated checks from
1.39–1.53 s to 1.05–1.21 s. This is not a whole-step performance pass.

`physical-rounding-known-120hz-551-559` stops on a strict dual residual of
3.804e-5. Re-centering cone coordinates does not fix this saved problem. A bounded
active KKT correction of the same convex problem does: dual 1.771e-9 and total
complementarity 7.700e-14, with about 0.133 s in refinement. Every original bound
and norm is checked independently, regardless of its numerical working-set
membership. Analytic recovery, infeasibility, wrong dual/primal, and summed
complementarity controls are retained in `check-length-kkt-polish.json` and
`check-conic-length-polished.json`.

The subsequent `physical-rounding-polished-120hz-551-559` still fails the 120 s
physical-step budget. All 44 final QP certificates pass, but the latest accepted
Newton direction is 9.114e-4 versus the unchanged 1e-7 convergence requirement.
There is no accepted physical output. Interval uncertainty proofs consume
54.454 s, external native queries 13.021 s and self native queries 4.966 s.
Repeated rejected trials include cloth edges [490,509] and [510,530]. The saved
`attempt-state` retains the original physical start/velocity, current iterate,
strain matrices and keys, and temporal features; it is explicitly not an
accepted physical seed. No process is hung and no full-action run is launched.

All 12 frozen hashes still match (`frozen-hashes-rounding-audit.json`). The next
isolated investigation is whole-interval polynomial separation bounds, retaining
the existing interval proof for every unresolved pair. Full action, curved
controller, cross-component cloth/piping, full outfit and real-time gates remain
open; native GPU is separately unrun. No defaults, commits, pushes or videos
are changed by this checkpoint.

### Adaptive interval proofs, extended precision and strain-branch audit

`bernstein_primitive_margin.py` and `bernstein_moving_axis_interval.py` use
outward-rounded Bernstein coefficients for whole linear primitive intervals.
Approximate moving axes only propose certificates; every cross-primitive
projection and uncertainty radius is bounded. Subdivision endpoint roundoff is
charged explicitly. Unresolved pairs retain the prior interval check. Analytic
clear/crossing/touch/margin controls, 900 rational scalar checks and 400 rational
polynomial evaluations pass. These are not curved-controller certificates.

Simple whole-interval filters remove most candidates but barely improve total
time. Adaptive finite-axis subdivision reduces about 372,000 intervals to about
1,071 in a retained safe trial. The three same-input safe checks take
0.444–0.525 s versus 1.386–1.532 s originally; the known positive conflict remains
rejected (`probe-known-rounding-features-adaptive.json`). All timing is CPU
diagnostic work, not a real-time or native-GPU pass.

The next saved QP exposes a double-precision cancellation floor: ordinary KKT
refinement oscillates at roughly 1.9e-8–4.8e-8. Mixed-precision residuals and
corrections retain the same original problem, iteration limits and 1e-8 gate.
`audit-extended-kkt-decimal-current.json` independently evaluates the complete
original system at 70 decimal digits: dual 1.169e-11 and total complementarity
6.974e-14. Extended precision is required explicitly when that fallback runs;
the actual geometry remains double/final-float32 and needs its own gates.
Earlier probe reports are retained; the `-current` reports hash the final
platform-checking helper. A direct working-set guess fails all three saved
fixtures and is not adopted (`probe-direct-length-kkt.json`).

`audit-lower-strain-branches.json` also finds a genuine internal overconstraint.
For rendered edge 9757, the whole linear edge path has minimum length 0.807081
against a required 0.800044, yet the retained start-direction plane binds with
dual -0.002189. The disabled `coupled_ipc_strain_paths.py` refreshes that sufficient
plane from the current whole path, coalescing historical lower planes for the
same edge. Original length bounds, rounding margins, every cell and independent
gates remain. A previously excluded safe rotation and 500 whole-segment controls
pass; a crossing stays rejected. This internal plane is not a user freeze.

Neither resumed larger step completes. `physical-rounding-extended-resume-551-559`
records 262.359 s including earlier attempts. After refreshing strain planes,
`physical-strain-paths-resume-551-559` accepts full Newton steps late in the run
but still misses 1e-7 convergence, with updates around 1.3e-5. All earlier cost
is retained in its `wallMs`; no incomplete iterate is a physical seed. A separate
cold trial also tightening the initial upper-cone spare fails QP at 26.777 s and
is not adopted. No output from these runs receives animation admission.

`probe-coupled-curvature.json` reconstructs a slow direction without another
physical run. Its gradient matches the saved gradient within 3.53e-15 and agrees
with energy finite differences. Contact metric curvature is about 1.083e-6,
while measured directional curvature is about 6.05e-7; material derivatives also
agree. This motivates a bounded, safeguarded step-length experiment, not more
blind iterations. The newest locally verified physical output remains the
earlier self-contact lineage through frame 555; all later large-step candidates
remain disabled. No full action, native GPU or overall production gate passes
at this checkpoint.


### Coarse-step convergence is rejected by independent interior strain

The over-relaxation experiment fails its 120 s bound and adds approximately
14.5 s of probe overhead; it is not adopted. A sparse one-pair damped secant
metric changes only the numerical Hessian, retaining the physical energy,
gradient, original constraints and strict augmented KKT certificate. Its saved
QP exposed an erroneous active-set refinement: slack inequalities with nonzero
numerical duals were forced into mutually inconsistent equalities. The corrected
working set checks both slack and multiplier, removes wrong-sign working rows
before moving the iterate, and independently retains every original bound.
`probe-secant-qp-slack.json` passes with dual 2.935e-14 and summed complementarity
4.579e-12; inconsistent-equality controls still fail closed.

`physical-secant-slack-resume-551-559` converges the same physical 1/120 s step
from 0.573958333 to 0.582291667 s with unscaled update 2.445e-8. The resumed
segment costs 69.996 s; **all earlier attempts total 666.134 s**, not real time.
The original physical start and velocity are unchanged; numerical secant history
restarts explicitly on resume. This is engine convergence, not admission.

Independent original-controller contact, seam, pin and cloth-self checks pass
at the endpoint and 31 interior samples. Interior strain fails: actual F32
back-edge vertices [3384,3396] and [3390,3391] shrink to about 0.792631 at the
midpoint. The complete rendered-edge audit identifies edges 9743 and 9760;
`audit-all-strain-paths.json` additionally finds nine physical edges with minimum
0.785096. Endpoints pass, demonstrating that endpoint-only discovery misses
rotating edges that shorten inside the segment. The remaining chord, rounded
self and individual-piping stages were not run by the stopped audit runner.

The new disabled `coupled_ipc_segment_strain.py` discovers analytic minima across
all physical and rendered edge-vector segments, includes both F32 conversion
errors, and keeps endpoint solver spare separate from the fixed start's original
bound. It is undergoing counterexample controls before the same step is resumed.
No rejected endpoint is a seed for advancing physical time. No full-action,
continuous curved-controller, cross-component, full-outfit, real-time or native
GPU gate has passed. Source geometry, controllers and production defaults remain
unchanged; no commit, push or new video is made.


Whole-segment discovery controls catch all nine physical and two rendered
counterexamples. The first resumed trial stops after 6.085 s because it starts
from an already invalid numerical iterate and a contact-shortened correction
cannot repair every strain violation at once. The disabled restoration candidate
allows only strict decrease of pending path violation in numerical iterates;
all original cuts remain in the QP/merit, stationary or worsening trials fail,
and remaining violation blocks final convergence. Controls retain these cases.

`physical-segment-restore-resume-551-559` reduces summed path violation from
0.061826 to 0.023416 in 40.204 s, then stops on an uncertified convex solve. Total
attempt cost is now 712.422 s. Its original-unit primal residual is small but
dual residual is 0.2745. A saved-system probe without the secant update also fails
(dual 0.2754), so the problem cannot be attributed solely to that acceleration.
The next diagnosis concerns the near-dependent working-set equations, including
necessary tangent rows alongside exact upper norm cones. No physical frame from
these trials is admitted and no full validation is launched.


### Four intervals pass whole physical and rendered strain; continuation stops

The exact norm-implied working-row experiment proves 31 redundant linear sides
but does not improve the saved correction. Pivot and inexact-internal-Newton
experiments also fail the complete unchanged KKT certificate; none is adopted.
The saved restored system has a maximum matrix coefficient about 1.86e14.
A cold 1/120 s step from the original verified seed also fails, after 63.995 s,
including 53.194 s in whole-interval rounding proofs. This is an internal
numerical/performance defect, not evidence of incompatible user freezes.

The whole-segment strain repair then passes four **1/960 s** physical intervals
551→555 (0.573958333→0.578125 s). Each receives independent original-mesh endpoint
and 31 actual-controller interior samples, linear hand/self and rounded-self
checks, all 22038 rendered-edge interval checks, and individual piping-self
checks. A new independent physical-edge audit checks all 8364 edges by endpoint
coordinate differences; near-threshold cases use exact rational quadratic
extrema. All four pass. The earlier prefix is not revalidated with this new
physical-path gate, and 124 samples do not prove curved-controller contact.
Whole solver costs per interval are 33.309, 40.555, 51.026 and 61.422 s. These are
correctness results only and fail real-time requirements.

Each interval now has a `*-continuation-v2.json` manifest binding exact files,
source hashes, independent results and final state. Controls reject an unrelated
successful proof and a changed render buffer. The first draft manifest remains
retained but is superseded because it did not explicitly reject another run's
proof. These manifests authorize further disabled research only, never full
production acceptance.

The 555→556 continuation stops after 61.416 s with `Factor is exactly singular`
in active KKT refinement; all processes have ended. The four prior intervals
are preserved. Failure-path auditing also finds that the adapter sets latest
problem inputs before solving but latest result arrays only after success, so
its finally snapshot can mix the current problem with the preceding successful
solution. Old arrays from this exception must not be labelled the failing QP.
The next repair captures the actual failed system and diagnoses the singular
working set. No source model/controller, default, commit, push or video changes.


### Exact stored endpoint representation closes another local interval

`qp_snapshot.py` binds each setup generation to its own inputs and raw result.
Exception controls verify that no previous solution is serialized as the new
failed solve; singular refinement returns structured failure and zero-column
diagnostics. The resumed 555→556 trial then fails its 90 s bound in geometry
proofs, not a solver exception: 79.498 s is spent in rounding certificates.

`display_replay_envelope.py` represents both endpoint casts exactly using their
actual F32 buffers, and bounds only the final interpolation cast plus double
evaluation error. Physical double/F32-endpoint native CCD, response barriers,
original models, controllers, pairs and zero-intersection gates remain. On the
same retained proposal, the old two-cast enclosure is unresolved after 3.020 s;
the actual-endpoint enclosure certifies it in 0.165 s. Both physical hand and
self CCD pass. The retained exact rounded crossing still fails the new proof.
This establishes a representation improvement, not curved-controller coverage.

`display-replay-resume-555-556` completes the same unfinished physical step in
an additional 24.479 s. All earlier attempts remain counted: 176.012 s total.
All local independent audits, including physical and rendered whole-segment
strain, pass. The five repaired intervals now reach 0.579166667 s; neither the
older prefix nor a full action is admitted. The continuation manifest explicitly
retains cross-component, curved-controller, full-outfit and real-time gaps.

Actual model stills compare the rejected coarse midpoint and the repaired
physical endpoint at the identical original-controller time 0.578125 s, from
45 and 100 degrees. Edges 9743/9760 improve from actual F32 strain 0.792631 to
0.807209/0.807205, above the unchanged 0.8 lower gate. No obvious new crossing
appears in those views, but the piping kink remains visible; screenshots are
not contact proofs or full visual acceptance. The first capture attempt lacked
a derived display JSON; it and its log are retained, and the completed v2
capture hashes the actual buffers. No new video or delivery package is created.

A bounded cold 1/120 s comparison from the same original frame551 seed is now
running with the stored-endpoint proof, to assess larger-step behavior without
hiding earlier failed work. Failed candidates remain disabled and no repository
commit or push is created.


### Barrier-domain and working-set failures are internal, not freeze conflicts

The cold coarse display-envelope trial fails after 10.860 s when the response
Hessian cannot be projected onto the PSD cone. The retained geometry proves
why: at phase 1/4, hem/right-hand edge stencil [5499,5511,10226,10227] has squared
distance 3.991e-14, below its unchanged barrier-domain bound 4.263e-14. The new
actual-display certificate cannot serve as an implicit check of a different,
more conservative response domain. `barrier_domain.py` now checks each actual
response stencil before differentiation and trial admission. Equality and
penetration controls reject; a positive gap passes.

The following coarse trial retains that check and stops after 45.705 s. A newly
discovered temporal feature invalidates the current numerical iterate, while
the original physical origin remains valid (`probe-new-feature-domain.json`).
This supports a reversible internal continuation fix, not user unfreezing.
`coupled_ipc_feasible_features.py` retains every discovered feature/strain cut,
restores only the original numerical origin and velocity, and charges all
reinitializations to the same bounded physical step. The actual retained
counterexample triggers this recovery and the verified origin remains valid.

Fine continuation 556→557 independently stops on a complete QP certificate.
The safe snapshot shows 13 wrong-sign numerical working rows, removed one at a
time until the unchanged 12-step refinement budget expires. The batch working-
set candidate proposes their simultaneous removal without changing position or
removing any original final-certificate row. On this exact saved QP it passes in
0.208 s and two refinement steps: primal 2.880e-10, dual 5.799e-10, summed
complementarity 3.869e-12. Original 1e-8 gates and iteration/time budgets remain.
Analytic norm recovery, infeasible equalities, wrong primal/dual/cone and summed
complementarity controls retain their outcomes. Same-step physical continuation
is running; these local solver controls do not establish action admission.


The batch-working-set continuation completes 556→557 and passes every local
independent stage, including exact-fallback physical edge minima and actual F32
rendered interval strain. It adds 43.707 s, with
88.721 s including the prior attempt. Six repaired intervals
now extend from frame551 through557 (0.580208333 s). The continuation manifests
are now enforced directly by the automatic advance driver, both at its initial
seed and before advancing after each independent audit.

The next 557→558 attempt stops at its original bounded deadline after
90.784 s. No failed physical endpoint is promoted. The last
unscaled directions decrease from 3.891e-5 to 3.576e-5 to 1.620e-5, and the last
two accept full steps. One further bounded 45 s continuation of the same
physical origin/velocity is planned after a verified archive; this is recorded
as additional failed/runtime work, not a real-time result. No live solve,
auditor, browser or local HTTP server remains at this checkpoint.


### Seventh segment and component-auditor correction

The bounded 557→558 continuation completes in another 9.603 s, totaling
100.386 s across all attempts. All independent local stages and physical
whole-segment strain pass; the bound continuation manifest reaches 0.58125 s.
The next 558→559 attempt stops at its 90.218 s physical-chord deadline. A
45 s same-step continuation is profiled before any larger run. The first
profiling invocation used a relative script path and failed during import
before constructing a solver; its log is retained and an absolute-path
invocation runs separately. No duplicate solver was started.

The raw cross-component audit used BVH internal callback triangle IDs as
authored IDs. Original overlap counts are valid, but original identity and
new-pair comparisons are not. The v2 audit resolves authored IDs and verifies
every callback triangle coordinate against its authored index buffer. All
current overlaps are longitudinally local sewn-component pairs; cloth/hem
overlap extends to row13 versus row14 at source. Source joins already
intersect, so changed triangle-pair identity alone is not a new-penetration
proof. No source join is silently excluded and cross-component admission
remains open. Models, controllers, acceptance thresholds and defaults remain
unchanged.


### Response reuse and coherent mollified energy close the eighth interval

The bounded cProfile continuation captures 777 hand collision-set builds
(9.371 s), 6.375 s in the native conic solver and 5.894 s in native continuous
queries. Cumulative profiler counters overlap; independent audit time is not
part of these runtime counters. Exact response-set reuse is distinct from the
previously rejected static-start intersection cache. It keys both endpoint
contents, phases, activation and retained features. Controls compare actual
energy, gradient, metric and invalid-domain rejection; native parallel sums
differ only at 7.595e-20 relative matrix scale. First test drafts incorrectly
compared native stencil order, lacked target setup, and expected a cache miss
on restoration of an identical retained key. Those failures are retained.

Sequential uninstrumented runs from the identical 557→558 numerical snapshot
take 10.060 s without reuse and 7.377 s with reuse (26.67% reduction), both five
iterations. Actual F32 rendering is bit-identical. The reused run passes all
independent local stages and physical interval strain. This candidate remains
disabled and nowhere near real time; CCD and proof gates are unchanged.

558→559 reveals a separate actual error: for cloth-self edges [490,509] and
[510,511], the closest-distance branch is the endpoint, but varying edge-edge
mollification makes the origin energy larger by 1.4916e-5 relative. The old
force and maximum-energy QP models disagree and correctly reject. The new
`temporal_energy_features.py` shares actual mollified energy branches among
force, merit and epigraph models; distance searches still locate narrow
contacts and bounded energy searches find response extrema. Invalid barrier
domains still reject. The original agreement threshold remains 1e-8; a control
selects the true origin branch and verifies its exact zero endpoint derivative.
These temporal searches are not continuous-contact certificates.

`energy-envelope-resume-558-559` completes in an additional 33.768 s, with
169.920 s along its main resume chain plus the separate 0.480 s failed baseline
probe. Every independent local stage and physical interval strain passes. The
eight repaired intervals reach 559/960 = 0.582291667 s. The earlier prefix,
original 0.625 s failure, full actions, curved controller, cross-component
contact and real-time gates remain open. The 12 frozen hashes still match.
No solver, audit, browser or server remains active before the safe archive.


### Shared proof domain with independent native comparison

`physical_chord_enclosure.py` uses outward double operations to bound the
exact physical endpoint offsets from the actual F32 center endpoints. Convexity
then includes the entire physical straight chord within the already-certified
replay tubes. No radius, mesh pair, strain bound or convergence gate changes.
2400 exact rational endpoint controls, an immediately-outside-radius negative
control, nonfinite input, and the retained real rounded crossing retain their
outcomes. If the enclosure cannot be certified, runtime falls back to original
physical queries. The true curved controller is explicitly outside this proof.

`unified-enclosure-resume-558-559` passes every independent local audit plus a
new explicit native CCD audit of double and stored-F32 hand/self chords. It
takes an additional 24.541 s versus 33.768 s from the identical unfinished
snapshot with separate runtime queries. Iterations differ (13 versus15), so
the total change is not an isolated per-operation benchmark. Maximum actual
F32 endpoint difference is 5.9605e-8; independent physical strain and actual
rendered contact/strain/pin/seam checks all pass. Only disabled continuation
is permitted. A bounded next 559→561 step is running; actual diagnostic stills
will be captured separately after the timed process exits.


### Contact identity continuation and actual visual audit

The 559→561 cold step stops at 90.179 s. It discovers an already-known
previous-step feature only at83.503 s and must return to its feasible numerical
origin. `retained_feature_seed.py` carries only validated feature identities
from the previous completed step; all time extrema, distances, collision
sets and energy branches are rebuilt for the new origin and all-pair discovery
remains. Controls verify unchanged positions/velocities/boundary, recomputed
phases and rejection of a failed physical source. The corresponding warm
trial has no restart and reaches its target boundary, but stops at its90 s
budget above the unchanged1e-7 unscaled-update criterion. Neither endpoint
is accepted. A single45 s continuation is planned after the safe archive,
justified by declining recent updates; no complete-step speedup is claimed.

Actual frozen-model close views at45°/100° for the admitted local559 endpoint
are captured and inspected. No obvious new exposed crossing appears, but a
visible angular kink persists. Quantitative diagnosis identifies back piping
ring25:34.0109° turn versus source3.0908°, with its center fixed and neighboring
rings displaced. Curvature is a diagnostic, not an invented acceptance limit;
no model, controller, pin or material change is made by this measurement.
A hand occludes part of the seam in one view. The stills do not establish full
visual admission. Browser and local HTTP server are closed; no video/package
is generated. All active solver/audit processes have ended at this checkpoint.


### Actual curved-controller counterexample blocks the larger step

The warm559→561 resume converges in another22.534 s (112.790 s on its
resume chain), and physical strain/native straight-chord checks pass. The
independent actual-controller interior audit rejects two frames: hem versus
left hand at0.583984375 and0.584049479 s. Endpoint561 is NOT admitted. An
independent original-controller export compares the same cloth with actual
versus rounded-linear hand motion. The two actual poses intersect authored hem
triangles3192/3195 with hand triangles2241/2243; every linear comparison is
clear. Both interval endpoints match the solver's hand buffers bit-for-bit.
Maximum true-controller chord deviation is3.35392e-6. The initial export
loaded two MeshBVH module identities and failed; its partial stream remains,
and the src-module v2 export completed.

The interval-jet entry-curve diagnostic bounds maximum chord deviation by
4.02166e-6/3.99178e-6 for left/right hands. High-precision analytic derivative
controls and all33 exported actual pose samples are enclosed. This is NOT a
complete original-JS continuous proof: the JS evaluation allowance is still
conditional, and carrier/timeline knots explicitly reject. Time-varying
uncertainty must vanish with phase at analytic endpoints and with the numerical
kinematic homotopy at its initial origin. The new disabled response/proof
prototype retains a valid origin and rejects the real old failure; zero-curve
and invalid-radius controls retain their outcomes.

`curved-entry-window-559-561` stops after62.142 s on a strict QP certificate,
with primal6.370e-19 but dual1.708 above1e-8. The snapshot is complete and no
failed endpoint is accepted. Tiny kinematic steps expose a likely missing
coupling: geometry boundary derivatives are present, but the new uncertainty
guard's growth is not yet included in mixed derivatives/epigraph boundary
models. Diagnose this before extending iterations. The diagnostic's interval
bound preparation occurs before the current solver timer and must be charged
in the next frame-budget version. Real-time still fails independently.

The precise seam-duplicate curvature audit supersedes the first ring-average
calculation: back ring25 is33.7861° versus source3.09077°, still a visible fixed-
center kink. Last independently admitted normal time remains0.582291667 s.
No solve/auditor/browser/server remains active. No commit, push or video.


### Guard-boundary coupling diagnosis and bounded candidate

Independent long-double evaluation of the saved curved-entry QP finds a primal
feasible point (6.415e-19); dual optimality still fails (1.708). This does not
establish infeasibility of user constraints. The omitted guard-growth mixed
derivative and epigraph boundary terms are implemented only in disabled
research candidates. A first finite-difference version stops after15.916 s
because numerical/outward guard recomputation contaminates its derivative.
Keeping that discrete guard fixed in the numerical derivative, while every
actual trial recomputes the full guard, reduces two-step-size discrepancies to
2.827e-8 (mixed) and1.007e-8 (boundary). Fixed-boundary correction is exactly
zero; original1e-8 KKT and physical gates remain unchanged.

The smooth candidate completes25 numerical iterations but stops at its90.199 s
wall budget, with remaining boundary error0.00124317 and no admitted endpoint.
Curve/solver setup is now included. Feature energy search costs38.919 s; domain
checks29.099 s and interval proof13.527 s are nested measurements, not additive.
A brief local diagnostic overlaps this run; it is not an isolated benchmark.
The scalar-energy-only optimization has no stable benefit and is not adopted.
A separate four-vertex EE search preserves all eight saved feature branches,
times, energies and world arrays bit-for-bit; it retains global final branch
geometry, all-pair discovery and all independent proofs. The old real curved
contact failure still rejects. Sequential whole-iteration comparison is in
progress before deciding whether to retain this optimization. Last admitted
physical time remains0.582291667 s; no model/controller/default is changed.


### Real curved-controller counterexample locally repaired

The four-vertex retained EE search takes7.901 s versus8.857 s for three
sequential identical-start Newton iterations. Both produce the same actual
float32 buffer; internal double positions differ by at most1.223e-10, so an
initial whole-state bit-exact assertion fails and is retained explicitly. All
original QP/segment gates remain. This10.80% local improvement is not a
complete-step or real-time claim. Scalar-only optimization remains unused.

`curved-compact-resume-559-561` then converges in41.740 additional seconds,
139.840 s on its main numerical resume chain. Unscaled update6.407e-8, actual
strain[0.800031754,1.199996847], minimum volume ratio0.0212524, centroid
residual1.656e-16, exact pins and zero support correction satisfy unchanged
local gates. All10 independent local audit stages, separate whole physical
segment strain and native original linear CCD pass. The original33-pose
controller counterexample now has no hem/hand intersections. Last locally
admitted normal time advances to0.584375 s.

The actual material stills were inspected at0.583984375 from45/100-degree
views. Angular back-piping kinks remain visible, and part of the contact is
occluded; geometry tests establish the microscopic contact result. Two failed
capture attempts requested nonexistent frame dumps (first also used index25);
v3 uses provenance-bound exact frame26 slices and succeeds. No video is made.

This does not prove the original floating controller continuously, complete
actions, cross-component contact, full visual quality or real-time performance.
The curve evaluation allowance is still conditional. Native GPU remains unrun.
The next bounded561→565 candidate is running; no failed endpoint or default
production path has been enabled.


### Next interval: analytic guard derivative and working-set regression

The561→565 proposal fails after31.097 s when finite differences cannot resolve
the guard derivative near an almost closed gap. The analytic derivative follows
IPC's local clamped-log formula including the EE mollifier, keeps the final
fixed-boundary correction exactly zero, and takes0.0327 s on this snapshot.
Fifteen high-precision scalar checks and157 native collision comparisons were
run. Near-gap native gradient differences reach4.082e-12 relative; they are
recorded with subtraction conditioning, not represented as bit equality.
Finite differences converge toward the analytic model (last mixed difference
6.307e-7). Early test drafts exposed exact-versus-rounded-gap comparison and
a nonzero float boundary test; all failed logs remain. Original physical/QP
acceptance tolerances are unchanged.

The analytic same-step resume fails strict QP certification in2.613 s; a cold
analytic run fails in29.932 s. The saved raw convex point remains primal
feasible6.071e-17, but dual48.740 and summed complementarity0.00810 fail.
Nine positive-cost zero-Hessian energy columns have no selected active branch,
causing a singular correction system. The earlier linear-only epigraph polisher
already handles this structure; that handling was omitted from the length-cone
polisher. It is an internal implementation regression, not a frozen-user-model
infeasibility conclusion.

The auxiliary working-set repair passes positive/negative row-sign controls
and still rejects truly inconsistent equalities. On the real snapshot it
removes zero columns but is insufficient: a full equality-only jump violates
lengths, adding every violated row produces an uncertified correction, and a
first-blocking variant reaches primal7.677e-5, dual19.418 and summed
complementarity1.079e-6 before the unchanged5 s refinement budget. Every
variant remains disabled and all original constraints remain in certification.
No production default is changed or failed state accepted. All processes ended
at this checkpoint; twelve frozen source hashes still match. The next bounded
proposal will use the previously verified1/480 s step from physical time
0.584375, with the repaired curvature model; no failed565 state is a seed.


### Saved-QP repairs are not a complete physical step

The561→5631/480 s trial fails at46.604 s with primal9.131e-19 but dual1.082.
Exact Fraction evaluation of the correction rows proves the1.085613e-8
residual is real, not summation error: three nearly coincident energy branches
of epigraph column5796 were selected simultaneously. Working-row pivots retain
every original inequality. First-blocking norm refinement alone can leave a
curved cone; exact convex restoration restores only an internal iterate and
requires the ORIGINAL objective KKT afterward. This repairs the first saved
QP in3.184 s: primal6.741e-14, dual1.634e-10, sum complementarity6.849e-14.
Analytic circle/epigraph, wrong-branch and true-infeasibility controls pass.

The physical resume still fails a following QP after25.513 additional seconds.
Uniform restoration can disturb stiff contact directions. Merit-only and
metric restoration alternatives fail; one bounded10 s correctness diagnostic
also fails and is not repeated or enabled. No physical gate is loosened.

A separate exact primal-coordinate translation reduces a saved problem's
linear term from3.713e10 to13.915. This is different from the earlier
Lorentz-axis rotation called 'recentered'. The translated solution is always
checked in ORIGINAL coordinates, including all norms and summed
complementarity. The two saved QPs then pass independently: dual1.574e-10
in2.628 s and dual6.657e-9 in6.652 s. Native solve, translation, refinement
and projection now share the actual frame deadline; zero-budget and truly
infeasible controls reject.

`curved-translated-resume-561-563` crosses that saved failure but fails the next
QP in20.218 additional seconds (92.335 s on this physical-step chain). Its
numerical boundary fraction is0.525476, NOT an admitted action time. The last
locally admitted physical endpoint remains0.584375 s. No further full action
is launched. Next diagnosis should identify the dominant true contact and
compare curved-center geometry with the isotropic curvature-error tube before
adding solver work. All candidates remain disabled in production. No commit,
push, deployment, new video or packaging is performed.


### Dominant stiffness is an overly conservative chord-tube response

The saved failing iterate was re-evaluated using14 exact original-controller
F32 hand poses at its requested diagnostic phases. Start/end hand buffers match
bit-for-bit. For retained edges[5499,5511] versus[10226,10228] at phase
0.713387373 and numerical boundary fraction0.525476, the chord tube has guard
1.561962e-6 and squared gap2.1561e-17; its time-weighted Hessian maximum is
6.36858e13. At the ACTUAL curved center, the unchanged float32 uncertainty
guard is2.06477e-7, squared gap3.66573e-12, and weighted Hessian maximum is
1600.66. The actual center is clear at this sampled phase; the enclosing
isotropic tube creates an artificial near-singular response. The cloth-self
feature[490,509,510,511] retains its real large stiffness and is not removed.

This is a local conditioning diagnosis, not proof of full feasibility or
continuous contact. The next reversible change should put response geometry
on the original controller's piecewise trajectory, and bound the residual
curvature BETWEEN its knots in the same collision proof. Source models,
controller, float32 conversion, all pair discovery and zero-intersection gates
stay intact. The conditional original-JS evaluation allowance remains an open
proof issue. Last admitted local action time is still0.584375 s.

### Shared actual-controller piecewise trajectory candidate

The disabled `ipc-stage/coupled_ipc_piecewise_controller.py` now shares exact frozen-controller F32 knots across response, boundary work, epigraph branches and interval admission. Eight segments retain analytic between-knot acceleration error and all original F32 guards. Original-JS floating allowance remains conditional. `check-piecewise-controller.json` confirms bit-exact knots, stationary numerical origin, zero-deviation chord equivalence, boundary Jacobian (maximum error 2.739e-11), enclosure of 33 actual poses, and rejection of the original real hem/hand counterexample. These samples are not continuous-controller proof.

At the saved 561→563 numerical failure, the previously artificial dominant hand-contact Hessian drops from 6.369e13 to 3.791e3 after searching the new energy envelope; the real cloth-self term remains 3.931e8. The cold bounded run `piecewise-controller-window-561-563` completed 20 certified QPs but exhausted its 90s budget (92.289s including final measurement). No new physical endpoint was admitted. Response feature construction and interval proofs each cost about 27s; QP solves cost 14.0404s. Overlapping profile fields are not added. Optimization under test removes repeated broadphase and irrelevant radius calculations while retaining every unproved collision pair.

The pre-repair source/evidence snapshots `*-actual-center-diagnosis-checkpoint` were member-verified: working tree SHA256 `fe088a5aad15ffdf730ebbff92127bb158a74d325abd13541f3df3f26052fd3c`; external evidence SHA256 `7ce9f0057929d4d54b0a80b3406a610632c0c49078a67691d360da2a11b9c7e3`. No commit, push, model/controller edit or new video.

### Piecewise proof/response optimization and unresolved convex solve

`check-piecewise-fast-v2.json` verifies identical response branch values, derivative differences within accumulation bounds, matching positive admission, and independent rejection of the known true-controller intersection. A single exhaustive broadphase proves most pairs globally; all remaining pairs visit every guarded trajectory segment. On the measured positive state, 22,961 pairs leave 12 for refinement. This is proof-based culling, not contact deletion.

`piecewise-whole-iteration-comparison.json` measures the same three complete iterations: 16.4151→10.3620 seconds (36.8756% reduction), including all solver/setup/proof/rejection/geometry work. Five of 23,217 rendered F32 coordinates differ by one ULP (maximum 5.96046e-8); double particle difference is 1.27147e-9. Neither endpoint was converged. The initial strict bit-exact assertion failure is retained. No claim of identical frames or real-time performance.

The next bounded run `piecewise-fast-resume-561-563` failed the original QP dual certificate after another 42.3204 seconds; main same-step resume chain totals 144.9717 seconds. Original certified physical time remains 561/960 (0.584375 s). Full normal/cancel actions, actual continuous JS evaluation, cross-component contact, appearance kink, real-time and native GPU remain open.

Saved KKT diagnosis found 713 working rows but rank 671. `check-independent-working-correction.json` certifies all original linear correction equations at 8.75636e-9 without deleting original constraints. Complete QP refinement nevertheless fails. Krylov, basis/group-pivot and associated active-set variants remain unadopted. `check-strict-feasible-counterexample.json` closes an analytic circular-constraint zero-step counterexample (exact expected optimum and original KKT), but `check-piecewise-strict-feasible-timed-qp.json` still fails the real cloth QP (dual residual 4.3559 versus 1e-8). The internal feasibility repair is not enabled in the physical driver. No finite-point, sample or subproblem success is promoted to complete physical acceptance.

All twelve frozen files still match (`frozen-hashes-piecewise-checkpoint.json`). No live solver is pending at this checkpoint. Next isolated investigation retains the shared curve fix and its proof optimization while testing integration sensitivity from the last verified physical state; failed 563 states are numerical evidence only. No new video, commit or push.


### Three independently checked 1/960 s continuation steps

The disabled piecewise candidate now has locally admitted endpoints 562/960, 563/960 and 564/960 (0.5875 s), each with all ten independent local stages, whole physical-edge segment strain and independent native CPU linear CCD. The latest source is `piecewise-fast-resume-563-564`, bound by `piecewise-564-continuation.json`. Its first 60.3162 s attempt reached the boundary with declining energy but exhausted budget; one same-physical-step resume completed in 23.1431 s, totaling 83.4593 s. Earlier steps cost 34.2513 and 51.9878 s. Failed 2 ms states are never continuation seeds. These costs fail real-time by a large margin.

Actual F32 diagnostic stills at 563/960 were inspected (`piecewise-563-stills`, `piecewise-563-visual-review.json`). A visible angular back-piping kink persists; appearance is not accepted. Small contact is assessed geometrically, not from occluded pixels. The original 0.625 s failure has not been reached. Full normal/cancel actions, continuous original-JS proof, cross-component contact, appearance, real-time and native GPU remain open. No solver is running at this checkpoint. The next bounded investigation profiles retained-feature response cost before more whole steps. No production default, frozen source model or controller changed; no commit, push or new video.


### Cached trajectory operands and exact retained EE scalar evaluation

`piecewise_cached_path.py` precomputes unchanged interpolation operands. `retained_ee_energy.py` evaluates the same single unweighted native IPC EE distance/mollifier without rebuilding a collision set for every scalar search. Discovery and final derivatives still use original native collision construction. 1,500 independent native controls include VV/EV/EE classifications, near-parallel edges and 132 invalid-domain cases; all valid energies match exactly and every invalid case is rejected. `check-piecewise-scalar.json` preserves response branches, original derivative accumulation bounds and rejection of the known true intersection.

From the identical saved numerical state, two fresh complete-convergence runs measure 22.6699→20.8107 s (8.20095%); both take 13 iterations, boundaries match exactly and particle maximum difference is 3.82543e-10. All independent local, full physical strain and native CPU linear CCD audits of the optimized result pass (`scalar-564-continuation.json`). This optimization is used only in disabled research; it is nowhere near real-time acceptance.

The next 564→565 step fails a 90 s segment plus a single 27 s same-step resume (117.3337 s combined). All 45 QPs pass original certification, but nonlinear convergence/physical proof is incomplete. A real candidate hem/hand intersection [6882,6895] versus [7913,7927] is rejected. Last admitted time remains 0.5875 s. One uninterrupted comparison uses the same original 120 s total ceiling from the verified physical start to isolate restart overhead. No failed state is a physical seed.

The completed member-verified 564 checkpoint archives have tree SHA256 `14ac110836931f323d439275bd134f28fbdad5d242607ae1473da9a26ad099fb` and evidence SHA256 `4d27110a985c4d7819464716fa6ea182c3463efd784d5b20109c43f8414d2b90`. They precede the scalar optimization; a new snapshot will follow its safe checkpoint.


### Follow-up experiments and diagnostic-budget distinction

Exact duplicate-row compression preserves all original rows in the final KKT check, passes analytic/infeasible controls, but worsens the saved real problem (dual 0.01236→214720); `conic_length_qp_exact_rows.py` is NOT adopted. Shared phase arrays preserve the response controls and pass local geometry audits, but improve the full same-state step only 20.8107→20.4144 s (1.9%); `coupled_ipc_piecewise_shared.py` is NOT adopted for lack of robust overall benefit.

The uninterrupted original 120 s diagnostic also fails at 0.5885417 s, so restart overhead alone is not the cause. Its final four updates fall from 1.90e-4 to 8.12e-7. The 120 s ceiling is an internal offline diagnostic limit, not a user acceptance threshold. A separately disclosed three-iteration completion probe adds 6.6131 s (126.7569 s total on that path) but still fails convergence at 4.10e-6. It is not admitted; original strain/contact/convergence gates and failed performance status remain unchanged.

A new isolated hypothesis tests lower-strain Lagrangian curvature in the damped secant model. Exact upper norms already live in conic constraints and their curvature is excluded from this correction. A rotated compressed-edge derivative control passes, with error 1.443e-7 at a 1e-5 finite difference step. The candidate verifies that multipliers map to the unchanged original strain rows and retains full original KKT and geometric checks. This is not yet an adopted method or a physical result. Twelve source hashes still match (`frozen-hashes-scalar-checkpoint.json`).


### Lower-curvature candidate rejected; original reference reaches next endpoint

The lower-norm secant candidate fails after ten iterations (update 1.9231e-6); it is NOT adopted. A fresh original-solver reference from exactly the same saved state converges in two iterations / 4.8168 s (update 4.05846e-8). Its same-step path totals 124.96056 s including the interrupted 120 s attempt. The generic old driver scope text describes an invocation ceiling; it must not be read as a cumulative 120 s claim. Earlier failed probes and alternate paths remain separate retained costs.

This sensitivity to small numerical differences is an unresolved robustness issue, not evidence that the rejected curvature correction works. `lower-secant-reference-564-565` uses the unchanged scalar solver. Independent audits must pass before 565/960 (0.5885417 s) is a continuation state. No physical seed, production default, model or controller is changed by the rejected experiment.


### 565 admitted locally; reproducibility cost isolated

All ten local independent audit stages, whole physical strain, and independent native CPU linear CCD pass for `lower-secant-reference-564-565`; `scalar-565-continuation.json` binds the exact files. Last locally admitted time is now 565/960 (0.5885417 s). Full actions, original 0.625 s failure, cross-component/actual continuous curve proof, piping appearance, real-time and native GPU remain open.

`check-native-response-repeatability.json` rebuilds the same saved contact response three times without cache reuse. Native four-thread gradient varies by 1.110e-16 and metric by 5.821e-11; one native thread is bit-exact in all three runs. Serial response is slower (about 0.74 s versus 0.53 s), so it is not adopted as a performance fix. Four threads are hardcoded by the original research surface constructor. The next bounded experiment will isolate deterministic local derivative reduction from parallel candidate discovery; no source-model/controller change or gate relaxation.

### Deterministic derivatives and near-convergence failure isolated

Read-only canonical native-primitive reduction now gives bit-exact fresh derivatives across three one-thread and three four-thread builds. Two complete ten-iteration repeats are also bit-exact, but both fail the original nonlinear convergence gate at an update of 3.12181e-7. This is a reproducibility fix in a disabled candidate, not physical acceptance. The first implementation mutated native collision containers while retaining element references; it was rejected and preserved. The corrected implementation never mutates those containers (`check-piecewise-canonical-v3.json`, `check-canonical-response-repeatability.json`, `canonical-whole-repeatability.json`).

Seven refreshed lower-strain support rows account for the saved material merit residual (sum 2.51097e-7); their old planes still prove the original nonlinear lower bound. The reversible `coupled_ipc_stable_support.py` retains a plane only when outward interval evaluation proves both endpoints beyond the original lower ball and its limit is no weaker than required. It preserves motion and refreshes invalid planes. Analytic controls pass, but the full candidate fails after 36.2145 s because energy backtracking exhausts the diagnostic budget. It is not adopted. This is an internal numerical representation issue, not a user freeze or a new proven collision.

The saved original QP meets its 1e-8 certificate, yet epigraph feasibility error (9.82058e-11) exceeds the predicted improvement. Its auxiliary objective predicts -1.49976e-10 while the true affine maximum gives +3.30851e-11. Blindly tightening all tolerances fails. Exact epigraph branch elimination passes analytic controls but fails the real bounded diagnostic; it is not integrated. The new `budgeted_energy.py` checks the shared deadline before and after each energy evaluation, preserving the return value before timeout and rejecting over-budget results. Three deterministic controls pass; no physical tolerance is changed.

An isolated comparison removes only the optional BFGS numerical metric correction, retaining the base material/contact metric, gradients, all physical rows and cones. The saved base-metric QP passes original certification in 0.4116 s with a 9.35425e-8 particle step. From the same saved physical/numerical state, `base-metric-resume-564-565` converges in two iterations and 11.3078 additional seconds (131.4516 s including its prior attempt). Energy backtracking remains expensive. Independent geometry audits are required before this alternative endpoint can be used. None of these results advances beyond the already admitted 565/960 s or admits real-time, complete actions, actual continuous JS proof, appearance, or native GPU. No production defaults, frozen models or controllers changed; no commit, push or video.

### Certified stationary iterate avoids unnecessary energy backtracking

`stationary_iterate.py` and the isolated `stationary-source` core recognize an already feasible current iterate before line search. The original unscaled update must be below 1e-7, the original conic certificate must pass, the boundary must equal its target, all original residual/whole-segment strain gates must pass, and the complete current physical path must pass the original trajectory certificate. Positions are not changed by this branch. Eleven controls reject nonfinite/nonstationary directions, unresolved boundaries, uncertified solves, primal errors, strain/support failures and contact failures. This is a convergence-order fix, not a displacement clamp or tolerance change.

From the same saved numerical start, the complete two-iteration continuation takes 4.03381 s instead of 11.30782 s (64.3273% for this continuation only); cumulative same-step cost including the earlier failed attempt is still 124.17759 s. Actual rendered F32 buffers are bit-identical and maximum particle difference is 2.435e-12. All ten independent local stages, whole physical-edge strain and independent native CPU linear CCD pass for both results. `stationary-base-565-continuation.json` binds the repaired result. This is used only for disabled research continuation; full-action and real-time acceptance remain failed/incomplete.

A separate base-metric 565→567 attempt reaches the requested boundary but does not converge: 60.1157 s plus a 24.0635 s bounded continuation, 84.1792 s total. Its 23 initial QPs all pass (8.45987 s cumulative solve time); response envelope construction and geometric proofs dominate the remaining time. The final raw update is 1.82395e-5. This failed numerical state is not a physical seed. Base-metric updates oscillate after reaching the boundary, so removing BFGS everywhere is not an established complete solution. No additional full-action run has been started.

### 567 curve-path audit: retain the failed unrendered chord diagnostic

`stationary-secant-finish-565-567` adds ten certified iterations / 21.0883 s and converges at 567/960 (0.590625 s), raw update 9.40525e-8. Total same-step solver cost is 105.26754 s, still a real-time failure. Endpoint and 31 actual-controller samples pass, as do physical/rendered whole-segment strain, cloth self-contact, rounded self-contact and individual piping self-contact. These samples alone do not admit contact.

Both independent straight-hand chord diagnostics fail for right-hand vertices [10215,10228] versus hem vertices [5500,5512]. The stored witness at 0.5888091004 s has squared distance 1.0394e-27 on that straight chord; evaluating the frozen original JS/F32 controller at the same time gives 7.43316e-14. The hand position differs by up to 8.95149e-7. This isolates a path mismatch: rendering and the solver's shared curve enclosure use the original nonlinear controller, while these two diagnostics substitute a straight endpoint chord. The old failed reports remain unchanged and are not called passed (`diagnose-567-chord-versus-curve.json`).

An independent native-primitive audit now checks every original inflated broadphase candidate on all eight actual-controller center pieces, retaining the same analytic curvature, F32 and explicit JS-evaluation guards. Native guarded queries can be overly conservative in oblique coordinates. A fixed coordinate transform includes an upper operator-norm bound and endpoint arithmetic error in its transformed clearance; it changes no geometry or threshold. Forty analytic/rotated controls retain actual crossing and insufficient-clearance rejection. The saved conservative native counterexample changes from unresolved to proved clear with the enlarged transformed guard (`diagnose-567-conditioned-native.json`).

The complete independent native audit passes all 156,124 candidates in 31.4654 s. An earlier 20 s invocation stopped after 106,980 passing queries and remains a failed budget diagnostic. These are separate offline audit costs, not runtime/GPU measurements. `stationary-secant-567-native-curved-complete.json` certifies the declared guarded piecewise path; the inherited 4096-epsilon original-JS floating allowance remains an unproved premise. This is NOT complete continuous actual-controller acceptance.

`local_continuation_curve_evidence.py` binds the matching curve proof, whole-segment strain, self-contact and actual samples to the exact files, while explicitly retaining both failed straight-chord diagnostics. It permits only conditional disabled research under that same declared curve premise. It rejects a failed curved proof, failed physical enclosure, silently changed premise or an unrelated failed audit. No production candidate is enabled. The prior 565/960 endpoint remains the latest also passing the unrendered straight-chord diagnostics; 567/960 is a separately identified conditional curve continuation.

Actual-model stills at 567/960 were inspected (`stationary-567-stills`, `stationary-567-visual-review.json`). The back-piping angular kink remains plainly visible; part of the microscopic contact region is occluded by the hand. Appearance is not accepted. The diagnostic body omits the final facial renderer and these stills are not a complete V2 demo. Full normal/cancel paths, original 0.625 s regression, cross-component contact, the JS floating enclosure, appearance, real-time and native GPU remain open. No full-action rerun, commit, push or video was started.

The member-verified stationary checkpoint protects 612 worktree files (SHA256 `f1f26c2729be99d305ebe7abd095e8b359b3f2dd1c89d7c7c38c6dbac3ef9b83`) and 5,549 external evidence files (SHA256 `d0edec47046e74e99efb1a448da3cea930fd15044e2af9bbaa0f1185e4133747`). It predates the 567 curve audit; subsequent evidence is preserved in a separate verified delta. Twelve model/controller/baseline hashes still match (`frozen-hashes-stationary-checkpoint.json`).

### Online iteration profile; native interpolation micro-optimization rejected

`profile-stationary-567-iteration` measures one complete online iteration from the saved pre-convergence state. Profiled work takes 2.59092 s, including a 0.419358 s native conic solve; total invocation work including curve/solver setup and final measurements is 3.59214 s. The deliberately one-iteration physical solve does not converge and is never admitted. Independent offline audits are excluded. Cumulative profiler fields overlap and are not summed; the profile itself adds overhead.

Repeated small local interpolation/layout operations are a measurable hotspot. A strict binary64-order CPU extension (`native_local_path.c`, compiled with `-fno-fast-math -ffp-contract=off`) passes 3,345 bit-exact local cases, six invalid time/shape/index controls, exact real response branches and derivative matrices, and rejection of the original actual-controller intersection. A 20,000-evaluation local loop drops from 0.20402 to 0.01383 s. This is CPU work, not native GPU validation.

The decisive same-state complete-convergence comparison is only 21.08834→20.68077 s (1.9327%). Both take ten iterations; particles, velocities, actual F32 render buffers and initial/final state arrays are bit-exact. The extension is **not adopted** for lack of a robust whole-step benefit. The original conditional 567 curve checkpoint remains the continuation source; no further timing repetition is justified without another change. All source, build flags/binary hash, controls and the rejected driver remain recoverable (`native-local-whole-comparison.json`). The first launch typo failed before creating its output directory and is retained separately; its corrected run is the measured one.

The 567 snapshot is member-verified: worktree SHA256 `b3518943b92bd953c674506fe20379d54cbd5da9cf1f37ad260c8a99c3b4b33e`; 95-file external delta SHA256 `58fcd7cacf5a783cb5bb05fb8cc2451290894bc81baf46db68d20784cc487b20` over the stationary base. A later `profile-checkpoint` tree/delta protects the profile and native-kernel rejection. No live command or browser remains. Full production acceptance is still incomplete; implementation gaps must not be attributed solely to the unavailable native GPU.


### Local bending experiment and whole-invocation domain precheck

The isolated centerline bending material uses the unchanged source section radius and existing material coefficient, with exact zero rest force, a rotation-invariant cosine residual and an analytic energy gradient. Numerical controls pass, including energy/force consistency, zero resultant force/torque and a PSD Gauss-Newton metric. On the saved 565→567 interval it converges in nine iterations / 19.7582 additional seconds, and all independent conditional-curve, actual-surface, physical/rendered strain, seam, pin and orientation checks pass. Its material history has NOT been replayed from action start. The actual F32 image still has the angular back-piping kink; maximum turn only changes 32.7623°→31.2335°. The material experiment is NOT adopted. No arbitrary stiffness increase follows this partial result (`piping-bending-567-visual-review.json`).

The original-material 567→575 attempt fails its 60.357 s diagnostic budget with twelve certified QPs. After eleven accepted numerical updates the prescribed boundary is still 0.0130832 away from its target, so this is not near convergence. The expensive repeated work includes temporal energy envelopes on already invalid candidate trajectories. No longer run has been started and no failed state is a physical continuation seed.

`retained_domain_precheck.py` caches only failed EE identities and temporal phases. It recomputes current geometry, the original native distance and the unchanged uncertainty guard on every query. A known actual violation rejects early; a miss always executes the full original domain/proof path. A real failing candidate gives exactly the original witness in 0.00223 s instead of 0.37855 s. A changed safe geometry runs the full path, and malformed identities are rejected.

The decisive comparison uses identical physical origin, target, machine and eleven nonlinear iterations, sequentially: total invocation cost is 52.2851→40.4622 s (22.6124%). It includes setup, QPs, contact/proof work, final measurements and saves. Initial and final particle/velocity/state arrays and rendered F32 buffers are bit-exact. Thirty-five invalid queries are rejected early; 55 still take the complete reference path. Both runs FAIL nonlinear convergence, so this is a bounded-work optimization, not a completed step or realtime result. The precheck is retained only for disabled research (`domain-precheck-whole-comparison.json`); all physical gates and production defaults remain unchanged.

`checkpoint.json.currentStatus` is the authoritative current scope. Earlier candidate-specific fields retain historical evidence and must not be combined into current full-action acceptance. Latest conditional curve endpoint remains 567/960; the 0.625 s regression, complete normal/cancel actions, cross-component continuous contact, original JS floating enclosure, appearance and realtime remain open implementation/validation items. Native GPU is separately unrun. The `domain-precheck-checkpoint` manifests preserve the tree and an external delta over the stationary base; verify their completion before treating them as backups. No source model/controller change, commit, push or video.


### Joint path feasibility, interior barrier conditioning and recovery diagnosis

Local separating rows now cover actual EE/FV/EV witnesses. All-pair projection and affine-map controls pass, including genuine crossing rejection. The first EE-only experiment exposed and retained an unsupported point/triangle witness. The complete simplex experiment passes its QPs and resolves sampled domain/whole-segment strain, but the original physical replay orientation still fails. Exact rational evaluation confirms four genuinely negative cells (409, 462, 463, 477), worst ratio −0.2906023; these are not rounding noise (`diagnose-predictor-orientation.json`).

Adding tangent rows from the failed physical-volume witnesses alongside the contact/strain rows produces a locally feasible 567→575 predictor in five solves / 21.0380 additional seconds. The current conditional curve contact proof, whole-segment strain discovery and original positive-volume path gate all pass. The source geometry/controller is unchanged. This is **not** a completed physical step: the additional rows are internal approximations and must be removed before checking the original material/contact stationarity. That check fails its unchanged 1e-8 conic certificate (dual 0.0217122; metric diagonal up to 3.88662e11), so the predictor remains unadmitted.

The near-boundary predictor places cells close to the original volume barrier floor. `interior_volume_step.py` uses the existing 80% fraction-to-boundary policy on remaining determinant slack even for still-positive proposals, without changing the final threshold or unscaled Newton convergence check. Controls include a positive but nearly singular proposal, an actual inversion, rigid translation and invalid initial state. A certified numerical update with fraction 0.786592 preserves original contact/strain/orientation gates and reduces the volume-barrier maximum Hessian diagonal from 3.88662e11 to 2057.66. This is a numerical iterate, not an animation frame or production acceptance.

The ensuing original-objective solve again passes its QPs but fails its 60.4133 s shared budget. The saved log explains the lost progress: at 47.5346 s, newly discovered EE [7914,7915] versus [6881,6894] invalidates the current response barrier (gap squared −1.89449e-14). The inherited recovery deliberately restores the entire physical origin. Boundary error consequently regresses from 0.00260852 to 0.0151051. Features, constraints and the wall budget are preserved; numerical progress is discarded. The next repair targets this coarse recovery policy, not the invalid-domain rejection. No extra run is currently active, and the restored environment's latest run-source hashes all match.

The latest admitted conditional endpoint remains 567/960 (0.590625 s). The candidate 575/960 endpoint has not passed original stationarity or independent action admission; 0.625 s, full normal/cancel paths, original-JS floating enclosure, cross-component contact, visible piping kink and realtime remain open. Native GPU remains separately unrun. New evidence is protected by the `interior-recovery-checkpoint` tree/delta manifests over the stationary base. No commit, push, new demo or production-default change.

### Feasible recovery and whole-step moving contact axes

The bounded feature-recovery candidate preserves 80% of numerical progress when a newly discovered contact invalidates the barrier. Every trial must pass the unchanged domain, whole-segment strain, positive-volume and physical-curve checks; otherwise the original checked cold fallback remains. Historical linear-path controls exercise both outcomes and deadline rejection. On the actual curved 567→575 interval, recovery takes 1.58989 s, retains all 25 features, and leaves boundary error 0.00514655 instead of resetting to the physical origin. The complete invocation still fails its 60.6195 s budget; this repair is not a completed physical step (`feature-backtracking-stationarity-567-575`).

Pointwise temporary contact planes repeatedly move failures to other phases. One fixed separating axis over a controller piece can even impose an impossible positive lower bound on an immutable zero row at the physical origin. This is an internal approximation defect, not evidence that frozen user geometry is infeasible. Adaptive constant-axis subdivision reaches 248 tiny accepted pieces without covering the interval. These candidates are not adopted.

Linearly varying endpoint axes produce quadratic Bernstein projection-gap coefficients. A norm envelope bounds their clearance guard, and all coefficients are constrained for each retained primitive pair. On the saved EE [490,509] versus [511,512], moving axes cover the previously unresolved controller piece in six parts / 0.00436 s. Whole-step coverage needs 15 parts, has no fixed-origin contradiction, and takes 0.08844 s to build its rows. The temporary convex-solve spare ramps from zero at the immutable physical origin; the physical guard is unchanged. Algebraic, affine-map, norm-envelope and negative-interior controls pass. These controls do not prove the original JavaScript floating allowance.

`whole-moving-swept-restoration-567-575` reaches a conditionally contact/strain/orientation-feasible target in six certified QPs / 13.6250 s, with three extra primitive pairs and no additional volume rows. Additional planes remain temporary numerical restoration aids. Removing them and checking original material/contact stationarity fails after 2.53289 s: primal residual 3.57046e-8 exceeds the original 1e-8 certificate. The minimum physical-path volume ratio is positive (0.00859542); the metric maximum diagonal is 225883 rather than the previous near-floor 3.88662e11. The numerical predictor is NOT a physical continuation seed. The next precision repair must certify all original rows, exact length cones and original objective, not merely the translated subproblem.

The current physical endpoint remains conditional 567/960. Full actions, appearance, realtime and original-JS continuous contact remain open. Current work changes isolated research and this evidence index only; no model/controller/default change, commit, push or recording.

The translation retry previously required the first, uncertified conic iterate to be primal-feasible. A finite coordinate origin does not require feasibility: `conic_length_qp_finite_translation.py` permits the same single bounded translation after `Solved`/`AlmostSolved`, while keeping the complete original-unit final certificate. On the exact saved failed matrix, primal residual improves 3.57046e-8→3.93392e-14, dual is 1.03764e-11 and total complementarity 3.89372e-14, in 1.18747 s including independent certification. Analytic optimum, true infeasibility and zero-budget controls pass. The first test-generation replacement did not apply; its unchanged-control files and hashes are retained separately. No failed certificate is admitted.

The full original-objective attempt still fails after 56.3524 s: complete QPs pass, but contact backtracking repeatedly reduces steps to 1/1024–1/256. The row audit locates 24 violated body-proxy rows, maximum 0.00341924, predominantly back piping; centroid, active strain and volume blocks have no comparable violation. Independent original-mesh/F32 inspection confirms real `cape_back_edge/body` and `cape_hem/body` intersections, so these are not merely proxy artifacts (`whole-moving-finite-stationarity-567-575-actual-endpoint`).

`coupled_ipc_dynamic_search_planes.py` remembers retained/failed primitive identities and provides whole-step moving separating rows on subsequent numerical searches. It does not remove a failed contact or accept a frame. On the same origin/target it permits seven full steps without contact backtracking, with final unscaled update 0.000171916; the bounded invocation still stops at 55.3429 s without convergence. Its independent actual F32 endpoint audit has no original-mesh obstacle intersections, and strain, seams and render pins all pass (`dynamic-whole-search-567-575-actual-endpoint`). This is local, unadmitted endpoint evidence, not a full action or continuous-body proof. Eleven completed conic solves cost 11.8349 s; profile categories for energy/proof are nested and must not be summed. Offline mesh auditing is separate from this invocation.

Removing all temporary search rows remains essential: `dynamic-original-stationarity-567-575` again takes small contact-limited steps and fails its next strict QP certificate after 48.6305 s. No physical frame is admitted. The last conditionally admitted time therefore remains 0.590625 s, and the 0.625 s regression remains unreached. The finite-translation and search-plane candidates remain isolated research; no production default changes.

### Local metric conditioning, precision correction and independent body trajectory audit

The next failed original-objective matrix contains an 18-coordinate block with eigenvalues approximately 15.75–1.83176e13. Removing the optional BFGS metric alone fails; it is not adopted as a general fallback. A reversible local block coordinate map preserves the complete objective, original constraints and norm cones. On the identical failed augmented matrix, block coordinates plus translation pass the original 1e-8 certificate: primal 2.66759e-13, dual 4.52573e-10 and total complementarity 4.36109e-13, in 1.19058 s including independent evaluation. An analytic stiff correlated system, 80 quadratic-form congruence controls, true infeasibility and zero-budget controls pass. The first output serialization failure is retained separately; no failed candidate was admitted.

A subsequent actual step still fails after 9.4950 s. Independent 70-digit evaluation confirms its dual residual is genuinely 1.29626e-8, not merely an extended-precision reporting error. Bounded dual-only correction leaves the primal position exactly unchanged and reduces that residual to 4.52874e-9; original primal, cone and complementarity gates all pass. Another saved subproblem requires original-coordinate primal/dual correction with the block preconditioner; its independent residual reaches 2.19552e-9. These are numerical subproblem repairs, not completed animation steps. Analytic dual-correction controls also reject bad primal geometry, wrong multiplier signs and an expired budget.

The certified temporal-model audit matches every saved affine branch row exactly. Four contact groups activate a different time branch from the selected energy maximum; one selected maximum is at the immutable physical origin. Supplementing the numerical Hessian with certified active-branch curvature preserves the nonlinear energy/gradient, but the actual 567→575 attempt still fails after 53.6087 s. This candidate is not adopted. A fresh 567→569 attempt with the precision repairs also fails its 55.3371 s shared budget; further blind timestep reduction is not justified by that result.

Removing a fixed numerical spare from whole-step search rows, then merging repeated whole-step primitive constraints and replacing redundant pointwise auxiliary rows, does not remove physical contact pairs or alter final tests. These bounded candidates remain failed (24.5779 s and 21.4603 s). The latest failing working KKT system has 1,178 rows, including 604 equalities. Direct rank-revealing selection identifies 438 dependent working inequalities; all original inequalities stay in the final certificate and blocking search. Merely pruning those working rows still fails original-unit correction. This is an internal active-set/conditioning issue, not evidence that frozen geometry is infeasible. The saved matrices and failed controls remain available in `search-linear-working-system` and `check-rank-working-search.json`.

`audit-original-body-swept-candidate.py` independently uses all 32,036 original body vertices / 63,610 triangles, with a verified frozen model hash. The retained failing endpoint is rejected for real body intersections. The repaired, unadmitted `dynamic-whole-search-567-575` segment passes native physical-double linear CCD, stored-F32 endpoint CCD and the declared CPU stored-F32 interpolation envelope against the static original body. This is stronger than endpoint sampling, but does not admit dynamics, curved hands, a full action or native GPU behavior. Its inspected actual-model stills retain the conspicuous angular back-piping kink (`dynamic-575-visual-review.json`); appearance remains failed. No full demo was recorded.


### Original-unit force certification and the remaining domain limiter

The rank-pruned direct KKT factorization reduces individual linear correction residuals to approximately 1e-13. Its bounded 15 s offline completion check still fails (16.2481 s measured, rejected): working-set changes lead to nearly zero blocking steps and do not certify the convex optimum. Preserving aggregate force during a basis transfer reaches a 4.98e-16 transfer residual, but produces wrong-sign forces and a subsequent uncertified correction. Both variants remain rejected; removing dependent working rows is not itself a solver closure.

Three bounded translations of the exact saved convex data, evaluated at 70 digits and re-solved with every original bound/norm retained, repair the saved search failure: original dual residual 0.0120191→1.13688e-10, primal 9.63584e-14 and total complementarity 2.67587e-13 (`check-exact-shifted-search.json`, 8.73823 s). A fresh standalone norm problem does not certify with this correction-only routine; that counterexample is retained and rejected. The complete composed solver passes its analytic norm/epigraph optimum, true infeasibility and deadline controls. No physical position is admitted from these matrix tests.

A fixed-primal linear program now finds sign-feasible forces across redundant original active constraints. It minimizes original stationarity residual and constrains total complementarity; 70-digit evaluation of every original KKT condition remains decisive. The first unscaled complementarity row slightly exceeds its original gate and remains failed. Scaling that row and using a stricter numerical working budget (5e-9, with original acceptance still 1e-8) passes the next actual saved failure in 1.43516 s: dual 5.82930e-10, total complementarity 5e-9, with positions exactly unchanged. Wrong-sign, infeasible-primal, empty-set and expired-budget controls reject invalid results (`check-feasible-dual-scaled-real.json`, `check-feasible-dual-controls.json`). This is internal force certification, not a relaxed physical constraint.

`feasible-forces-search-567-575` completes seven certified QPs and six full numerical updates; the seventh trajectory search reaches the unchanged diagnostic deadline. It takes 55.3830 additional seconds, or 370.4064 s including earlier same-step attempts. All seven QPs cost 26.1261 s together; other profiler categories overlap. Actual original-mesh F32 endpoint contact, strain, seam and pins pass, but the endpoint remains unadmitted. Removing temporary search planes for the original reference problem gives two certified QPs and only 1/256 and 1/512 accepted fractions; raw updates 0.00947 and 0.01068 remain far above 1e-7 (`feasible-forces-original-stationarity-567-575`, 11.2080 additional seconds). There is no physical time advancement.

Read-only limiter evidence identifies retained cloth edges [490,509] / [511,512] and hem [5500,5512] / hand [10228,10238]. The unchanged guarded barrier domain, rather than energy backtracking or a failed QP, rejects the large proposals. Native mollifiers equal 1, excluding a vanishing-mollifier explanation. Instantaneous F32 distances are recorded only as samples, not continuous contact acceptance (`diagnose-original-domain-limiter.json`). Selected temporal curvature versus convex-active branch curvature is the next bounded diagnosis; no user-frozen incompatibility is established.

Current repository validation is complete: `npm run check` passes 6,742 tests with 29 skips and all subsequent checks; `npm run test:integration` passes 71. The earlier restricted invocation failed 18 file processes because local socket/subprocess communication was denied (direct child launch reports EPERM); the same 29 diagnostic tests and full suite pass with local socket support. Logs and exact status are preserved under `ipc-stage/repository-check-audit` and `repository-check-current.json`. The optional Canvas limb outline scan and native GPU validation remain unrun. Twelve frozen model/controller/baseline hashes still match. These checks do not close normal/cancel dynamics, the original 0.625 s regression, appearance, original-JS continuous enclosure, full outfit contact or realtime. No default activation, commit, push or demo recording occurred.


### Bounded original continuation and rejected domain-model alternatives

A further original-objective continuation completes ten certified convex solves (18.5648 s cumulative solve time) and ten actual numerical updates, then rejects an over-budget next certificate. Its total invocation time is 55.1784 s, including setup, geometry and rejected work; the cumulative incomplete physical-step cost reaches 436.7929 s. The independent offline mesh audits are separate. Raw updates remain about 0.01, far above 1e-7; no new physical frame is admitted (`feasible-forces-reference-continuation-567-575`).

Replacing the single selected temporal metric by certified convex-active branch curvature preserves the rebuilt material/ordinary-contact metric and every physical test, but fails the same two-update comparison. Time increases 11.2080→21.1606 s, while merit reduction decreases 7.67340e-5→6.92321e-5; the final fraction is still 1/512. It is not adopted (`weighted-curvature-whole-comparison.json`). A subsequent one-direction audit reproduces the original direction exactly and records competing branch models. The largest quadratic contribution already belongs to the original selected-branch metric; “missing curvature” is not an established root cause (`branch-quadratic-model-diagnostic/report.json`).

A separate candidate adds 102 closest-feature domain tangents at existing retained times, using native distance derivatives and the unchanged guard. These are temporary numerical rows, not acceptance evidence. It fails the first original convex certificate before any update. Solving only bit-identical affine rows once removes 462 repeated rows, maps multipliers back and checks the full original system, but still fails. Exact algebraic substitution of 414 independent internal centroid coordinates also fails the complete original certificate. No source geometry, centroid relation, contact pair, motion, threshold or failed test is removed; none of these alternatives is adopted. Matrices, coefficients, failed results and scripts remain available (`domain-tangent-search-567-575`, `check-unique-row-real.json`, `check-centroid-reduced-real.json`). The historical `allOriginalRowsCertified` field in the rejected duplicate-row diagnostic denotes evaluation of all original rows; its explicit `passed:false` is authoritative and it is not passed evidence.

The remaining failure is internal guarded-domain step control / strict convex certification, not proven frozen-model infeasibility. No additional user approval is required for continued internal repair. The latest conditional physical checkpoint remains 567/960 (0.590625 s); 0.625 s has not been reached, complete normal/cancel actions are not admitted, the visible back-piping kink persists, and real-time/native GPU acceptance remains open. No math process remains running at this checkpoint; two reaped-browser zombies are not active validation commands.

To reproduce the original same-state bounded comparison without overwriting evidence, run from the external `ipc-stage` directory with a new `--output` path:

```sh
PYTHONPATH=../ipc-deps:../deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 resume-feasible-forces-step.py --compact --iterations 2 --budget 30 --seed-audit stationary-secant-567.json --seed-physical-audit stationary-secant-567-physical-strain.json --seed-native-audit stationary-secant-567-native-curved-complete.json --resume-run feasible-forces-search-567-575 --seed-run stationary-secant-finish-565-567 --start-frame 567 --end-frame 575 --output NEW_EXTERNAL_DIRECTORY
```

The source branch and HEAD remain `feature/pet-animation-v2` / `c0a8281bbc721f1f7d01afdb0ece6920aebc90f9`. Work remains uncommitted. A member-verified tree archive and a member/composite-verified external delta are recorded by `source-backup-domain-diagnosis-checkpoint.json` and `source-evidence-delta-domain-diagnosis-checkpoint.json`, over the immutable `source-evidence-stationary-convergence-checkpoint.json` base. Use their actual completed verification fields. No commit, push, default activation, packaging or video recording was performed.

### Architecture review: displayed material and a known-feasible solver failure

`ipc-stage/architecture-review-20261026/result.json` indexes the bounded comparisons, source hashes and scope corrections. The runtime is available; the completed checks leave no active calculation. Source geometry and controller freezes are distinct from private material integration, contact linearizations and solver choices. No new authorization is required for internal repairs, and no frozen-source incompatibility is proved.

The optimized contact-time energy has a verified derivative gap. Eliminating its interior time variable adds a Schur term before PSD projection. For hem [5500,5512] / hand [10228,10238], the fixed-time directional curvature is approximately 0.000595; the refined reduced prediction is 0.00124889 and the smallest tested finite difference is 0.00124904. The self-contact finite differences show more cancellation and are retained in full. Barrier/guard derivative and reduced-Hessian controls pass. Actual two-update runtime increases 11.2080→14.3475 s, with unchanged 1/256 and 1/512 fractions. The correction is **not adopted as a stagnation repair** (`audit_refined_envelope_derivatives.json`, `reduced-time-original-567-575`).

Actual F32 triangle metrics expose a separate material blind spot. At conditional 567/960, triangle 930 [490,509,510] has area ratio 0.0840628 / minimum principal stretch 0.0831981, although all three edge ratios are in the original interval. Its vertices bind to different cells, 411 and 427, whose volumes remain positive. Thus the existing edge and cell gates do not characterize the displayed triangle's shear/flattening. The audit reports this without substituting new acceptance thresholds (`audit_render_metric.json`, `audit_material_patch.json`).

The opt-in authored-triangle membrane replaces only the volume-corotated elastic energy, retaining all particles/cells, orientation barrier, masses, piping terms, seams, bindings and contact/strain tests. Integrated material weight is preserved using existing volume / authored area. Analytic, rigid-motion, gradient/Hessian and fixed-offset controls pass. The same-state two-update diagnostic costs 13.9109 s but fails convergence; its second raw update is 0.364397. It is **not adopted** and cannot inherit the former constitutive model's trajectory (`membrane-original-567-575`). It does not close the measured material defect or the actual action failure.

A numerical trust box retains the reference energy and every physical test. A proposed update below 1e-7 triggers an unrestricted original solve, preventing a small box from faking convergence. Its four-update diagnostic costs 22.4292 s: accepted fractions 1/8, 1/8, 1, 1; the final raw update is 8.00882e-6. The last two objective reduction ratios are approximately 0.9956 and 0.9997. There is still **no original convergence or physical advance** (`trust-original-567-575`).

Adding all retained closest-domain tangents to that box fails the first strict convex certificate after 7.77961 s total. Keeping one active branch per primitive also fails, after 14.7673 s; this changes only temporary numerical guidance, not physical contacts or full-interval checks. Independent 70-digit evaluation shows zero increment satisfies all 7,591 / 7,502 affine rows and 251 exact norm constraints, with primal residual 1.48102e-16 against the unchanged 1e-8 gate. Its stationarity residual is 1, so it is a feasible point, **not an optimum** (`audit_domain_qp_feasibility.json`). This rules out interpreting these solver failures as proven infeasible user constraints. Both candidates remain disabled; larger iteration budgets are not justified by these results.

The inherited `referenceStationarityWithoutAdditionalContactOrVolumePlanes` field in the two domain-tangent run reports is inaccurate for their temporary rows. The explicit failed status and `temporaryDomainPlanesRequireIndependentReference` are authoritative; the review manifest records this scope correction and hashes the original reports. The membrane report likewise does not retain the reference material objective. No run is accepted on the strength of these historical labels.

The installed IPC Toolkit metadata explicitly says it is not a full physics/solver library. Its primitives cannot certify this custom temporal-envelope architecture. Public paper-site reads were denied by the network proxy; no fetched-paper claim or bypass is used. The existing DESIGN now compares the internal reduced-time, membrane and trust-region changes with complete IPC/shell integration and the retained sequential Rapier failures. Next, a feasible-start constrained method must pass the saved convex problem and then the original nonlinear/actual-render interval; full actions follow only after that.

Latest conditional physical time remains **0.590625 s**. The 0.625 s regression is unreached; full normal/cancel actions, visible back-piping kink, original-JS floating enclosure, continuous full-outfit contact and realtime remain open. Native GPU is separately unrun. Repository executable code has not changed since the recorded 6,742 + 71 checks; new numerical controls are isolated research. The `architecture-audit-checkpoint` manifests preserve the current tree and external delta over the stationary base. No commit, push, default activation or demo recording occurred.

### Feasible-start solver and authored compression barrier

The saved domain/trust conic problem now passes its unchanged 1e-8 gates. CVXOPT 1.3.2 is installed only in the external research dependencies; its package metadata and notices remain with those files. Its default `kkt_chol` explicitly densifies the constraint matrix and factors a dense system: the bounded comparison rejects its first factorization after 42.6089 s. `cvxopt_sparse_kkt.py` instead preserves sparse scalar, equality and four-coordinate SOC blocks, without regularization. The same saved problem passes independent 70-digit evaluation in 10.0291 s: primal 4.24256e-21, dual 2.88484e-9, total complementarity 8.27032e-13. Factorizations cost 5.39412 s, linear solves 3.06477 s; these are parts of that invocation, not extra time. This closes the convex matrix counterexample only (`check_feasible_start_sparse_real.json`). Analytic norm, dependent-equality and expired-budget controls pass. The first overstrict native tolerance control fails and is retained; final original-unit admission remains 1e-8 throughout.

The original material/action interval then completes three certified QPs, accepting fractions 1, 1/2, 1/2 in 43.0643 s; original nonlinear convergence remains failed. An unboxed saved problem fails after 60 native iterations / 10.0836 s (dual 4.57543e-5 and total complementarity 2.09228e-5), so removing the numerical trust box is not adopted. No more iterations are inferred from that failed result.

The authored log-area membrane has verified rest tangent, rigid-motion and compressed/stretch derivative controls, but replacing the volume-corotated term still limits actual steps through internal volume cells. Its three-update diagnostic costs 51.9244 s, with minimum cell volume ratio 0.00434382; it remains failed. The successor `surface_compression_barrier.py` retains **every original material term** and adds only a nonnegative authored-surface compression correction, with zero rest energy/gradient/tangent and divergence at singular-value collapse. No fitted area cutoff, modified source geometry, relaxed strain gate, deleted cell or frozen swing is introduced. An outward-rounded numerical area line search and a separate declared CPU-F32 area enclosure include a positive-endpoint/interior-collapse rejection control.

The additive candidate makes two full numerical updates in its first 55.5762 s invocation before rejecting the shared deadline. A bounded continuation costs 53.4779 s, accepts 1/4, 1/8, 1/4, and still fails original convergence. Actual F32 triangle 930 area ratio improves 0.150056→0.156790→0.161226 across these numerical states, but remains severely flattened. This is not a material or action closure. The first additive candidate's complete original-body linear chord and declared CPU replay enclosure pass independently (`audit-compression-original-body.json`); its later continuation has only the indexed metric audit, not a new body proof. All late-state candidates remain disabled.

The changed material law is therefore also tested from untouched rest. The first genuine 1/120 s step converges in three iterations, with raw update 6.33323e-9, actual edge ratios 0.998335–1.004298 and minimum cell volume ratio 0.947394. Its measured solver/construction interval is 9.52330 s; input/discretization/contact-service bootstrap occurred earlier and is not included in that number. Independent original-body CCD, stored-F32 body replay and positive cloth-area replay pass (`audit_cold_start_geometry.json`). The repository's original-mesh verifier additionally passes contact, strain, seam and rendered pin samples (`compression-cold-start-0-8-actual-strict/actual-contact.json`). The first diagnostic snapshot call omitted two required arguments; its failure remains recorded, while complete final position/velocity/boundary arrays were saved. Later frame drivers use the correct snapshot signature. A separate initial export failed on bare `Infinity` diagnostics; the successful export uses the existing repository `json_evidence.encode_evidence`, preserving those sentinels as strings and keeping finite physical arrays unchanged.

Three more physical steps reach 32/960 = **0.0333333 s** on the new constitutive trajectory. All converge and pass independent original-body/area replay checks plus the original-mesh contact/strain/seam/pin sample verifier. Their runtime invocations total 31.3496 s, offline audits 1.50028 s, and the complete diagnostic invocation 35.1134 s including setup/saving. `compression-prefix32-continuation.json` binds this conditional research seed. It explicitly excludes production, full action, original-JS, full-outfit continuous and native-GPU admission. The earlier 0.590625 s checkpoint belongs to the retained **former** material trajectory; it is not a continuation seed for the new material.

Historical feasible-start v1/v2 source bytes are preserved under `feasible-start-source-history/manifest.json`; the v1 saved-matrix proof hashes resolve to the exact v1 copy. V2 initializes only true epigraph coordinates, leaving secant auxiliaries at zero. Do not discard an old proof because the live experimental module has a later hash, or substitute that later source for reproduction.

The next bounded prefix targets the original 0.21667 s counterexample before 0.625 s and full paths. At this checkpoint no long computation is active. The `surface-compression-prefix32-checkpoint` worktree/external-delta manifests preserve this stage over the stationary base. Twelve frozen files still match; no default activation, commit, push, packaging or new demo occurred. Realtime remains failed and native GPU remains separately unrun.


### Original-unit QP accuracy, trust ratios and carrier slope knots

The fresh compression trajectory reaches 160/960 = **0.166667 s** with converged
physical steps, independent full original-body and cloth-area CPU replay checks,
and original rendered-mesh contact/strain/seam/pin sampling checks. This is local
conditional research continuation, not full-action or production acceptance.
The former-material 0.590625 s checkpoint remains a separate trajectory.

New controller contacts at frame 88 invalidate a strict primal-start assumption.
The original saved QP becomes certified using native infeasible-start initialization
without changing any bound (`check_new_contact_phase1.json`). Exact-norm, redundant
equality, new-contact and expired-budget controls pass. True infeasibility is
rejected, not admitted. An unresolved energy ratio at frame 96 previously shrank a
numerical trust radius to 1.53e-14. The roundoff-aware controller leaves that radius
unchanged when the ratio cannot be resolved within the existing Armijo allowance;
physical admission and unrestricted stationarity remain separate.

At 96→104, an otherwise certified convex direction has original quadratic-model
change +4.56590e-12. On the identical matrix, stricter native accuracy gives
−8.56316e-13 while retaining the original 1e-8 KKT gate. Retaining that achieved
accuracy through the final unrestricted reference solve closes the complete step.
A second actual counterexample at 160→168 has negative linear slope but positive
full quadratic change +4.37822e-12. The same-matrix accuracy correction gives
−7.11070e-14 and reduces its raw update from 2.01089e-6 to 3.72409e-7. The current
bounded candidate therefore tests the **full quadratic merit model**, not only its
linear slope; the new step is still running at this documentation checkpoint.
No raw update, physical tolerance or deadline is loosened.

`cvxopt_schur_kkt.py` algebraically eliminates diagonal scalar cone coordinates,
retaining every original constraint and independent original-block residual check.
The sequential identical-origin 96→104 whole-step comparison improves
29.8868→27.8058 s (6.9627%); final rendered F32 buffers are bit-exact, maximum
particle difference 2.68e-12, and both original-mesh audits pass. This is one local
comparison, not a statistical performance claim or realtime acceptance. All
refinement/reference solves and geometry work remain in the same measured frame
budget. The new profiled adapter records every convex call separately so final-call
certificate timings are not mistaken for the whole frame cost.

A separate coverage failure at 144→152 exposed a carrier radius slope knot. Smooth
second derivatives alone cannot bound its chord defect. The additive derivative-
measure enclosure retains smooth curvature and the sum of velocity jumps, with
correct linear-in-duration scaling for the existing eight controller pieces. It
changes no controller or geometry. The broken-line counterexample and sampled
original-controller F32 regression pass (`check_carrier_jump_enclosure_v2.json`);
the original JavaScript floating allowance remains explicitly unproved. The first
control export failed on a NumPy boolean serializer; its failure log is retained.
The corrected enclosure crosses the knot and reaches frame 160. No samples are
represented as continuous original-JS proof.

Reproduction uses the matching `probe_compression_*` scripts in `ipc-stage`,
`PYTHONPATH=../ipc-deps:../deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1`, and the
original repository `coupled-verify.mjs` for each completed run. Saved source hashes
bind each candidate; older failed modules are not overwritten. Models/controllers
and production defaults remain unchanged. Complete normal/cancel paths, the
0.216667/0.625 s regressions under this new material, visible late piping shape,
full-outfit continuous contact and realtime remain open. Native GPU is separately
unrun. No commit, push, packaging or recording.


The completed continuation now reaches **208/960 = 0.216667 s** from the new
material's untouched-rest trajectory. All six 160→208 steps converge and pass
original-body/area replay checks; the original rendered-mesh verifier passes
contact, strain, seams and pins. Three inspected actual-source diagnostic stills
show no visible front-piping/body penetration. Actual cloth minimum area ratio
is 0.985241 and minimum principal stretch 0.984841; these remain added diagnostics,
not substituted original acceptance gates. The final renderer, full outfit,
cancellation path and late back-piping kink are not certified by these stills.

The last 1/120 s runtime step costs 12.5621 s: six convex calls cost 9.29052 s,
partitioned into setup 2.75293 s, native solve 3.77467 s and original 70-digit
certificate 2.76180 s. Other runtime work costs 3.27157 s. Independent body/area
auditing adds 0.490732 s; the Node original-mesh audit is separate. This is a failed
realtime result, not a GPU benchmark. Exact frame-origin, actual buffers, controls
and cost reports are bound by `compression-prefix208-continuation.json`,
`compression208-runtime-cost.json`, `compression208-visual-review.json` and the
`compression-contact208-checkpoint` backup manifests. All twelve frozen hashes
match. Next is a bounded extension toward 0.625 s; failures remain disabled.


### Actual-coordinate merit and the first moving hem/hand contact

The fresh trajectory now reaches **504/960 = 0.525 s**. At 0.375 s the inexact
merit check incorrectly benefited from high-precision coordinates whose affine
constraint residual was smaller than the actual reconstructed F64 iterate's.
`actual_merit_model.py` assesses exactly the candidate coordinates used by
`CoupledNewton`, including their original constraint residual and full quadratic
model. The saved same-matrix comparison distinguishes this representation error
from a frozen-source conflict (`check_reconstructed_direction360.json`). The
complete 352→496 prefix converges and passes original mesh/body/area checks.
`audit_prefix496_reference_scope.json` confirms no additional domain-guide rows
were used by any admitted earlier prefix step.

The next real blocker is `cape_hem` vertices 1738/1750 against original left-hand
vertices 439/450 during 496→504. Fixed-endpoint-only guidance cannot handle the
remaining prescribed hand motion. Full-kinematic domain tangents include that
motion and the existing guard-growth derivative, while every trial retains the
original full trajectory tests. An exact rational proof shows four such rows
require a numerical coordinate radius of at least 0.00613 versus the current
0.0015587 box. This is an internal trust-box contradiction, not physical
infeasibility. Removing only that proven-incompatible numerical box certifies the
same guided QP in 1.95186 s. `check_moving_trust_exact.json` supplies the exact
binary-coefficient proof; `check_exact_trust_controls.json` covers rounded-sum
false conflicts, real conflicts and unrestricted auxiliary coordinates.

Guidance based only on active barrier collisions arrives too late. The retained-
primitive variant instead uses already-discovered real witnesses outside the
energy activation band, without changing the energy or adding physical
colliders. Its bounded numerical continuation reaches the complete original
kinematic target. All added guide rows are then removed. The original unrestricted
reference converges with unscaled update **7.71786e-8**, zero additional guide
rows, and the unchanged physical/KKT gates. Original-body and cloth-area CPU
replay proofs pass; original rendered mesh contact, strain, seams and pins pass.
Three actual-source stills, including a close view of the hem/left-hand contact,
show no visible intersection. Actual minimum cloth area ratio is 0.721152 and
minimum principal stretch 0.716399; these remain diagnostic observations, not
replacement acceptance criteria. Later piping appearance is still unverified.

This is **not realtime**: the five-invocation same-physical-step continuation chain
costs **134.700861 s**, including setup/audits/saving. The final 19.5201 s runtime
invocation alone must not be reported as the whole cost. The chain preserves the
original physical origin/velocity/dt and advances physical time only after the
last original-reference/geometry checks. See `compression504-checkpoint-evidence.json`
and its source hashes for exact reproduction via the five indexed probe scripts.
The restored execution environment preserved all reports; the final computation
had already completed and was not duplicated.

The verified seed is `compression-prefix504-continuation.json`. The
`compression-contact504-checkpoint` worktree/external manifests preserve this
stage; verify completed manifest fields. Twelve frozen model/controller/baseline
hashes still match. The new material has not reached 0.625 s or full normal/cancel
endpoints. Full-outfit continuous contact, original-JS floating enclosure,
production integration and stable realtime remain implementation/validation gaps;
native GPU is separately unrun. No production activation, commit, push or demo.


### 2026-10-26: 0.533333 s original-unit recovery and contact witness audit

The verified current-material seed remains **0.525 s**. No new physical frame
was admitted in this stage; all candidates remain disabled. The preceding job
had ended normally, with no orphan solver. Its next 504→512 step returned native
`optimal` but failed the original 70-digit KKT check: dual residual 8.52743e-7
versus the unchanged 1e-8 threshold. Tightening native tolerance alone left
8.53776e-7. An equivalent coordinate recentering recovered 8.49e-13 on the saved
subproblem. Original-coordinate working-face refinement also recovers the full
original certificate. It checks **every** original row and complementarity
product; initial wrong-face, zero-curvature scaling and empty-index failures
remain saved. None of these convex certificates admits a nonlinear time step.

A second concrete defect discarded failed barrier primitive identities before
contact recovery. The saved 67 real rejections now retain their original EE/FV/EV
identities, with invalid topology/nonfinite controls rejected. The involved
`cape_hem` local vertices 347/360 meet right-hand 252/262; hem 1739/1752 meet
left-hand 439/452. Later discovered neighboring edges are retained too. These
are original triangles, not replacement colliders. Vertex-only reports are not
silently converted into invented primitives.

Finite target-plane predictors use the original prescribed motion. A version
with many nearly parallel guide rows fails; one fixed primitive normal with
maximized phase bounds reduces redundant numerical rows. That version reaches
the complete original 0.533333 controller boundary at 23.3064 s. This is **not**
convergence: removing numerical limits still produces an original update around
1e-2. Small trust-limited updates therefore remain rejected. Local domain guides
can assist subsequent fixed-boundary solves, but the final reference must remove
all such rows. Latest continuation exhausted its original shared diagnostic
budget while checking the full curved hand path. New endpoint body/area/actual
mesh audits were not run on an unconverged state; no vacuous zero-frame pass is
reported. The earlier 0.525 actual-mesh and area evidence remains unchanged.

See external `ipc-stage/contact512-diagnosis-checkpoint.json` for source hashes,
all failed candidates, exact resume entry, cost partitions and the full selected
same-physical-step chain. Its **198.668253 s** cost includes all four invocations
and is still a failure; it cannot be reported as a realtime result. Independent
convex setup/native/certificate costs are separated from incomplete calls and
full geometry checks. There is no whole-step performance win to claim.

Twelve frozen hashes still match. No user freeze conflict or required user
approval was established. The immediate blocker is internal joint convergence
with all actual contact witnesses, not native hardware. Full normal/cancel
coverage, full-outfit continuous contact and the original-JS rounding premise
remain open; native GPU is separately unrun. No production activation, commit,
push, packaging or demo recording. `contact512-diagnosis-checkpoint` manifests
preserve this stage after their archive/live verification completes.

### 2026-10-26: retained times and closest-feature curvature close 0.533333 s

Current-material conditional coverage advances from **0.525 to 0.533333 s**.
`ipc-stage/contact512-closed-checkpoint.json` records the reproducible chain,
source bindings, controls, failed alternatives and new 0.541667 s counterexample.
All candidates remain disabled for production. No frozen-source incompatibility
or new approval requirement was established.

The ten original primitive identities were preserved, and independent linear
feasibility/KKT checks pass. However, repeat rejections of the same primitive at
new times were discarded. The time-preserving candidate recovers 53 additional
times from saved logs without adding invented primitives. Its cache/save/restore
controls pass. This fix alone still fails the physical step after 20 updates;
the full 174.454 s failed diagnostic remains saved.

The slow direction has projected curvature 7.28818e-11 versus observed gradient
curvature 1.73057e-11. Material-only signed curvature does not fix it. The actual
interior contact for hem [6891,6904] / left-hand [8177,8189] has a native
**edge/vertex** closest feature, skipped by the old edge/edge-only time Schur
correction. Complete signed material/contact curvature with that elimination
predicts 1.73054e-11 and the assembled matrix passes Cholesky. Finite differences
and a false-stationarity regression support the isolated implementation. This
does not change the physical energy, gradient, geometry, motion or thresholds.

From the same saved state, the base method takes 55.664 s for six updates and
still fails at 1.79531e-6. Material-only curvature fails a native solve after
three accepted updates, at 39.960 s; BFGS also provided no benefit. Those variants
remain rejected. The closest-feature correction takes two iterations, then
restores the original metric and removes all numerical guidance for the final
reference. Its original unscaled update is **2.25445e-8**, dual residual
**1.58626e-10** against the unchanged 1e-8 KKT threshold. Original-body CCD,
declared CPU-F32 body/area envelopes, whole-segment strain, positive cells and
actual source-mesh contact/strain/seam/pins pass for this step. The seam error is
7.38420e-8. The original-JS rounding premise remains unproved.

The successful continuation takes 21.0793 s runtime plus 0.4934 s independent
body/area audit (23.3768 s total diagnostic). Runtime convex work is 15.7071 s:
1.3093 s setup, 13.0244 s native solve, 1.3728 s original-coordinate certificates.
Contact/proof profiler categories can overlap. The entire selected same-step
continuation chain, including earlier failed invocations, is recorded separately;
this final tail is not a cold-start or realtime performance result.

`compression-512-stills/visual-review.json` records actual-model front/contact/
back inspection. No obvious crossing or open seam is visible in these stills;
the later back-piping kink is not resolved. These are diagnostic stills, not a
new demo. The next 512→520 attempt fails original QP certification after 15.203 s;
independent coordinate recentering also fails. Thus **0.541667 s is unaccepted**,
0.625 s and complete normal/cancel actions are still open, as are continuous
full-outfit contact, production appearance and realtime. Native GPU is separately
unrun. No commit, push, default activation, packaging or recording occurred.

The older postmetric guide diagnostic used candidate-cache records after its
path query; use `contact512-postmetric-original-model-v2` for the rebuilt-origin
guide analysis. The earlier raw original direction/path result remains valid.
Repository executable code was not changed in this stage; previously reported
6,742/29-skipped and 71 integration results were not rerun as new validation.
`contact512-closed-checkpoint` archive manifests provide the saved working tree
and external evidence after their verification fields complete.

### 2026-10-26: 0.541667 s original-coordinate recovery remains incomplete

`ipc-stage/contact520-solver-diagnosis.json` records the follow-up. A 12-variable
equivalent-row scaling control exposes an active-face selection defect: multiplying
the same inequalities by 1e9 changes the old result from success to failure.
Normalized working-face selection fixes that control, but does not independently
close the real subproblem. Removing the multiplier filter also gives no benefit.
Those isolated comparisons and their failures remain saved.

The full sparse KKT backend at native 1e-13 avoids the Schur backend's observed
instability, but the original dual residual remains around 2e-6. Recentered full
KKT then supplies a closer, still uncertified seed. Independent original-coordinate
primal-dual correction certifies every original row, sign and complementarity
product with dual residual 1.25123e-12. This is a new convex certificate, not
acceptance of the native `unknown` result. The recovery's affine, norm, infeasible,
expired-budget and saved-0.533333-QP controls pass without changing thresholds.

In the actual 512→520 continuation, the first recovered original certificate has
dual residual 2.77316e-12. Contact discovery retains five real primitive identities
and their new phases. One numerical update passes the path check at alpha 1/1024,
but the prescribed boundary is still 0.0162094 away. A second convex subproblem
passes; after adding a required strain cut, the next native solve is `unknown`
with original dual residual 0.405152 and is rejected. No 0.541667 physical frame,
body/area audit or actual final mesh audit is admitted. The two selected attempts
cost 59.3410 s in total, separate from the prior 0.533333 chain.

The current accepted seed remains `compression-prefix512-continuation.json`.
The next exact failure is saved in
`compression-original-recovery-normal-512-520/frame-520`, with the original
physical origin, velocity, temporal support times, strain cuts and QP matrices.
All candidate defaults remain disabled; the blocker is internal numerical
recovery and moving-contact continuation, not established frozen-model
infeasibility or unavailable GPU. No live solver remains at this checkpoint.

### 2026-10-26: original KKT and local replay envelopes close 0.541667 s

`ipc-stage/contact520-closed-checkpoint.json` advances conditional local coverage
to 520/960 s. All candidates remain disabled; no frozen file, controller or
acceptance threshold changed. The source-bound continuation record is
`segment-response-prefix520-continuation.json`.

The updated physical strain row 5412 is reproduced exactly, including its
normal and bound (rounding discrepancy 3.33e-16). Adding it changes neither the
gradient nor curvature. The complete physical metric is SPD; all 603 equality
rows are independent. HiGHS independently finds a feasible point with original
70-digit primal residual 3.72e-16. This is an internal backend accuracy problem,
not established geometric incompatibility. Full sparse KKT plus one coordinate
recenter passes the same saved problem at original dual 9.45e-11. Affine, norm,
infeasible, expired-budget and actual saved 512/before-cut/after-cut controls pass.

The ensuing actual step exposes a second reusable defect. The global response
radius uses the maximum endpoint Float32 ULP throughout the whole step. When
cloth vertex 6904 crosses the 0.5 exponent boundary, that radius grows even at
the bit-identical origin. Its positive squared gap 2.89e-15 becomes negative
−2.25e-15 although the origin did not move, exhausting line search. The new
per-piece two-conversion bound retains endpoint and final-cast uncertainty plus
outward arithmetic. The candidate origin gap is 2.66e-15, compact/full native
energies agree, and adversarial conversion controls pass. Those samples only
supplement the directed bound; they are not a continuous proof. Independent
physical/F32 trajectory checks are unchanged.

`segment-response-normal-512-528-bounded` completes frame 520 with an unrestricted
original-reference update **8.77268e-8** and original dual **6.59881e-11**. No
numerical guide or trust box establishes convergence. Original-body CCD,
stored-endpoint body/area envelopes, positive cells, whole-segment strain and
actual Float32 triangles pass. Actual edge ratios are **0.815124–1.155114**,
seam error **8.13142e-8**, render-pin error zero; minimum volume ratio is 0.42225.
`segment-response520-stills/visual-review.json` records the three inspected views.
No obvious crossing/open seam is visible; mild piping facets, later appearance
issues and omitted face layers in this diagnostic renderer remain explicit.

The final 520 runtime tail is 112.961 s, independent body/area audit 0.512 s,
and actual mesh audit 0.125 s. Convex work is 76.403 s: setup 5.470 s, native
solve 64.926 s, original-coordinate certificates 6.005 s. The complete selected
same-step diagnostic chain is **417.743 s**, excluding the subsequent failed
528 step. Some low-level profile categories overlap. This is neither a cold
start of the new method nor a realtime result.

At frame 528 (0.55 s), a new moving-boundary QP fails with original dual
0.112834. Initial native `optimal` has original dual 1064.89; recentering and
the independent face correction still fail. Its matrix/state/temporal supports
are saved under `frame-528`; it is not admitted. The current controller enclosure
only supports normal entry. Cancel retreat and later normal phases need actual
path-specific enclosures; this is an implementation gap, not a GPU limitation.
The original 4096-epsilon JS allowance, full outfit continuous contact, full
normal/cancel actions, final appearance and realtime remain open. Native GPU is
unrun. No default activation, commit, push, packaging or recording occurred.
Repository executable code was not changed; prior broad regression counts are
not presented as newly rerun checks. The `contact520-closed-checkpoint` manifests
preserve the working tree and external evidence after their verification fields
are complete.

### 2026-10-26: coherent local response closes 0.55 s

`ipc-stage/coherent-local-prefix528-continuation.json` binds the new conditional
local seed at 528/960 s. The original-reference update is **2.89566e-8**, original
dual **1.61583e-9**, and prescribed boundary error zero. Original-body CCD,
stored-endpoint body/area bounds, positive cells and whole-segment strain pass.
Actual Float32 triangles have no intersections, edge ratios
**0.803022–1.199977**, seam error **7.58188e-8**, and zero rendered-pin error.
Minimum volume ratio is 0.217639. Three actual-model views are reviewed in
`coherent-local528-stills/visual-review.json`; mild piping faceting and full-action
appearance remain open. The diagnostic renderer omits face/detail layers and is
not the complete V2 demo.

Two related envelope defects and one arithmetic defect explain the progression:

- The hand's global future-bin radius made the immutable origin gap negative
  (−8.14658e-16). Dividing that deficit by a near-zero phase created numerical
  guides whose solution displaced vertices by roughly 24,235 model units.
  Local hand cast bounds restore a positive gap 4.70570e-15. They use the old
  global tube to bound each local coordinate box, retain the original JS
  allowance, and do not change independent physical proofs. Actual-controller
  sample controls and compact/full energy equivalence pass; samples are not
  represented as continuous proof.
- The cached domain precheck still reconstructed the global radius after full
  response switched to local radii. For the saved right-hand/hem stencil
  [5500,5513,10236,10237] at phase 0.002660779, it falsely rejected both a tiny
  and a complete update that full response accepted. The corrected precheck
  calls the same radius operation, recomputes geometry, and still runs the full
  reference after a miss. Deliberate-contact, changed-geometry and malformed-ID
  controls pass. No physical collision or witness was removed.
- Extended-precision sparse residual products lose absolute accuracy through
  cancellation. A 70-digit original-coefficient correction closes the corrected
  saved QP with dual 7.48463e-10; equivalent row scaling and wrong-face controls
  pass. The old unbounded candidate still fails and is not admitted. The
  speculative early-face optimization encounters a singular face and is
  rejected, with no claimed timing benefit.

The selected 0.55 s continuation chain costs **423.182 s** of diagnostic time,
including the earlier failed attempts and shared setup in the first mixed run,
excluding its preceding accepted 520 frame and that frame's independent audit.
The final runtime tail is 39.505 s; body/area audit is 0.461 s and actual-mesh
audit 0.108 s. Convex work in that tail is 31.366 s (setup 2.155, native solve
26.640, original certificates 2.564). These are not cold-start, full-action or
realtime results. Low-level profile categories can overlap.

The same implementation reaches the complete 0.558333 s boundary, then rejects
an updated 22-length-cone QP: primal 1.34955e-7 and dual 1.08863e-7 exceed the
unchanged 1e-8 threshold. The saved finite native `unknown` iterate is not
accepted. A separate recentered solve passes the original 22-cone certificate
(primal 1.80263e-23, dual 3.18750e-10); actual physical-step continuation remains
required. The failed frame is preserved under
`coherent-local-normal-520-544-final/frame-536`.

`audit_contact528_face_precision-storage-note.json` excludes failed diagnostic
NPZ pairs whose final stored iterate was not the last certified pair; the
iteration histories remain valid and no admitted seed used those files. The
corrected diagnostic writer and source-bound accepted states are separate.
All models/controllers and original thresholds remain unchanged, candidates
remain disabled, complete normal/cancel and original-JS proof remain open,
native GPU is unrun, and no commit, push, demo recording or packaging occurred.

### 2026-10-26: original-coordinate and guide audits close 0.558333 s

`ipc-stage/contact536-closed-checkpoint.json` binds the accepted local continuation
at 536/960 s. Original-reference update is **1.94108e-8**, original dual
**1.06203e-9**, boundary error zero, and minimum volume ratio 0.105036. Whole-step
strain, positive cells, original-body CCD and stored Float32 body/area envelopes
pass. Independent actual triangles have no intersections; edge ratios are
**0.807673–1.199980**, seam error **8.84381e-8**, and rendered-pin error zero.
`unbiased-equilibrium536-stills/visual-review.json` records three inspected views:
no obvious crossing/open seam, with visible piping faceting. The diagnostic
renderer omits face/detail layers and is not the complete V2 demonstration.

The original 22-cone numerical recovery uncovered an additional coordinate
conversion defect: rounding a large affine dot product before subtracting it
from a bound changed the incremental problem. Its certificate passed while the
absolute-coordinate violation was **6.97910e-8**. The isolated 70-digit shift,
with inward inequality rounding, retains all original rows and passes the saved
absolute check at **5.49958e-22**; large-offset and equality controls pass.
The original absolute-coordinate gate remains authoritative.

Two bounded physical continuations then made valid descent but did not converge.
The independent late-direction audit confirms the saved gradient bit-for-bit;
actual energy finite differences and directional curvature agree (curvature
ratio about 0.999956). Two temporary guide planes outside barrier activation
instead supplied maximum force 0.0495585 and directional work 6.31441e-5. A
comparison removing only those numerical guide rows keeps **690 physical affine
rows and 21 exact length cones**, passes the complete declared physical path,
and lowers actual energy by 2.96936e-4. The guide-free equilibrium candidate
then reaches the original convergence gate. Moving-boundary predictors remain.

The selected same-step continuation chain is **586.782 s**, not a cold solve.
The final 536 tail is 77.690 s, including 58.928 s of convex work (setup 4.077 s,
native solving 49.903 s, original certificates 4.937 s). Independent body/area
audit is 0.480 s; actual-mesh verification is 0.126 s. Failed attempts and shared
initialization are retained in the chain; subsequent failed544 work is excluded.
These costs fail realtime and do not predict native GPU performance.

The next frame, 544/960 s, rejects an updated QP. An independent scalar relaxation
requires a numerical box radius **1.23087e-4**, versus the actual **8.69404e-6**
(14.16 times smaller). Its original-unit certificate passes; exact rational row
checks independently identify four conflicting physical rows. This is an
internal search-box contradiction, not incompatible user-frozen content.
The isolated follow-up checks every physical row, preserves numerical radius
and native accuracy in saved attempts, and tests one-use contact guidance after
an actual rejected trajectory. Earlier checkpoints preserved physical origins
and velocities but reset numerical search state; they are not bit-exact cold
replays. A further search-scope correction is under validation because an
unrestricted reference direction had incorrectly shrunk an unused tiny box.
No 544 physical admission is inferred from these diagnostics.

The bounded 544 follow-ups preserve their failures: the all-physical-row
conflict repair completes 20 outer iterations without satisfying the original
physical convergence gate (137.078 s); transient guidance reaches its bounded
physical-search deadline (181.861 s); the search-scope correction reaches its
bounded convex-solve deadline (181.889 s). The latter restores the effective
radius from 1.61939e-14 to 4.71870e-4 after an unrestricted reference step, then
allows ordinary bounded-step expansion to 0.00188748. Certified intermediate
QP results do not admit frame544. The next numerical/geometry witness remains
saved under `search-scope-normal-536-560/frame-544`.

`check_search_scope.json` verifies unrestricted versus actually bounded radius
updates and rejection of invalid restored settings. Earlier startup/fixture
errors are retained in separate logs; only the completed controls count.
`check_numerical_resume.json` verifies the actual saved physical arrays and
constraint matrix bit-for-bit, the radius/accuracy state, refusal of missing
legacy numerical state before mutation, and one-use guide consumption. Its 433
temporary rows disappear on the next unrequested context call while all 19
physical **context** rows and 10 retained contact primitives stay unchanged;
the base affine system is assembled separately. No simulation step is accepted
by either control test. The `contact536-closed-checkpoint` backup manifests bind
the working tree and external restore chain once their verification flags are
complete.

All 12 frozen hashes still match. Candidates remain disabled; full normal/cancel
paths, original-JS enclosure, full outfit continuity, final appearance and
realtime remain open, and native GPU remains unrun. Repository executable code
is unchanged in this stage; earlier broad test totals are not new test results.

### 2026-10-26: native contact closure admits the local 0.566667 s continuation

`ipc-stage/contact544-closed-checkpoint.json` and
`contact-complete-prefix544-continuation.json` bind the admitted local state.
Original-reference update **7.50899e-8**, dual **2.87210e-9**, boundary error zero,
minimum volume ratio **0.0800042**, full declared-step strain and cell checks,
original-body CCD and stored Float32 body/area envelopes pass. Independent
actual triangles have no intersections; ratios are **0.800089–1.199975**, seam
**7.58290e-8**, rendered-pin error zero. Three inspected source-geometry views
show no obvious crossing/open seam; front piping faceting remains. These are
diagnostic stills without the complete face/detail renderer, not the V2 demo.

`audit_contact544_contact_closure.json` identifies four active original native
EE/FV contacts missing from the response at inspected phases. The isolated
`contact_family_closure.py` inserts original stencils and refuses unsupported
provenance; the independent trajectory proof remains unchanged. Retained sets
grow from 10 to 20, then 29 during bounded solves. This is not a proof that phase
sampling covers all continuous contact. An instrumentation mismatch caused one
intentional SIGINT before enabling the corrected profile wrapper; its preserved
report saying `running` is historical, and
`contact-complete-instrumentation-stop.json` records the termination.

The final admitted 544 continuation tail takes **69.774 s**, including **37.420 s**
convex work (setup 3.565 s, native solve 30.461 s, original certificates 3.393 s).
Independent body/area audit takes **0.558 s**, actual-mesh audit **0.107 s**.
These exclude earlier failed same-frame continuations and are not a cold total.
The containing invocation also attempts frame552 and takes 253.020 s overall.
Runtime already fails realtime without independent offline audits; original-JS
and native-GPU acceptance remain separate and unpassed/unrun respectively.

The first 552 continuation reaches its prescribed boundary, then exhausts the
physical-search budget. Its resumed 87-cone QP fails original dual residual
**1.63582e-8** after two bounded native solves (120 total factorizations).
`audit_contact552_initialization.json` uses the identical saved coefficients
with native primal-dual initialization: **51 iterations**, original dual
**2.76731e-9**, primal **5.84633e-20**, all original gates passed. The recorded
12.233 s versus 27.239 s is a diagnostic comparison, not an isolated repeated
performance benchmark. Physical 552 convergence remains to be established.

`check_resumable_guidance.json` reproduces a separate checkpoint defect: the old
context call consumed 1,184 temporary rows before the QP returned, so an
interrupted solve resumed with different constraints at unchanged positions.
Version 2 retains in-flight guidance until numerical position advancement and
passes same-iterate/restart row-and-bound equality checks. Original-reference
removal remains mandatory. Legacy version 1 is explicitly not exact replay;
the new physical continuation starts from its saved pending request rather than
inferring one from a failed solve. No model, controller or acceptance threshold
changes, production promotion, commit, push, packaging or demo recording occur.

`check_native_initialization.json` also passes the saved 22-cone problem with
all original residuals, and rejects expired budgets and an impossible immutable
row. The first physical follow-up makes valid energy-decreasing steps at 552
but fails after 154.162 s at an internal **40-entry** contact-storage cap. The
rejected original EE witness is `[10464, 10465, 5490, 5515]`, at local phase
0.6606365. `check_topology_contact_storage.json` reproduces that refusal, retains
all previous witnesses while inserting the actual 41st, checks idempotence,
and rejects expired deadlines/unknown topology before mutation. Storage now
uses the finite original topology and shared wall budget rather than the
arbitrary 40-entry count. No physical frame is admitted by this storage test.

### 2026-10-26: active-time Newton direction closes the local 0.575 s step

`contact552-closed-checkpoint.json` binds the admitted local state. The original
reference update is **7.25910e-8**, original dual **2.64867e-9**, boundary error
zero, minimum volume ratio **0.0734517**, and all independent body/area and actual
mesh checks pass. `active-time552-full-reference-check.json` checks the stored
matrices: all **1,809 original time rows** are restored in the final reference,
and its physical rows are unchanged bit-for-bit. Three inspected actual-geometry
views show no obvious intersection or open seam; front piping faceting remains,
and the diagnostic renderer still omits face/detail layers.

The full time-branch model stalled above the original update threshold despite
valid descending steps. `audit_contact552_late_accuracy.json` compares identical
saved coefficients at 1e-10 and 1e-13 native accuracy: directions differ only
**1.65576e-9**, so that precision change is not adopted. Evaluating the unchanged
reference before the working trigger also fails (raw **2.65632e-7**); that is not
a fix. `audit_contact552_step_forces.json` instead identifies dominant direction
work from numerical time-branch planes. An isolated active-maximum Newton
direction preserves **761 physical affine rows and 88 exact upper norms**, passes
the full trajectory checks and reduces the complete original energy. The
runtime candidate retains all exact active ties (495 working rows in this case),
uses the full nonlinear energy and restores the complete reference. It reaches
the original gate in two outer iterations, without changing thresholds or
discarding any original contact primitive.

The final continuation takes **38.387 s**, with **0.443 s** independent body/area
audit and **0.118 s** actual-mesh audit. The selected same-frame chain, including
earlier failures and method versions, takes **1,138.133 s**; it excludes separate
diagnostic probes and is not a cold replay. Neither quantity meets realtime.

The next physical frame560 is still under validation. Its initial saved QP
fails original dual **1.08672e-4** despite small primal/complementarity errors.
`check_conic_active_refinement.json` refines that same convex problem in two KKT
checks, **2.735 s**, to primal **1.41804e-15**, dual **2.28939e-15** and summed
complementarity **3.79629e-22**. Two independent small active-norm cases pass.
`check_conic_refinement_guards.json` rejects a nonconvex objective and an expired
budget without mutating the seed. Only the subsequent original physical-path
validation can admit frame560. The earlier runner-name collision failed before
execution and was retried under a fresh filename; no source-bound file was
overwritten.

`benchmark_singleton_saved_qp.json` separately compares full versus selective
singleton elimination in alternating order on identical saved coefficients.
All four original certificates pass; median complete convex-call time changes
**12.887→11.322 s** (ratio **0.8785**), with maximum physical-direction difference
**1.75517e-18**. This is not the rejected full Schur method: only modest singleton
scalar contributions are eliminated and the full original residual is retained.
Small controls preserve two accepted cases and two originally uncertified
active-cone cases. Native-optimal controls were correctly rejected; an attempted
tighter native solve was singular and is not adopted. The elimination candidate
is **not used by the physical continuation** pending same-condition whole-step
cost and geometry comparison. Subproblem speed is not realtime or GPU evidence.

### 2026-10-26: local 0.583333 s physical admission and whole-step cost comparison

`contact560-closed-checkpoint.json` binds the next accepted local continuation.
Original-reference update **1.43946e-8**, dual **2.30502e-10**, boundary error zero,
minimum volume ratio **0.0762276**, full declared-step strain/cell checks and
independent original-body/Float32 body/area checks pass. Actual triangles have
no intersections; ratios **0.842427–1.199998**, seam **6.96385e-8**, rendered-pin
error zero. All **1,361 original time-model rows** are restored in the stationary
reference; its physical rows match bit-for-bit. Three inspected source-geometry
stills show no obvious crossing or open seam; piping faceting and complete
renderer/final appearance acceptance remain open.

The final tail takes **144.119 s**; the selected same-frame chain including
failed attempts is **547.186 s**. These are resumed research timings, not cold
or realtime results. Original-conic refinement uses the same shared deadline;
its low-level setup/certificate categories may overlap, so full invocation and
convex-call wall times are the authoritative totals.

`singleton-whole-step-comparison.json` compares the full and selective KKT
backends from the identical saved state, seeds, physical interval, thresholds,
iteration ceiling and wall budgets, in sequential runs. Both pass all original
and actual-mesh gates. Runtime is **144.119 versus 142.092 s** (ratio **0.985934**);
maximum rendered-coordinate difference is **3.72529e-9**. This one-pair 1.4%
difference does not establish a consistent overall benefit, so selective KKT
elimination is **not adopted**. The 12% subproblem result does not become a
whole-animation or stable-framerate claim. The full backend remains selected
for subsequent physical continuation; failed/unused candidates stay preserved.

### 2026-10-27: 0.591667 s cost diagnosis, admission still open

`conic-active-time-normal-560-608` ended normally at its 180 s shared step
deadline; no background solver remained. It did not admit frame568. The last
accepted local state remains frame560 (0.583333 s). The failed invocation spends
84.401 s inside convex solves and 42.431 s in contact-family closure; independent
endpoint/body audits did not run because nonlinear convergence had not passed.

`audit_contact568_refinement_order.json` rejects early active-KKT refinement:
the native original dual is 1.45396e-8, but refinement diverges rather than
certifying it. Recovery order is unchanged. An initial diagnostic export failed
because of a missing `Path` import; its log is retained and the repaired harness
was rerun. No physical state was advanced by either probe.

`check_contact_family_batch.json` compares original versus batched insertion on
the real initial frame568 state. Both preserve the same 14 original witnesses,
support times, physical arrays, response metric, gradient and boundary coupling.
Native enumeration order varies; the first order-sensitive comparison fails,
while normalized identity comparison and bit-exact response comparison pass.
The original logs remain. Complete domain checks decrease 14→1, with measured
closure time 5.198→0.692 s. Negative controls retain every witness on domain
rejection, restore the validation flag after exceptions and reject an expired
deadline before mutation. This changes no contact or acceptance criterion.

`batched-contact-normal-560-568` uses the same initial physical state and 180 s
step budget. Its sixth numerical update is reached at 110.743 s versus 137.192 s;
it further reaches raw update 6.22798e-4 at 168.816 s. It still exhausts the shared
budget and remains unadmitted. These intermediate improvements do not establish
complete-step speed or realtime performance. A saved-state continuation is
separately labelled and includes the failed invocation in any chain cost.

`audit_contact568_native_accuracy.json` compares the same saved QP coefficients:
existing recovery 18.094 s, direct native 1e-13 termination 9.039 s, with original
dual residuals 2.31707e-10 and 2.62880e-10 respectively. Both original certificates
pass; maximum direction difference is 5.63674e-12. The original 1e-8 admission
gate is unchanged. Whole-step policy comparison is still required; this isolated
result does not activate a production candidate.

The matched continuation rejects a globally tighter native policy.
`batched-contact-normal-560-568-tail` reaches raw update 5.37354e-5 at 174.469 s,
then exhausts its shared budget. From the identical saved starting attempt,
`batched-accuracy-normal-560-568-tail` fails after 89.799 s inside CVXOPT's
Lorentz-cone scaling (`jnrm2`, negative square-root argument). It reaches only
3.73520e-4 before that failure. The tighter policy is **not adopted**, and the
single-QP speedup is not claimed for a complete physical step. Both runs remain
unadmitted; the original-accuracy continuation retains its saved search state.

`batched-contact-normal-560-568-final` then fails a specific updated QP, rather
than its wall deadline: 147.507 s total, 2,068 temporary guide rows, original
primal 1.45619e-21 but dual 4.51322e-7 and summed complementarity 4.01016e-6.
The feasible primal point is evidence against attributing this convex failure
to incompatible frozen source requirements. Preserving the primal origin in a
recentered solve also fails (`audit_contact568_feasible_recenter.json`), as does
the independent installed conic backend (`audit_contact568_independent_conic.json`).
Neither failed candidate is selected. Exact box implication proves only seven
rows redundant; that isolated presolve is not selected for the runtime.

`audit_contact568_generated_guidance.json` closes this saved convex failure by
standard constraint generation on temporary guides. All physical rows and norm
constraints remain in every inner solve. The first solution identifies 266
violated omitted guides; the second solve passes the entire original 8,794-row
problem with original primal 1.16777e-22 and dual 7.77450e-10. Complete call plus
independent final certificate takes 10.886 s, versus the earlier 37.987 s failed
recentered call. This is a saved-subproblem comparison, not a whole-frame speed
claim. `check_guidance_constraint_generation.json` verifies missing-guide
restoration, full audit of an inactive guide, infeasibility rejection, immutable
inputs, expired deadlines and rejection of equality candidates. The original
1e-8 certificate and physical convergence thresholds are unchanged.

The new `run_generated_guidance.py` also corrects failed-attempt time accounting:
`runtimeStepSeconds` includes all recorded solver attempts, while accepted,
failed and offline-audit times are separate. Earlier failed reports have zero
`runtimeStepSeconds` because they summed only accepted rows; their retained
`totalDiagnosticSeconds` and explicit convex wall events must be used instead.
No old evidence file is rewritten to disguise that limitation.

### 2026-10-27: local 0.591667 s physical admission

`contact568-closed-checkpoint.json` records the newly accepted local continuation.
Original unscaled reference update **5.60719e-8**, dual **3.76525e-10**, boundary
and pin errors zero, centroid residual **1.65766e-16**, physical strain
**0.800182–1.2**, and minimum volume ratio **0.0837972** pass. The stationary
reference restores **2,145 original time rows** after the 199-row working model;
all physical reference rows match bit-for-bit. Independent original-body,
stored-Float32 body/area and declared path/strain/cell checks pass. Actual mesh
checks show no intersections, strain **0.850264–1.199998**, seam **7.56661e-8**,
and rendered-pin error zero. Three inspected actual-geometry stills show no
obvious crossing or open seam. Piping faceting and complete appearance remain
open; the diagnostic body omits face/detail and is not a complete V2 demo.

The final saved-state continuation takes **167.104 s**, plus **0.501 s** separate
body/area audit and **0.119 s** actual-mesh audit. The selected same-frame chain,
including three failed invocations and method versions, takes **681.027 s**.
Independent probes and the alternate strict-accuracy branch are excluded and
remain separately recorded. This is neither a cold replay nor realtime, and no
complete-step speedup is claimed for the batch policy. Full normal/cancel,
original-JS enclosure, full outfit continuity and native GPU acceptance remain
unclosed. Frozen model/controller files remain unchanged; no production
candidate is enabled and no commit or push is created.

### 2026-10-27: 0.600000 s slow convergence and checked short-step candidate

`generated-guidance-normal-568-608`, `generated-guidance-normal-568-576-tail`
and `generated-guidance-normal-568-576-final` preserve three bounded failures at
frame576. Accepted local coverage remains frame568. The last numerical update
is **1.66048e-5**, above the unchanged **1e-7** gate, after full-energy descent.
Their diagnostic walls are **182.509**, **181.903** and **181.742 s**; failed
runtime is separately recorded rather than zero. Additional identical full
continuations were paused for diagnosis.

`audit_contact576_late_direction.json` reconstructs the saved un-guided QP and
confirms the current gradient matches the saved gradient bit-for-bit. Independent
directional-gradient differences give curvature ratios **1.000592**, **1.000041**
and **0.999993** at fractions 0.1, 0.03 and 0.01; this does not support retuning
the material/contact curvature. `audit_contact576_certified_short_step.json`
instead identifies a discarded useful step. Fractions 1, 1/2 and 1/4 fail the
unchanged path check; 1/8 passes, retains the new witnesses, adds no strain cuts,
passes whole-segment strain, and decreases updated energy **0.1367490245→
0.1367439420**, satisfying the updated energy Armijo criterion. This probe is
not an independent actual-mesh or stationary-reference admission.

`check_feature_model_refresh.json` verifies bit-exact updated gradient versus
complete reassembly, unchanged physical arrays, retained witnesses and rejection
of stale position/moving boundary. The isolated `feature-aware-normal-568-576`
run preserves two such shortened steps under the original full merit/path
checks. It does not allow same-iteration convergence after feature discovery.
Working updates approach **2.02732e-7**, but the subsequent complete original
reference still requires **4.56877e-4**; that larger step is accepted only after
the unchanged checks and decreases full energy. The candidate then reaches the
shared path-search deadline (**184.128 s** diagnostic wall, **182.288 s** failed
runtime), so frame576 is **still unadmitted**. It is not enabled for production;
neither the near-threshold working update nor the local energy decrease is a
full-frame pass. Its preserved final state permits further bounded validation.

### 2026-10-27: pending restoration and feasible-face refinement

The next `feature-aware-normal-568-576-resume` attempt remains unadmitted.
Its short-step hook incorrectly consumed a pending restoration request before
constructing that QP. `check_short_step_restoration.json` reproduces the loss
and verifies the isolated replacement: the request survives, the next QP has
2,121 guide rows, and same-position retry matrices/bounds are bit-exact.
`feature-restore-normal-568-576` nevertheless fails after **180.012 s** runtime
(**181.940 s** wall). Coverage remains frame568, not frame576.

`audit_contact576_restore_generated_guidance.json` repeats the saved QP failure
independently in **40.566 s**. Its second constraint-generation round has only
eight restored guides. The recentered seed already passes original feasibility,
cone and complementarity, but has dual residual **3.11749e-8**. Instrumented
active-face refinement projects nearby inequalities to exact equalities and
produces large wrong-sign multipliers. Preserving existing multipliers alone
still fails; `audit_contact576_refinement_preserved.json` retains that result.
Preserving the feasible slacks and correcting stationarity instead closes the
saved reduced problem in **3.041 s**, with original dual **1.39667e-14**.
`audit_contact576_complete_retained_generated_guidance.json` checks the complete
original QP, including all omitted guide rows with zero multipliers: **passed**
in **26.814 s**. The prior frame560 case, active-norm controls and nonconvex/
expired-budget guards pass. Additional ineligible-seed controls exposed a late
guard that tried to convert an infinite bound; the guarded isolated variant
rejects original row/norm/sign violations before constructing a correction.

`retained-stationarity-normal-568-576` still fails (**61.775 s** runtime,
**63.798 s** wall). `audit_contact576_actual_merit.json` replays the identical
certified working QP into actual F64 coordinates: update **7.47635e-8**, negative
model change **-2.20986e-9**, roundtrip error **1.11021e-16**. It does not request
accuracy refinement. Instead the small working update correctly triggers the
complete original stationary reference, which remains the failing subproblem.
No physical frame, full action, cold replay or realtime acceptance follows from
these local solver passes. All candidates remain disabled for production.

`audit_contact576_reference_profile.json` isolates that complete-reference
failure: 2,839 nearby rows reduce to a 767-row numerical basis; dense QR costs
**9.867 s**. A tangent correction achieves a small stationarity residual but
creates a **0.0284855** wrong-sign multiplier, so it is rejected. The fixed-dual
alternative (`audit_contact576_reference_fixed_dual.json`) retains every seed
multiplier and auxiliary variable, corrects the physical block by at most
**7.79938e-13**, and passes all original residuals in **1.104 s** (dual
**8.23811e-14**). It also passes the saved guided case in **1.312 s**.

This fast path fails the earlier frame560 and two active-norm controls and is
therefore not used as a replacement. `check_hybrid_conic_refinement.json`
verifies that the composite retains the unchanged original fallback on those
three cases, starts that fallback from the untouched seed, and shares the
existing deadline. Original-row/norm/wrong-sign rejection controls also pass.
The isolated physical runner is `run_hybrid_refinement.py`; neither the fast
path nor the composite has passed production or full-action acceptance.

### 2026-10-27: complete working time envelope

`hybrid-refinement-normal-568-576` accepts a full **1.01325e-4** update but fails
the shared deadline (**181.793 s** wall). Its bounded continuation accepts full
updates **1.71776e-5** and **1.56636e-5**, interleaved with severely shortened
directions, then also fails (**185.112 s** wall). The last unscaled direction
is **1.10653e-5**, so frame576 remains unadmitted. Further identical long runs
were paused for diagnosis; their costs and failure states remain recorded.

`audit_contact576_blocking_feature.json` identifies cloth edge `(2558,2578)`
against left-hand edge `(7925,7926)`. Compact search energy and original native
energy match exactly at every recorded branch. The two near-maximal peaks are
at phase **0.610543** and **0.639428**, with minimum squared clearance margin
**1.24000e-17**. This rules out a scalar-search/native-energy mismatch on this
saved case; it does not establish an exhaustive temporal maximum proof.

`contact576-full-envelope-comparison.json` verifies identical saved numerical
state hashes for a sequential matched comparison. The active-only working
envelope shortens a **6.13417e-6** direction by **2^-22**, accepts only
**1.46250e-12**, and takes **64.778 s** diagnostic wall. Keeping every original
time branch accepts the full **6.13390e-6** direction with zero physical/energy
backtracks in **20.164 s**, under the same unchanged checks. Both experiments
deliberately run one Newton iteration and are correctly marked unconverged;
neither is a physical-frame pass. `run_full_envelope_refinement.py` combines
this isolated policy with the checked hybrid refinement for further complete
frame validation. No production default is changed.

`full-envelope-normal-568-576` subsequently closes the local **0.600000 s**
continuation. Original unscaled update **2.460995e-8**, original dual
**1.609270e-10**, physical strain **[0.80000859,1.199999999999]**, minimum
volume ratio **0.17471914**, zero pin/boundary error and centroid residual
**1.70e-16** pass unchanged gates. Both working and stationary reference retain
all **2,240** time rows; original physical rows are bit-exact. Independent
original-body/F32/area and whole-segment strain/direction checks pass.

The actual rendered mesh has zero sampled crossings, strain
**[0.85110073,1.19999784]**, seam error **7.24918e-8**, and zero render-pin error.
Full, left-contact and back stills were inspected: no obvious crossing/open
seam; piping faceting remains visible. This diagnostic body omits face/detail
and does not establish final V2 appearance. The last invocation is **59.835 s**,
separate body/area audit **0.495 s**, and actual-mesh audit **0.096 s**. The full
selected same-frame resume chain (including failed attempts and method versions)
totals **1,646.229 s**, excluding independent probes and the active-only matched
comparison. This is not a cold solve or realtime. Evidence is bound in
`contact576-closed-checkpoint.json`; full normal/cancel, full-outfit continuous
acceptance, original-JS allowance and native GPU acceptance remain open.

### 2026-10-27: neighboring time planes and frame584

The next four full-envelope attempts preserve every failed state and deadline:
`full-envelope-normal-576-600`, its `-resume`,
`full-envelope-normal-576-584-final` and `-tail`. They reach the target boundary
and decrease full energy, but the late update stalls near **2.01750e-6**.
None admits frame584. An early fixed-dual probe gives **4.974 s versus 4.866 s**
with the same original residual and is not adopted as an optimization.

`audit_contact584_late_direction.json` verifies a bit-exact reconstructed
gradient. Larger finite-difference steps give curvature ratios **1.0062** and
**0.9857**; this does not justify retuning the material.
`audit_contact584_epigraph_work.json` attributes **5.87831e-9** of opposing work
to time epigraph planes; strain contributes about **1.48e-14** and the numerical
trust box about **6.37e-22**. The dominant branches at **0.3683657** and
**0.3684056** lie next to the same smooth peak. Duplicated local curvature is a
working-model diagnosis, not a general theorem or a controller constraint.

The reversible `piecewise_peak_time_model.py` keeps each existing controller
piece's recorded maximum, exact ties and knot sides in the fixed-boundary
working QP. Full energy, geometry and original-reference checks are unchanged.
`check_piecewise_peak_time_model.json` retains the real frame576 two-peak
counterexample and checks ties, knots and invalid input. The matched-state
`contact584-piece-peak-comparison.json` verifies identical seed hashes. At584,
the candidate accepts a full **8.88046e-5** direction and reduces full energy
**1.66122e-7**, versus **6.41632e-9** for the full-envelope direction (25.89x).
Diagnostic wall time is **21.600 s versus 19.981 s**, so this comparison claims
better progress, not a cheaper iteration. Both single-iteration runs correctly
remain unconverged. The prior576 matched regression accepts a full step too.

`piece-peak-normal-576-584` then closes local **0.608333333 s** in **41.021 s**
runtime (**43.304 s** diagnostic wall). Original unscaled update is
**2.531115e-8**, dual **2.383231e-9**, physical strain
**[0.80074473,1.19999999999976]**, minimum volume ratio **0.25608000**, zero
boundary/pin error and centroid residual **1.57e-16**. The original reference
restores all **2,103** time rows from **1,980** working rows; physical rows are
bit-exact. Independent body/F32/area and whole-segment strain/direction checks
pass within their declared conditional scope. The actual Float32 mesh has
zero sampled crossings, strain **[0.83161384,1.19999758]**, seam error
**7.75978e-8**, and zero render-pin error. Body/area audit costs **0.467 s**;
actual-mesh audit **0.123 s**. `piece-peak-prefix584-continuation.json` admits
only this local continuation. It does not admit production, full normal/cancel,
continuous original-JS behavior, current-method cold replay or realtime.

`contact576-runtime-cost.json` also resolves the previous accepted invocation's
cost: **26.290 s** convex-solver wall inside **59.835 s** runtime, leaving
**33.545 s** for material/contact construction, geometry/path checks and other
runtime work. Nested solver/profile timers overlap and must not be summed as
additional frame time. Independent offline audit remains separately reported.

### 2026-10-27: frame592 remains unadmitted; small-guide cost audit

`piece-peak-normal-584-600` and `-resume` stop safely at shared deadlines after
**180.934 s** and **180.029 s** runtime. Neither admits another physical step.
The second reaches the exact frame592 (**0.616666667 s**) target boundary and
reduces full energy from about **0.15027** to **0.14947**, but the last accepted
update is still about **4.18e-4**. Reaching the boundary is not convergence.
The failed states and source-bound reports remain available for bounded resume.

`audit_contact592_small_guides_generated.json` and `_full.json` compare the same
saved 27-guide problem sequentially, with the same hybrid refinement and all
original constraints/cones/tolerances. Three generated solves cost **30.470 s**;
retaining all guide rows directly costs **10.894 s**. Both independently pass
the complete original certificate (dual **1.27143e-10** and **1.29659e-10**).
This is a subproblem timing result, not physical-frame or realtime acceptance.

The isolated `sized_guidance_solve.py` retains up to 32 temporary rows directly
and otherwise uses the unchanged certified generation algorithm. This cutoff
is a numerical cost policy, not an acceptance tolerance. Actual runtime benefit
is still unverified. `check_sized_guidance_solve.json` checks the complete
solution with 1/32/33 guides, infeasibility, expired deadlines, invalid/equality
guide candidates and unchanged inputs. No production default is changed.

`contact584-runtime-cost.json` records **18.714 s** convex outer wall within
**41.021 s** runtime and **22.307 s** other runtime. Independent body/area and
actual-mesh audits total about **0.590 s**. The dominant measured cost is online
prototype work, not independent audit or a missing GPU measurement. The
restoration-request, identical-position gradient-cache and general incremental
coordinate repairs are covered by the admitted local action through frame584;
complete normal/cancel and current-method cold replay remain open.

`contact592-sized-guide-action-comparison.json` subsequently verifies identical
seed hashes and all QP coefficient arrays for a sequential action comparison.
The generated-guide baseline accepts a full direction; the direct-guide
candidate discovers one extra strain cut and accepts no position in its one
iteration. Its **14.369 s** versus **37.582 s** runtime is therefore **not** an
equivalent-progress speedup. The direct cost policy is not selected for the
continued main physical validation. It also exposes an uninitialized diagnostic
local on a cut-only bounded exit; the failure is preserved verbatim.

`feature_aware_trajectory_step_complete.py` fixes only that diagnostic exit,
without accepting an unconverged iterate. `check_cut_only_exit.json` replays
the actual saved problem: all physical arrays are bit-exact and unchanged,
all 24 previous strain cuts remain, the new 25th cut is saved, and the run
correctly reports original convergence failure with no admitted frame.
`run_piece_peak_complete.py` continues using the prior guide strategy with
this reporting repair; it does not enable the unverified cost optimization.

The continued `piece-peak-complete-normal-584-600` also exhausts its deadline
after **180.504 s** runtime. It lowers full energy to **0.14469549**, but the
last **3.34412e-3** direction is shortened to **1/256** and frame592 remains
unadmitted. `contact592-blocking-parts.json` maps the failed-trial witnesses to
left hand/cape hem and right hand/cape cloth, with original vertex indices and
controller times. These are failed trial trajectories, not accepted frames.

`audit_contact592_direction.json` verifies the saved QP is at the current
position, reconstructs its gradient bit-for-bit, and matches all time rows.
The numerical trust box contributes **1.12900e-5** of opposing work versus
**8.30206e-7** from time epigraphs and **2.04154e-7** from affine physical rows.
The preceding contact-discovery step had shrunk the global search radius from
**1.93073e-3** to **1.50838e-5**, although its recorded model ratio was **0.8983**.
This motivates a bounded model-validity experiment, not removing physical
constraints or declaring infeasibility under the user's frozen model.

`trust_region_feature_scope.py` defers global radius feedback for the existing
event that rebuilds the contact model after constructing a direction. It
retains the previous radius until a fresh QP, while all original physical and
stationary gates remain mandatory. Controls preserve ordinary contraction,
expansion, moving-boundary deferral and unresolved-roundoff behavior. The first
control invocation lacked the installed `ipctk` path and is retained as an
environment invocation failure; the correctly configured invocation passes.
`feature-scope-normal-584-592` starts from exactly the same saved numerical
state as the preceding full physical attempt. Its result must establish any
action benefit; the algebraic diagnostic and policy controls do not admit it.

The model-feedback trial finishes at **180.012 s** runtime (**181.775 s** wall),
still unadmitted because contact insertion exhausts the shared deadline.
Identical saved numerical seed hashes are verified in
`contact592-search-feedback-checkpoint.json`. Its full energy reaches
**0.14375469**, versus the baseline's **0.14469549** under the same 180 s budget.
After the recorded model discovery it accepts a full **5.58146e-3** direction;
the final accepted direction is still **2.66521e-3**, above the original
**1e-7** stopping threshold. This is improved bounded progress, not a frame,
whole-action or realtime pass. Independent frame592 body/mesh admission has
not run. Both snapshots are retained; the candidate remains disabled for
production and can only seed another explicit bounded research attempt.

The subsequent `feature-scope-normal-584-592-resume` also fails at the unchanged
deadline: **180.001 s** runtime, **182.002 s** wall. Full energy reaches
**0.14217087**, but the last unscaled update is **5.55950e-4**, with only one
quarter accepted. This remains above **1e-7**. The selected resumed frame592
chain totals **720.977 s** runtime and **728.432 s** wall, excluding the alternate
baseline branch, independent probes and earlier frames. It is not a cold
runtime measurement. Saved positions, physical velocities, boundaries and
origins are finite. Independent frame592 body/mesh admission has not run.

`contact592-model-feedback-open-checkpoint.json` is this stage's recoverable
checkpoint. The last admitted local step remains **frame584 / 0.608333333 s**;
frame592 is the minimum outstanding physical step. Restoration-request,
same-position gradient-cache and incremental-coordinate repairs are included
in the admitted local action regression, not a complete normal/cancel replay.
The small-guide cost policy remains unselected. No candidate is enabled for
production. Full-outfit continuous contact, original-JS rounding enclosure,
complete action, realtime and native-GPU gates remain open; a GPU or permission
gap does not explain this unresolved internal numerical/contact problem.

The existing environment can reproduce the last admitted local continuation
with a fresh output name (run from the archived `ipc-stage` directory):

```sh
PYTHONPATH=../ipc-deps:../deps OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 run_piece_peak_refinement.py --seed-run full-envelope-normal-568-576 --seed-check full-envelope-prefix576-continuation.json --start 576 --stop 584 --resume piece-peak-direction-normal-576-584/frame-584 --output replay-frame584-local --step-budget 180 --total-budget 210 --iterations 30
node /workspace/bubu/research/animation-0.1.0/animation-foundation-v1/secondary-motion/cloth-probe/coupled-verify.mjs ../inputs-portable.json replay-frame584-local
PYTHONPATH=../deps python3 check_full_time_reference.py replay-frame584-local replay-frame584-reference.json
PYTHONPATH=../deps python3 admit_local_continuation.py replay-frame584-local replay-frame584-admission.json
```

Do not overwrite prior outputs. The unresolved step can be reconstructed using
`run_feature_scope_refinement.py`, admitted seed `piece-peak-normal-576-584`,
seed check `piece-peak-prefix584-continuation.json`, start584/stop592 and resume
`feature-scope-normal-584-592-resume/frame-592`. A fresh bounded output is
required; that resume is an unadmitted numerical state, not an accepted physical
frame. Repository-wide Node/integration counts from earlier stages are not new
validation evidence for this isolated Python experiment.

### 2026-10-27: original residual and proxy-support history audit

No orphan Python validation process remained on recovery. The last failed
QP generation has no raw result: its solve began with only **1.698 s** left in
the shared deadline. The recorded **5.55950e-4** update is not evidence of a
stationary plateau. `audit_contact592_replay_curvature.json` rejects an attempted
exact replay: objective/gradient/curvature match bit-for-bit, while affine
constraints do not. That failed audit is retained, not interpreted as passing.

`audit_contact592_constraint_replay.json` narrows the difference to **810 versus
808** base rows; strain keys match and all non-proxy augmented rows are
bit-exact. Three saved body support rows become one current-position support
row. `audit_contact592_plane_selection.json` solves both complete problems
independently with identical objective, norm cones and original tolerance.
Both pass all residuals in **5.642 s / 5.186 s**, with raw updates
**2.66978e-4 / 2.66987e-4** and dual residuals **6.14794e-11 / 6.13509e-11**.
Saved row635 is active with multiplier **-0.00110515**. The similar maximum
update does not establish this cache defect as the dominant convergence cost.

`audit_contact592_verified_curvature.json` uses the independently certified
saved direction, without reusing the absent interrupted result. Reconstructed
gradient and repeated-origin energy/gradient are bit-exact. Four finite-
difference scales give actual/working curvature ratios **0.91093--0.91113**;
the original directional derivative is **-3.55785e-5**. The audit costs
**37.928 s**, is offline, advances no physical state, and does not justify
large material/curvature retuning.

`check_current_proxy_support.json` reproduces the history-dependent face choice
on actual body facet1653 and rendered vertices **3239, 3240, 3252** (cape back
edge). Cached triangle gaps are about **1.046e-7**, while some current best
support gaps are **0.002231 / 0.002560**. Controlled valid cached-plane history
changes the old active set; `current_proxy_support.py` returns bit-identical
current supports under both that history and an independent reset. A truly
interior triangle remains constrained and physical arrays are unchanged.

Earlier stored-state hashes prove the serialized arrays/search settings, not
the omitted proxy-plane cache. This limits exact QP restart claims, without
revoking separately verified local physical geometry checks. The new policy
removes the cache dependency rather than serializing unnecessary historical
forces. `run_current_support_refinement.py` retains the same models, controllers,
guards, full constraints, original stopping tolerance and independent admission
gates. Its actual frame592 result must determine whether to adopt the repair;
the isolated tests above are not physical-frame acceptance.

`current-support-normal-584-592` subsequently closes the local **0.616666667 s**
step in **56.094 s** runtime (**58.484 s** diagnostic wall). Original unscaled
update **7.99460e-8**, dual **5.67715e-10**, physical strain
**[0.80182916,1.199999999999]**, volume ratio **0.29712867**, zero pin/boundary
error and centroid residual **1.69643e-16** pass the unchanged gates. The
stationary reference restores all **1,606** time rows from **1,579** working
rows; physical rows are bit-exact within that solve. Independent original-body,
F32/area, whole-segment strain and cell-direction checks pass in their declared
conditional scope.

The actual rendered mesh has zero sampled crossings, strain
**[0.81372826,1.19999717]**, seam error **8.43508e-8** and zero render-pin error.
Full, left-contact and back stills were inspected: no obvious crossing/open
seam; piping faceting persists. The diagnostic body omits face and other V2
details and is not final appearance acceptance. Convex solver outer wall is
**29.039 s**, other runtime **27.054 s**; independent body/area audit costs
**0.513 s**, actual-mesh audit **0.095 s**. The selected same-frame resumed chain
totals **777.070 s** runtime / **786.916 s** wall, excluding alternate comparison
branches, independent probes and previous physical steps. This is not cold
runtime or realtime. `contact592-closed-checkpoint.json` binds the evidence;
`current-support-prefix592-continuation.json` permits only local continuation.
The proxy support selection is retained for the next isolated validation;
production, full normal/cancel, original-JS and full-outfit continuity remain
unadmitted. The next physical target is the original **0.625 s** counterexample.


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


2026-10-29 domain-correction evidence, under external `ipc-stage`:
- `domain-correction-checkpoint-20261029.json`: distinct numerical/physical
  status, bounded attempts and accumulated continuation cost.
- `diagnose608_trust_restriction_v2.json`: boxed/unboxed problems are explicitly
  different numerical problems; neither is equilibrium admission.
- `diagnose608_domain_correction.json` and `domain-correction-frozen-trial-v2/`:
  real rejected direction, local correction, independent body/area/orientation/
  whole-strain and actual F32 triangle/seam/pin checks. The unconverged trial's
  zero timing placeholder is not a runtime measurement.
- `check_domain_correction_witness.json`: real new-time lifecycle and exact
  original-coordinate guide-bound verification.
- `domain-corrected-v1-witness-history-check.json`: the sole V1 correction time
  had been retained by an earlier fallback before that correction.
- `domain-corrected-v2-normal-600-624/`: latest bounded failure and source hashes.

First diagnostic failures remain in their original files: a dual-weight
formatting assumption and a geometry fixture missing topology-storage setup.
V2 harnesses fix them without overwriting those failures. Frozen source hash
manifest `frozen-hashes-domain-correction-20261029.json` in the parent evidence
directory rechecks all 12 model/controller/baseline files. No commit, push,
full video, or production enablement occurred.


`collaboration-reference-activity-20261029.json` is the current standalone
follow-up for dot: same-generation active-set observations, actual current-point
original-reference residuals/update, and cumulative unadmitted continuation
cost. `contact608-original-reference-current/` saves that complete reference QP
and its own coordinate origin. `diagnose608_reference_trial.json` preserves
the reference direction's actual domain backtracking.
`compare608_symbolic_cache.json` separates backend replacement from symbolic
reuse; `symbolic-cache-adoption-20261029.json` explicitly rejects selecting it.
`check_symbolic_kkt.json` binds the independent small-matrix behavior tests.
No newly admitted physical frame, completed animation, or realtime acceptance
is claimed by any of these diagnostics.


`time-max-guidance-checkpoint-20261029.json` indexes the fixed-origin semantic
and guidance audit. `temporal-origin-audit-20261029/audit.json` contains every
family's branch time/value gap, near-max count, positive multiplier count,
original-coordinate multiplier sum, and both shadow QPs. Its NPZ files keep
their separate solutions. `temporal-all-branch-gradients-20261029.json` extends
the fresh-gradient check to every branch, not just selected maxima.
`temporal-history-invariance-20261029.json` adds a genuine new nonmaximal time
in memory and checks unchanged E/g/both metrics.
`schur-directional-audit-20261029/` binds the correct saved point, direction,
finite-difference probes and feature changes; the older stored QP origin is
explicitly different. `temporal-native-family-overlap-20261029.json` records
cross-family native aliases without authorizing energy/constraint deletion.
All are diagnostic evidence, with unchanged production-disabled status.

`reference-bound-checkpoint-20261029.json` records the subsequent admission
repair and its limits. `check_original_reference_state.json` covers the F64
threshold counterexample, stale state/direction/generation, required reference
flags and physical-check mutation. `reference-bound-replay600-20261029/` and
`reference-bound-replay608-20261029/` bind fresh QPs at the saved actual states:
600 still passes locally, 608 still fails, and neither state is moved.
`total-directional-energy-20261029.json` records finite differences of total
material/contact energy at the latest 608 state; it is not a continuous proof.
The opt-in `run_domain_corrected_reference_bound.py` harness uses the new
current-state reference adapter and step policy. Earlier evidence-bound code
is preserved, and no new candidate is enabled in the product.

`check_original_reference_step_v3.json` additionally exercises the actual v2
and v3 step functions with controlled certificate/geometry fixtures: the same
tiny move is incorrectly admitted by v2 but remains unadmitted by v3 when its
iteration or time budget ends. A second current-origin reference permits v3
admission. These three flow tests do not confer physical acceptance.

`guidance-curvature-checkpoint-20261029.json` indexes the next isolated
globalization stage. `guidance-rebuild-audit-20261029/interpretation-v2.json`
and `guidance-globalization608-20261029/comparison.json` separate fresh row
construction from conservative exclusion of a verified trial. The bounded
rejection-guided, checked-backtracking, hierarchical-backtracking and
Schur-projected runs preserve their failures and source bindings. Their QP
and metric tests are not physical-frame admission.

`second-order-restoration-checked608-20261029/diagnostic.json` verifies one
full corrected trial; `second-order-recorded-normal-600-608/` retains the
subsequent failed actual continuation, per-iterate numerical checkpoints and
the complete failed restoration QP. `soc-deadline-check-20261029/check.json`
checks local versus shared deadlines without running a physical solve.
`soc-row-degeneracy-v2-20261029/audit.json` independently reproduces the
failure and checks the origin-side separation construction, without a QP.
`soc-degenerate-tangent608-20261029/`, `soc-oriented-tangent608-20261029/` and
`soc-shortened-predictor608-20261029/` preserve the failed recovery alternatives.

`feasibility-feedback-normal-600-608/` records the first trust-feedback
replay and its remaining unboxed-radius defect.
`feasibility-trust-check-v2-20261029/check.json` includes that missing branch
alongside the unchanged SOC and moving-history behavior. Current physical
coverage remains the conditional 0.625-second checkpoint; 0.633333 seconds,
full normal/cancel actions, continuous full-outfit acceptance and realtime
are still unproved. No new video or production enablement is implied.

`original-reference-only-normal-600-608/` is the bounded full-reference
control, also unadmitted. `feasibility-feedback-row-audit-20261029/` traces
its predecessor's box conflicts to the body proxy supports and preserves
their failing original residuals. `convex-triangle-support-audit-20261029/`
independently verifies an outward-rounded separating axis for the same
triangle/convex-body geometry. `unadmitted608-actual-surface-probe-20261029/`
contains the original-mesh F32 verifier's one-state contact/strain/seam/pin
results, with physical convergence explicitly false.

`direct-physical-context-check-20261029/check.json` verifies equivalent row
construction; its timings are not an isolated whole-frame comparison.
`repository-validation-globalization-20261029.json` binds the complete
application-check log and records the prior sandbox failures and remaining
skips separately from animation research acceptance.

`support-representation-checkpoint-20261029.json` is the recoverable end of
this stage. It separates passed local representation checks, failed original
stationarity, and unrun full-action/native checks, with exact reproduction
commands and backup-manifest paths.
`convex-support-sat-v2-geometry-check-20261029/` binds the guarded whole-hull
fallback and its eight geometric behavior groups; the first test-fixture
failure and source snapshot remain separately preserved.
`support-sat-model-invariance608-20261029/` checks unchanged P/q/gradient,
physical energy and time models at the real failure state.
`check_original_reference_proxy_state.json` binds seven admission behavior
groups, including support mutations during physical checks.
`support-sat-v2-reference600-20261029/` preserves the existing local acceptance.
`support-sat-v2-normal-600-608/` retains the failed full step and numerical
checkpoints; `support-sat-v2-runtime-cost-20261029.json` separates runtime
from the unrun offline final audit.
`support-sat-v2-current608-reference-20261029/` contains the fresh original
QP and its failing update threshold. The corresponding `reference-trial`
JSON records the exact remaining cloth/right-hand witnesses and alpha=1/128.
`support-sat-v2-current608-actual-surface-20261029/` contains the independent
F32 snapshot results without physical admission. None is a full video,
continuous full-outfit proof or native GPU benchmark.

`reference-contact-checkpoint-20261029.json` records the next stage and its
conditional 0.633333-second continuation.
`reference608-mechanism-comparison-20261029.json` binds the fixed-time/researched-time diagnostic and the rejected
rank-one metric experiment, including fresh original-reference solves at both
trial endpoints. `support-sat-v2-reference-origin-time-audit-20261029/` is the
independent no-QP audit of the two distinct native families.

`reference-backtracking-normal-600-608/`, its `resume` run, and
`metric-backtracking-normal-600-608/` / `metric-backtracking-finish-normal-600-608/`
preserve all failed numerical attempts and their costs. In
`reference608-admission-trace-20261029/`, original stationarity and physical
checks pass but the F32 residual mutates the proxy support cache. The first
`reference608-query-admission-20261029/` and
`reference608-query-isolation-check-20261029/` retain the ineffective direct-residual variant. The corrected
`reference608-projection-query-isolation-check-20261029/` verifies the actual
call path and unchanged original QP fields. Independent
`check_support_projection_query_route_20261029.json` adds five actual-route
fixtures including true penetration and exceptions.

`projection-query-backtracking-normal-600-608/` contains the admitted local
step, original reference certificate, independent body/area audits and actual
F32 mesh verification. `projection-query-prefix608-continuation.json` authorizes
only conditional research continuation. `projection-query-baseline600-20261029/`
preserves the old baseline. `projection-query608-stills/` and
`projection-query608-right-contact-stills/` show the actual model; their visual
review preserves the visible piping bend rather than claiming appearance
closure. `check_reference_backtracking_v2_boundaries_20261029.json` binds five
deadline/witness/stale-origin flow tests. The fresh multi-frame driver
`projection-query-next-normal-608-624/` stops at 616 without admitting a new
frame; it is not a completed trajectory. None of these artifacts is a new
production default, full animation demo or hardware benchmark.

The next stage is indexed by `moving616-joint-body-checkpoint-20261029.json`.
`audit_moving616_invariants_20261029.json` and
`audit_moving616_saved_direction_split_20261029.json` bind the moving-boundary
consistency checks. `moving616-guided-20261029/` preserves its successful QP
and a failed logging attempt; `moving616-guided-path-20261029/` replays the
saved direction without another QP. `moving616-without-guidance-20261029/`
is an ablation, not an admitted reduced-constraint solve.

`moving616-original-mesh-20261029/`,
`moving616-body-proxy-audit-20261029/` and
`moving616-first-body-crossing-audit-20261029/` retain the true body collision.
The first crossing primitive and the later back-edge penetration differ.
`check-joint-body-path-20261029.json`, `check_joint_body_deadline.json`, and
`check_reference_backtracking_v2_boundaries_joint_body_20261029.json` cover the
actual body regression, late proofs and existing final-step fail-closed flow.

`joint-body616-resume-20261029/`, `joint-body616-equilibrium-20261029/`,
`joint-body616-full-box-20261029/` and
`joint-body616-original-descent-20261029/` are bounded research attempts; none
may be promoted from a numerical checkpoint alone. The actual snapshot audit
in `joint-body616-actual-mesh-20261029/` passes geometry but its independent
original reference in `joint-body616-original-reference-20261029/` fails
stationarity. `joint-body616-reference-ray-20261029.json` records the remaining
hand-contact limitation. `boxed616-full-vs-lazy-20261029.json` compares the
identical frozen QP; its certificate cannot be used at another physical origin.
The checkpoint is authoritative for later diagnostics and continuation state.

`joint-body616-latest-mesh-20261029/` and
`joint-body616-latest-reference-20261029/` bind the final numerical snapshot:
geometry passes, fresh original stationary update .00578485758 still fails.
It supersedes the earlier full-box snapshot only as a research resume origin,
never as an admitted frame. `frozen-hashes-joint-body616-20261029.json` in the
external evidence root verifies the same 12 frozen sources. Repository and
external archive manifests use the `joint-body616-20261029` tag and preserve
the existing restore chain.


`audit_joint_body_admission_paths_20261029.json` and its installed-chain
correction `audit_joint_body_installed_chain_20261029.json` bind the focused
acceptance audit. `trial-geometry-contract-20261029.json` checks real 600/608/616
structure; the earlier failed fixture-setup log remains recorded.
`check-verified-trial-path-20261029.json` preserves real safe origins and the
known body-penetrating counterexample. `verified-trial-flow-boundaries-20261029/`
and its v2 rerun cover volume, area, recovery, stale tickets, unique evidence
names and partial timeout proofs using explicitly scoped service mocks.
`check-trial-error-evidence-v2.json` tests early-failure metadata isolation.

`verified-trial-baseline600-20261029/` and
`verified-trial-baseline608-20261029/` recompute original reference certificates
and full common safety checks on the prior admitted local origins.
`verified-trial616-two-step-20261029/` retains two real safe numerical commits,
17 rejected trials and the uncompleted physical frame. Its incoming velocity
remains unchanged. Later continuation states must be distinguished from this
snapshot and from physical admissions.

`verified616-curvature-comparison-20261029.json` binds the same-origin
original/time-curvature comparison, bit-identical original problem inputs,
and fresh reference certificates at both numerical endpoints. The first
`verified616-curvature-original-20261029/` run retains its logging failure;
only the `original-ready` and `time` results are compared. The added curvature
is not adopted. Original KKT and contact feasibility pass in both cases;
original stationarity does not. None is a full physical frame or native
performance result.


`verified-trial-transactions-audit-20261029/` preserves the late-velocity
finalization defect and verifies the old resume serializer was safe.
`verified-trial-velocity-commit-20261029/` checks six old/new success/error/timeout
cases. `verified-trial-flow-final-20261029/` reruns the six acceptance-boundary
fixtures on owner v3 and step v2. `verified-contact-failure-evidence-20261029/`
verifies self-contained rejection witnesses and stale-metadata clearing.
These small fixtures explicitly mock QP/contact services; they are not full
animation proofs.

`verified-trial616-four-step-20261029/` and
`verified-trial616-continuation-20261029/` retain subsequent safe numerical
moves and the complete shared-budget failure. The final reference and original
F32 snapshot are `verified-trial616-final-reference-20261029/` and
`verified-trial616-final-mesh-20261029/`; geometry passes and stationarity fails.
The `latest-mesh` snapshot refers to the preceding four-step state, not this
last origin. `verified-trial-final-driver608-20261029/` replays the prior admitted
608 origin through the final opt-in driver including independent audits.
The stage checkpoint is `verified-trial616-checkpoint-20261029.json`.


`verified-actual-rejection-evidence-20261029/` replays the first saved real
rejected proposal through owner v3 without a QP and preserves its precise
retained-EE domain witness in the standalone trial file. Final source and
resume details are bound by `verified-trial616-checkpoint-20261029.json`.
Application check/integration logs use the `verified-trial-application-*` names;
the restricted initial failures are distinct from permitted passing runs.
The external root's `verified-trial-foundation-20261029/summary.json` preserves
one missing-osqp failure. `verified-trial-cloth-probe-rerun-20261029.json` binds
the successful 55-test dependency-corrected stage; aggregate 875/875 combines
those stage records and does not rewrite the original report as passed.

Frozen-file and repository/external backup manifests use the
`verified-trial616-20261029` tag. The incremental evidence backup extends the
prior joint-body restore chain and also includes this foundation output folder.
No commit, push, publication, default-candidate activation or demo recording
occurs in this stage.


`tangent616-checkpoint-20261029.json` records the bounded same-origin nonlinear
correction stage and its mathematical problem. `tangent616-origin-ray-20261029/`
binds the unchanged reference problem, full-path backtracking and separate
distance/guard derivatives. `tangent616-current-original-control-20261029/`,
`...-margin-control-20261029/` and `...-nonlinear-correction-20261029/` are the
three compared numerical trials; their `original`, `margin` and `corrected`
reference folders recompute the unrestricted original gate at each new state.
`tangent616-origin-margin-20261029/` retains the earlier serializer failure,
not a passing report or benchmark.

`tangent616-margin-rejection-20261029/` records the linear versus quadratic
geometric predictions. `tangent616-margin-exact-segments-20261029/` independently
checks all four saved cases using rational segment geometry without native IPC
or another QP. These are fixed-time local diagnostics, not continuous proofs.
`tangent616-current-corrected-mesh-20261029/` verifies the corrected snapshot.

`tangent616-corrected-ordinary-flow-20261029/` preserves three accepted numerical
moves followed by an original-QP certificate failure. Its augmented matrices,
vectors, origin and failed decimal certificate are the next precision minimal
reproduction. `check-tangent616-ordinary-origin-20261029.json` and
`tangent616-ordinary-final-mesh-20261029/` preserve independent geometry evidence
for that origin; they do not rehabilitate the failed QP or admit frame616.

The `tangent616-20261029` frozen/repository/external backup manifests retain the
previous restore chain and all comparison prerequisites. No new animation,
commit, push, publication, default activation or frame admission occurs.


`precision616-20261029-checkpoint.json` records the frozen-QP numerical audit
and the isolated integrated nonlinear predictor. `frozen616-kkt-capture-20261029/`
preserves native matrices, W, RHS, returned values and callback/refinement
traces. Both native calls complete; the old active-face fallback times out,
so that instrumented whole replay is not marked passed.
`frozen616-kkt-mapping-20261029/` independently separates congruence construction,
coordinate rounding, q and constraint/dual-map errors at90 digits.
`frozen616-full-kkt-linear-20261029/` audits original-W full KKT residuals and a
known-solution iterative-refinement control without another QP solve.

`frozen616-precise-metric-20261029/` and its `...-mapping-20261029/` audit show
the benefit and insufficiency of congruence reconstruction alone.
`audit616_kkt_expansion_precise_seed/` retains its rejected local block repair.
`audit616_kkt_precision_20261029/` independently demonstrates the single-value
rounding floor on the earlier fixed-dual seed. The full unchanged QP passes
only in the combined `frozen616-precise-translation-20261029/` experiment;
`expanded-solution.npz` stores both components. Its single-value `solution.npz`
is an execution proposal, not a replacement for that expanded certificate.

`audit616_kkt_expansion_checks_v2/` and
`audit616_expanded_binding_checks_20261029_v3/` contain7 recovery groups and6
integration/binding groups, respectively. The latter mocks the native backend,
with98 exact raw-bound and96-coordinate exact-sum comparisons. Earlier test
fixture/import/syntax failures remain in their original logs and are not
counted as passes. `expanded-precision-baseline608-20261029/` is a real current
reference and complete-path replay, not a mocked baseline result.

`expanded616-original-flow-20261029/` preserves3 safe numerical moves through
the formerly failing QP. `nonlinear-expanded616-flow-20261029/` records the
first integrated correction and2 moves; `...-continuation-20261029/` records
the stricter rounded-row-check variant,4 moves, rejected final recheck and
shared-budget timeout. Their `nonlinear-correction-*` folders preserve every
augmented QP and trial. Temporary-QP certificates never confer original
stationarity. `expanded616-final-reference-20261029/` and
`expanded616-final-mesh-20261029/` independently recheck the last safe origin:
original QP/conditional geometry pass, stationary update still fails1e-7.

The `precision616-20261029` frozen/repository/external manifests extend the
previous tangent restore chain. No production activation, physical frame
admission, recording, packaging, commit, push or publication occurs.

`audit616_trial_recheck_domain_20261029/` preserves the same-state cold/warm
counterexample and rational gap operands. `audit616_trial_recheck_tube_domain_20261029_v2/`
contains outward center/radius arithmetic proofs and three real-state controls.
`audit616_trial_recheck_tube_v3_boundaries.json` validates41 boundary cases;
`audit616_trial_recheck_acceptance_20261029/` rejects the original bad candidate
through the actual complete ticket/commit path. `tube-v3-baseline608-20261029/`
is the final-v3 real reference/geometry regression.

`tube616-reference-ray-20261029-v2/` compares seven ray positions at one frozen
origin without advancing any state. The first diagnostic invocation is retained
as a fixture assertion failure: its stationary eligibility helper also applies
the1e-7 threshold and was inappropriate as a general binding-only assertion.
`audit616_reference_ray_frozen_qp_20261029.json` and
`audit616_reference_ray_family_switches_20261029.json` identify the finite-model
branch switches and exact norm-ray limits. They do not change any objective or
constraint. `audit616_ray_policy_boundaries_20261029.json` covers seven search
policy rejection/fallback behaviors.

`tube-ray616-flow-20261029/` preserves two safe numerical moves and the subsequent
profile-key report error. `tube-ray616-continuation-20261029/` uses the reporting
fix and passes fresh original stationarity, complete physical/domain checks,
independent body/area audit and actual F32 mesh verification. Its checked
continuation seed is `tube-ray-prefix616-continuation-20261029.json`.
`../tube-ray616-stills-20261029/` contains actual-model diagnostic stills,
not a full animation or native/GPU acceptance.

`tube-ray-normal616-632-20261029/` preserves the automatic next-frame attempt:
624 remains unadmitted with incomplete boundary motion;632 is not run. Both
accepted616 and failed624 state/velocity snapshots remain available. No
unadmitted snapshot is substituted for the checked physical continuation seed.

`moving-guide624-original-20261029/` and
`moving-guide624-guided-20261029-v2/` are the matched no-state-advance comparison
at624. `audit624_moving_guide_binding_20261029/` and
`audit624_moving_guide_observer_nonzero_20261029/` check non-reference exclusion,
fixed-target restoration, stale generations and observation invariance with an
analytic native-backend fixture, not a physical QP run. The unexecuted first
moving-guide adapter is superseded by v2, which retains all rows as mandatory
and does not claim a numerical trust box.

`moving-guide624-flow-20261029/` preserves the diagnostic trust-box assertion
failure after a valid QP and before a move. `moving-guide624-flow-20261029-v2/`
uses the corrected observer, reaches the full prescribed target, and then
returns to original stationary search. It remains unadmitted.
`tube616-20261029-checkpoint.json` distinguishes this state from the admitted616
physical seed and records all runtime attempts. The `tube616-20261029` archive
manifests extend the verified precision616 restoration chain.


### Deferred contact and curve-bound restoration, 2026-10-29

All following paths are under external `ipc-stage/`; these remain isolated
research implementations. No production default or frozen source changed.

- `moving-guide-fixed624-continuation-20261029/`: further numerical updates,
  180.128786s shared-budget exhaustion;624 is still not an admitted physical frame.
- `fixed624-correction-order-20261029/`: same-origin bounded correction trial;
  original QP and inner correction evidence saved. Outer report serialization
  fails on a numpy boolean; preserve that failed diagnostic log.
- `fixed624-correction-independent-20261029/report.json`: independent complete
  geometry and original-energy replay of both saved trials;20.059597x energy
  decrease, no original stationarity or state advance claimed.
- `audit624-delayed-contact-flow-20261029/report.json`:5 mocked safety cases
  and2 witness-feedback counterexamples. This tests flow semantics, not physics.
- `audit624-contact-ledger-flow-20261029/report.json` and
  `audit624-contact-ledger-resume-20261029/report.json`:7 flow and7 persistence
  cases for all rejected-query callbacks, timeout preservation, payload/path
  binding, and replay before a new QP. Missing sidecar rejects ordinary resume.
- `audit624-curve-path-binding-20261029-v3/report.json`:23 pre-integration
  path/migration boundaries. `audit624-curve-restore-external-state-20261029/`
  adds5 external-search-state rejection cases. These alone missed normal bind.
- `curve-bound-baseline616-20261029/`: actual integration rejected before QP
  because marshal code hashing changed on ordinary execution;no new state.
- `audit616-curve-binding-bind-diff-20261029/report.json`: exact pre/post bind
  differences isolate3 code hashes, with no numerical/path operand differences.
- `curve_path_binding_v2.py` and `coupled_ipc_curve_bound_trials_v3.py`: opt-in
  stable public-code/default/closure fingerprints, installed before consumers.
  `audit616-curve-semantic-bind-20261029-v2/report.json` covers6 actual binds,
  response cache miss/hit, unchanged physical/reference state and genuine
  implementation mutation rejection. The initial class-closure test failure
  is retained separately.
- `curve-ledger-baseline616-20261029/`: real original reference and full
  physical contract reproduce raw update3.42150999e-8 and dual5.42899756e-9;
  runtime24.073402s, independent body/area audit.502967s. Actual F32 mesh audit
  passes. This is stationary-state revalidation, not a cold frame timing.
- `audit624-crossframe-cancel-lifecycle-20261029.json`: current analytic bound
  only covers normal entry below1.2s; full normal and cancel02 still require9s.
  Cancellation completion at.8s is not the acceptance endpoint.

The ledger records pending observations only, never grants a geometry ticket,
never substitutes a temporary-QP certificate for original stationarity, and
never commits velocity on an incomplete frame. Full normal/cancel, original-JS
continuous replay/full outfit and realtime remain open; native GPU remains
unrun, not an explanation for the current numerical and coverage defects.


`curve-ledger624-flow-20261029/` retains six complete-geometry numerical moves,
three successful bounded corrections and the240.083547s timeout in contact-family
closure. All original convergence gates remain unsatisfied;632 is not run.
`curve-ledger624-mesh-20261029/actual-contact.json` passes the discrete real F32
snapshot checks only. Its exporter timing placeholder is not runtime evidence.
The saved frame624 state has zero boundary error and unchanged incoming velocity;
its pending ledger and path/state hashes validate. Last completed original-QP
update.012099340887 belongs to the origin before the last numerical move, not a
fresh stationary certificate at the saved endpoint.
