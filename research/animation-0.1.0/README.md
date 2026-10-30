# bubu 0.1.0 — 3D foundation checkpoints

This directory records the new 0.1.0 3D architecture work. Runtime design intentionally excludes V1 compatibility. Existing application code is not switched over by these research commits.

## Checkpoint status

- Approved body: static05, original GLB SHA256 `3b7adcb303c8bd3c0dfb8976f9eb8fc0e6cefb897a7c16e99acc827385591722`.
- Approved selected expression set: 01 / 04 / 05 / 07 / 08, revision r6; GLB SHA256 `fba41db41ecb0e0a959cd6923f55d5edbfaebf4558d79e1e9832b2a806cc5830`.
- Full expression library: the 18-slot static set is approved; the shared full18/D2 runtime and weighted expression owner have CPU verification. Historical seven-slot/r6 snapshots retain their original evidence.
- Current integrated research foundation: `animation-foundation-v1/`. Its README defines executable capabilities and the unified validation command.
- Current drag and long-press source: `shared-input-workbench-v2/` with the accepted landing/continuous-petting profiles. The foundation reuses these owners; final native input/visual acceptance remains separate.
- Browser/WebGL/native performance and real mouse interaction are not yet verified. Offline rendering and CPU tests must not be described as native end-to-end validation.

The approved body and selected r6 expression source/GLB restoration bundles are backed up under approved-assets/. The current D2/full18 restore scripts live under runtime-facepath05/tools/. Use the integrated foundation's current instructions instead of treating older snapshot READMEs as the latest readiness statement. No production/main merge is implied.
