# Basic face batch5: T5, S3, S5

Reference directions accepted. Independent actual3D single-face static/path review passed. Awaiting user3D confirmation. Runtime remains paused.

## Contents and recovery
Native gold GLB, complete editable source and exact look scenes(gzip), local authoring/mapping/regression helpers, source crops with provenance, face chart/roster contract, QA and compact large/native99 boards. Full frame dumps, prior passes, videos and cache are excluded.

Run `python restore.py` to inflate both complete scenes into `_restored` and verify their hashes. Run `blender -b -t 4 --python rebuild_batch5.py` to remove only this batch's targets/layers from the restored gold source and regenerate them. The original authoring implementation is retained as `build_batch5.original.py`. Actual rebuild was byte-identical to the shipped GLB. Run `blender -b -t 4 --python verify_restored_look.py` for the neutral look check; it matched every pixel.

To rerender, copy the restored look into this directory using its original filename and run render_batch5.py in first, other, interpolation and brow-threshold modes. Rendering and regeneration use local helpers, without downloads or production files. Blender4.3.2 and Python/numpy/Pillow are the tested environment.

Identity comparisons require separately archived r6/batch1 baselines, as their scripts document. The boundary-scope diagnostic additionally references the omitted redundant pre-fix GLB; its full result is retained. These are historical comparison dependencies, not dependencies of restoration or rebuilding. The shared radial-boundary regression, current attachment, gap, layer and orientation checks can run from restored files placed at their original local filenames.

## Path and use rules
closed_mouth_transition expects a pill boundary on the same angular ray as each original radial sample. Use closed_mouth_boundary.rounded_pill_boundary, never tangent/normal capsule output, for that argument. The included1024-ray test rejects the previous nonradial input and guards against half-strength double bulges. Curved endpoint strokes still use normal-width capsule sweeps; those have a different contract.

The body and historical r6 targets remain exact. Shared brow Basis is identical to batch1. Apply a single semantic face with at most two adjacent authored knot weights and reset the complete roster first. Preserve POSITION/NORMAL sparse deltas; do not replace authored paths by endpoint interpolation. Gaze, direct cross-face mixing and dynamics remain unapproved/unimplemented. Intentional zero-area hidden layers and closed inner mouth boundaries are documented separately from visible geometry checks.
