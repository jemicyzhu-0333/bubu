# Shared face-bank export notes

The independent batch GLB is a complete reproducible art-review package, not a recommendation to load multiple complete bodies at runtime. A_mochi_skin has 45,945 vertices and no morph targets. The five face objects reuse the frozen r6 Basis/topology/material/skinning; batch1's two brow objects form an optional shared layer with collapsed neutral Basis.

A runtime bank can contain only the eight authored POSITION/NORMAL deltas per affected face object, its mapping function and optional layer data. Keep the common body, neutral face topology, skin/rig and materials once. Omit exact-zero deltas only when the adapter reconstructs exactly zero. Missing bufferView plus sparse values must decode from an all-zero base, not uninitialized memory.

Current exported float32 POSITION and NORMAL deltas are the authoritative reviewed values. Bit-exact sparse-to-dense/repacking is a suitable first converter. Recomputing normals is not automatically equivalent: split/weighted normals and intermediate blend evaluation may differ. Such optimization needs separate numeric and render equivalence tests.

Do not reduce an eight-knot semantic path to an endpoint lerp. Closed-mouth routes must close the inner boundary before bending the filled stroke; highlights must follow their reviewed collapse path. Preserve single-face mapping, reset all unrelated history/eyebrow layers, and keep source IDs and hashes. The reviewed files do not enable arbitrary double-face morph sums, gaze or dynamic art integration.
