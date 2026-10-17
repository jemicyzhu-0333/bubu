# Patch01 review addendum

Current source SHA256: 529185114f8e2c26100654a80db33fa14d7c3445a5776eb62b7712aab14546b5.

New observer isolation behavior: core boundary commits before diagnostic dispatch; first observer throw/unsupported native Promise return disables observer without aborting core advancement. Failure is observable via immutable bounded observerStatus. Critical apply sink is not isolated; host production fault/dispose remains a separate open gate.

43 author tests pass, including14 new observer cases. The historical20 independent P0 tests were rerun by the patch author and pass. Fresh comprehensive reviewer independently passed43/43 plus45 fault-injection/cadence/budget checks, with144 semantic writes per case identical to baseline; see evidence/observer-fix/INDEPENDENT-RECHECK.md. The same no-op-sink microbenchmark has been rerun on patch01 in evidence/benchmark.json; the baseline is retained as evidence/observer-fix/benchmark-baseline.json. These single-host samples do not prove hard realtime bounds or browser/GPU performance.

Historical base handoff below, retained for provenance:

# Fresh-review handoff

Source freeze candidate: src/director.mjs SHA256 `e692c55738e8837e12e25734d63ea8e97478d0e04d0423a38609b32a4d62a454`.

The first independent correctness reviewer passed 20 adversarial tests against this source, including 60 seeded random event histories ×32 batches under different cadences/budgets. Author tests now total29 (the additional test exercises the unchanged DemandLoop). All fixtures are mechanical, not approved acting defaults.

## Reproduce

- `npm test`
- `node evidence/review/independent-p0.mjs`
- `node tools/benchmark.mjs`
- Optional Python dependency: `python tools/check_schema.py`
- `sha256sum -c SHA256SUMS`

Review evidence is preserved rather than summarized as a performance pass. The broader requested new-agent code/performance/mature-open-source comparison gate remains pending; no drag/long-press work should proceed until its findings are resolved.

## Performance boundaries

Operation budget: default64/hard4096 canonical boundary batches per advance; ≤32 events per batch, ≤128 queued batches, ≤32 fixed candidates. Queue shift is bounded O(q); per-batch arbitration O(events). No probability scan exists in P0. Scalar steps use unchanged FaceTimeline. Director callbacks and GC prevent hard realtime guarantees. No hot-path allocation-free claim; record callback and event arbitration allocate.

Latest local microbench host: AMD EPYC 9V74 80-Core Processor, v24.19.0. No-op apply sink; admission/setup excluded. Selected raw results:
- one complete lifecycle advance (5 boundaries): n=10000, p50=4.687µs, p95=11.637µs, max=9901.997µs.
- steady hold sample (no deadlines crossed): n=10000, p50=0.120µs, p95=0.210µs, max=29.114µs.
- 128 queued timestamp batches (full drain): n=1000, p50=279.602µs, p95=569.419µs, max=18250.200µs.
- 128 queued batches budget=1 (one boundary only): n=1000, p50=4.296µs, p95=8.533µs, max=247.113µs.

Do not compare these isolated numbers to full browser frame budgets without measuring real binding, scene, GPU and device behavior. No mature-open-source comparison has been performed here.

## Deliberate tradeoffs to review

- Global lifetime admission watermark, safe integers, O(1) retained identity history; reset clears future timestamp horizon but never recycles admitted lifetimes. Losing/precleared requests consume sequence values. Internal token tracks accepted decisions separately.
- Host closes complete timestamp batches; sealed timestamp inputs reject instead of pretending earlier output can be undone. Partial budget catch-up forbids new admissions; a real host must submit all known events before advancing or wait until catch-up finishes.
- P0 privately owns a clock and exposes a trusted semantic sink; production admitted ActorPool binding is not yet wired, and hostile host JavaScript is not sandboxed.
- One-shot fixed timing only; no autonomous loop, RNG, condition language, cooldown, time-map, visibility/reduced-motion adapter, body movement or device input.
- One logical time domain is required for future visibility integration. Current code does not claim pause/resume support.
- Throwing trusted callbacks are outside contract. Review whether future host integration needs a fail-stop wrapper before deployment.
- FaceTimeline's scalar C1 does not mean geometric C1 or visual approval. Never modify the approved art to make scheduling tests pass.
