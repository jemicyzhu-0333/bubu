# Portable research entrypoints

Run from any directory, with Node and the pinned Three dependency installed for this package/reference cache:

    node headwear-expansion/src/test_and_export.mjs --repo-root "$REPO" --reference-root "$REFERENCE" --cache-root "$CACHE"

REFERENCE is a prepared, SHA-manifest-verified reference tree containing the unchanged source/hybrid actor, fixture modules and pointer/drag plus pointer/longpress trajectories. Outputs go only to CACHE/headwear-expansion/review and reports. Add --static-only to skip pointer replay while retaining static export and lifecycle checks. It is not full replay evidence.

Python audits use the same output CACHE and an explicit reference tree with tea/reports and hybrid-inputs:

    python headwear-expansion/src/audit_tea.py --reference-root "$TEA_REFERENCE" --cache-root "$CACHE" --full

The bundled shared/tea/triangle-collision.py is read directly. Tea tests cover 271 discrete sampled frames, not continuous collision or cloth simulation. Existing reports and image files remain historical evidence; fresh reports are separate cache outputs. Original provenance paths and hashes are deliberately retained in those historical reports.

Blender rendering remains an optional tool dependency, not a host-import requirement. Render scripts use CACHE_ROOT for output; Python composition tools accept --reference-root/--cache-root. Fresh render images were not produced as part of portability validation. Authoring build_models.py is retained for model regeneration and was not run; do not run it over approved packaged geometry. Themed finalize.py requires an isolated complete authoring cache with source/model/reference copies and freshly rendered review images and deliberately fails otherwise.

No browser/WebGL, native desktop, production wardrobe, or user visual acceptance is implied by CPU host and discrete tea checks.
