# Default-quarter umbrella source

The actual default `umbrella-dance` view is three-quarter. `umbrella-quarter-handle-v1` adds a genuine quarter far-palm source to that default path; the accepted front-only umbrella source remains unchanged.

The hand grips the original green J handle's right upright at fixed `[68.375,43.75]`, rather than the previous cheek-level `[61.875,35.75]` point. The full umbrella remains at `[37,-11]`. The real far-palm source has no independently visible short wrist, so none is synthesized. Its heel is naturally hidden by the unchanged body.

## Evidence

`validation-summary.json` records the bounded production-code results:

- 3,020 source frames: full 10-second action at nominal 30 fps, exact 1250/3750 ms extrema, DPR 1/1.25/1.5/2/3, both reflections.
- 240 headwear/wardrobe cases: all 10 Dango head entries at their applicable skins, both DPR 1/2 and facings, five phases; plus a seven-item heavy outfit and reduced motion.
- 1,617 lifecycle frames, including 1,319 selected-source frames: controller expiry, interruption/reopen, reduced/resume, cancellation/reopen and frozen animation clock pause/resume.
- Real pending-image promise and late decode: the current episode retains byte-identical whole fallback; the next episode uses all four source layers. Four independent actual PNG decode failures and per-resource state faults are covered by the formal Node tests.
- 374 formal Node tests/subtests pass. They cover metadata, geometry, immutability, envelopes, original body/face/matrices, the accepted front path, hashes, complementary RGBA partitions and exact NN8x. No Python test dependency was added.

Every full-cycle source frame has actual final-stage source omission evidence and actual `drawImage` tracing. The observed order is umbrella back → palm back → cached body → umbrella front → palm front. Both umbrella fragments have identical actual matrices and draw rectangles; both palm fragments have identical matrices. Replaying the two umbrella draws reproduces the original complete prop byte-for-byte in all 240 headwear cases.

The minimum true pink-palm/body-fill overlap is 5 final-stage pixels. Rear-root exposure is zero at alpha≥128; the known pink boundary cell is body-covered with alpha255. New palm/face overlap is zero. The old cheek-level fallback covered 1–15 face-mask pixels in headwear samples; all face differences are removal of that old action overlap, with unchanged face painting.

`source-audit.json` separates source-mask ownership from alpha thresholds and whole-cell palette quantization. All 2,882 connected pink palm pixels survive the approved mask; the approved inner ink band does not preserve the entire original outer stroke thickness. The 75-cell palm is split into 23 rear and 52 front cells without loss or duplication. Original prop RGBA is also partitioned without loss. Quarter's foreground split differs from front's because the upper shaft would cross the quarter eye.

## Portable replay

Requires the repository's existing Node dependencies, including `@napi-rs/canvas`. Run each command with a fresh external output directory:

```sh
node docs/reviews/dango-limbs-v2-runtime/umbrella-quarter-source/two-phase.mjs --repo /path/to/repo --out /tmp/umbrella-quarter/two-phase
node docs/reviews/dango-limbs-v2-runtime/umbrella-quarter-source/full-cycle.mjs --repo /path/to/repo --out /tmp/umbrella-quarter/full-cycle
node docs/reviews/dango-limbs-v2-runtime/umbrella-quarter-source/headwear.mjs --repo /path/to/repo --out /tmp/umbrella-quarter
node docs/reviews/dango-limbs-v2-runtime/umbrella-quarter-source/lifecycle.mjs --repo /path/to/repo --out /tmp/umbrella-quarter/lifecycle
node docs/reviews/dango-limbs-v2-runtime/umbrella-quarter-source/late-loader.mjs --repo /path/to/repo --out /tmp/umbrella-quarter/late-loader
node --test test/dango-umbrella-quarter-contact.test.mjs
```

`--out` is mandatory and rejects paths inside the repository, including symlink-resolved paths. Generated adapters, dense traces, frame captures and images are external output only. The two-phase script creates light/dark comparison panels from independent native DPR1 and DPR2 stages; it does not downsample DPR2 to imitate native size.

The fixture uses the unmodified production helper/selector/artist. Its adapter injects only independently constructed source loaders and tracing into the real renderer. The fallback control disables this new source registration; the omission control changes only the selected front-palm image to same-sized transparency. Full manifests, actual Artwork, immutable frames and actual stage transforms are compared. Diagnostic masks never compare body-cache indices to stage indices.

The optional source reconstruction script lives with the compact authoring source under `assets/companion/dango/raster/action-contact/umbrella-quarter-handle-v1/sources/`. It uses the recorded 78×88 context crop, approved mask and projection, plus the unchanged repository umbrella PNG; it does not require shipping the full historical master.

## Boundaries

These are offscreen Skia production-code checks, not native Windows/macOS transparent-window, GPU or OS-scheduler acceptance. They do not certify every outfit/skin combination or all subframe alignments. Source body, face, feet, original prop and accepted front source remain unchanged; no persistent state, IPC, native window geometry or new rendering runtime was introduced.
