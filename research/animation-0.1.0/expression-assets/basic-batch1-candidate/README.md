# Basic face batch1: frozen candidate backup

D1 awake-tired / N2 puzzled / P2 quietly content. The generated reference directions are accepted. Independent actual four-view static shape and intensity checks passed. User3D acceptance is pending. Do not replace the approved05 body/r6 history or enable this in the interaction runtime.

## Restore without other project folders
1. Run `python restore.py`. This verifies the native GLB and losslessly restores the complete source and gold look blends into `_restored`.
2. Open `_restored/bubu-a05-basic-batch1.blend` to edit the full candidate, or the restored `-look.blend` for the exact inherited lighting/material/compositor environment.
3. To rebuild from formulas, use Blender4.3.2 with `--background --python rebuild_batch1.py`. The script removes only this batch's Basic targets/brows from the full retained source, then reconstructs them. Outputs go to `_rebuilt`. This has been tested: the rebuilt GLB is byte-identical to the shipped candidate.
4. To render, use Blender with `--python render_batch1.py -- first`, then `other` and `interpolation`. Frames go to `_renders`; run `python compose_batch1.py` after all modes for comparison boards. This requires Pillow/numpy. No video is included.
5. Run `python test_closed_mouth_transition.py` and `python audit_weight_map.py`; Blender audit_attachment.py, audit_orientation.py, audit_mouth_collapse.py and audit_brow_layer.py check restored geometry. The full independent oldr6 identity result is retained as evidence; no duplicate oldr6 GLB is required for reconstruction.

`build_batch1.original.py` preserves the original working-source formula and paths for provenance. Use the portable `rebuild_batch1.py` for standalone recovery.

## Retained versus excluded
Native GLB, complete compressed source/look, exact formulas/mapper, approved direction source crops, local coordinate extension, QA/status, independent review ledger and compact actual99px evidence are included. Old failed passes, duplicate blends, caches, full render-frame stacks and videos are excluded. Full source/look gzip is intentional: reconstructing only light values previously proved insufficient to reproduce the scene.

## Key boundaries
Original05 body and historicalr6 endpoint data are unchanged. N2 adds explicit Body-bound brows with a zero-area hidden neutral state. All other states clear these brows. R6/05 remains historical after the user's later tense-reference correction. Whole-eye gaze remains unimplemented. Only one semantic face with adjacent authored intensity knots is supported; cross-face overlays are not accepted.

The reusable `closed_mouth_transition.py` closes an O's inner boundary symmetrically by intensity .5 before bending into a closed line. N2 and P2 use the same primitive, with actual3D interpolation/attachment tests in addition to algebraic tests. The evaluator's collapsed boundary has float32 scatter up to1.34e-7 design units; raw near-degenerate signed-area counts are retained rather than called zero-degeneracy.
