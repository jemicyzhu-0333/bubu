# Authored clip CPU evidence

Measured 2026-10-16T19:30:57.742Z to 2026-10-16T19:31:08.382Z.

Node CPU-only actual preparePack -> ActorPool -> createSuite/GLTFLoader -> canonical playClip sampling and owned-resource disposal, using mechanical fixtures.

## Reproduction and source integrity

- Run: `node tools/benchmark-authored-clips.mjs --runs 3 --batches 8 --ticks 256 --warmupTicks 256 --eventSamples 64 --individualSamples 128 --actors 1,4 --out evidence/authored-clip-cpu.json`
- Full configuration and every raw observation are in the accompanying JSON. Measured runs: 3; actors: 1, 4; active/entry batches per run: 8 × 256 group ticks.
- One preparation and one complete shortened lifecycle warmup per case/actor are excluded from reported distributions but retained in JSON. Each measured lifecycle also uses 256 warmup ticks, 2 warmup batches per sampling phase, and 8 warmup event/end/jump samples.
- Fingerprint before: `6949cec44dac2c33f6f392a3206a5055ecfa78fd4aa57bc013f137060368b9fa`
- Fingerprint after: `6949cec44dac2c33f6f392a3206a5055ecfa78fd4aa57bc013f137060368b9fa`
- Unchanged during measurement: **true**. Per-file runtime, harness, fixture and selected Three dependency hashes are recorded.
- Node v24.19.0; Three 0.186.1; AMD EPYC 9V74 80-Core Processor; CPU quota unavailable.

## Workloads and preparation

| Case | Active tracks | Keys | Key scalars | Clip bytes | Runtime vertices | Runtime nodes | Prepare median ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| small-authored-mixed | 3 | 14 | 70 | 3532 | 148 | 16 | 3.001457 |
| small-authored-step | 3 | 14 | 70 | 1290 | 148 | 16 | 2.904321 |
| small-authored-linear | 3 | 14 | 70 | 1296 | 148 | 16 | 3.396904 |
| medium-ceiling-mixed | 16 | 2048 | 10240 | 108266 | 12024 | 71 | 12.496891 |
| medium-ceiling-step | 16 | 2048 | 10240 | 108250 | 12024 | 71 | 11.678397 |
| medium-ceiling-linear | 16 | 2048 | 10240 | 108282 | 12024 | 71 | 7.791233 |
| large-ceiling-mixed | 16 | 2048 | 10240 | 108266 | 45024 | 119 | 29.405286 |
| large-ceiling-step | 16 | 2048 | 10240 | 108250 | 45024 | 119 | 24.484393 |
| large-ceiling-linear | 16 | 2048 | 10240 | 108282 | 45024 | 119 | 22.885060 |

The mixed small case is an exact byte-for-byte copy of fixtures/authored. STEP-only and LINEAR-only cases use the same targets, phases and rotations, with interpolation changed and compact JSON encoding. Each ceiling library uses 15 distinct joints plus one accessory, 128 independently phased keys per track: exactly 2,048 keys and 10,240 key scalars, with compact JSON below the 131,072-byte admission limit. Medium geometry: 12,000 vertices, 24 joints, 64 source nodes and four morph targets; large: 45,000 vertices, 48 joints, 112 source nodes and eight morph targets, each plus the small accessory. These are mechanical load fixtures.

## Runtime distributions (milliseconds)

| Case | Actors | Changed actor ticks | Cached clone group median | Active batch-mean group tick median | Active batch-mean group tick p95 | Individual group tick p95 | Event entry group median | Large jump group median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| small-authored-mixed | 1 | 86.13% | 0.203126 | 0.002633 | 0.003151 | 0.003165 | 0.001752 | 0.002103 |
| small-authored-mixed | 4 | 86.13% | 0.841930 | 0.010598 | 0.012423 | 0.012198 | 0.006360 | 0.007911 |
| small-authored-step | 1 | 1.56% | 0.138419 | 0.000789 | 0.001161 | 0.001122 | 0.001702 | 0.002073 |
| small-authored-step | 4 | 1.56% | 0.702390 | 0.003672 | 0.004943 | 0.005979 | 0.006229 | 0.007712 |
| small-authored-linear | 1 | 100.00% | 0.134062 | 0.003014 | 0.004762 | 0.004517 | 0.001633 | 0.001983 |
| small-authored-linear | 4 | 100.00% | 0.666736 | 0.012366 | 0.017994 | 0.018538 | 0.006069 | 0.007602 |
| medium-ceiling-mixed | 1 | 99.46% | 0.353603 | 0.014200 | 0.017349 | 0.014923 | 0.007441 | 0.010475 |
| medium-ceiling-mixed | 4 | 99.46% | 1.647575 | 0.054761 | 0.064952 | 0.093991 | 0.028493 | 0.039189 |
| medium-ceiling-step | 1 | 21.09% | 0.364069 | 0.006692 | 0.007388 | 0.012108 | 0.007461 | 0.009955 |
| medium-ceiling-step | 4 | 21.09% | 1.414824 | 0.027287 | 0.029631 | 0.051267 | 0.029344 | 0.040101 |
| medium-ceiling-linear | 1 | 99.95% | 0.382808 | 0.014855 | 0.016869 | 0.015884 | 0.007361 | 0.009765 |
| medium-ceiling-linear | 4 | 99.95% | 1.637670 | 0.060936 | 0.070813 | 0.078218 | 0.029515 | 0.040270 |
| large-ceiling-mixed | 1 | 99.46% | 0.610020 | 0.021780 | 0.027577 | 0.031268 | 0.011407 | 0.013891 |
| large-ceiling-mixed | 4 | 99.46% | 2.760945 | 0.093112 | 0.098954 | 0.140152 | 0.046510 | 0.058208 |
| large-ceiling-step | 1 | 21.09% | 0.576450 | 0.010010 | 0.011689 | 0.029184 | 0.011377 | 0.013871 |
| large-ceiling-step | 4 | 21.09% | 2.392789 | 0.047604 | 0.058881 | 0.118999 | 0.047702 | 0.061002 |
| large-ceiling-linear | 1 | 99.95% | 0.633346 | 0.021831 | 0.023271 | 0.023145 | 0.011478 | 0.014752 |
| large-ceiling-linear | 4 | 99.95% | 2.216163 | 0.096468 | 0.117720 | 0.115515 | 0.047041 | 0.059990 |

“Group” means all stated actors. Cached clone measures actual sequential ActorPool.create calls with decoded GLBs held by an untimed seed actor; it includes admission, clone, bindings and initial matrices. Cold decode-plus-seed and individual cached creation timings are separately retained. The seed is removed before sampling, so 1/4 means exactly 1/4 runtime actors. Custom pool ceilings admit the large group and transient seed explicitly.

STEP holds can leave the quaternion unchanged and skip matrix propagation. The changed actor-tick ratio reports actual suite.advance return values during timed active batches, including the original small fixture’s holds. STEP and LINEAR therefore have different write loads; these measurements must not be described as pure interpolation instruction costs. The small counter overhead is included equally for all modes.

Active/entry batch means are throughput measurements: each batch timer covers 256 group ticks; p95 is over batch means. Individual active, enqueue, event-entry, exact-end and large-jump timers each bracket one group operation and retain their separate raw samples. The event-entry timer processes one due playClip per actor; the 0.1-second entry bridge is sampled separately. Enqueue excludes processing and measures an empty queue. Large-jump includes the queued event and terminal evaluation after a 1,000-second skipped interval. Endpoints, active-track ownership, event counts and inactivity are asserted outside timed brackets.

## Disposal and limits

- Every measured and warmup lifecycle returned actor/active/pending, vertices/nodes/deformed vertices, source bytes, key scalar reservations, live decoded resources and retained cache references to zero: **true**. Every decoded load had exactly one matching disposal.
- Actors are disposed once with individual/group timings, then twice more for idempotence; pool disposal is timed and repeated. Actor root children are asserted empty. JSON includes before/after counters for every run.
- Calls to SkinnedMesh.getVertexPosition during measured preparation/runtime: **0**.
- Empty timer-bracket median: 0.000130 ms; not subtracted.

- No browser, WebGLRenderer, GPU draw, GPU skinning, GPU memory, input latency, FPS or target-device performance claim.
- Sample times include JavaScript timer and changed-advance counting overhead; timer overhead is recorded but not subtracted. Shared CPU scheduling, JIT and garbage collection are uncontrolled.
- STEP holds often produce unchanged ticks and skip Object3D matrix propagation, while LINEAR commonly changes quaternion state and propagates matrices. Changed actor-tick ratios are reported; interpolation modes do not imply equal matrix-write workloads.
- Percentiles over active/entry batches are percentiles of batch means, not individual calls. Separately bracketed group calls have their own distributions. A 4-actor group is four sequential actor advances, not four independent timing samples.
- Repeats are within one Node process and machine session, not independent machine trials. Source case order is fixed; actor order alternates between measured repeats.
- Zero owned admission and cache balances prove tested lifecycle bookkeeping, not zero heap retention, zero allocations, or general leak freedom. Historical cache load/disposal counters are expected to remain nonzero.
- Generated medium/large mechanical packs are not approved character art. Geometry dimensions influence load/clone/matrix costs; active animation does not evaluate every skinned vertex on the CPU.

## Track-count coverage boundary

The key-ceiling cases activate 16 tracks × 128 keys. They do not measure the separate maximum of 72 simultaneously active tracks, and these observations must not be described as worst-case performance over all legally admitted clips.
