# 小步 V2 play and discovery props

Six isolated geometry families: ball, energy-token, treasure-chest, paper-plane, cardboard-box, building-block. Local asset laboratory only: no production code, remote branch, profile state, actor mesh or new action timing changed.

## Evidence

Each family has its own built-in imagegen sheet (isolated views and reference-character placement), editable Three.js model, real GLB, material records, sockets, local bounds, clearance envelope, actual single-model four views, and actual original-character four-view static mounts. Generated studies guide only the accessory. The original body, original face and two original hands/feet remain 13 byte-identical position/index arrays. No hand stretching, replacement, extra paw or tea-carrier reuse.

- Ball: 0.52 diameter, eight broad mint/cream physical sphere panels, ground rest.
- Energy token (energy crystal): original V1 golden crystal identity, irregular elongated gem, physical 0.008-unit soft bevel and four golden facet materials. No coin/disc/lightning/currency icon. Independently positioned against unchanged right-hand surface.
- Treasure chest: 0.685 width, hollow base with separate walls/floor, external bands, latch, feet, independent domed lid hinge. No timing authored.
- Paper plane: 0.54 wingspan, two folded wings and double keel; closed 0.006-unit paper thickness. Independently positioned against the unchanged short hand.
- Cardboard box: open carton, thin solid walls/floor, four separately named hinge/flap groups. No timing authored.
- Building block: 0.31 rounded cube with top/bottom stacking sockets.

The chest prototype depicts a relatively larger chest; actual model deliberately follows requested small accessory scale (about 29% of original body width). Texture detail is simplified for native small-scale legibility. Prototype images are not model textures.

## Checks and limits

76 Node tests cover finite geometry/materials, GLB cold load, socket persistence, malformed input, per-resource disposal, 5 action interruptions per family, parent-transform mounting, and ball/block shared geometry with independent materials and ref-counted sibling-safe release. Repeat-instance rendering is separate from single-instance tests.

Actual triangle BVH audits require no prop crossings of original body/face; hand surface distance <0.003 units and penetration <0.025, with full 13 actor arrays unchanged. Latest measured crystal distance is about 0.00152 and paper plane 0.000252 units. Crystal penetration is zero; paper wing local overlap is 0.00282 units. The paper plane is pitched -0.4 radians for front-view readability while the original hand stays unchanged. Ground props rest at y=0. This does not validate future hand motion.

Fixed camera span 5.264, original 2.37974-unit body width, is equivalent to 99 CSS-pixel body width in a 219 CSS-pixel stage. All four angles are projected at this same camera; no per-prop resizing or stage expansion. Actual renders are Blender CPU, not native WebGL/OS screenshots. Local prop envelopes include 0.035 margin; every wardrobe combination and all new complete action/native GPU acceptance remain pending.

`manifest.json`, `reports/mount-contracts.json`, `reports/mount-audit.json`, `reports/stage-audit.json`, `reports/all-tests.txt`, and three review contact sheets are the review entry points. Source models are authored interpretations, not automatic image-to-mesh output.

## Reproduce

Run node src/export-models.mjs; node src/export-mounts.mjs; node src/export-shared.mjs; node --test src/test-*.mjs; blender -b -t 2 --python src/audit-mounts.py; python src/audit-stage.py; blender -b -t 2 --python src/render-models.py; bash src/render-mounts.sh. Repeated scenes use render-static-fit.py with reports/ball-repeated.json or building-block-repeated.json and fixed span 5.264 at angles 0,45,90,180. Finally run python src/finalize-report.py.

No new paid conversion, credentials, software installation or external publication.

## Energy identity correction

The initial energy coin introduced an incorrect currency metaphor and is retained only in rejected/energy-coin-v1. Active energy-token is now a golden energy crystal based on the original V1 energy.png and a separately regenerated crystal prototype. The original identifier remains for inventory compatibility. Its four material surfaces form one closed solid; penetration ray parity is measured against their combined triangle mesh, not against open per-material fragments. Other five geometry families remain byte-identical.


## Portable current validation

Use the package-level fresh pipeline (requires Node with Three.js 0.186.1, Python, and Blender):

```sh
python shared/check-prop-groups.py --repo-root /path/to/repository --reference-root /path/to/prepared-fixture --cache-root /path/to/cache --group play-props
```

Prepare the D2/hybrid fixture and current accessory halo reference first using the package-level cache workflow. The reference fixture manifest is checked before exporting. Model exports write into cache/model-rebuild, never into the preserved models or manifests. This pipeline checks GLB byte parity against the existing factories, regenerates actual mounted meshes, runs fresh Blender triangle/contact audits, writes a hash-bound current-evidence.json, and runs model/lifecycle tests. All mounted JSON and new audit/proof outputs live under cache/play-props/reports.

Existing reports, renders, manifest statuses and prototype provenance remain historical evidence. Old absolute/sibling paths inside those records identify the original creation environment; they are not runtime dependencies or proof of current acceptance. Current static success does not upgrade pending action, wardrobe, renderer, native runtime or scene integration requirements. Do not run historical finalize utilities to update acceptance status.
