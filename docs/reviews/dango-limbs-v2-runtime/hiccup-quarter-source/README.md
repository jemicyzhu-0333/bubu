# Hiccup quarter source replay

Requires the integrated quarter pair and the repository's existing `@napi-rs/canvas` dependency:

```sh
node docs/reviews/dango-limbs-v2-runtime/hiccup-quarter-source/capture.mjs --repo="$PWD" --out=/tmp/hiccup-quarter-source-replay
```

Default output is a compact report and local temporary module adapters only. Optional `--images` enables diagnostic native/2x PNGs; optional `--frames` enables per-frame JSON. No browser, network, display or new package install is used.

The candidate uses the actual unmodified production selector, artist, helper, manifest and PNGs. Canvas/image ports and the form-artist factory seam create isolated renderer instances. The first baseline disables only the dedicated quarter pair at the same revision; the second additionally forces both original legacy fins. A fourth identical source-enabled renderer removes only the far hand after selection to measure its visible RGBA contribution. Missing production sources fail explicitly rather than falling back to a test-injected selector.

3,072 samples per stream cover 12 scenarios: all phases at DPR 1/1.25/1.5/2/3, heavy wardrobe, reflection, calm, manual view inheritance and expiry, interruption/reopen, pause/resume and hidden/reset replay. Invariants assert source scope and atomic near/far pair, body, cup/tool geometry, both grip targets, the far before-cup layer, nonzero actual far visibility in every source-active sample (including lifecycle cases), and cache disposal. Failure exits nonzero. The report records the exact production source hashes.

The earlier isolated candidate report remains local; the delivered report uses the actual integrated selector. `contact-audit.json` is a separate fixed-art-space source/cup alpha audit. `verified-report.json` records the actual integrated production replay for raster digest `9c0e93ae2e132e93fc54cabc0d1f400a01e3d53255699d894694d96cdd784d0b`: all 3,072 samples pass, including nonzero far visibility in every source-active lifecycle sample. All delivered pixels retain the fixed four-color palette, zero transparent RGB and exact nearest-8x logical grid; approved master, masks, recipe and rebuild checker live with the source package.

The far asset contains only the source-observed lower-palm contour, after the body and before the unchanged cup/handle. Hidden anatomy is not fabricated. Whole-renderer reflection preserves the independently drawn near/far pair. This is offscreen Skia evidence, not native desktop/GPU validation. Hidden replay uses `document.hidden` and the public clear command, not an operating-system hide event/controller test.

## Far contour connectivity

```sh
node docs/reviews/dango-limbs-v2-runtime/hiccup-quarter-source/alpha-audit.mjs --repo="$PWD" --out=/tmp/hiccup-quarter-source-replay
```

This separate audit reads the production PNGs and projects their alpha at exact 8 px/art using the unchanged cup and true quarter body. `alpha-connectivity.json` verifies one four-connected far component before and after cup occlusion. The visible component has 2,812 pixels, 68 cup-adjacent pixels, and complete overlap with the original body footprint. Its dark contour has two segments (922 and 109 pixels), both touching the original cup (11 and 9 pixels). Thus the narrow dark side line is part of a single connected visible palm surface; it is not a separate alpha fragment. This geometric check does not by itself establish that viewers will read the stylistic contour as a hand. The full-renderer phase/visibility replay and human native/2x review remain distinct evidence. Optional `--images` emits a local light/dark alpha diagnostic only; source PNGs are not modified.

The full-renderer far-omitted comparison also audits the actual output alpha in every source-active sample. Across 2,220 such samples (within all 3,072 timeline samples), adding the far contour changes zero alpha pixels and introduces zero pixels outside the original body/cup silhouette. Its nonzero contribution is entirely visible color/ink within that silhouette. `farAlphaStats` in the verified report records these extrema; the replay fails if new off-silhouette alpha appears. This directly distinguishes the narrow palm-side ink from a new detached off-body sprite while retaining human readability review.

Final repository check with all three existing Canvas backend variables:6152 tests,6147 pass,5 optional skip,0 fail, exit0. Integration71/71. The older reconstruction fin test explicitly selects the source-disabled fallback, preserving its exact grip/scale assertions; eight dedicated pair tests cover normal source and failure contracts. See `final-validation.json`.
