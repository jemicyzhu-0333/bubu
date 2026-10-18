# Source-derived surface query

Uses pinned upstream MeshBVH with a private Float64 position buffer. Original actor geometry, vertex methods and index order are unchanged. Current skeleton/bind/morph snapshot gates reuse. Geometry/layout mutation fails closed and requires readmission. Ray layers, distance limits, materials, UV and face indices retain native semantics in the tested cases. No coarse collider is substituted.

The scene reserves 32 MiB CPU staging per actor, then commits a conservative resident bound and releases it at disposal. Original actor geometry is borrowed, never disposed by the picker.

The initial checkpoint had 37 related tests passed, plus the 900-frame integration and five authored cases. The mixed 900-frame replay P95 improved from about 137 ms to about 6–7 ms, but the more demanding 180-frame continuous moving longpress remains P95 about 31 ms. This is NOT a blanket performance pass. Mixed-workload maximum spikes varied between runs; trace evidence includes spikes with zero surface queries/refits, so they cannot all be attributed to picking. CPU timing on the shared workspace is not native/GPU timing.

The next performance work is reducing per-pose refresh cost during continuous held movement and profiling non-query spikes, without weakening surface-hit or cancellation semantics. Fresh independent review is still pending. Clean fixture path portability and native testing remain incomplete.

## Rigid/blended partition refinement

The admitted D2 mesh splits into five single-bone rigid groups and 32,981 blended triangles. Only 16,955 of the 45,945 vertices need per-pose CPU deformation. Each rigid group is queried through its exact affine bone transform with the upstream BVH; source topology and render geometry remain unchanged. Meshes with morph attributes, material groups, or unsupported partition structure use the general full-resolution posed-buffer strategy. This is a capability choice, not legacy rendering compatibility.

Nearest point/distance and selected triangle metadata are tested against native raycasting. Shared-edge or overlapping co-nearest faces may have a different traversal tie order; the reported face must be a native co-nearest face, with its matching normal, UV and barycentric coordinates. This does not promise stable face identity across acceleration algorithms. Reflected bones, nonuniform/root reflections, near/far, layers, non-indexed geometry and invalidation are covered.

The 1,800-frame continuously moving longpress is the stronger acceptance fixture. Measured P95 was about 13–17 ms across repeated 1,800-frame runs, with occasional larger spikes; see its hash-bound evidence. The older 31 ms figure above describes the first full-pose-buffer checkpoint. Mixed replay and native/GPU testing are distinct. Allocation/resource guards and zero release checks do not constitute an OOM guarantee. Fresh independent review and residual spikes remain open.
