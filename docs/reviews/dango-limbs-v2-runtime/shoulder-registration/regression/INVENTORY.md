# Registration synchronization and test plan

All paths below are repository-relative. No listed file was edited by this worker.

## Mandatory current limb-package edits if adopting the registration

Within assets/companion/dango/raster/limbs:

1. `limbs.json` sockets[1], `socket/sockets.json` frames[1], and `sources/rebuild-recipe.json` frames[218] (socket-patch) and[219] (socket-coverage): worldRoot=[58.5,45.5]; preserve sourceBodyAnchor=[58.6,39.712821]; anchorOffset=[-.1,5.787179] within numeric tolerance. Explain canonical x half-pixel quantization. Other five shoulder roots remain byte-equivalent. sourceBody data/hash are unchanged.
2. Rebuild `socket/socket-shoulder-r-front-coverage.png` and its exact8x counterpart from canonical alpha using the new integer placement. Update coverage frame.sha256, recipe and FILES hashes. The transparent socket patch and local pivot do not move/change pixels. UsefulLocalRect and root remain unchanged. bodyAlphaSha256 names the canonical body alpha and must not be replaced with a stencil hash.
3. `validation/fixed-shoulder-targets.json` has10 old front/right fixedShoulder entries. `validation/visual/rig-solutions.json` has the same10. Re-solve their fixed, existing target wrists using the new root; do not merely subtract3 from the shoulder field while retaining stale elbow/wrist/error results. Preserve approved source/canonical target positions; distinguish any historical shoulder-relative mirrored derivation from newly solved world positions.
4. `validation/visual/registration.json` has3 front/right old-root records. Recompute front standing/holding-cup/waving evidence and corresponding native/2x/inspection images (quarter stepping/lifting unchanged), or explicitly separate historical review from a new current report. The old `render_previews.py --verify` compares against prior image snapshots and must not pass by overwriting evidence without review.
5. Refresh `FILES.sha256.json`, `validation/check-results.json`, plus current claims in `validation/QA.md`, `README.md`, `COMPOSITION.md` and any ART-DIRECTION statements only where affected. Current static40-goal error maxima may change; recalculate them rather than retain1.662799 as a current maximum by assumption.
6. `interfaces/interfaces.json` has three left-side verified poses; all remain unaffected. Segment/paw PNGs, joint-pair repairs, source-body PNG, body anchors, props, face, feet and their hashes must stay unchanged.

## Existing source-contact pose must not be silently relabeled

Hiccup's separate source-bound package retains old front/right61.5 in:
- `assets/companion/dango/raster/action-contact/hiccup-front-v1/frames.json`, `scripts/build_pose.py`, extraction recipe and prior source/evidence files;
- `assets/companion/dango/raster/dango.raster.mjs` embedded hiccup-front-contact-right.sourceContactPose.fixedShoulder;
- `src/capabilities/companion/presentation/dango-source-contact-pose.mjs` closed eligibility condition;
- `test/dango-source-contact-pose.test.mjs` fixture and current validation artifacts.

Both hiccup runtimeReady flags are false. Mark this old package explicitly unregistered/unverified for the new generic right shoulder, or keep it explicitly historical and disabled. Do not edit its shoulder number/eligibility fixture alone and imply the baked source projection was validated at58.5. Rebuilding that separate source pose is a separate actual source-registration task. Its historical masters/provenance should not be rewritten. `sip-front-v1` source-derived pose records likewise are not generic shoulder-contract evidence and remain disabled/source-specific as currently declared.

## Suggested validation order

1. Add exact metadata-agreement tests across manifest/socket/recipe records, sourceBodyAnchor preservation, half-grid registration, canonical-body pixel identity, and all other shoulder roots unchanged.
2. Validate the new coverage against canonical body alpha at every usefulLocalRect pixel; unknown padded pixels remain unknown. Confirm exact8x equivalence and unchanged transparent patch/pivot.
3. Run package `scripts/check.py` and `scripts/rebuild.py --output <meta scratch> --verify`. These asset checks alone do not validate the40 solved-goal summaries or runtime behavior.
4. Recompute40 goals, audit their exact target/error statistics, and refresh/review only affected static front compositions. Verify all left and quarter/back placements remain identical.
5. Run Node dango-limb-assets/body-alpha/contact-contract/composition and source-contact-pose tests, plus raster/source-integrity/portable action-contact checks applicable to current tree. Add a source-backed generic bubble regression that pins58.5 and asserts full-phase admission with unchanged wand target and zero upper exposure.
6. The parent reviewed newly admitted umbrella/front/right in the five-phase 1x/2x sheet with no new obvious contour issue. Retain that bounded finding rather than claiming broader animation acceptance. Preserve whole-action conservative gates; never relax tolerances to hide hiccup/carry-energy/plant-water regressions. Track already-unadmitted action branch diagnostics separately from visible animation proof.
7. Run npm run check and npm run test:integration against the final tree. Keep generic runtimeReady=false, hostAcceptsContract=null and all unapproved action-contact defaults disabled. Actual browser/DPR/native evidence remains distinct from these Node/Skia checks.
