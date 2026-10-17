# Pre-parse array admission correction

Scope: defensive CPU-array accounting for the existing Three 0.186.1 GLB subset. No new asset, profile, capability, renderer, network dependency, or budget escalation.

## Cause and corrected model

The old `assetBytes + sum(dense accessor sizes)` allowance did not bound `loadBufferView`: Three copies each loaded view's entire byte range with `ArrayBuffer.slice`, even if the view overlaps another view or only a few elements are read. Deduplication is by **view index**, not underlying BIN interval. Each accessor dependency is cached by accessor index. Ordinary typed arrays and interleaved arrays alias the copied view; multiple accessors sharing it do not allocate additional backing stores. A sparse accessor with a base copies its dense array; a missing base creates a dense array. Sparse index/value typed arrays share their respective copied views.

`decodedArrayPlan` follows scene nodes to mesh primitive attributes, indices, morph targets and skin inverse-bind accessors. Both preflights enforce a sole scene containing every node. It counts loaded views exactly once, unused views/accessors zero times, and each sparse/zero-base dense allocation once. It retains `assetBytes` as a conservative bound on the loader's separate BIN copy, including padding. `sourceBytes` covers the loader input snapshot. Mechanical acquisition now uses private prepared bytes, eliminating the extra public copy-on-read before the loader input copy. Normal fixture assets and declared ceilings are unchanged. Mechanical, static05 and r6 reservation totals remain unchanged; face7 increases from 18,756,540 to 18,927,900 bytes (171,360 bytes), still below its existing 20,971,520-byte profile ceiling.

ActorPool already atomically reserves all unique sources before scheduling any parse; corrected accounting makes that boundary effective. Abort/late-completion retention and release remain unchanged. Direct low-level suite/acquire APIs still do not provide an application aggregate budget; applications must use ActorPool.

GLTFLoader requires a complete final interleaved stride when constructing its TypedArray; preflight now rejects layouts lacking that padding before the loader. This is an explicit loader compatibility restriction, not a claim that the glTF specification forbids the layout. Sparse interleaved bases and sparse matrices are likewise rejected because this loader cannot process them correctly. Dense interleaving, ordinary overlap, and supported sparse layouts remain accepted.

## Evidence

- `npm test`: original 167 tests unchanged, plus 12 bounded regression tests; 179/179 pass.
- New overlapping-view parser tests use only a 16 KiB BIN (under 256 KiB of decoded view copies), not a large allocation stress test.
- `evidence/preparse07-admission.json` reuses the existing audit's 527,924-byte fixture for **preflight and denied admission only**. Body reservation is now 8,392,244 bytes: 527,924 BIN allowance + 15 × 524,288 copied views. No GLTFLoader invocation occurred. The old reservation was 534,760; the old observation of 7,340,032 geometry-reachable bytes excludes the copied inverse-bind view and is not the full parser allocation.
- At package reservation minus one byte: GLOBAL_BUDGET, parse calls 0, cache loads 0, all actor/source reservations 0. This valid overlapping source is not universally forbidden: the default pool has enough capacity for it. Small overlapping sources load at the exact sufficient budget, share once across actors, and release all accounting after the last owner.
- Regression observer counts actual loaded view buffers plus accessor-result buffers and compares their unique backing sizes to the plan. Covers unused accessors/views, large view with small accessor, repeated mesh nodes, shared typed arrays/interleaving, sparse overlay/zero-base for uint8/uint16/uint32 sparse indices, and zero-base dense arrays. Existing normal hash-locked fixtures, abort, parse failures and disposal tests continue passing.

## Source and limits

Official source: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js
Installed 0.186.1 GLTFLoader SHA-256: `131c0f78c01d19368ae495caa65b3adaa10487810a36a05bb5901b769a35ac16`.
Relevant methods: GLTFBinaryExtension (BIN slice), getDependency (index cache), loadBufferView (full-view slice), loadAccessor (shared TypedArrays, zero bases and sparse copy), loadMesh/loadSkin (dependency graph). Source reviewed locally and official upstream page checked; no installation or package update performed.

This is **not a total process-memory or GPU limit**. Caller-owned prepared bytes, JSON/JS objects and parser metadata, preflight dense validation scratch, source-parity temporary arrays, per-actor skeleton state, retained disposed handles, renderer morph staging/textures, driver allocations and VRAM are outside these fields. Preflight work/dense decode remains separately bounded by existing limits. No WebGL/GPU allocation or complete GC/leak-freedom claim is made. Disposed mechanical handles may retain model references as already reported by the independent review; this patch does not change that separate API-lifetime behavior.
