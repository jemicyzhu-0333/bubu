# Landing R5 independent functional review

Result: no remaining blocking correctness issue in the reviewed CPU/API landing delta. User-visible artistic acceptance is separate.

Frozen sources:
- pointer-host: 9917818fe3d5073348bebd7bcdb7f5bb20e80f867d11f869a0e2e5efb2437a5a
- host-admission: 37ba3eba1003e0e8aec5fbf8781b248e018951fa11f5a2c77d5b43a6f2d293cd
- drag-landing-r5 controller: e402e71b925449585ef808c2161b9dbac3d8dabb82d1c01c01792d4dcf860ffa

Independent execution:
- Final controller tests: 5/5. Approved R4 held trajectories compare exactly; release/settle deadline, cancellation, hidden interruption and frame-rate terminal state are covered.
- Shared integration suite before the final one-line idle-hidden fix: 58/58. Do not report this as a separately run final 59-test suite.
- Final delta tests after the fix: 5/5, including idle-hidden retirement, new-gesture/context cleanup, initialization failure and disposal failure handling.
- Separate actual D2 probe at 30/60/120 Hz: same settle body pose and root placement, sole minimum nonpenetrating (ground approximately 0.00600000005), owner invariants intact, D2 cavity gate zero throughout settlement and idle. Long rest samples through 81 seconds have interactionOwned=false and owner=p1_idle. Hidden then resume does not resurrect R0 or P2. Final actor/cache resources release to zero.
- Independent injected initial RAF failure: actor/cache/decoded arrays and all three tracked listener sets zero.
- Runtime src tree is byte-identical to the reviewed shared-D2 baseline; no second face writer or runtime policy default was introduced.

Defect found and corrected: owner.suspend freezes idle intent when there is no interaction. The first rest-context version therefore left R0 visible in its state while hidden. Host now invalidates the paused owner when the prior facts/context are rest or the owner is p1_idle. The final real-model probe and new regression pass. Before-fix evidence is retained.

Ownership: landingP2 is a research-only candidate with .10 enter / .12 exit; it releases during settle. At .48-second settle completion, the interaction relinquishes ownership; existing P1 idle selects research restR0. New gestures and visibility barriers clear this rest-context routing. The explicit external-owner preemption test is an owner-level contract check, not proof of a new scene/UI coordinator API.

Visual limitation: the sole face timeline still follows P2 -> Basis -> R0. Sampled evidence includes a short Basis interval before P1 R0 entry. This review does not claim an unchanged mouth throughout that bridge or certify the rendered artistic ending. Original 18 expression policies and approved R4 held animation remain unchanged; special idle routing is a workbench fixture, not a production default.

Tests use actual loaded D2 geometry, CPU skin/morph evaluation and fake DOM/capture/scheduler. No real browser/WebGL/OS capture, performance or GPU shader certification is claimed.
