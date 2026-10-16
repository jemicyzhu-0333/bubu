# Compact approved Bubu model archive

This package retains approved05 body and the user-approved r6 five-face library, plus editable sources, coordinates, source design/prompt, selected QA boards/reports and reproducible tests. It is not the complete future expression library. New five-group concept sheets are separate unapproved references.

## Restore and verify

Python 3, Blender 4.3.2, and Node.js for the mapping test. No network downloads, third-party packages or other project directories are required. Blender includes numpy used by detailed geometry audits.

- `python3 scripts/restore.py --verify-only`
- `python3 scripts/restore.py --only body`
- `python3 scripts/restore.py --only r6`
- `node r6/test_mapping.mjs`
- `blender -b --python _restored/r6/rebuild_selected_faces.py`
- `blender -b --python _restored/r6/render_selected_faces.py -- first`
- `blender -b --python _restored/r6/audit_selected_faces.py`
- `blender -b --python _restored/body/render_body_archive.py`

The restore step losslessly restores complete look scenes, including compositing and scene settings. An initial environment-only reconstruction failed a render comparison and was replaced by the full golden look files. Gold GLBs remain native and are never re-exported during restore. The source r6 blend uses deterministic gzip and restores to its original SHA256. Formula rebuild is isolated under `_rebuilt`.

`BACKUP-MANIFEST.json` is the inclusion list with every retained file hash. `UPLOAD-body.txt` and `UPLOAD-r6.txt` split the package for transport. Do not interpret the historical immutable QA/GLB candidate strings as overriding the later user approval recorded in r6/APPROVAL.json.

No videos or per-frame renders are included. Duplicate historical pass GLBs and duplicate body-only Blender sources and superseded prototypes are intentionally omitted. The complete approved editable body/rig/shape topology is retained; this is not a recipe that reconstructs sculpted geometry from primitives.
