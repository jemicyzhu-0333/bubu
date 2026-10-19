# Frame-tail diagnostics (negative optimization result)

The initialization refit warm-up experiment is rejected as an overall tail fix. See WARMUP-RESULT.md for the decision and REPORT.md for stage attribution. These are bounded CPU research measurements, not an optimization claim or native/GPU acceptance.

Suggested repository placement:
research/animation-0.1.0/animation-foundation-v1/integration/diagnostics/frame-spikes-20261019/

From the repository root, set DIAG to that directory and run:

    WARM_COUNT=0 node "$DIAG/warmup-compare.mjs" --research-root research/animation-0.1.0 --output /tmp/baseline.json
    WARM_COUNT=8 node "$DIAG/warmup-compare.mjs" --research-root research/animation-0.1.0 --output /tmp/warm.json
    node "$DIAG/stage-profile.mjs" --research-root research/animation-0.1.0 --output /tmp/stages.json
    DETAIL=1 node "$DIAG/stage-profile.mjs" --research-root research/animation-0.1.0 --output /tmp/stages-detail.json

Default research root is inferred from the suggested placement. Pass --research-root when using another location. --output is required. Install pinned research dependencies and materialize the approved D2 fixture using the parent integration README first.

Raw evidence is retained in run1–run4.json and warm-1–warm-6.json. Summaries include source/asset hashes, state hashes, GC overlap, initialization cost, and noisy sampled memory changes. Whitelist and individual file hashes are in manifest.json. Machine-specific CPU profiles, duplicate logs, and archives are excluded.

The scripts were made portable after the measured series: import/output path handling changed, measurement semantics did not. All three scripts pass node --check. A separate 900-frame smoke replay of the portable warmup script passes invariance checks and produces the identical state digest. No production files or acceptance gates changed. The pre-refit stage script preserves the instrumentation variant used for the first three stage runs.
