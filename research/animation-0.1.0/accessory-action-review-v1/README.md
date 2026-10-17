# 03 satchel + 04 scarf: approved-action combination evidence

Read REVIEW.md for the scoped result and known inner-layer overlaps. This package changes no production asset, adapter, wardrobe rule or UI. The appearance assets are user-approved; this is sampled technical evidence, not an assertion of globally collision-free clothing.

## Frozen inputs
Use evidence/source-hashes.json to verify all exact assets and runtime source modules. Requires the repository's approved D2 runtime fixture, petting-continuous-r2 including tools/fixture.mjs, shared-input-workbench-v2 with the landing lingering-smile controller, and accessories-v1/01-sprout, /03-satchel and /04-scarf. Three.js 0.186.1 must be installed under animation-0.1.0/node_modules; use Blender 4.3.2 and Python/Pillow/NumPy.

## Reproduce
Run from research/animation-0.1.0/accessory-action-review-v1:

    node src/verify-sources.mjs
    node src/export-combinations.mjs
    node src/test-active-unload.mjs
    node src/extract-colors.mjs
    blender -b -t 2 --python-exit-code 1 --python src/check-combinations.py
    blender -b -t 2 --python-exit-code 1 --python src/check-central-seam.py
    blender -b -t 3 --python-exit-code 1 --python src/render-combination.py

Wait for export-combinations to finish before checking/rendering. Generated work/ is ignored and contains roughly 500MB of binary geometry, not committed here. Delete or move previous work/ before a fresh full rerun; the collision checker can resume an interrupted run from its existing result file and therefore must not reuse results across changed inputs.

For same-angle seam closeups, use the renderer after Blender's -- separator:

    --frames 0,1,2,3,4,5,6,7,8,9 --close --size 512 --samples 20 --output seam-sequence
    --frames 60,61,62,63,64,65,66,67,68 --close --size 512 --samples 20 --output seam-sequence

The frame IDs above are drag/landing times in tenths of a second. Evidence PNGs retain their timestamps. Compact gzip JSON files preserve numeric trajectory, geometry-frame manifest, all robust collision/occlusion results, and the central strap visibility samples. The package deliberately excludes binary frame caches, entire restored runtime, original video and unneeded screenshots.

## Important interpretation
30fps actual-host numeric run; 10fps geometric samples over 9s drag/landing and 63s petting. Three front-facing camera angles; stable upper-head vertex region, not every possible camera or transition. Majority-three-ray closed-volume tests avoid single-ray grazing false positives. Node texture hooks are metadata-only; Blender renders decode the actual embedded textures. Diagnostic Blender shading does not reproduce the custom browser D2 shader effect. No WebGL/Electron/production integration claim.

After rendering both closeup sequences: python src/compose-seam-review.py.
