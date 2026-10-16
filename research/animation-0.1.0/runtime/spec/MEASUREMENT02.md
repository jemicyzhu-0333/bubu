# Historical checkpoint 02 policy and measurements

The authoredclip03 extension additionally charges clipKeyScalars and encoded clip-library source bytes; see AUTHORED-CLIP03.md. The matrix archived with this document retains its measurement02 source fingerprint.

# Measurement checkpoint 02

Scope: aggregate admission, reproducible mechanical CPU workloads and simulated context policy. No authored clips/retargeting, art adapters, contact physics or final drag/pet added.

## Aggregate limits and ownership

One application ActorPool privately owns its cache. Default actor / submitted vertex / hierarchy node / morph-expanded element / encoded GLB limits are 8 / 200,000 / 512 / 1,000,000 / 32 MiB. Hard ceilings are 32 / 1,000,000 / 4,096 / 4,000,000 / 128 MiB. Limits must be positive integers with known names.

Active and pending actors consume instance complexity. Repeated instances count individually, while identical GLB sources count once by verified hash. Failed admission starts no parse. Aborting releases instance reservations after cleanup; uncancellable parsing keeps source bytes reserved until the cache disposes/evicts its late result. Shared siblings keep ownership. Releases are idempotent.

These budgets describe render work and encoded source admission. Caller-owned prepared files, parser temporaries, decoded attributes, driver allocations and VRAM are not falsely equated with source bytes. Independent pools are independent application domains; the library does not sandbox arbitrary same-origin JavaScript.

## Immutable preparation

Each reader result is copied with Uint8Array.from before hashing or another read. This avoids Buffer.slice aliasing and reader-buffer reuse. Plain metadata is deeply frozen; read-only Map views expose frozen audit values and fresh byte copies. The same immutable pack feeds admission and construction. Changes require re-preparation with matching hashes. Negative binding tests intentionally use re-prepared invalid files or isolated low-level test views.

## Context policy

Hidden, lost and disposed are separate state dimensions. Restore while hidden stays paused. A load completing during loss binds paused. Restoring an idle canvas forces invalidation. Disposal detaches listeners and cannot be reversed by a late restore.

Canonical time continues through loss/hidden. Wake evaluates queued events at original times and samples the current pose at now. This is not physics catch-up. WebGL loss calls standard preventDefault to opt into restoration; no browser security setting is changed. Evidence uses EventTargets/VM, not actual browser GL restoration.

## Matrix and units

The generator produces 10 deterministic packs: isolated vertex axis 1,008/12,000/45,000; joints 4/8/48; asset nodes 16/64/112; morph targets 2/4/16; plus a combined large case with 45,000 vertices, 48 joints, 112 asset nodes and 8 targets. Resolved runtime nodes include wrappers. One and four actors are measured, with a separate ActorPool concurrent-admission phase.

Run `node tools/benchmark-matrix.mjs --runs 10`. Reports include raw samples, warmup, workload hashes, environment and before/after source fingerprints. Files were just generated: preparation is not cold-disk I/O. Parse/clone/binding are real GLTFLoader operations. Steady throughput distributions are batch-per-operation means. Individual group advances include all actors and timer overhead; they are not per-actor frame latency. Enqueue and due-event processing are separate. Teardown verifies explicit cache ownership; uncontrolled-GC process heap samples do not prove leak freedom or zero allocation.

Increasing vertices with unchanged nodes/bones mainly affects validation/loading and hypothetical GPU deformation, not full-vertex CPU work. Changed-state hierarchy propagation remains O(nodes). No FPS or old-controller speed multiple is claimed. Target hardware/workload/margin must be fixed before performance acceptance.
