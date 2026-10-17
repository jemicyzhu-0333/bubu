# Authored clip CPU evidence

Measured 2026-10-16T19:30:19.499Z to 2026-10-16T19:30:23.093Z.

Node CPU-only actual preparePack -> ActorPool -> createSuite/GLTFLoader -> canonical playClip sampling and owned-resource disposal, using mechanical fixtures.

## Reproduction and source integrity

- Run: `node tools/benchmark-authored-clips.mjs --out evidence/authored-clip-cpu.json`
- Full configuration and every raw observation are in the accompanying JSON. Default measured runs: 2; actors: 1, 4; active/entry batches per run: 4 × 128 group ticks.
- One preparation and one complete shortened lifecycle warmup per case/actor are excluded from reported distributions but retained in JSON. Each measured lifecycle also uses 128 warmup ticks, 2 warmup batches per sampling phase, and 8 warmup event/end/jump samples.
- Fingerprint before: `d0b2272cdd5c7c7fa5a2e168c541aba799e82da7ac57c1ea441c05418ce167e9`
- Fingerprint after: `d0b2272cdd5c7c7fa5a2e168c541aba799e82da7ac57c1ea441c05418ce167e9`
- Unchanged during measurement: **true**. Per-file runtime, harness, fixture and selected Three dependency hashes are recorded.
- Node v24.19.0; Three 0.186.1; AMD EPYC 9V74 80-Core Processor; CPU quota unavailable.

## Workloads and preparation

| Case | Active tracks | Keys | Key scalars | Clip bytes | Runtime vertices | Runtime nodes | Prepare median ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| small-authored-mixed | 3 | 14 | 70 | 3532 | 148 | 16 | 3.164514 |
| small-authored-step | 3 | 14 | 70 | 1290 | 148 | 16 | 2.262303 |
| small-authored-linear | 3 | 14 | 70 | 1296 | 148 | 16 | 2.995889 |
| medium-ceiling-mixed | 16 | 2048 | 10240 | 108266 | 12024 | 71 | 18.089658 |
| medium-ceiling-step | 16 | 2048 | 10240 | 108250 | 12024 | 71 | 10.163292 |
| medium-ceiling-linear | 16 | 2048 | 10240 | 108282 | 12024 | 71 | 11.030610 |
| large-ceiling-mixed | 16 | 2048 | 10240 | 108266 | 45024 | 119 | 42.261890 |
| large-ceiling-step | 16 | 2048 | 10240 | 108250 | 45024 | 119 | 43.873111 |
| large-ceiling-linear | 16 | 2048 | 10240 | 108282 | 45024 | 119 | 49.354380 |

The mixed small case is an exact byte-for-byte copy of fixtures/authored. STEP-only and LINEAR-only cases use the same targets, phases and rotations, with interpolation changed and compact JSON encoding. Each ceiling library uses 15 distinct joints plus one accessory, 128 independently phased keys per track: exactly 2,048 keys and 10,240 key scalars, with compact JSON below the 131,072-byte admission limit. Medium geometry: 12,000 vertices, 24 joints, 64 source nodes and four morph targets; large: 45,000 vertices, 48 joints, 112 source nodes and eight morph targets, each plus the small accessory. These are mechanical load fixtures.

## Runtime distributions (milliseconds)

| Case | Actors | Cached clone group median | Active batch-mean group tick median | Active batch-mean group tick p95 | Individual group tick p95 | Event entry group median | Large jump group median |
|---|---:|---:|---:|---:|---:|---:|---:|
| small-authored-mixed | 1 | 0.232170 | 0.002883 | 0.004846 | 0.003506 | 0.001983 | 0.002363 |
| small-authored-mixed | 4 | 0.736381 | 0.012341 | 0.017021 | 0.013941 | 0.006450 | 0.007942 |
| small-authored-step | 1 | 0.144759 | 0.000825 | 0.000829 | 0.002754 | 0.001732 | 0.002123 |
| small-authored-step | 4 | 0.595408 | 0.003638 | 0.004618 | 0.011117 | 0.006270 | 0.007782 |
| small-authored-linear | 1 | 0.201534 | 0.003247 | 0.004398 | 0.003645 | 0.001713 | 0.002104 |
| small-authored-linear | 4 | 0.610130 | 0.014723 | 0.022479 | 0.015223 | 0.006240 | 0.007812 |
| medium-ceiling-mixed | 1 | 0.407184 | 0.013865 | 0.023471 | 0.013610 | 0.007491 | 0.010105 |
| medium-ceiling-mixed | 4 | 1.426662 | 0.056904 | 0.063572 | 0.070467 | 0.029734 | 0.040742 |
| medium-ceiling-step | 1 | 0.393083 | 0.008230 | 0.009472 | 0.012579 | 0.007592 | 0.010165 |
| medium-ceiling-step | 4 | 1.498871 | 0.033100 | 0.040144 | 0.086951 | 0.031928 | 0.044237 |
| medium-ceiling-linear | 1 | 0.521937 | 0.015840 | 0.020660 | 0.017316 | 0.007522 | 0.010907 |
| medium-ceiling-linear | 4 | 1.888428 | 0.071936 | 0.099564 | 0.135835 | 0.029424 | 0.040271 |
| large-ceiling-mixed | 1 | 0.593005 | 0.019790 | 0.034881 | 0.020081 | 0.011597 | 0.014241 |
| large-ceiling-mixed | 4 | 2.618550 | 0.096445 | 0.107706 | 0.168865 | 0.047662 | 0.061192 |
| large-ceiling-step | 1 | 0.566294 | 0.011285 | 0.014919 | 0.030837 | 0.011588 | 0.014122 |
| large-ceiling-step | 4 | 2.900646 | 0.051805 | 0.054586 | 0.103907 | 0.047391 | 0.060071 |
| large-ceiling-linear | 1 | 0.545042 | 0.021465 | 0.032936 | 0.041903 | 0.011608 | 0.014231 |
| large-ceiling-linear | 4 | 2.117334 | 0.104126 | 0.123995 | 0.126541 | 0.048002 | 0.061072 |

“Group” means all stated actors. Cached clone measures actual sequential ActorPool.create calls with decoded GLBs held by an untimed seed actor; it includes admission, clone, bindings and initial matrices. Cold decode-plus-seed and individual cached creation timings are separately retained. The seed is removed before sampling, so 1/4 means exactly 1/4 runtime actors. Custom pool ceilings admit the large group and transient seed explicitly.

Active/entry batch means are throughput measurements: each batch timer covers 128 group ticks; p95 is over batch means. Individual active, enqueue, event-entry, exact-end and large-jump timers each bracket one group operation and retain their separate raw samples. The event-entry timer processes one due playClip per actor; the 0.1-second entry bridge is sampled separately. Enqueue excludes processing and measures an empty queue. Large-jump includes the queued event and terminal evaluation after a 1,000-second skipped interval. Endpoints, active-track ownership, event counts and inactivity are asserted outside timed brackets.

## Disposal and limits

- Every measured and warmup lifecycle returned actor/active/pending, vertices/nodes/deformed vertices, source bytes, key scalar reservations, live decoded resources and retained cache references to zero: **true**. Every decoded load had exactly one matching disposal.
- Actors are disposed once with individual/group timings, then twice more for idempotence; pool disposal is timed and repeated. Actor root children are asserted empty. JSON includes before/after counters for every run.
- Calls to SkinnedMesh.getVertexPosition during measured preparation/runtime: **0**.
- Empty timer-bracket median: 0.000140 ms; not subtracted.

- No browser, WebGLRenderer, GPU draw, GPU skinning, GPU memory, input latency, FPS or target-device performance claim.
- Sample times include JavaScript timer overhead; overhead is recorded but not subtracted. Shared CPU scheduling, JIT and garbage collection are uncontrolled.
- Percentiles over active/entry batches are percentiles of batch means, not individual calls. Separately bracketed group calls have their own distributions. A 4-actor group is four sequential actor advances, not four independent timing samples.
- Repeats are within one Node process and machine session, not independent machine trials. Source case order is fixed; actor order alternates between measured repeats.
- Zero owned admission and cache balances prove tested lifecycle bookkeeping, not zero heap retention, zero allocations, or general leak freedom. Historical cache load/disposal counters are expected to remain nonzero.
- Generated medium/large mechanical packs are not approved character art. Geometry dimensions influence load/clone/matrix costs; active animation does not evaluate every skinned vertex on the CPU.
