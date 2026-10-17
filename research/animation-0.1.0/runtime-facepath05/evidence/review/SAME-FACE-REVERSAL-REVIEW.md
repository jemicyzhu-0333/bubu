# Independent same-face reversal review

Result: PASS for the bounded scalar controller and existing eight-layer adapter, not visual approval or full interaction approval.

Reviewed source: src/face-timeline.mjs SHA256 286ded8d6c6992cd0333e1985a0baee0e21dd951dcf3ab91b8bb790cd7641892.

The independently written regression reproduced four failures on the original facepath05 before being run unchanged on facepath06. The final expanded regression passes 10/10 groups. A separate complete npm test run passes 167/167.

Verified outcomes:
- Returning to the active face during withdrawal preserves current value and velocity, brakes without extending an existing brake, and adjusts without forcing a Basis visit.
- Repeated cross/same intent changes during a brake do not restart its endpoint. A final cross-face or cancel retains/restores the explicit old-face zero, Basis, new-face zero boundary.
- Cancellation invalidates old queued work. A genuinely fresh later same-face cue may reverse a cancellation withdrawal, while same-time cancellation precedence remains covered by the full suite.
- Withdrawal reversals within 1e-12 seconds of the endpoint remain on the old semantic. At the exact endpoint, already-achieved Basis is correctly retained as an actual boundary.
- Finite-difference scalar derivatives join continuously; scalar values and velocities remain finite under 6000 deterministic retarget interruptions.
- Near-1e9 clock cases remain bounded and cadence independent. Event and arbitrary-time snapshots match across 30/60/120/240 Hz and a single jump.
- Real source actors pass per-tick all-layer influence assertions, exact cadence parity, and all-zero cancellation across all eight layers. Disposal releases active and pending actor counts.

Specification review: FACE-TIMELINE.md now agrees with same-ID reversal, current-brake reuse, fresh-generation cancellation behavior, neutralAt and arrival diagnostics. FACEPATH06.md states the observed issue and limits. Older FACEPATH05/API prose does not contradict the new policy; it points to FACE-TIMELINE.md for authoritative behavior.

Limits: this review does not certify geometric C1, rendered appearance, full 18-face activation, WebGL/GPU behavior, drag or long-press interaction. Real authored paths remain piecewise linear. The worker/root's continuous visual comparison is a separate gate.

Artifacts: same-face-reversal-independent.mjs, same-face-reversal-independent.json, same-face-reversal-full-suite.txt.
