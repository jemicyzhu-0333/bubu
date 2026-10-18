# Existing four wearables: contact/weight candidate

This is an isolated research candidate for the approved Sprout, Sunhat, Satchel and Scarf. The original GLBs, original adapters, body, face, materials and publication checkout remain unchanged. The candidate's own per-actor geometry is revised at runtime. No production/native acceptance, user visual approval of the revision, or stable solver interface is implied.

## Retained corrections

- Bag and scarf attach to torso surface vertices, independently of head-local deformation. Sprout and hat retain scalp support. GLB coordinates keep the original scalp-origin convention, with explicit compensation to the new support frame.
- The bag-side continuous strap rises into the pouch's upper seam. It no longer enters the pouch at the original low middle section. The pouch outline, leather/brass materials and continuous rear return are retained. Fresh ±90°, -45° and back comparisons show this change.
- The scarf tail has a small downward/inward resting drape and a pinned root. Its original low-U collar geometry is retained. An attempted inward collar/contact compression increased tea intersection peaks and was reverted; it is not a successful seam fix.
- All geometry changes are actor-private. Cross-material scarf normals share the same seam map. Source geometry, shared materials/textures, body and face are read-only.

## Experimental motion only

`src/local-adapters/` is a bounded kinematic experiment awaiting comparison with mature Three.js-compatible physics/cloth solutions. It is not a physically calibrated cloth simulation and must not be promoted as a locked production interface. Gravity is evaluated in the current local frame; supplied pose acceleration drives a damped response. There is no self-running sine wave, random wind, new timer or independent clock. The hat crown and attachment roots remain supported; only free regions receive small secondary movement.

Reduced motion, disable, seeks and >250 ms gaps clear momentum. Identical shape/contact inputs cache geometry. The host validates live actor ownership, transforms and finite positive three-component contact envelopes; invalid state revokes the wearable set. The original catalog descriptors remain provenance-compatible; experimental deformation limits are defined and tested in the candidate adapter code, not a new catalog contract.

Owner: research wearable installation. State: per-instance geometry/rest buffers, motion state, shape cache, lease counts and same-actor exclusive-group admissions only. No persistent state, body-rig, wardrobe eligibility, main, publication or production renderer changes.

## Current evidence

The final run is in `.physics-final/existing-wearables/`; `.physics-validation/` preserves the rejected compression experiment and is not the final candidate. Compact final reports are copied under `reports/final-*` and indexed by `reports/physics-revision-summary.json`.

- All four items replay all 271 drag and 1,891 longpress poses. Same-actor exclusion, independent actors, source bytes, private geometry, source identity/revocation, failed installation, exact reduced/reset behavior, repeated time, dt spikes, and final disposal are tested.
- Separate support-motion tests cover head-only deformation leaving torso attachments fixed, no unforced idle motion, deterministic replay, gravity, 30/60 Hz peak agreement, caching and exactly-once private disposal.
- Actual static vertex stage checks use four camera directions. A conservative .18-unit garment envelope is transformed through every recorded pointer pose without enlarging span5.264/targetY1.05/CSS219.
- Fresh actual geometry is rendered by Blender CPU: four views, selected drag/longpress frames, both bag sides/back before-after, and selected tea contact frames. Geometry-based images are not native pointer/WebGL evidence.
- Tea is audited on all 271 source-coordinate frames using the actual per-frame candidate geometry and unchanged source hand/cup/face data. Known palm/strap and palm/collar seams remain unresolved. Zero cup crossings in these samples is not continuous collision or arbitrary-action acceptance.

The six pointer images are labeled by exact scenario/frame/time. They are representative frames, not a rendered movie or an assertion that every phase is shown. Enlarged bag/tea diagnostics use span3.0 and must not be treated as stage-size evidence.

## Reproduce

Use the existing pinned Three.js 0.186.1 runtime, Python numpy/scipy/Pillow, Blender, the unchanged repository, and SHA-manifest-verified references. `POINTER_REFERENCE` supplies fixture modules and pointer trajectories; `TEA_REFERENCE` supplies tea snapshots and hybrid input arrays. Both may be the same complete prepared reference tree. `CACHE` is an isolated output directory.

1. `node src/test-support-motion.mjs`
2. `node src/test-and-export.mjs --repo-root "$REPO" --reference-root "$POINTER_REFERENCE" --cache-root "$CACHE"`
3. `node src/export-tea-physics.mjs --repo-root "$REPO" --reference-root "$TEA_REFERENCE" --cache-root "$CACHE"`
4. `python src/audit-tea.py --reference-root "$TEA_REFERENCE" --cache-root "$CACHE"`
5. `python src/verify-evidence.py --reference-root "$TEA_REFERENCE" --cache-root "$CACHE"`
6. `python src/audit-stage.py --reference-root "$TEA_REFERENCE" --cache-root "$CACHE"`
7. `python src/audit-motion-bounds.py --reference-root "$POINTER_REFERENCE" --cache-root "$CACHE"`
8. `CACHE_ROOT="$CACHE" bash src/render-all.sh`
9. Prepare/render contact evidence using `prepare-contact-review.py`, `render-contact-review.sh`, `classify-contact-points.py`, and `audit-contact-visibility.py` with the same explicit cache/reference arguments.

The source GLBs are borrowed from the repository rather than duplicated. Do not run legacy model builders over approved originals. This candidate does not run or modify the production application; no production aggregate test or native OS qualification is claimed.
