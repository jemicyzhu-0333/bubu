# Basic face batch3: N3 and revised05

Reference designs approved. Independent actual3D static gate passed. Awaiting user3D confirmation. Runtime is paused. Originalbody05/r6 and earlier batches are unchanged.

## Included
Native candidate GLB, complete editable source and exact look scenes(gzip), authoring/rebuild/mapping code, source crops and provenance, fixed coordinate/roster contract, audit evidence, and compact actual large/native99 review boards. No videos, intermediate GLBs, cache or full frame dump.

## Restore and verify
Run `python restore.py` to inflate two complete scenes into `_restored` and verify hashes. Run `blender -b -t 4 --python rebuild_batch3.py` to remove only this batch's targets/layers from the restored gold source and regenerate them. The original authoring implementation is also preserved as `build_batch3.original.py`. A real rebuild was tested byte-identical to the shipped GLB. Run `blender -b -t 4 --python verify_restored_look.py` for the neutral look check; this also matched every pixel.

To rerender all review frames, restore the look scene into this directory under its original filename, then run render_batch3.py with first/other/interpolation/tongue-threshold modes. All scripts use local basic_face_utils and round_stroke_geometry. Render scripts do not download any dependencies or access a production repository.

The identity audit compares against the separately archived r6 and batch1 originals and expects those source directories as documented in the script. The original rim-scope audit also expects its diagnostic pre-rim GLB; that redundant intermediate binary is intentionally omitted. Its complete result, before/after visual proof and first-hit mask reports are retained. These historical comparison scripts are evidence tools, not dependencies of restoration or rebuild. Re-run current mask, layer, orientation and attachment checks against restored scenes as needed.

## Use limits
T05 is the newly corrected05; do not silently load historical Face05 instead. Fixed eye/mouth neutral anchors stay unchanged. One semantic face and at most two adjacent knot targets are active; reset all other targets across eyes, highlights, mouth, brows and tongue. Tongue has an explicit zero-area hidden Basis and only appears inside N3 black mouth after intensity.5. White eye caps are reflections; gaze remains unimplemented. No direct multi-face mixing or dynamics are certified.
