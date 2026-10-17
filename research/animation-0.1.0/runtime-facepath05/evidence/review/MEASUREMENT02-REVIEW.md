# Measurement02 independent architecture/performance review

Target: bubu-runtime-0.1.0-measurement02-20261016. Read-only source review and separate local test artifacts. No changes to frozen source, art activation, publication, user-device access, real browser or GPU execution.

## Findings and closure

1. Prepared-pack mutation bypassed ActorPool's private admission cost: after prepare, adding an equipment instance resulted in actual 172 vertices/21 nodes while the pool reported and enforced only 148/16. Reproduced through normal public ActorPool.create, not by bypassing the pool. Fixed via immutable metadata, frozen audits, and private copy-on-read bytes. `m02-pool-mutation-rerun.json`: mutation rejected.
2. First immutability fix copied input bytes too late: a reader retaining a returned buffer could mutate it on a later read after SHA/preflight but before final copy. Prepared bytes then disagreed with the locked hash. Fixed by immediate Uint8Array.from after each read, before hash/preflight. `m02-reader-byte-race-rerun.json`: prepared body bytes match pinned hash despite reader mutation.

No remaining blocker found in this bounded CPU/admission/simulated-lifecycle scope. This does not certify all hostile JavaScript callers or arbitrary bypass of internal APIs.

## Independent checks

- 53/53 implementation tests passed: `../tests.tap`.
- Four independent pool scenarios: atomic pending admission, immediate abort/late completion, pool closure during pending create, shared encoded-source accounting with independent instance budgets. All accounting/cache counters return to zero.
- 256 four-operation permutations of loss/restore/hide/show using actual ContextLifecycle + DemandLoop and EventTarget. Hidden OR lost suppresses frames; disposal cannot be awakened by later events. `m02-context-independent.json`. This is lifecycle simulation, not GPU recovery.
- Prepared metadata and bytes are now aligned with admission and source identity.

## Independent CPU matrix

Command: node bubu-runtime-0.1.0-measurement02-20261016/tools/benchmark-matrix.mjs --workloads vertices-small,vertices-large,joints-high,nodes-high,combined-large --actors 1,4 --runs 2 --batches 4 --ticks 300 --out bubu-engine-measurement-review-20261016/m02-independent-matrix.json

Five workloads, one/four actors, two repeated runs; source hashes unchanged during measurement. CPU skinned-vertex reads: zero. Raw observations, hardware/Node/Three versions, timer overhead, per-source hashes, distinct throughput/individual latency metrics and explicit GC caveats are included in the JSON.

Examples (group-tick batch-mean median, milliseconds, two runs):
- 1008 vertices / 66 actual nodes / 8 joints: four actors 0.02136 / 0.01883.
- 45000 vertices / 66 nodes / 8 joints: four actors 0.02061 / 0.01971.
- 12000 vertices / 66 nodes / 48 joints: four actors 0.04271 / 0.04766.
- 45000 vertices / 114 nodes / 48 joints: four actors 0.05973 / 0.05675.

Increasing vertices primarily affects loading/preflight here; steady CPU animation processes bound channels/matrices. updateMatrixWorld remains O(nodes). No CPU result implies actual render FPS, GPU skinning/morph cost, VRAM, input latency, or native energy usage. Batch-mean quantiles are not individual-call tail latency. Multi-run observations share a process/machine and are not independent hardware trials. Repeated event tests processed 256 events per one-actor run / 1024 per four-actor run.

## Resource and lifecycle boundaries

ActorPool sourceBytes counts unique encoded GLB sources and retained pending parses, not decoded geometry arrays, caller-owned pack bytes, heap or VRAM. All app actors must use one pool to get the application-level admission guarantee. The implementation expressly does not claim to sandbox arbitrary callers of lower-level APIs.

ContextLifecycle tests establish pause/resume/wake policy and canonical time, not Three renderer restoration. WebGL context restoration invalidates pre-loss resources; actual renderer recreation/reupload needs browser verification. Primary references consulted:
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event
- https://threejs.org/docs/pages/WebGLRenderer.html

Real WebGL/browser/native performance and recovery, art-library approval, final drag/press/contact behavior remain outside this pass.

Portable copied reproductions use package-relative imports. Earlier mutation failures are retained as diagnosis; current strict-mutation tests and rerun records establish closure.
