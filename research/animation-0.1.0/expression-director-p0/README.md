# bubu expression director: isolated P0, observer isolation 01

An executable fixed-timing foundation, not an approved acting configuration or a renderer integration.

Patch01 isolates diagnostic observer failures. Read spec/OBSERVER-ISOLATION.md; its observer contract supersedes the base P0 observer statements. The original frozen P0 directory is unchanged. Historical evidence/review reports refer to the base revision; patch-specific results are in evidence/observer-fix.

## Reproduce

Requires Node.js ≥22; tested on Node v24.19.0. No npm dependencies or network setup.

- `npm test` — policy/director tests (contract and tests were written before implementation; initial missing-module failure retained in evidence/test-before.txt).
- `node tools/benchmark.mjs` — scalar/director-only microbenchmark; writes evidence/benchmark.json.
- `sha256sum -c SHA256SUMS` — verify packaged closure (generated after final review).

Read `spec/CONTRACT.md` before integration; public API is `src/director.mjs`. `spec/policy.schema.json` describes JSON shape. Runtime validator additionally enforces unique keys and programmatic-entry constraints. Runtime validation is authoritative; optional `python tools/check_schema.py` checks JSON shape with Python jsonschema 4.26.0 (recorded in evidence/schema-check.json).

All fixture numbers are mechanical testing inputs. There are no product cadence, idle-face or emotion defaults. Nothing is automatically played at construction.

## What works

- Exact fixed-duration policy and immutable validated input copies.
- Single privately owned unchanged FaceTimeline, approved seven-slot IDs and source/profile fingerprints.
- Explicit request → arrival → hold → safe exit → gap → done.
- Complete timestamp batches, owner/request identity plus globally increasing safe-integer lifecycle sequence, fixed interaction-over-idle arbitration, true global reset separated from owner release.
- Logical keep/restart hold, deterministic canonical boundaries, bounded resumable advance, demand-loop-compatible boolean advance and unified deadlines.

## What is deliberately absent

No random weights, seeds, condition DSL, cooldown/history, automatic looping, time-map, body motion, input/drag/long-press adapter, visibility adapter, reduced-motion integration, ActorPool wiring, browser/GPU validation, or final artistic timing. Lifecycle labels may be reused only with a new globally increasing `lifetime`; the validator enforces this bounded identity protocol, and reset never recycles admitted sequence numbers. The caller's `apply` callback must be connected only to an admitted binding; this scalar harness does not admit a GLB or prove its visual state. The core apply callback remains trusted, non-throwing and non-reentrant. Diagnostic onRecord runs after core boundary commit; its failures are isolated and disable observation, as reported by observerStatus. Observer mutation remains forbidden. The host must not write the same facial binding independently.

## Design and cost boundaries

Fixed bounded arrays are used instead of a generic event graph. Candidate validation/compilation is O(c), c≤32, once at construction. Each batch has ≤32 events; arbitration is O(e). Queue pop uses array shift and costs O(q), q≤128. Each advance handles at most maxSteps boundaries (default64, hard4096); it does not fast-forward or discard pending work. This is an operation budget, not a hard CPU-time guarantee: callbacks, OS scheduling and GC are outside that bound.

The director intentionally keeps future inputs above the clock rather than filling the low-level queue. This permits owner-specific cancellation without modifying FaceTimeline's global cancel semantics. Policy processing allocates at event boundaries and diagnostic getter reads. No allocation-free director claim is made. Idle/hold samples do not scan candidates or request rendering; a stable hold still exposes its finite expiry.

The microbenchmark excludes constructors and batch admission and uses a no-op output sink. It measures neither original eight-layer binding cost nor scene traversal, morph shader, heap/VRAM, browser battery use, or device input. P50/P95 cannot establish a worst-case guarantee; max outliers remain visible in evidence.

## Review gate

Preserve source hashes, exact evidence and tests for a fresh independent code/performance/open-source comparison review. Resolve its findings before implementing drag or long-press behavior. This package does not fulfill that later gate by itself.
