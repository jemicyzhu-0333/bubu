# Snack quarter source replay

Run from the repository root after installing its existing dependencies:

```sh
node docs/reviews/dango-limbs-v2-runtime/snack-quarter-source/capture.mjs --repo="$PWD" --out=/tmp/snack-quarter-source-replay
```

Requires the repository's `@napi-rs/canvas` development dependency. No browser, display server, network or additional package installation is used. The output directory is created automatically. `--repo=/absolute/path` and `--out=/absolute/path` make the replay independent of its working directory. `--images` explicitly enables diagnostic native/2x light/dark PNGs; `--frames` explicitly enables detailed frame JSON. By default only a compact `report.json` and temporary local module adapters are written; neither images nor per-frame data are produced.

The candidate uses the integrated production manifest, source selector and artist unchanged. The fixture substitutes only Canvas/image ports and the form-artist factory seam to compare three independently cached artists: source-disabled legacy fallback, diagnostic forced generic limbs, and production source. The two baselines disable only the dedicated snack source at this same revision; they are not checkouts of a historical commit. There is no candidate selector injection.

The replay samples 4,677 times in each stream across 12 scenarios: DPR 1/1.25/1.5/2/3, heavy wardrobe, reflection, calm, manual auto-view inheritance and expiry, interrupt/reopen, pause/resume and hidden/reset command replay. It asserts action/view agreement; identical body, tools and right eating-hand contact records; exact left rest endpoint; source readiness and scope; cancellation cleanup; and cache disposal. Failure sets process exit status 1. The report records the exact production source/helper/renderer/PNG hashes.

`verified-report.json` is the compact checked result for raster asset digest `c6672852ae9b0be248f6b6cb266150ea46ef9be5bff2eb189ee0995a3aadda83`. The delivered PNG is the four-palette, transparent-zero, exact nearest-8x source. This replay validates the actual production painter through an offscreen Skia backend, not native desktop/GPU presentation. Hidden testing replays `document.hidden` plus the public `clearDecorativeParticles` command; it does not synthesize an operating-system hide event or validate controller scheduling.

Visual scope: the left resting fore/palm becomes one continuous source contour. Right eating hand, sandwich, picnic cloth and body remain unchanged. The original independent fore-fragment report was not reproduced in this head's pure-alpha diagnostic; the historical reproducer still needs reviewer confirmation. Hiccup is outside this replay's scope.

Repository validation: full check exit0 (6144 tests,6130 passed,14 optional skipped); the additional all-Canvas targeted suite passed27/28 with one historical-eye-baseline skip, covering nine previously skipped Canvas cases. Integration71/71. See `final-validation.json` for exact commands and scope. Candidate test staging lives outside the repository and is not included in these totals.
