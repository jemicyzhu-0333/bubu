# bubu 0.1.0 — 3D foundation checkpoints

This directory records the new 0.1.0 3D architecture work. Runtime design intentionally excludes V1 compatibility. Existing application code is not switched over by these research commits.

## Checkpoint status

- Approved body: static05, original GLB SHA256 `3b7adcb303c8bd3c0dfb8976f9eb8fc0e6cefb897a7c16e99acc827385591722`.
- Approved selected expression set: 01 / 04 / 05 / 07 / 08, revision r6; GLB SHA256 `fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830`.
- Full expression library: in design and review. V1 inventory is coverage evidence, not a runtime dependency or an upper bound on expressions.
- 0.1.0 manifest, capability contracts and foundation runtime: in progress, independently reviewed.
- Drag and long-press integration: deferred until the foundation and full expression library pass review.
- Browser/WebGL/native performance and real mouse interaction are not yet verified. Offline rendering and CPU tests must not be described as native end-to-end validation.

The approved body and selected r6 expression source/GLB restoration bundles are now backed up under approved-assets/. Run its restore script to verify retained hashes and reproduce editable source/look files. The broader expression library and new runtime remain in progress. No demonstration videos or production/main merge are included.
