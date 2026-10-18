# Bubu: seven head ornaments, research candidates

Each item has its own imagegen prototype (wearing and isolated four views), saved prompt, true GLB model, and actual unchanged approved D2 + hybrid host render. Generated character illustrations are concepts only and never replace the approved character. No new actions were designed. No remote write or production wardrobe integration occurred.

## Review
- `review/{forest,sakura,moon,flame,crown,antenna,pumpkin}-actual-fourviews.png`: actual CPU-deformed meshes, front / 45° / side / back, rendered with Blender. Not a browser or native desktop screenshot.
- `references/*-prototype.png`: separate imagegen concept sheets, not model renders.
- `attach-manifest.json`: exact catalog IDs, original exclusivity/unlock restrictions, GLB and concept hashes, material colors, bounds, scale and attach contract.
- `models/*.glb`: real meshes with physical depth. Not textured image cards.

## Validation boundaries
`reports/host-audit.json`: 271 existing drag frames and 1,891 existing long-press frames replayed. Actor geometry hash unchanged; accessory per-frame bounds finite and diagonal under 3 actor units; detach, idempotent disposal and explicit borrowed-resource release tested. Source actor and hybrid asset hashes recorded.

`reports/tea-collision.json`: corrected 16 existing tea keyframes. `reports/tea-collision-full.json`: corrected 271 discrete 30fps frames. All accessory world exports are transformed by the actual inverse source skin matrix before comparison with tea-local geometry. `reports/tea-coordinate-proof.json` independently compares body and both feet with approved hybrid NPZ source positions. The old coordinate-mismatched result is retained only as `tea-collision-superseded-coordinate-error.json` and is invalid evidence. These checks detect sampled triangle intersections, not continuous collision, containment, cloth simulation or universal outfit compatibility.

Host adapter is research-only. The combined scene is a diagnostic export of mutually exclusive alternatives; it must not be shown as a valid wardrobe outfit. Production exclusivity remains authoritative. Seasonal pumpkin originally exposes front-only views; this research adds review angles but does not modify production admission. Effects are catalog metadata only, not newly implemented animations.

All candidates await user's final batch acceptance. Browser WebGL, native desktop, production wardrobe integration and all outfit combinations are untested.

## Reproduce
Run from this directory:
1. `blender -b --python src/build_models.py`
2. `node src/test_and_export.mjs`
3. `python src/audit_tea.py`
4. `bash src/render_batch.sh`
5. `node src/write_manifest.mjs`
6. `python src/contact_sheets.py`

Dependencies are borrowed read-only from the existing recovery environment. No persistent app state is written.
