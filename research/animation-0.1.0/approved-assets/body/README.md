# Approved 05 body baseline

The two GLBs are byte-exact frozen approved artifacts. The single original Blender file is the editable body/face source; duplicate body-only and look Blender files are intentionally omitted.

Run `python3 scripts/restore.py --only body` from this package root. It verifies all retained files, reconstructs `body-only.blend`, `approved05-original-look.blend`, and `body-only-look.blend` under `_restored/body/` using the retained source and compact environment library. The original gold GLBs are copied without re-export. Blender 4.3.2 is the recorded version.

Coordinates and hashes are in body-baseline.json and face-frame-v1.json. Fixed U/V is a front orthographic chart, not a differential tangent frame. Gaze is a proposed separate channel, not an implemented pupil control.

Historical approval: user approved candidate-a-static-05 and continuing rig on 2026-10-16 (message Sentinel_3fc77f15f3a481918577686878043d1f). Body archive identity gate independently confirmed original/source/body-only geometry, normals, colors, indices unchanged.
