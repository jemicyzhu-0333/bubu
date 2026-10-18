# Source-derived surface query

Pinned upstream MeshBVH reads a private Float 64 posed-position buffer. Actor
geometry, skinning methods, source topology and render fidelity remain unchanged.
Skeleton/bind/morph snapshots gate reuse. Ordinary, morph and index attributes
share a layout guard, including interleaved offset, stride, data count/identity/
version, item size, normalization and backing-array identity. Structural changes
require readmission before cached hits can be returned.

## Rigid and blended surfaces

D2 partitions into five single-bone rigid groups and 32,981 blended triangles.
Only 16,955 of 45,945 vertices need per-pose deformation. Rigid groups use their
exact affine bone transform and upstream BVH. Morphs, material groups and
unsupported partition structures use the full-resolution posed-buffer path.
Direct component stores pack the same Three skinning result into that buffer.

Nearest point/distance and triangle metadata are compared with native raycasting.
Co-nearest shared-edge faces may differ in traversal order; the selected face
must itself be native co-nearest, with matching normal, UV and barycentric data.
Independent review reproduced three stale-layout cases in the prior guard; the
revised guard rejects all three. The suite includes 3,000 seeded affine rays,
reflections, grouped materials, morphs, non-indexed geometry and disposal cases.
Repository-relative setup and Chinese/space-path checks are documented in the
[integration guide](../integration/README.md).

## Allocation scope

The actor reserves 32 MiB for query construction, commits a resident estimate,
and releases its ledger claim at disposal. Borrowed source attributes stay owned
by the actor. At 100,000 vertices/200,000 triangles, an independent synthetic probe
counted 9,356,736 bytes of query-owned typed buffers versus a 26,066,048-byte resident
bound; sampled construction ArrayBuffer growth was about 12.7 MB. These observations
do not prove instantaneous JavaScript heap or concurrent construction maxima.

Upstream three-mesh-bvh 0.9.16 retains the last built root through module-level
build views. In that probe, dispose plus explicit GC retained 801,696 bytes;
constructing a tiny replacement tree reduced this cache to 32 bytes. This is a
single bounded upstream cache, not demonstrated per-actor accumulating leakage.
An empty actor resource ledger therefore does not mean every upstream byte has
been released. No cache-reset workaround or OOM guarantee is claimed.

## Remaining acceptance gates

86 tests and 900 mixed functional frames pass. Timing remains non-passing for
stable frame-time acceptance: a 1,800-frame moving hold measured P 95~11.3 ms and
max~49.3 ms, while a separate mixed run had a~210 ms spike. Some mixed spikes occur
with no surface query/refit. These uncontrolled shared-host CPU measurements
cannot certify native/GPU timing. Native Windows/macOS input/GPU, wearable
contact, and extreme/concurrent peak allocation validation remain open.
