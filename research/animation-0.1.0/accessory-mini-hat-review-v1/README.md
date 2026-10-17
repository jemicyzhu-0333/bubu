# Independent miniature-hat technical evidence

Read REVIEW.md before interpreting a pass. Applies only to exposed-ear GLB 06516ab90d747416c1749469b76aa24bff8e5ecea529f4e47134726112fa5227. The old large hat is not covered. Physical far-ear occlusion at strict side/elevated views is explicitly retained; this is not a claim that all ear surfaces remain visible.

## Restore
Install this directory under research/animation-0.1.0 alongside accessories-v1, runtime-facepath05 and the approved shared-input-workbench-v2/petting-continuous-r2/drag-landing-r5 modules. Restore the D2 fixture using its existing repository restore flow. Requires Three.js 0.186.1 under animation-0.1.0/node_modules, Blender 4.3.2 and Python/NumPy. No absolute dated workspace paths are required.

Run from this directory:

    node src/verify-sources.mjs
    node src/export-actions.mjs
    node src/extract-colors.mjs
    blender -b -t 2 --python-exit-code 1 --python src/check-actions.py
    python src/check-rigidity.py
    blender -b -t 2 --python-exit-code 1 --python src/check-self-intersection.py
    blender -b -t 2 --python-exit-code 1 --python src/classify-ears.py -- --body ../runtime-facepath05/fixtures/face-d2/asset.glb
    blender -b -t 3 --python-exit-code 1 --python src/render-actions.py

Wait for export-actions to finish before running checks. Generated work/ contains roughly 500MB of binary mesh frames and is deliberately excluded. Use a fresh work/ for changed sources. check-actions can resume an interrupted identical run from its existing result; never reuse it across changed inputs.

The frozen accessory package retains its own source builder, 241+361 host test, actual fit, 270 face-ray and default-render reproducer. Its all18 Blender mapper is an explicitly supplied approved input, not bundled here.

## Evidence
- source-hashes.json binds assets/adapters and approved action controllers.
- action-summary.json and rigid-fit-result.json summarize complete 2162 numeric / 722 geometry-frame action coverage.
- Gzip JSON retains complete numeric trace, frame manifest and 722 geometric result records.
- fit-audit.json and ear-near-far-independent.json retain all 24 static ear viewpoints, including nonzero far-ear occlusions.
- Two diagnostic PNGs show actual exported action geometry; no entire render set, video or frame cache is included.
- Browser/WebGL decoding and the custom D2 shader effect are not established by Node metadata stubs or diagnostic Blender renders. Final actual-model visual acceptance is separate.
