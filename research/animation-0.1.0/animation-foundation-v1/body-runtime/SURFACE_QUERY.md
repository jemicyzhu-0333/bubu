# Source-derived surface query

Uses pinned upstream MeshBVH with a private Float64 position buffer. Original actor geometry, vertex methods and index order are unchanged. Current skeleton/bind/morph snapshot gates reuse. Geometry/layout mutation fails closed and requires readmission. Ray layers, distance limits, materials, UV and face indices retain native semantics in the tested cases. No coarse collider is substituted.

The scene reserves 32 MiB CPU staging per actor, then commits a conservative resident bound and releases it at disposal. Original actor geometry is borrowed, never disposed by the picker.

37 related tests passed, plus the 900-frame integration and five authored cases. The mixed 900-frame replay P95 improved from about 137 ms to about 6–7 ms, but the more demanding 180-frame continuous moving longpress remains P95 about 31 ms. This is NOT a blanket performance pass. Mixed-workload maximum spikes varied between runs; trace evidence includes spikes with zero surface queries/refits, so they cannot all be attributed to picking. CPU timing on the shared workspace is not native/GPU timing.

The next performance work is reducing per-pose refresh cost during continuous held movement and profiling non-query spikes, without weakening surface-hit or cancellation semantics. Fresh independent review is still pending. Clean fixture path portability and native testing remain incomplete.
