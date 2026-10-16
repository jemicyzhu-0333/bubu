# CPU workload matrix

These tools generate mechanical boxes and channel offsets. They do not contain bubu art, approved animation, drag behavior, or a rendering benchmark.

## Reproduce

- Quick harness check: `node tools/benchmark-matrix.mjs --quick --workloads vertices-small,combined-large --out evidence/cpu-matrix-smoke.json`
- Main evidence: `node tools/benchmark-matrix.mjs --runs 10 --out evidence/cpu-matrix.json`
- Tests: `node --test tests/measurement.test.mjs`
- Inspect generated packs separately: `node tools/build-workloads.mjs --out /tmp/bubu-workloads`

The matrix creates packs in a temporary directory and removes that directory even after an error. No generated multi-megabyte GLBs need to be committed. The separate generator command leaves its explicitly selected output intact. Raw evidence contains GLB and manifest hashes, generator/runtime source hashes, environment observations, samples and configuration.

## Workloads

The baseline is 12,000 vertices, 8 animated joints, 64 GLB nodes and 4 full-mesh morph targets. Each isolated sweep changes one dimension:

- Vertices: 1,008 / 12,000 / 45,000; all other dimensions stay at baseline.
- Joints: 4 / 8 / 48; unchanged node count includes passive nodes replaced by bones.
- Nodes: 16 / 64 / 112; the animated joints and mesh complexity stay fixed.
- Morph targets: 2 / 4 / 16; every target has full-mesh deterministic offset data.
- Combined high case: 45,000 vertices, 48 joints, 112 GLB nodes, 8 morph targets, 405,000 deformation-budget units.

The resolved runtime has two more nodes than the GLB. All generated cases must pass the real package validation, integrity checking, numeric GLB preflight and runtime binding. Asset, accessor-scalar and deformation limits still apply. A size increase is not assumed to cause proportional steady CPU cost: skin/morph vertex deformation would ordinarily occur on the GPU, which this measurement does not invoke.

## Units and boundaries

The default matrix runs 10 workload cases at 1 and 4 actors, with three repeats unless `--runs` overrides it. The committed evidence uses ten repeats. These are repeated runs in one Node process, not ten independent machines/processes. Actor-count order reverses on alternate repeats; workload order stays fixed.

- `preparePack`: reader, JSON validation, hashing and numeric preflight. The files were just generated, so this is not cold-disk I/O.
- `preflightOnly`: numeric/structural preflight of bytes already resident in memory.
- `create`: first actor starts with an empty decoded-resource cache; later actors share the decoded source. This does not mean cold OS/JIT/GPU state.
- `steady`: playback starts outside each timer; the timed work advances all actors through active interpolation. Percentiles of `millisecondsPerOperationBatchMean` describe **batch throughput per group tick**, not individual-call latency. `millisecondsPerActorTickBatchMean` divides by the number of actors too.
- `individual`: a separate timer around each group advance. These observations are **individual group-call CPU latency**, including timer and actor-loop overhead. They are not frame latency.
- `queue.enqueue`: validation, allocation, insertion and sorting for a bounded event burst. Means divide total batch time by total enqueued events.
- `queue.processDueEvents`: an advance processes the prepared burst and final sample/matrix update. Its per-event mean is throughput, not one event's latency.
- `mixed`: advance plus play enqueue/processing every 60 canonical ticks.
- `idle`: explicit advance calls after motion settles. The real demand scheduler would generally omit these calls.
- `actorPool`: actual concurrent creation, immediate pending reservation, active ownership, an over-budget rejection, deduplicated GLB accounting and final disposal. Its limits are explicitly sized for each group; they can exceed the engine's defaults.

`ActorPool.sourceBytes` counts unique encoded GLB source reservations. It does not represent decoded heap, caller-owned prepared-pack bytes or GPU memory. Cache releases and accounting assertions are ownership checks, not a garbage-collection or VRAM measurement. Memory snapshots are uncontrolled process-wide observations; no zero-allocation or leak-free claim follows from them.

## Interpretation

All timing samples remain in their acquisition order. Summary quantiles use nearest rank. An empty timing-bracket baseline is retained and is not subtracted. No threshold declares the runtime fast enough for hardware, FPS or user interaction. Shared-host scheduling, JIT and GC can create outliers. Compare repeated distributions, avoid claiming precise ratios from tiny timer-scale differences, and rerun if the source hash changed during measurement. The CLI exits with status 2 when it detects that change.

The `getVertexPosition` instrumentation reports calls to that specific Three.js method across the measured path. A zero result is not a general proof that no code scanned arrays, allocated memory or touched vertices.
