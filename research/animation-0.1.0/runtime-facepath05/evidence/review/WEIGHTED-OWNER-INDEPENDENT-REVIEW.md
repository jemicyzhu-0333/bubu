# Weighted owner independent functional review

Result: PASS against the final frozen functional source in this candidate.

Evidence:
- `weighted-owner-independent.mjs` / `.json`: 7/7 independent high-risk checks, actual full18 pack loaded, eight facial layers audited.
- `weighted-owner-full-suite.txt`: runtime tests independently rerun, 289/289 passed.
- `weighted-owner-p1-suite.txt`: P1 tests independently rerun, 26/26 passed.
- The JSON records SHA256 of all eight relevant runtime/P1 source modules actually imported. No stub Director, mock face sink, or alternate Timeline substitutes for the real actor tests.

Verified outcomes:
1. ActorPool.createWeighted drives all 18 admitted faces through the same existing eight-layer binding. Each completed face has only the expected active targets; assertCurrent validates complete per-layer weights and unchanged source pose. No legacy enqueue entry is exposed.
2. Autonomous hidden freeze retains shape, RNG state, recent history, decision count and epoch, with hidden wall duration excluded from logical progression. Resume continues the existing hold without redraw/backlog selection.
3. Explicit hidden retirement preserves scheduler RNG/history/count and rebases existing cooldown against the new epoch's local origin. A concrete normal-exit cooldown was verified to wake at the same original logical instant after a long hidden interval, not at a shifted or prematurely expired time.
4. Interaction retirement immediately restores real Basis, advances epoch, and preserves host lifetime highwater. Stale epoch input is rejected without mutation; lifetime reuse rejects; old same-label release cannot clear the new interaction. New work uses a higher lifetime.
5. Observer failures are isolated from the actual actor and remain disabled across retirement. Core bindings remain auditable.
6. Disposing while the actual weighted load is pending rejects readiness, never attaches a late root, and returns pool actor/source/decoded accounting to zero.
7. Weighted loading rejects slice7. The ordinary full18 P0 ExpressionOwner still performs its prior lifecycle correctly. The complete runtime regression suite also passes.

Architecture boundary: WeightedExpressionOwner and ActorPool.createWeighted use the canonical P1 binding, which owns one canonical Director/FaceTimeline. Retirement discards the old Director before constructing the new one while retaining scheduler state; there is no simultaneous duplicate writer. This review did not change functional sources or existing rendered evidence.

Limits: CPU correctness and real asset binding are verified, not browser/WebGL appearance, artistic naturalness, device input behavior or production emotion mappings. All test weights/timing/face choices are mechanical fixtures. Production policy remains opt-in rather than an approved product default. Interrupted cooldown retains the documented semantic-invalidation interpretation; history is accepted-selection history, not exposure analytics.
