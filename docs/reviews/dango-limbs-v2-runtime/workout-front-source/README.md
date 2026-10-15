# Integrated workout front-source QA

## Result and scope

The eight-group phase matrix passes 4,080 actual-renderer frames: bare DPR 1/1.25/1.5/2 with both facings represented, boots DPR 1/2, and a six-item heavy outfit in full and calm modes. Every group covers all 510 60 Hz frames before the 8.5 s deadline, plus 8,500/8,600/9,000 ms controller-expired frames. There are 16,320 separate final-stage source-omission contribution proofs and 24 clean exit checks. The heavy outfit is sunhat, satchel, scarf, halo, boots and cape; it is representative, not an exhaustive wardrobe cross-product.

The independent lifecycle matrix passes eight scenarios / 2,499 frames, including 2,004 atomic source-pose frames, 4,008 separate left/right omission proofs, and 2,004 final-stage equalities after omitting all legacy support-paw/arm/hand pixels. It covers natural expiry, reduced motion, low stimulation, mid-action mode switches, wave replacement, repeated workout, mirrored drag cancellation, visibility/menu cancellation, and paper-plane replacement. Its recorded production-input hashes still match this source tree.

`compact-summary.json` retains group-level numerical results, evidence hashes, production/source hashes and lifecycle totals without bulk frame traces or demo PNGs. Parent-owned full repository/integration validation is recorded separately; these scripts do not rerun it.

The phase fixture invokes the real registered selector, artist, action/paw/appearance painters and `createPetRenderer` with a local Skia image port. It does not inject a workout helper or modify a production painter. Its main matrix leaves the optional generic-limb source null. Lifecycle loads the real generic limbs and production walk adapter. `qa/audit-limb-parity.mjs` passed a bounded parity check at the two source extrema and DPR2 frames 90/384, for both integrated source and source-disabled fallback. Eight with/without-limbs full-stage comparisons are byte-identical. With real limbs enabled, separately failing the left or right source PNG also matches the source-disabled+limbs baseline at all four points (eight more byte-identical comparisons; each failed case records exactly one failed source).

The formal `test/dango-workout-runtime.test.mjs` test “actual production artist preserves original body, feet and headband across 257 phases” loads generic limbs. Its separate delayed/failed-loader tests do not; the bounded failed-left/right full-stage parity above supplies that additional tested configuration, without claiming a generic-limb delayed-load matrix.

These are offscreen factory-injection results, not the production singleton, browser, Electron or native desktop acceptance.

## Geometric and pixel boundaries

- Each mapped canonical body is byte-identical to the same-frame legacy baseline. Body descriptors, original part matrices, attachment matrices and footwear transforms remain equal.
- Bare hands and the original feet have exactly equal same-frame final-stage sole coordinates in all 2,040 bare frames. Original feet/boots have exactly equal new-versus-legacy final-stage sole coordinates in every group.
- Existing boots use the unchanged 0.8 scale about art sole y=64. Final Skia CTM coefficients are float32. Hand-versus-boot numerical tolerance is explicitly 0.0001 device px; measured maxima are 0.00000762939453125 at DPR1 and 0.0000152587890625 at DPR2/full. Heavy calm is exactly zero. This numerical exception does not apply to bare feet or new-versus-legacy shoes.
- The boot rounding scale follows y=d·64+f. With float32 unit roundoff u=2^-24, a conservative first-order estimate for the extra scaled path is 2u·(64|d_boot|+|f_boot|+|f_hand|), around 0.000052 device px for the tested DPR2 coefficients. The predetermined 0.0001 bound is far below one device pixel. Exact measured errors remain in the summary.
- Absolute stage ground moves under the unchanged shared renderer snap/expression baseline. At DPR1.25 it spans 194.67636108398438–195.6698760986328 device px. Equal same-frame source/foot geometry does not mean a fixed absolute raster row.
- Positive-alpha boundary mismatches per side are 188/510 at DPR1, 247/510 at DPR1.25, 291/510 at DPR1.5, and 270/510 at DPR2/full. All differences are one row. Boots/heavy full follow their DPR's counts; heavy calm has none.
- Alpha>=128 hand/foot boundaries match at DPR1/1.25/1.5. At DPR2/full they differ by one row at frames 90 and 384 (1,500 and 6,400 ms): the hand boundary is 311 and foot/boot boundary 312, with shared sole y=311.4991149902344 / 311.49918365478516. This is disclosed for bare, boots and heavy/full, rather than described as universal pixel locking.
- The canonical-body test region uses alpha>=254, which includes near-opaque antialias pixels. Up to ten such pixels differ by one channel value after a source is omitted; the largest channel difference is 1, and zero pixels exceed the audit's interior-leak threshold of 8. This is not a claim that every covered-source pixel is byte-identical.

The original foot source's alpha bottom is 70/70 of its image, mapped to art y=64. The new palm source's alpha bottom is 520/648 with rect `[-12,-1,90,81]`, also art y=64. Final-stage CTMs, not logical rectangles alone, supply the acceptance evidence.

## Immutable evidence and controller expiry

Per-frame draw records are deeply cloned and frozen before reusable captures are cleared. `qa/snapshot-regression.mjs` mutates original CTM elements, rectangles, image sizes, object properties and array length; old snapshots must retain their original values, and direct snapshot mutation must throw. It is deliberately not named `*.test.mjs`, so it does not alter the repository's automatic test inventory.

The gallery harness is renderer-only. At the action deadline the audit explicitly applies `currentEgg=null`, matching production `updateActionPlayback`; expecting the renderer itself to expire its input would give a false residual-source result. The lifecycle fixture separately extracts the controller begin/cancel/update functions verbatim and runs them with disposable state/effect ports.

Earlier reports without immutable CTM/sole evidence are retained externally as superseded. One old shallow-reference CTM comparison and the absolute fractional-ground failure are not accepted production regressions. The independently completed DPR1.5 immutable/geometry report was reused; the three old groups were replaced and four missing groups completed.

## Portable commands

Requires Node, Python 3, the repository and its installed `@napi-rs/canvas`. No network or browser is used. `--repo` selects the source tree; mandatory `--out` must be outside it, including after symlink resolution. Disposable fixtures, PNGs, logs and full frame reports remain there. Run matrix processes sequentially because each output root shares a generated fixture directory.

From the repository root:

    node docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/snapshot-regression.mjs
    WORKOUT_SMOKE=1 node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/audit-full-production.mjs --repo=. --out=/tmp/workout-smoke
    WORKOUT_SCENARIO=smoke node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/lifecycle/run.mjs --repo=. --out=/tmp/workout-lifecycle-smoke

The portable smoke passed four selected action frames plus three exit checks; the lifecycle smoke passed 61 frames and 84 source-omission proofs. These smokes validate relocation; they are not additional full matrices.

Optional future full reproductions:

    node docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/run-matrix.mjs --repo=. --out=/tmp/workout-matrix
    node docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/run-lifecycle.mjs --repo=. --out=/tmp/workout-lifecycle
    node docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/audit-limb-parity.mjs --repo=. --out=/tmp/workout-limb-parity
    python3 docs/reviews/dango-limbs-v2-runtime/workout-front-source/qa/aggregate.py --repo=. --out=/tmp/workout-matrix --lifecycle=/tmp/workout-lifecycle/report.json --parity=/tmp/workout-limb-parity/parity.json

`run-matrix.mjs --group=bare-dpr2-facing-1-full` selects one named group. Direct phase-audit options are `WORKOUT_DPR`, `WORKOUT_FACING`, `WORKOUT_CALM=1`, JSON `WORKOUT_OUTFIT`, and `WORKOUT_QA_TAG`. `WORKOUT_QA_LIMBS=1` additionally loads real generic limbs and the production walk adapter. The separate `audit-fractional-ground.mjs` reproduces the specific DPR1.25 diagnostic; it was made portable without repeating its prior 510-frame run.

## Execution resources and limits

The first new DPR2 run was killed with exit 137 before a complete report; it is not passed evidence. A subsequent forced-GC attempt was deliberately stopped (exit 130), excluded, and forced GC was removed. The completed run limits V8 to 384 MiB, yields `setImmediate` every eight frames, clears only disposable per-frame QA artist traces, and uses a WeakMap for QA body-cache identity. It does not clear or change production caches, frame counts, resolution, sampling or assertions.

Five later groups include RSS/heap/external-memory samples every 32 frames. The highest sampled RSS is about 1.13 GiB. Actual artist source-cache counters stayed at 346 entries / 77,101,244 bytes from first to last sampled frame; per-mode QA traces stayed at one current artwork. The first three accepted groups predate resource sampling and have no invented resource figures. These bounded runs do not establish absence of native memory leaks or close the separate native-memory gate.

The inherited lifecycle combined run completed four scenarios before exit 137; its remaining scenarios completed in isolated exit-0 processes. Completed assertions and process outcomes remain distinct in the compact evidence. No native Windows/macOS transparent-window, input, GPU, DPI or memory acceptance is claimed.

## Source and provenance paths

Production sources remain unchanged by this QA package:

- `src/capabilities/companion/presentation/dango-workout-contact-pose.mjs`
- `src/capabilities/companion/presentation/dango-source-contact-pose.mjs`
- `src/capabilities/companion/presentation/dango-raster-art.mjs`
- `src/capabilities/companion/presentation/dango-raster-actions.mjs`
- `src/capabilities/companion/presentation/dango-raster-paws.mjs`
- `src/capabilities/companion/presentation/dango-raster-appearance.mjs`
- `assets/companion/dango/raster/dango.raster.mjs`
- `assets/companion/dango/raster/action-contact/workout-front-support-v4/left-8x.png`
- `assets/companion/dango/raster/action-contact/workout-front-support-v4/right-8x.png`

Original generation, reference, exact prompt, provenance, reconstruction and quantization disclosure remain under `assets/companion/dango/raster/sources/action-contact/workout-front-support-v4/`. The original 1254×1254 `generated-v1.png` has SHA-256 `d53f342877cc1a14ed04cb90c769d51074eaa7a22fb2c71029daa2f211cf8061`. No generated provenance was removed or rewritten to make the QA portable. Demonstration images, videos and bulk traces are intentionally external to this review package.
