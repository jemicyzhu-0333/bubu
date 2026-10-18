# Bubu comfort and observation props

Six isolated asset candidates: mirror, tissue, cushion, binoculars, telescope, pillow. Each follows an individual built-in image-generation reference, actual procedural 3D geometry, independent named sockets and part nodes, GLB export, and actual-body static mounting review. No prototype image is used as a substitute for 3D geometry.

## Evidence
- `manifest.json`: geometry budgets, materials, source hashes, safe bounds, mounts, and honest pending gates.
- `models/*.glb`: actual 3D meshes and materials, including independent socket nodes.
- `prototypes/*.png` and `prototypes/provenance.json`: individual generated design references.
- `reports/tests.tap`: 79 passing Node checks covering finite geometry, GLB cold load, sockets, bounds, actual install/unload, idempotent disposal, failed replacement, late async load, and static audits.
- `reports/mount-audit.json`: actual triangle BVH checks against original body and eight face meshes. All six preserve the 13 original actor meshes byte-for-byte. Body and face triangle crossings are zero. Grounded scene items meet the same 0.006 floor plane; original feet are unchanged.
- `renders/isolated-review-sheet.png` and `renders/assembled-review-sheet.png`: actual geometry CPU render sheets; individual front/side/45/back files retained.
- `src/static-install.mjs`: isolated cold-load/owning lifecycle scaffold. It is not application production integration.

Mirror and binoculars contact the existing right hand without moving or adding hands. Mirror contact distance is 0.000084 units and maximum penetration 0.01031; binocular contact distance is 0.0000345 and maximum penetration 0.00681. The straight mirror and handle tilt outward together by 0.5 radians around the grip, preserving the concept silhouette while avoiding the original body. This is static side-holding, not an eye-level use animation.

Tissue, telescope, cushion and pillow stand naturally on the shared ground. Cushion and pillow are empty beside the actor. Their seat/head surface sockets reserve a later support pose; no feet are hidden, lowered, or moved through the floor. Telescope has three separately modeled support feet and an altitude pivot; binoculars are the separate two-barrel handheld asset.

## Scope and remaining gates
This directory writes no production state and changes no repository contracts, renderer, original actor mesh, or other team's assets. No remote write. No new action timeline. Unified repository check is deferred to the parent as requested.

Pending: full new actions, wardrobe combinations, production/native installation, actual GPU/OS acceptance. Mirror uses a static metallic material only; live scene reflection is pending. Cushion/pillow seated or sleeping contact and binocular eye-use remain pending. CPU Blender renders prove geometry and material appearance only, not native GPU behavior.

## Reproduce local checks
Run from this directory: `node src/export-models.mjs`, `node src/export-mounts.mjs`, `blender -b -t 2 --python src/audit-mounts.py`, then `node --test src/test-*.mjs`. Run isolated renders with `blender -b -t 2 --python src/render-models.py`. Assembled renders use `src/render-mounted.py -- --input reports/<id>-mounted.json --out renders/<id>-mounted-<angle> --angle <angle>`. Finally run `python src/finalize.py` to rebuild sheets, manifest evidence, and hashes.

## Admission and evidence integrity repair
Static admission validates all X/Y/Z bounds, finite vertex and local/world matrix values, positive bounded scales, normalized rotations and canonical manual matrices. The parsed loader root must retain its identity transform before the fixed placement is applied. Rejected candidates release owned geometry/materials/textures and preserve the previous admitted prop. Fifteen mutation regressions cover depth overflow, NaN/Infinity, scale and matrix defects.

Triangle reports carry SHA-256 bindings to their exact mounted JSON and original-body reference. Tests recalculate input hashes and independently compare the 13 current actor position/topology arrays, all finite geometry, current three-axis bounds and the ground plane. Changed evidence fails closed; refresh the expensive BVH report explicitly with `blender -b -t 2 --python src/audit-mounts.py` before testing. Five stale-report mutation regressions reject changes even when a forged new input hash is provided.

`CANDIDATE-ALLOWLIST.json` records this directory's current file hashes. Parent staging must refresh its separate source allowlist after adopting this repair. No six-item geometry or mount placement changed in this repair.

## Detached handheld variants
`models/tissue-sheet.glb` derives the existing Tissue_single_sheet mesh, with its own grip/support/tip sockets. `models/telescope-handheld.glb` derives the six existing optical-tube parts under Telescope_altitude_pivot, preserving their geometry, materials and tilt while omitting the tripod. Original six GLB hashes remain unchanged (`reports/original-six-before-variants.sha256`). No new concept image or silhouette is introduced.

`variants-manifest.json` contains family/source hashes and evidence. `reports/variant-mount-audit.json` and `renders/handheld-variants-front-45.png` show original-hand static contact with all 13 original actor meshes unchanged. The paper is an open surface, so penetration is measured against the original closed hand instead of falsely treating paper as a closed volume. Two variants own cloned resources, and unloading one never releases another. Both use the same fresh-input/static-bounds guard and cold installation lifecycle as the original group.

Run `node src/export-variants.mjs`, `node src/export-variant-mounts.mjs`, `blender -b -t 2 --python src/audit-variants.py`, then the full Node tests. Finalize variant evidence with `python src/finalize-variants.py` before `python src/finalize.py`. New action timing, paper extraction/return, eye-level optical use, wardrobe and native integration remain pending.


## Portable current validation

Use the package-level fresh pipeline (requires Node with Three.js 0.186.1, Python, and Blender):

```sh
python shared/check-prop-groups.py --repo-root /path/to/repository --reference-root /path/to/prepared-fixture --cache-root /path/to/cache --group comfort-props
```

Prepare the D2/hybrid fixture and current accessory halo reference first using the package-level cache workflow. The reference fixture manifest is checked before exporting. Model exports write into cache/model-rebuild, never into the preserved models or manifests. This pipeline checks GLB byte parity against the existing factories, regenerates actual mounted meshes, runs fresh Blender triangle/contact audits, writes a hash-bound current-evidence.json, and runs model/lifecycle tests. All mounted JSON and new audit/proof outputs live under cache/comfort-props/reports.

Existing reports, renders, manifest statuses and prototype provenance remain historical evidence. Old absolute/sibling paths inside those records identify the original creation environment; they are not runtime dependencies or proof of current acceptance. Current static success does not upgrade pending action, wardrobe, renderer, native runtime or scene integration requirements. Do not run historical finalize utilities to update acceptance status.
