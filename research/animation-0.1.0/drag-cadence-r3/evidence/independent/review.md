# Independent cadence R3 / pointer V2 delta review

Result: no blocking issue found in the requested cadence-isolation delta. Ready for parent publication decision.

Independent tests: cadence 4/4; restored pointer V2 npm test (four pinned dependency hashes plus 19/19 tests).

Additional direct old/new oracle: for each 2.0, 2.4 and 2.5-second cadence, ran the same 180 input frames through the original drag controller and R3. velocity, InputIntent latest observation, lag, lagV and pickupAt were exactly equal throughout; after release at 3.0 with duration 0.6, releaseAt, releaseDuration and descending/rest modes at 3.1, 3.59, 3.6 and 4.0 matched. Pose equality is intentionally not claimed because R3 implements the approved A/B change.

Diff checks: input-intent.mjs and drag-session.mjs are byte-identical to the prior drag prototype. Pickup completion remains 1.075 seconds; speed window, spring coefficients and release timing retain real seconds. R3 cadence defaults to 2.4 and validates the inclusive 2–2.5 range. Fast inertial pose dominance is covered by the cadence tests.

Pointer delta: controller import selects drag-cadence-r3, dragOptions passes through, and pure controller configuration validates before actor allocation. No pointer gesture, face/body writer, lifecycle or release code was changed. Workbench explicitly selects 2.4 seconds. PROVENANCE pins R3 controller/A-B/input-intent and unchanged body profile; restored npm test verified all four hashes and the oracle option-pass-through tests.

Frozen R3 controller: 10199f00bc83bb7fdc06cbb53460a4cdc15579af19d738b2d3115600443b663c.
Frozen publication pointer-host: b5563defbc1aa0d9c9badfe6aa2c2f21ae1d03c5f6d73bf09030e0a970dd678d.

Boundary: CPU functional/diff verification only; no new rig, performance, actual browser/WebGL/OS, or additional artistic approval is claimed.
