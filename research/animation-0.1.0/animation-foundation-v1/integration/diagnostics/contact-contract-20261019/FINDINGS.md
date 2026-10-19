# Cape / tea contact contract audit

Status: confirmed incompatibility for the current static cape + existing rigid tea endpoint matrices. No production, body, model, trajectory, or cloth solver edits. Analysis outputs only. Full Rapier trial was not run.

## Verified input identity and coordinate frame

- Frozen source: `bubu-wearable-round5-checkpoint-20261018/accessory-expansion/models/07-cape.glb`, SHA256 `e29010956b989a60e196472b2206e6c397b34f12f3b7092d67f53f189c128e21`, matching `verification/model-hashes.json`.
- Baked this frozen GLB with the current foundation loader/admission code. Cached static accessory export, inverse transformed from its 10-degree world yaw, matches frozen positions within 4.45e-16 source units. All indices match except clasp triangle ordering; its unoriented triangle sets are identical. The new collision tests use the frozen geometry directly.
- Current normalized `original-parts-hybrid-v1/tea/src/rigid-tea.mjs` reproduces all 16 cached hand poses within 5.96e-8 source units. Cup-shell/handle/liquid relative transforms reproduce hold-to-sip samples within 1.19e-7. Thus these are real source-runtime contacts, not a coordinate-frame mismatch.
- Source coordinates: GLTF Y-up; +Z is forward. The cached world transform is rotation only, so displacement magnitudes are unchanged in that world frame; source +Z corresponds to world (0.173648, 0, 0.984808). No SI/metre calibration is asserted.

## Reproduced contacts

13 of 16 sampled frames intersect. Entry/exit at 0.6/7.5 seconds crosses cloth and hem (each hand: 140 cloth triangle pairs, 71 hem pairs). Hold at 1.5 seconds has left 175 cloth +73 upper-edge pairs; right 184 cloth +70 upper-edge pairs. Cup shell has 108 clasp triangle pairs at 1.5, 2, 6.2, 6.6 seconds. Sip at 3.4 seconds still has left 120 cloth +70 upper-edge pairs and right 118 cloth +75 upper-edge pairs. These counts are intersecting triangle pairs, not contact areas or penetration depths.

The object named `cape_back_edge` follows the entire top border, including its front portions. Its name must not be interpreted as a rear-only collision. Hold contact envelopes lie around x ±0.13–0.44, y 0.58–0.64, z 0.71–0.77. Clasp contact envelope is x −0.022–0.024, y 0.561–0.610, z 0.775–0.779.

## Structural causes

1. Garment construction offsets the approved body surface by only 0.010 + 0.016*back + 0.035*back*t² source units, with 0.012 cloth thickness and 0.009 trim radius. Its side cutouts fit the neutral hand relationship. The tea hands travel along a body-profile arc toward front grip targets; that path and its endpoints were fitted without cape clearance.
2. The full upper cloth border is pinned in the research prototype: 65 pins, not a few shoulder support pins. Six of those pins are actually inside the two hands at hold and sip. Left particle IDs 427/431/435 and right 6/9/13 are affected. The hands are closed after merging coincident vertices (every mesh edge has incidence 2), and winding magnitude at these interior points is 1.
3. Exact nearest-triangle distance from the deepest enclosed pin gives a necessary lower bound for any pure hand translation that frees all these pins: hold left 0.084620, right 0.082860; sip left 0.084637, right 0.081686 source units. These are lower bounds, not sufficient correction sizes and not bounds on rotation or deformation.
4. The clasp is fixed at the front near source y=0.59, and the hold cup shell crosses it. Cloth-only movement cannot resolve this fixed/fixed conflict.

## Bounded displacement probes

Each probe rigidly translates one mesh forward, tests all frozen cape parts, searches in 0.01 increments, then bisects the first observed blocked/clear bracket to <1e-5. These are first observed surface-clear thresholds along one ray, not globally minimum displacement or a containment/continuous-motion guarantee.

- Entry 0.6 s, left/right hand: +Z 0.193545 / 0.189795.
- Hold 1.5 s, left/right hand: +Z 0.149990 / 0.150361.
- Sip 3.4 s, left/right hand: +Z 0.139102 / 0.122373.
- Hold cup shell: +Z 0.003819. A stronger sufficient Z-projection separation of the cup shell from the entire cape needs >0.009221; add an independently declared margin before admission. Sip cup is already clear; the tiny interval in the displacement JSON at sip represents the search tolerance from a clear zero pose, not a required shift.

A cup change must move the shell, handle, liquid and grip targets coherently. A blanket translation of the cup-hand assembly by the larger hand displacements would invalidate existing lip/rim contact. These probes are not proposed runtime offsets.

## Smallest sound next step

Keep geometry unchanged and test a **constrained endpoint feasibility problem before writing a new motion path or cloth solver**:

- Freeze approved body and hand geometry, required lip/rim contact at sip, cup geometry, and explicit grip/hand-root attachment tolerances.
- Test whether rigid hand orientation/position refits can maintain cup grips and anatomically connected roots while clearing the fixed garment at hold and sip. The current fixed hand matrices cannot pass. An orientation refit around a grip might preserve the semantic contact, but feasibility is not established by this audit.
- Allow a small coordinated hold cup/hand-target adjustment to clear the clasp, tapering to the unchanged sip cup endpoint if feasible. Clasp interference does **not** by itself prove that an asset redesign is mandatory. It proves that the current fixed clasp plus fixed hold pose is inconsistent.
- If feasible endpoints exist, fit clearance-aware entry/lift/return/exit with swept checks. Reuse authored timing, intent, and contact semantics, rather than preserving invalid endpoint matrices. Verify hand/body attachment, both grips, lip/rim contact, all garment pieces, and cancellation/reduced-motion paths together.
- If endpoints are infeasible, either revise the garment attachment contract (unpin only explicitly approved free upper-border sections, preserving supported shoulders; investigate deterministic garment response as a separate research task) or require a design decision. Unpinning alone does not establish a valid garment or performance pass.

This is a contact/attachment feasibility task, not appearance polish and not a quick spring-strength adjustment. Full dynamic cloth remains blocked (~584.6 ms physics P95) and should not be activated to hide infeasible constraints.

## Explicit compatibility policy while unresolved

Represent the exact cape geometry/version + tea action/trajectory version as `blocked: endpoint-attachment-conflict`, with measured part/time evidence. Preserve the equipped cape and current valid pose. Decline starting the conflicting action with a clear reason; do not auto-unequip, hide, cut holes, rescale the body, move the clasp silently, or mark the outfit generally invalid. If tea is already active, do not accept a conflicting equip operation until a verified safe boundary. Any runtime/UI implementation is a separate change, not performed here.

## Evidence and limits

`contact-report.json`, `pin-depth-report.json`, `displacement-report.json`, `runtime-provenance.json`, and their companion scripts are reproducible analysis outputs. Tests cover 16 original keyframes and bounded directional probes, not the complete 271-frame trajectory, cancellation set, continuous collision, garment deformation, native/GPU execution, or visual acceptance. Contact envelopes bound intersected garment triangles, not exact intersection points. No successful compatibility claim is made.

## Foundation contract and smallest garment candidate

Separate three contracts:

1. **Invariant actor geometry**: approved body/hand mesh hashes, anatomical attachment frames, and allowed rigid-motion semantics. Garment fitting must not alter actor geometry or invent a new hand shape.
2. **Action contact contract**: supported action/version and pose range, hand-root attachment tolerances, both grip targets, lip/rim target, and transition/cancellation ranges. Geometry identity alone does not authorize every pose.
3. **Garment contact envelope**: exact render-model hash, attachment/pin map hash, deformable versus rigid piece ownership, allowed deformation/strain, clearance thickness, and supported action/pose ranges. Evidence is indexed by this combination, not by a garment name or spring preset.

Admission first rejects conflicting fixed constraints at the authored endpoints; only then admits transition checks. Passing rest or a loose simulation cage cannot override high-render-mesh collisions. Emit explicit supported/blocked/untested status and part/time/reason; never fall back to a known penetrating rest shape.

The smallest plausible upper-border candidate is **two local front-side free border arcs**, not a global change to the cape:

- The measured interior pin groups are coarse columns 2–4 (particle IDs 6, 9, 13) and 60–62 (427, 431, 435). At minimum, those six must cease being immovable if the existing hand matrices are retained.
- Start research with one adjacent column of transition padding: columns 1–5 (IDs 3, 6, 9, 13, 17) and 59–63 (422, 427, 431, 435, 438). This is a localized candidate, **not a tested sufficient release set**. Determine final arc boundaries from complete swept hand envelopes and strain/seam constraints.
- Preserve actual shoulder support regions and central fixed closure; let the corresponding upper piping, adjoining cloth, and thickness offsets deform coherently. Merely unpinning particles while leaving `cape_back_edge` rigid would retain the blocker.
- At the deepest measured interior pin, garment material must move at least about 0.085 source units to exit the unchanged hand volume, before clearance margin. This is substantial relative to 0.012 cloth thickness; it needs an explicit allowed-strain/deformation envelope and visual review. It cannot be disguised as numerical tolerance or tiny jitter.
- This option preserves the existing sip lip contact because the hand/cup pose can remain unchanged while the two garment arcs yield. The fixed clasp still needs the small coordinated hold-pose adjustment described above, or an explicitly approved closure design revision. No tested contact-safe or real-time garment solution exists yet.

Recommended order: implement/verify the general admission contract independently; keep this exact cape+tea combination blocked; evaluate the two local free-border arcs offline with frozen actor poses and an explicit deformation budget. Only if all endpoint/contact/seam checks pass should a bounded runtime adapter be considered. Do not repeat the expensive full Rapier trial at this stage.
