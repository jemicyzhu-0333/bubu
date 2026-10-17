# Facepath05 small integration contract (work in progress)

Scope: seven explicitly approved semantic slots from the18-slot library, assembled into one immutable shared-body GLB:04, N3, A7,07, S5, R0, N2. The unified18-slot gold asset is archival/reference input, not an assertion that every slot can play in this checkpoint. Original neutral04 remains frozen.

Only the approved figure and exact authored POSITION/NORMAL deltas may enter. The subset is a reproducible copy/selection of reviewed float32 arrays; all source hashes, target names and shared-basis hashes must be recorded. No endpoint interpolation replaces authored interior knots. Every face has eight knots at .125 increments from original Basis, and only the two adjacent knots of that one semantic path may be weighted at a time.

## Identity and complete layers

- Body A_mochi_skin remains unmorphed and stored once; exact approved rest/rig/material/COLOR and weighted geometry are retained.
- Complete face roster: A_eye_L/R, A_eye_highlight_L/R, A_mouth_ring, A_brow_L/R and A_tongue. Missing source layers receive explicit zero deltas and remain neutral. No unknown mesh/target silently skipped.
- Basis is the unchanged original small-O rest. R0 is a separately approved short-horizontal semantic face; R0 at full intensity is not Basis, and cross-face bridges use Basis unless a different geometric transition is independently approved.
- Actors start in Basis with every target weight zero. The profile semanticDefault R0 recommends a future host idle semantic; it does not activate R0 during loading or silently enqueue a first transition.
- Historical face05 is superseded by T05 for the full library. Neither appears in this initial seven-slot subset. Gaze and independently articulated brows/tongue are unavailable; these are authored face layers only.
- Hidden brows/tongue/highlights and closed-mouth interiors may have reviewed zero-area geometry. These are explicit layer contracts, not implicit allowance for arbitrary invalid data.

## Event/transition interface

One application ActorPool owns sources and actors. This purpose exposes semantic face cues only, not arbitrary morph arrays, parallel faces, skeletal motion, drag or pet input. The clock accepts face(id,amount,fadeOutSec,fadeInSec,time) and cancel(fadeOutSec,time). Durations are separate withdrawal and arrival phases, not a total action duration. Exact API and tested continuity construction are in FACE-TIMELINE.md.

A cue samples the current path/intensity first. Same-path changes start from that state. A different path withdraws to exact Basis0 before the new one enters; intervening requests can replace the destination without clearing a visible mesh. A cancel withdraws and removes old future cues. Equal-time cancel wins, and face cues otherwise use insertion order. Event processing is cadence-independent and supports large time jumps. Arrival and any extra braking time must be observable so a readable hold can be scheduled after actual arrival, rather than after request time.

The body and all skeletal transforms remain at source rest in this closure. The application input/interaction layer is not delayed to finish a face. New drag/petting implementation follows only after this library/transition gate.

Continuity is scoped precisely: the bounded interruption clock is C1 in its scalar intensity. Authored POSITION/NORMAL knots form a piecewise-linear geometric path, so vertex velocity can change at a knot even with a C1 scalar clock. The complete facial surface is only claimed C0; actual transition imagery remains a separate gate.

## Loading, resources and limits

Use a distinct versioned approved-face-purpose manifest/profile; neutral-only readiness cannot silently become expressive. Hash-lock the seven-slot compiled source and profile mapping. Apply sparse validation, full dense workload accounting, material/color/normal validation and source numeric parity with the existing explicit Three skin-weight normalization exception. Complete inactive-layer weights reset to zero on every path change.

Do not introduce runtime bank swaps or mutate geometry morphAttributes after rendering. The small subset is resident, body/Basis shared, skin and influence arrays private per actor. Parser ceilings are calibrated from the exact compiled subset inventory and remain independent of the strict neutral/mechanical entrypoints. Record encoded bytes, dense/morph-expanded work, measured decoded backing and renderer packing estimates separately. CPU load/tick evidence is not GPU latency or memory evidence.

## Required gate

1. Source-to-slice exact array proof and full-roster/profile checks, including all neutral-hidden layers.
2. Single-path arithmetic, every knot and intermediate sample, interruption/return/cancel, same-time ordering, 30/60/120Hz and large jumps, bounds, invalid cues, readiness and resource disposal/admission.
3. Actual controller-driven sequences:04→N3→A7;07→S5; R0↔Basis; N2 brow and N3 tongue appear/exit; rapid retarget during both withdrawal and entry. Fixed99px scale, front/quarter/opposite views and normal-speed evidence. Numeric continuity alone cannot approve facial read/bridge appearance.
4. Real WebGL remains unverified unless a supported own-cloud browser runs successfully with its normal sandbox. Blender replay and VM tests must be labelled accurately. No user's computer, saved environment or sandbox bypass.
