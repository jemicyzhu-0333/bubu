# Animation foundation research checkpoint

The current foundation composes the approved D2 face/input owner, original-parts
hybrid, anatomical anchors, authored accessory actions, secondary motion and
bounded effects. It remains a research runtime. Full wardrobe/contact acceptance,
stable frame timing and native/GPU validation are separate gates.

Install once at `research/animation-0.1.0` using its pinned lockfile. All consumers
must resolve one physical Three.js 0.186.1 instance. Use Node 24+ and Python 3
with NumPy and SciPy. The checked-in source archives restore D2/full18 locally.
The business-event adapter stage also requires the pinned main Git object
`1a66a0d3b7a51b19ac843b80f6629d0eb20eeb18` retained by its source manifest.
A shallow single-branch checkout must obtain that baseline before running the
complete suite; the verifier does not fetch or substitute a different baseline.

```sh
npm ci --ignore-scripts
npm run foundation:verify -- --output /tmp/bubu-foundation-new-run
```

The output directory must be new and outside the research source tree. The
verifier records commands, individual test counts, source hashes, environment,
fresh CPU integration and contact replay. A failed stage stops the run and is
recorded as failed. Historical reports are never overwritten. A passing research
run retains `productionAccepted: false`; outstanding gates are listed separately.

## Current capability boundaries

| Capability | Executable scope |
| --- | --- |
| Body/face/input | Actual approved D2 geometry, single face owner, original drag/pet/landing profiles; shared browser/CPU composition and real Chromium checks |
| Anchors/actions | Final-pose surface anchors, bounded authored accessory tracks, interruption, face/contact/effect ports |
| Equipment/resources | Scoped equip generations, preservation during replacement I/O, shared original-parts leases, bounded CPU claims and independent cleanup |
| Contact admission | Exact actor/action/garment identities; supported/blocked/untested decisions before action start and equip commit |
| Scene/theme | Existing ledger/coordinator decisions; production mapping and native business/rendering integration remain separate |
| Secondary/effects | Existing bounded chains, rigid-body release and effect lifecycles; full cloth remains isolated |

The contact registry contains the measured round5 cape/tea blocker. It contains
no broad positive compatibility claim. Endpoint samples cannot authorize complete
motion. Changing a mesh, attachment or trajectory identity requires fresh evidence.
The active integration's earlier cape model is a different version and remains
untested by the round5 audit.

The private round5 cloth research now versions its attachment conditions:
original 65 and legacy 55 supports remain failed baselines; the corrected
51-support profile removes fourteen exact inside-hand witnesses. Analytic
motion bounds certify retained fixed-point clearance, including the original
particle radius, without changing source art or controllers. Free cloth and
actual render strain still fail. A separate rigid piping-section mapping
removes early cross-section collapse but is not a complete collision solution.
See [the cloth probe](secondary-motion/cloth-probe/README.md) and
`verification/binding-continuity-20261024/` for evidence and remaining scope.

The next actual-surface audit is in `verification/cloth-surface-20261024/`.
An explicit body-frame detail and joined-piping candidate clears the saved
0.5167 s render compression but retains the 0.5333 s piping/body collision.
The complete nine-second path cancelled at 0.2 s passes sampled contact,
strain, pins and joined seams; neither all cancellation times nor production
cloth is admitted. The complete outfit retains 481 clear samples. Its three
rigid head-mount pairs additionally have a conditional continuous separation
certificate for a common proper rigid transform; dynamic/body pairs remain open.

The [integration contract](integration/README.md) describes ownership and limits.
No source body, face shape, accepted model, main branch or release is replaced.

## Interactive V2 demonstration

Run `npm run foundation:demo` from the research directory and open
`http://127.0.0.1:8766/animation-foundation-v1/demo/`. The demo includes the
original-parts body, actual pointer petting/drag/landing, all 18 expression paths,
five accessory fixtures, their five-mount outfit, authored reactions, a synthetic
book release, and the isolated nine-second tea choreography. Camera views, dark
background, pause and reduced motion are available. Book collision is a cuboid
proof; tea is deliberately isolated and does not acquire wardrobe compatibility.
The current fixture cape is not the frozen round5 cape used by the blocker audit.

Browser and Node now share the entire foundation coordinator and binding
preparation. Equipment staging preserves the prior outfit on synchronous failure,
uses a separate bounded effect runtime, and reports post-commit retirement errors
without rejecting an applied replacement. Existing expression candidates are
reused for exact face/amount/timing requests instead of consuming duplicate slots.
Production contact, full cloth and native hardware frame-rate gates remain open.

`demo/capture.py` verifies the browser composition and can produce an MP4 from
actual rendered frames using `--record`. Its 24 fps sample clock is explicit;
the video is not evidence of realtime throughput. Reports and recordings must be
written to a new directory outside research sources. `demo/package.py` packages
only the fetched local dependencies plus licenses into an offline runnable ZIP.

## Historical design audit, 2026-10-20

The production closure remains **not accepted**. These are separate findings,
not five alternative names for the same test gate.

| Finding | Resolution / current evidence |
| --- | --- |
| V2 browser workbench imported a nonexistent nested Three installation | Fixed to the pinned shared dependency. The foundation's browser-safe host composition is now also used by its Node fixture. |
| Replacement I/O removed working equipment too early | Fixed: all asset loads and decoded-resource admission complete first. Partial/late failure releases candidates and preserves the committed outfit. Synchronous composition was still open in this historical audit; the current implementation above closes that equipment transaction gap. |
| Resource admission accepted NaN geometry and understated large backing allocations | Fixed: finite transforms/attributes, triangle index range and distinct backing-buffer accounting, with behavioral regressions. |
| Several individually supported garments could never obtain complete outfit admission | Added explicit exact-set evidence, independent of order. It does not infer compatibility or register invented positive evidence. |
| Verification omitted browser entry files and could follow output symlinks into source evidence | HTML/CSS included in source inventory; output is canonicalized and the evidence adapter rejects all research paths, including nested symlinks. |
| Browser observations contained nonstandard `Infinity` JSON, and the timing gate omitted the three-pass profiler | Fixed: explicit string encoding for non-finite observations, strict JSON serialization regressions, and performance aggregation across integration, profiling and browser intervals. The first complete-stage run failed its final JSON summary and is not retained as an overall pass. |
| Fixed cape/tea attachment constraints were mutually incompatible | Conservative endpoint exclusion covers the full 360° rigid-hand twist, with root and source grip each allowed 0.01 source units. All four hold/sip hand endpoints remain blocked; minimum certified margin exceeds 0.003 source units. This bound does not apply to larger endpoint refits or deforming garments. |
| Ten local free upper-border pins were assumed a plausible repair | Actual 60-step Rapier experiments still fail high-model contact and strain. Both exact-hand trimeshes and convex-hand diagnostics remain far outside the frame budget. These start from an intersecting sip pose; they do not disprove every safely initialized motion path. |
| Catalogued assets were being confused with accepted action/outfit coverage | The catalogue is inventory, not coverage. The active fixture uses an earlier cape; round5 evidence cannot be transferred by name. Full wardrobe/cancellation/continuous contact remains open. |
| CPU host passed while real rendering was unmeasured | Actual Chromium/SwiftShader checks now cover shaders, pointer capture/drag/release, DPR 1/1.25/2, context restoration and three resource recreation cycles per DPR. These cover the D2 body path, not the whole hybrid/wardrobe scene or native desktop windows. |

The initial browser residual-texture suspicion was disproved by resource events
and WebGL allocation stacks: all nine actor bone textures and eight morph
textures release; one Three renderer fallback sampler remains stable. Do not
report this as a fixed actor leak or as physical GPU byte recovery. This
distinction follows the [Three disposal contract](https://threejs.org/manual/pages/how-to-dispose-of-objects.html).

The final hand-trimesh cloth experiment measured physics P95 about 540 ms;
convex-hand diagnostics about 546 ms. Both retain actual high-model contact failures and
excessive strain. These use the installed
[Rapier soft-body API](https://rapier.rs/docs/user_guides/javascript/soft_bodies/);
switching collider representation is a diagnostic, not an admission shortcut.
The original body, hand meshes, fixed clasp and accepted garment files remain
unchanged. No experimental cloth is registered with `FoundationActor`.

A three-pass, 2,700-frame CPU profile recorded OS main-thread CPU time and GC
overlap. One run reproduced 13 frames above 16.667 ms, with a 29.934 ms maximum.
These frames consumed comparable main-thread CPU time and showed no overlapping
GC entries; they cannot be dismissed as merely uncharged scheduling delay.
A separate instrumented V8 sample retains function samples and deoptimizations,
including startup; it does not establish a single cause of the spikes.
Software WebGL RAF P95 ranged from about 218 to 259 ms in the initial browser
runs. Native Windows/macOS input, transparent windows, physical GPU memory,
stable target-device frame rate, and integrated full-outfit rendering remain open.

The October 20 rerun and diagnostic artifacts are retained in
[audit-20261020](verification/audit-20261020/audit-summary.json). A passing verifier
means its declared checks passed, while production gate failures remain explicit.
It is not an overall release approval.

To include actual Chromium checks in the unified run (Python Playwright 1.62.0,
an installed browser, NumPy and SciPy are required):

```sh
npm run foundation:verify -- --output /tmp/bubu-foundation-browser-run --browser /usr/bin/chromium --software
```

Use `--headed` and the target browser path for a visible run. Only use `--software`
when intentionally measuring software rendering; the report records renderer
identity. Neither option turns this fixture into native Electron desktop evidence.
The independent cloth experiment is reproducible with
`node animation-foundation-v1/secondary-motion/cloth-probe/endpoint-probe.mjs --frames 60 --output NEW_EXTERNAL_DIRECTORY`;
`--convex-hands` selects the explicitly labelled collider diagnostic.

## Current composition audit

The final follow-up verifier passed 33 stages, 799 Node cases and two Python
cases with an unchanged source inventory during the run; evidence is retained
in [followup-20261024](verification/followup-20261024/summary.json). Application
checks passed 6,742 cases with 29 skips, and integration passed 71/71. These are
functional/research results, not production acceptance. The same run observed
a 16.952 ms CPU-frame maximum and software WebGL RAF P95 of 206.6 ms.

The October 24 follow-up keeps the canonical models unchanged. The five-mount
fixture now owns its composition fit: a 0.04 crown-normal halo offset removes the
halo/flower crossing in the same 481-frame, 60 Hz replay. The later bounded flower/leaf fit removes two further pairs; nine other surface
pair crossings remain. Attachment contact classification, containment and
continuous-time separation are not established. Run `node
animation-foundation-v1/contact/outfit-sweep.mjs NEW_EXTERNAL_DIRECTORY` from the
research root; append `--reference` for the original halo, flower and leaf placements.

Contact identities now include the normalized configuration, instance placement,
secondary settings and a private clip-library snapshot. Custom loader overrides
cannot borrow canonical contact provenance. Demo scene selection releases the
authored expression it clears from the UI; paused frames avoid repeat rendering
while camera changes can still redraw once.

The two-knot morph shader is an isolated experiment, not enabled by the actor
factory. Its 612 WebGL comparisons match the reference byte for byte, but the
interleaved software RAF measurements do not establish a stable speedup. Keep
the existing render path and the failed performance gate. The client GL call
measurement is not a hardware GPU timer.
The experiment's exact recorded sources are archived separately. The dependency
gate rejected an attempted callback-composition change to the pinned D2 style;
that source was restored byte for byte, and the final 19 dependency hashes pass.

Remaining local work is explicit: define allowed attachment-contact regions and
fit the remaining satchel/ear/cape combinations, then validate a collision-free
cloth initial state through the complete action under the existing strain and
frame budgets. Native Windows/macOS input, transparent windows and physical GPU
recovery still require target hardware. Dense samples cannot replace continuous
collision or containment proof. No positive production contact record was added.

## Remaining-item audit and bounded repairs

The next verifier run passed 36 stages, 805 Node cases and two Python cases,
with unchanged sources during validation. Its evidence is retained in
[remaining-20261024](verification/remaining-20261024/summary.json). This is still
research validation; `productionAccepted` remains false.

The default complete outfit now places sakura at `[0, .0125, 0]` and leaf at
`[-.0125, 0, 0]`. Actual front/side renders cover asserted idle, drag and landing
states. The 481-frame replay removes both flower/leaf crossings, measures a
0.000421 minimum surface gap, and preserves their relative transform to within
1.2e-15. Nine other pairs remain. The original configuration is retained by
`outfit-sweep.mjs --reference` and still reproduces both crossings.

`fit-obstruction.mjs` verifies exact welded, closed body/feet and hand topology.
Connected inside/outside surface witnesses establish that the current satchel
pouch/body and strap/right-hand crossings persist throughout the existing
translation box (maximum movement 0.053385). Observed internal distances are
0.089168 and 0.117770 respectively. This is not an exclusion of rotations,
private deformation or a new versioned attachment contract, and does not prove
that approved source meshes must change. The other seven pairs remain open.

A separate tea candidate translates the cup assembly and both hands together
by at most 0.0098 near hold; sip and rest retain the original positions.
1,173 samples of the full action and eight cancellation trajectories reduce
cup/cape crossing frames from 112 to zero. A conservative motion enclosure
certifies surface separation from the fixed clasp over 295 intervals, with a
minimum certified gap of 0.000452. The enclosure is tied to exact source hashes.
It does not cover arbitrary cancellation times, hands, moving cloth or body
contact, and this candidate is not enabled in the default demo or registry.

This analysis also reproduced tiny negative cup scales at exact cancellation
endpoints in the frozen timeline. `integration/tea-sample-boundary.mjs` now
normalizes only excursions up to 1e-12 before strict render admission, without
mutating the source sample or changing the frozen controller. Larger or
inconsistent values still fail. The demo uses this boundary.

Rapier profiling identifies narrow-phase collision as the main cloth cost.
A private body proxy derived by support bounds encloses all original body
vertices with a measured negative plane margin; its maximum distance from the
original convex hull is 0.007961, below the declared 0.01 limit. Combined with
the existing convex-hand diagnostic, a 60-step endpoint trial records physics
P50/P95 24.70/36.87 ms and full mapping/contact P95 95.08 ms. This is a substantial
cost reduction, but frame limits, render contact and strain still fail (edge
ratios 0.6206–1.4337 against 0.8–1.2). Converting the same proxy to a trimesh did
not improve the result. Both candidates stay isolated. Feasible initialization,
seams, self-contact and the complete action/cancellation path are still needed.

The final CPU replay maximum is 13.116 ms, while software WebGL frame interval
P95 remains 201.2 ms. Sparse morph/skinning experiments do not establish a stable
drawing improvement and remain disabled. Native desktop and physical GPU gates
are not run. Previous failures and interrupted diagnostic attempts are retained;
no failed production gate or original model is replaced by a passing sample.

## Motion-fit convergence and remaining design gaps

The complete outfit retains full secondary motion while applying bounded rigid
offsets: satchel `[0.005258461059488644, -0.009985710937233348, 0]` and cape
`[0, -0.025, 0.04]`. The 481-frame replay removes the four motion-induced pairs
from the earlier nine, leaving five pre-existing rest-fit crossings. Maximum
private deformation remains approximately 0.2323 for the satchel and 0.1295 for
the cape. Actual Chromium front/side/back, drag and landing views were checked.
No source model, tea controller, pin, spring profile or angle bound changed.
`outfit-sweep.mjs` now fails if those four dynamic pairs return; `--reference`
restores all five original zero offsets, preserving the original failures.

The same-pose rest-geometry control isolates the four failures to secondary
deformation. Root bone scale stays within 3e-8 of one. The sphere guard checks
chain endpoints, not every rendered triangle or neighboring garment. A uniform
angle cap derived from the original 0.000232 strap/cape gap removed the crossings
by rejecting all 480 deformation steps; that functional regression was rejected.
The accepted offsets use the existing mount bounds instead. The first strap-only
fit introduced 15 strap/cape crossings; the final lower cape fit removes them.

Five rest-fit pairs remain: three flower/body pairs, pouch/body, and strap/right
hand. The prior closed-volume witnesses exclude the existing translation-only
box for the two satchel pairs. A 328-plane local flower solve is infeasible, but
does not prove global nonlinear infeasibility or require source-model changes.
Further work needs a versioned attachment/rest-fit candidate with explicit
surface contact and shape/seam criteria. Private-copy implementation may remain
within the repair scope; do not label this as a hardware blocker or silently
expand bounds, reclassify failures as allowed contact, or rewrite approved art.

Rest-initialized cloth now supplies a concrete counterexample at 0.55 seconds:
render trim intersects the body while the simulated thin surface is clear and
strain still passes. A uniform radius enclosing the render offsets overlaps
40 retained fixed pins with the actual body and fails strain at the first step.
The required next implementation is a localized cloth/trim collision envelope;
neither warm initialization nor uniform inflation closes it. Original fixed-pin
infeasibility and these 55-pin solver failures have different scopes.

The zero-weight bone-read shader remains an isolated prototype. Nine pixel
comparisons were exact, but balanced software timing did not show stable benefit
(reference draw/sync medians 126.7 and 113.4 ms; candidate 132.2 and 121.0 ms).
It was never enabled in the actor/demo, so there is no default-path rollback.
The clasp certificate still covers only the fixed clasp and the declared cup
trajectories; hands, body, moving cloth and runtime admission remain blocked.
Physical GPU and native Windows/macOS acceptance remain not run. No new video
or distribution package is produced by this convergence work.

CPU profiling locates the first-click spike in posed-surface BVH refitting:
one baseline frame takes 17.259 ms (body stage 15.840 ms, no overlapping GC),
and the detailed replay attributes 11.657 ms to refit at the same interaction.
One unchanged refit is now exercised during query preparation, with its cost
reported as `preparationRefitMs`. Native hit equivalence remains strict. A more
aggressive coordinate-frame cache failed three equivalence cases and was
withdrawn; it is not part of the default query. Preparation work and repeat-run
timings cannot close the physical-GPU or stable-frame-rate gates on their own.

An additional private-copy fit proposal can clear pouch/body with roughly
0.108808 outward movement. Keeping all four vertices of each authored strap
cross-section together prevents width collapse, but its maximum edge ratio is
still 1.2834 and it introduces two cape crossings. This candidate remains
rejected outside the runtime. It is evidence for the required joint shape/seam
fit, not authorization to broaden mount bounds or to rewrite the source GLB.

The final [convergence evidence](verification/convergence-20261024/summary.json)
passes 36 stages, 815 Node cases and two Python cases with unchanged verification
sources. The application check passes 6,742 cases with 29 explicit skips and
integration passes 71/71. Software Chromium input/context/resource checks pass;
physical GPU/native checks remain not run. Query preparation refit costs 5.734 ms.
The three CPU profile maxima are 13.143/8.691/6.652 ms, but the independent
900-frame integration replay still reaches 16.678 ms and software browser frame
interval P95 is 199.5 ms. Stable frame time is still failed. Audit, rejected
candidates, raw logs and source manifests are retained alongside the summary.

## Local cloth/contact audit, 2026-10-24

The [local-contact evidence](verification/local-contact-20261024/audit.json)
records research repairs, rejected candidates and outstanding implementation
work. Production acceptance remains **false**. A locally fitted body proxy now
independently checks full body containment, convex/closed topology, the original
0.01 global hull-error bound and actual initial garment/trim clearance. The old
conservative proxy overlapped four trim pieces at rest. The new 930-vertex proxy
has a minimum initial garment gap of 0.000064691 and maximum outer error 0.008919.
It changes no approved source geometry.

The diagnostic now checks 29 actual rendered fixed-point witnesses at 1e-5;
fixed simulation particles alone previously hid a 0.000357 visible drift.
Region-owned collision bindings cover detailed cloth and piping separately, and
short diagnostic runs cannot claim the full nine-second action endpoint.
These are research contract/representation corrections, not accepted cloth.
The centered detailed-skin candidate still reaches 1.20646 rendered edge stretch
at 0.0667 s. A thin-cloth/piping candidate reaches 1.28794 at 0.5167 s despite
compliant coarse edges. Adding local triangle shape matching instead overextends
cloth-to-piping links to 1.27659 at 0.0833 s and incurs a 19.159 s first step;
that separate diagnostic is rejected and removed from the research source tree.
Saved snapshots reproduce these failures independently of the original solver run.

Same-volume body partitions reduce the last failed sample's narrow-phase cost
from 184 to 69 ms, but increase solver cost from 149 to 280 ms; overall physics
P95 worsens from 337 to 351 ms. This option remains diagnostic only. Material
transfer, seam coupling, detailed collision coverage and solver CPU cost are
implementation gaps, not physical-GPU blockers. The five remaining full-outfit
pairs persist in all 481 samples. Cup/clasp retains its limited 1,173-sample and
295-interval certificate; original 65-support cape/tea compatibility remains
blocked. Existing bounds do not prove all private-copy fits impossible or that
unfreezing source models is necessary.

The final [verification](verification/local-contact-20261024/summary.json) passes
36 stages, 828 Node cases and two Python cases with unchanged tested sources.
Application validation passes 6,742 cases with 29 explicit skips; integration
passes 71/71. CPU integration P95 is 2.655 ms, but one profile reaches 18.618 ms
and software Chromium frame-interval P95 is 194.9 ms. Stable frame time remains
failed. Native desktop and physical GPU acceptance remain not run. This phase
produces evidence/backups only, with no new demo recording, distribution package,
commit or push. See the cloth-probe README for commands and scope limitations.

## Flower/body repair, 2026-10-24

The [flower fit](verification/flower-fit-20261024/audit.json) closes three actual
sampled crossing pairs in the shared Node/browser assembly. Before the repair,
`sakura_petal_1`, `sakura_petal_2` and `sakura_leaf_-019` intersected `Bubu_body`
in all 481 action samples, with 65/86/177 intersecting triangle pairs and maximum
tested-vertex depths 0.038794/0.040267/0.027326. These were persistent overlaps;
the recorded worst-depth frames differ only by floating-point noise across poses.

Private rigid part frames now rotate around the original petal centres and leaf
tip. Source asset bytes and vertex/normal/index buffers remain identical, as do
mount bounds, offsets, materials, controllers and secondary motion. All three
pairs are clear throughout the same idle, pending, petting, drag and landing
replay, with minimum actual triangle gaps 0.004818/0.003365/0.007680. The complete
outfit now has two sampled failing pairs: pouch/body and strap/right-hand.
No previously cleared pair reappeared. The fit identity is part of contact
evidence; incompatible actions remain blocked.

Actual browser review covers frontal/oblique/back views, action phases, light and
dark backgrounds, and 1x/2x rendering. Fourteen final default-path captures are
pixel-identical to the reviewed candidate. One earlier Playwright element-stability
screenshot attempt timed out and is retained as failed evidence; the successful
retry verified three consecutive RAF canvas bounds before clipped page capture.
This is local visible-contact repair, not full continuous/self-contact,
cape/tea, real-time cloth, stable-frame-rate or native/GPU acceptance. No new
recording, distribution package, commit or push is part of this phase.

Final verification passes 36 stages, 831 Node cases and two Python cases with
unchanged tested sources. Application `check` passes 6,742 cases with 29 explicit
skips; integration passes 71/71. Software browser frame-interval P95 is 217.5 ms,
so stable frame time remains failed. Native desktop/physical GPU checks remain
not run. The [summary](verification/flower-fit-20261024/summary.json) preserves
these gates independently of the three repaired flower pairs.

## Satchel/body and strap/hand repair, 2026-10-24

The [satchel evidence](verification/satchel-fit-20261024/EVIDENCE-INDEX.md) closes
both remaining sampled crossing pairs. The pouch, flap and catch share a private
rigid frame about the original support vertex. Binding-owned rigid calibration
keeps the satchel spring origin and the daily cape mount origin fixed. Instance
offsets stay within the existing bounds; approved model buffers, materials,
controller modules, pin weights and maximum spring angles are unchanged.

All 481 idle/pending/petting/drag/landing samples are free of cross-garment
surface intersections. Minimum hand/strap and body/pouch triangle distances are
0.019338 and 0.038776. Pouch/strap embedding persists in every frame (42–55
intersecting stitch triangles), without changing the pouch/flap/catch relationship.
This is a looser waist-sling placement; it does not certify a pointwise sewn seam.
The actual maximum secondary displacement is 0.200147 for the satchel and
0.128897 for the cape. Parameters and amplitude limits remain unchanged; the
new assembly orientation does change the simulated waveform.

Fourteen final default-path browser captures match the reviewed candidate
pixel for pixel. The first whole-satchel tilt was rejected because its rest
success became 10 hand-crossing frames and new cape crossings during motion.
Finite orientation/offset nominations were followed by full dynamics and actual
renderer review. The original before-state is retained, including its exact
source backup, rather than relabelled as a passing scene.

The audit also found stale geometry bounds in an external distance diagnostic.
Corrected full replay and the shared surface probe agree on the final gap;
previous flower clearances were rechecked and remain unchanged. Executable
fit modules and matrices participate in attachment identities. Construction
failure, private ownership, reset and renamed mount behavior have regression
coverage. No canonical application state or IPC contract changes.

Final verification: 36 stages, 838 Node cases and two Python cases pass with
2,014 tested source identities unchanged. Application check passes 6,742 cases
with 29 explicit skips; integration passes 71/71. CPU P95 is 2.555 ms, but software
browser interval P95 is 248.4 ms. Stable frame rate remains failed; native desktop
and physical GPU remain not run. Full wardrobe contact is **not-established**:
sampled separation does not prove continuous contact, containment, self-contact
or intended-contact classification. Production acceptance remains false.

The round5 tea cape is a different frozen asset. Independent winding checks
find six fixed supports inside the hands across its saved tea keyframes, with
maximum exit distance 0.11739. Original 65-support compatibility remains blocked;
released-support candidates still fail cloth/material/CPU gates. A separate
local piping capsule-envelope nomination covers the original trim triangles.
Its first refined body proxy failed degeneracy checks; a quantization-safe
candidate passes independent body containment, the unchanged 0.01 global error
limit and static gaps. It is not a default runtime path and has no dynamic,
seam, strain or performance acceptance. The unresolved attachment scope question
and these implementation gaps are retained separately from native/GPU conditions.
No new recording, distribution package, commit or push accompanies this phase.

## Earlier engineering baseline, 2026-10-20

[Earlier research report](verification/closure-20261020/summary.json): 27 stages
passed, 775 Node test cases passed, and the before/after research source inventory
matched. Four isolated contact analyses reproduced the frozen reports; cape and
tea exports matched their frozen source outputs. Logs, source hashes and the
lossless archive manifest are retained beside the report.

[Application validation](verification/closure-20261020/application-validation.json):
`npm run check` passed with 6,742 tests passing and 29 environment/optional-backend
skips; separate application integration passed 71/71.

The current 900-frame CPU replay measured median 1.346 ms, P95 3.058 ms and maximum
16.150 ms. It is one shared-host run, not a stable frame-rate or native/GPU pass.
Historical spikes remain relevant. The exact cape/tea conflict and full dynamic
cloth remain blocked; full wardrobe, native input and GPU recovery remain
unverified. The archive does not promote any of those gates.
