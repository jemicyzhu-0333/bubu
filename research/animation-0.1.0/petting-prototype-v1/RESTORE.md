# Restore the continuous petting prototype

Place this folder at `research/animation-0.1.0/petting-prototype-v1`, beside `drag-body-prototype-v1`. Restore the sibling drag prototype using its `tools/hydrate_runtime.py` against the hash-pinned weighted baseline and install its locked Three.js dependency. The petting package adds no npm dependency or independent runtime copy.

Run `cd research/animation-0.1.0/petting-prototype-v1 && npm test`. All seventeen tests must pass. This package imports the sibling body adapter, explicit body-enabled runtime/fixture policy and evaluated-scene exporter. It never mutates the face-only baseline.

Optional offline evidence: run `node tools/export-keyframes.mjs`; render its JSON with the sibling `render/render_actual.py` (Cycles CPU, denoising off, fixed camera); compose the local keyframe sheet. Preview videos and raw world-vertex JSON are generated locally and excluded from Git. Video shell helper assumes launch from the two sibling packages' parent directory.

Functional prototype only: no DOM pointer-capture wiring, OS behavior, WebGL verification, fixed touch-point constraint solve, dual-foot IK or final art approval. Both 24 fps review excerpts are normal-speed subsets of one original timeline, not accelerated timing.
