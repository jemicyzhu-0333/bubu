# Initialization-only refit warm-up: rejected as overall tail fix

## Decision
Do not implement this as a foundation performance fix. It reliably shifts first-query/refit work into initialization, but costs more startup CPU/wall time, creates transient heap pressure, and does not reliably eliminate long-tail frame violations. No foundation source, accepted asset, dependency, or gate changed. No new archive created.

## Experiment
Six independent fresh Node processes, order baseline/warm/warm/baseline/baseline/warm. Each runs the identical five-fixture, 900-frame input replay. Warm treatment is exactly eight synchronous BVH refits on the already-created private posed surface, before createBody completes. Baseline runs the same instrumentation with zero warm-up calls. It uses a diagnostic Node module load hook only; repository files remain untouched. There are no initialization pointer events, pose changes, clock advances, timers, or fake runtime actions. The regular replay uses the existing deterministic pointer inputs after initialization.

Warm-up source and posed-position buffer hashes, source index hash, bind matrices, morph values, and all bone local/world transforms are checked before/after and equal. Actor time is zero after construction. All six complete replay-state SHA-256 hashes match: 35a21d4910fe (full hash in JSON). Final surface diagnostics agree. This is observed replay equivalence, not exhaustive exact-ray or full acceptance coverage.

## Results
- First changed-pose refit: baseline 8.36–10.35 ms; warm 2.51–3.14 ms.
- Next changed-pose refit: baseline 15.55–16.05 ms; warm 2.72–3.32 ms.
- Added initialization-only warm-up: 41.08–45.70 ms. Total actor construction ranges overlap heavily (baseline 1,067.87–1,145.30 ms; warm 1,065.33–1,318.24 ms), so subtracting total initialization medians would be misleading.
- Sampled warm-up heap delta: approximately +9.99 MB, +10.16 MB, or -8.18 MB depending on collection. The positive sampled peak is approximately 10 MB. These are noisy transient heap observations, not exact allocation or retained-memory claims. RSS delta ranges -974,848 to +262,144 bytes.
- >16.667 ms frames: baseline 2 / 5 / 4; warm 0 / 4 / 5. A zero-tail single run is not reproduced consistently. See JSON for GC overlap and individual query frames.

This is evidence of startup-vs-interaction latency tradeoff, not total performance improvement and not a solution to no-query spikes. Startup cost must remain visible in any future readiness proposal. The existing tail gate stays open; no scheduling cause is asserted.

## Reproduce
From the repository root (diagnostic directory abbreviated as DIAG below):

    WARM_COUNT=0 node DIAG/warmup-compare.mjs --research-root research/animation-0.1.0 --output /tmp/baseline.json
    WARM_COUNT=8 node DIAG/warmup-compare.mjs --research-root research/animation-0.1.0 --output /tmp/warm.json

Raw results: warm-1.json through warm-6.json. Condensed statistics: warmup-summary.json. No per-frame thread CPU counter or forced GC used. Timing includes normal diagnostic wrapper overhead and is CPU-host wall time only, not native/GPU evidence. Memory checks and source hashing add common initialization overhead in both treatments. No full test suite rerun was necessary for a production change because none was made; this experiment itself is not an acceptance-suite replacement.
