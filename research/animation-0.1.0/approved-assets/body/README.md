# Approved 05 body baseline

The two GLBs are byte-exact frozen approved artifacts. The single original Blender file is the editable body/face source; duplicate body-only files are intentionally omitted; the golden full look scene is retained in lossless gzip.

Run `python3 scripts/restore.py --only body` from this package root. It verifies all retained files, restores the exact full `approved05-original-look.blend` and creates `body-only.blend` / `body-only-look.blend` derivatives under `_restored/body/`. The original gold GLBs are copied without re-export. Blender 4.3.2 is the recorded version.

Coordinates and hashes are in body-baseline.json and face-frame-v1.json. Fixed U/V is a front orthographic chart, not a differential tangent frame. Gaze is a proposed separate channel, not an implemented pupil control.

Historical approval: user approved candidate-a-static-05 and continuing rig on 2026-10-16 (message Sentinel_3fc77f15f3a481918577686878043d1f). Body archive identity gate independently confirmed original/source/body-only geometry, normals, colors, indices unchanged.
