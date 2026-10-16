# Approved r6 selected expressions

Five approved expressions 01/04/05/07/08 on approved05/r4 unchanged rest. APPROVAL.json supersedes historical candidate status strings retained inside the immutable GLB and QA reports. This is not the complete proposed basic-expression library and does not approve dynamics.

The GLB is native and byte-exact. `bubu-a05-selected-faces.blend.gz` losslessly stores the one complete editable rig/shape source. The complete approved look scene is retained as lossless gzip; earlier pass GLBs are omitted. `python3 scripts/restore.py --only r6` restores the source and losslessly restores the complete look scene under `_restored/r6/`; no previous scratch directory is required.

To regenerate selected morphs from formulas after restoring: `blender -b --python _restored/r6/rebuild_selected_faces.py`. It writes `_restored/r6/_rebuilt/`, preserving the gold asset. It uses the preserved base topology/rig and legacy shapes, removes selected Face* keys, and rebuilds them using the original formulas. It does not attempt to reconstruct approved topology from primitive shapes. Re-export file serialization need not have the gold byte hash; compare geometry/targets before adopting a rebuild.

Use selected_face_utils.py / selected-face-map.mjs. One selected ID may be nonzero. Adjacent knots interpolate within that face. Do not directly mix two expression endpoints. Full-face transition direction needs future acting review. Highlights are attached reflection marks, not independently implemented pupils.
