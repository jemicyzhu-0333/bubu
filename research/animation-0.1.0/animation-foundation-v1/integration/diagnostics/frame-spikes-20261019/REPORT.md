# Remaining frame-tail diagnostic, 2026-10-19

## Result
10,800 additional deterministic CPU replay frames (four processes, each three passes of five 180-frame fixture sweeps). No source, asset, dependency or acceptance-threshold edits. Existing full correctness suite was not rerun because this is an external diagnostic harness, not a code change. This does not certify native input, GPU, appearance, contact or production readiness.

There are two observed patterns, not one proven root cause:

- Repeatable pointer-down/refit pressure: the detailed fourth run has three slow query frames at 26.52, 29.42 and 30.63 ms. Inclusive BVH refit wall time is 18.64, 23.43 and 25.08 ms respectively. Those frames overlap GC events of 1.21, 16.90 and 10.49 ms; overlap is evidence of a contributing pause, not proof of exclusive causation. The other eleven refit frames range 7.45–13.32 ms total, refit 3.18–7.43 ms. Same full-resolution mixed surface, unchanged triangles and posed buffers.
- Non-query tails migrate: separate stage-only processes observed 109.96 ms in a frame dominated by anchors and 152.51 ms dominated by attachments, plus 165.92 ms dominated by body. These had no recorded GC overlap. They cannot be attributed to BVH refits (zero queries/refits), nor to host scheduling using current evidence. The old per-frame thread CPU method remains discarded.

The steady body cost is largely exact floor evaluation: third-run instrumented minimumFoot median 1.02 ms and P95 2.26 ms per frame (inclusive across calls), versus whole body median 1.46 ms/P95 3.27 ms. Existing complete-pose affine floor cache already exists; do not add a weaker cache or remove source validation. The whole-process V8 sample profile included initialization and disposal, so its aggregate leaf attribution must not be treated as frame-only attribution. The machine-specific profile is intentionally excluded from the portable evidence package.

## Recommendation
Do not land a speculative runtime change or mark the tail gate passed. The most focused next experiment is a bounded initialization-time BVH-refit warm-up comparison, with unchanged full-resolution geometry, exact hit equivalence, memory envelope, and startup cost measured. This tests the repeatable first-query/refit component only; it is not a proposed cure for all tail spikes. A second optimization candidate is reducing temporary allocation in complete floor-pose signatures while preserving all existing invalidation inputs, but the present data does not establish that allocation as the source of the largest outliers.

For arbitrary no-query spikes, obtain a trace with V8 GC/JIT events and OS scheduling evidence in the target host before assigning causation. Keep all native/GPU gates open.

## Reproduction and limits
Run from the repository root (diagnostic directory abbreviated as DIAG below):

    node --expose-gc DIAG/stage-profile.mjs --research-root research/animation-0.1.0 --output /tmp/stage-run.json
    DETAIL=1 node --expose-gc DIAG/stage-profile.mjs --research-root research/animation-0.1.0 --output /tmp/stage-detail.json

The harness reproduces FoundationActor frame ports/order with timed wrappers, same real assets and deterministic pointer inputs. No inter-frame correctness traversal occurs; this intentionally isolates runtime stages and is not the original acceptance harness. It yields between fixtures only to collect PerformanceObserver GC events. Passes 1/2 reuse the actor and continue time; they are repeated workload passes, not identical initial-state replays. Instrumentation itself adds cost. Detailed minimumFoot and snapshot timings overlap; never sum nested detail stages into whole-frame totals. GC events may overlap a frame partly. The script writes rows and slow frames only after measured replay.

run1/run2 are stage-only; run3 adds body timings plus 100 microsecond V8 sampling; run4 adds body and BVH-refit timing without V8 sampling. The final script includes optional refit timing; stage-profile.before-refit.mjs preserves the prior script used by runs 1–3 (detail flag unused for runs 1–2). Raw JSON includes all frame/stage intervals and GC events. summary.json includes source hashes and all pass percentiles. No acceptance threshold was relaxed.
