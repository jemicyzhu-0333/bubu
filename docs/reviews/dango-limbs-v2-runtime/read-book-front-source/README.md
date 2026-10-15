# Reading palm source QA

This small package records the integrated `read-book-front-halfgrid-v1` source and reproduces its offscreen checks against the current repository. It contains no generated frame dump, video, private workspace path or copied production artist/selector.

## Scope and source

The companion presentation layer owns this narrowly registered exception: only the two original reading palms, including their source-owned hidden proximal roots, use a 0.5-art sampling grid. Body, book, page, page timing, stage and other action grids are unchanged. The original whole-hand source remains 9.2 × 6.705084745762711 art; quantization rounding is disclosed in the source audit and does not authorize runtime enlargement or deformation.

Four cropped runtime sources carry the existing four-color palette, binary alpha and exact nearest-neighbor 8× export. Front/root pieces are disjoint and reconstruct every RGBA byte of each complete logical source. Original source parts already exist in the repository; their full paths/hashes, exact footprint recipe, complete logical references and complementary partition proof are under:

`assets/companion/dango/raster/action-contact/read-book-front-halfgrid-v1/`

Rebuild from the repository root with:

    python assets/companion/dango/raster/action-contact/read-book-front-halfgrid-v1/rebuild.py --check

The source is selected only for the exact supported front reading geometry and all four resources must be ready together at episode entry. Cold/failed resources fall back as one group, with no late pop-in. Existing clothing is allowed. Unknown source metadata, unexpected geometry, partial-opacity metadata and recovery metadata fail closed. Remove this exception by removing its explicit selector registration and four descriptors when a replacement source is accepted; never change a global grid. `test/dango-read-book-contact.test.mjs` bounds the contract and verifies source hashes, palette, alpha, NN8×, RGBA union and lifecycle gating.

## Recorded results

`summary.json` contains the aggregate evidence:

- Pink, forest, ocean and sakura: two phases × DPR1/2, 16 groups and 32 single-source-omitted comparisons.
- Full 11-second front read at DPR1/1.25/1.5/2: 4,404 sampled frames, 2,116 visible-page frames and 8,808 single-source comparisons; zero recorded contact, root or source-contribution failures.
- All 16 Dango wardrobe items and two scarf/heavy combinations: two phases × DPR1/2, 72 groups and 144 source comparisons. Requested garment IDs were checked against actually selected garment IDs.
- Thirty lifecycle frames: manual/cue entry, controller-expiry projection, interruption/restart, and the real paper-return transition.
- Final parent aggregate validation: 6,716 checks (6,711 passed, five skipped, zero failed), plus 71 integration checks, both exit 0.
- Post-export-adaptation portable smoke: DPR1.25, three frames, six single-source comparisons, zero failures, exit 0.

Page contact requires either actual same-cell overlap with both final-stage alphas at least 128, or a full orthogonal shared pixel edge with both alphas 255. Diagonal-only contact is rejected. The analytic target remains on the original page edge through its real translate × rotate × scale transform; alpha checks do not replace that semantic requirement. At fractional DPR, source PNG alpha stays binary while the final Canvas may antialias its transformed edge. Per-hand `pageContactPass` fields are applicable only to the right palm during a visible-page phase; the other palm retains its book grip.

Body/book/page descriptors, source pixels, layer order and hidden-root coverage are checked independently. Source omission preserves the complete frame, artwork and manifest, blanks exactly one decoded palm, and requires positive final-stage contribution. Merely selecting a key or drawing fallback art cannot pass.

## Reproduce against another checkout

All runners require `--repo PATH` and `--out EXTERNAL_DIRECTORY`; the output must be outside the repository. They use existing Node dependencies, directly import the current production artist and selector, and create only output-directory renderer composition fixtures. The artist/selector drawing logic is not copied or replaced. The hooks observe post-tint draw calls; separate decode ports implement single-source omission.

    node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/read-book-front-source/matrix.mjs --repo /path/to/bubu --out /tmp/read-smoke --dpr 1.25 --smoke
    node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/read-book-front-source/two-phase.mjs --repo /path/to/bubu --out /tmp/read-two-phase
    node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/read-book-front-source/wardrobe.mjs --repo /path/to/bubu --out /tmp/read-wardrobe
    node --max-old-space-size=384 docs/reviews/dango-limbs-v2-runtime/read-book-front-source/lifecycle.mjs --repo /path/to/bubu --out /tmp/read-lifecycle

For a full matrix, omit `--smoke` and run separate output directories sequentially for `--dpr 1`, `1.25`, `1.5` and `2`. The renderer yields to the normal event loop each frame, reuses capture surfaces and trims trace history; no forced GC is used. Full raw JSON, regenerated frames and contact sheets remain in the chosen output directory.

## Boundaries

These are actual production modules rendered offscreen with Skia, not native Electron/desktop, transparency, GPU or platform-scale acceptance. The lifecycle runner supplies the real controller's `currentEgg: null` expiry projection at the documented deadline; it does not claim to run the native controller or autonomous cue scheduler.

Natural read-book has no partial-opacity/recovery episode. Its original page remains untouched. Paper-return→read may preserve the existing three-quarter view, which legitimately uses the old fallback; a later fresh front read selects the new source again. No new side-view source or view policy is claimed.

The superseded injected prototype's synchronous DPR2 run was killed before yielding results; a forced-GC retry was stopped with exit130 and is not counted as passed. The final ordinary-yielding production matrix has complete results. Its short sampled RSS observations do not close the pre-existing general production-memory risk.

An export-only syntax adaptation in `read-book-targets.mjs` accommodates the existing VM loader. The final target-module SHA and post-adaptation portable smoke are recorded in `summary.json`; the unchanged full-cycle mathematics was not needlessly rerendered.
