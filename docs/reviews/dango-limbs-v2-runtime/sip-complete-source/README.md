# Front sip complete-source reproducible review

This review uses the repository's actual production source-contact selector and standard raster artist. It does not install assets, alter files, publish commits or enable a production gate. Its in-memory test manifest changes exactly the four existing `sip-front-v2` `runtimeReady` fields from false to true. The input repository must retain those four false gates.

The frozen source assets and their portable source-rebuild checker live in the repository under `assets/companion/dango/raster/action-contact/sip-front-v2/`. This review imports them in place; it contains no duplicate source package and does not overwrite that package.

## Requirements

- Node with the repository's installed `@napi-rs/canvas`
- The complete repository assets, including the disabled old `sip-front-v1` comparison package
- `ffmpeg` on PATH for full-mode H264 encoding and decode verification

No browser, external service, Python dependency or image-generation call is needed by these QA scripts. Output must be absent or empty. Paths containing spaces are supported; quote them in the shell.

## Small portable reproduction

    node scripts/run-review.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/QA smoke with spaces" --smoke
    node scripts/verify-reproduction.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/QA smoke with spaces"

Smoke mode renders phase indices 0, 128, 256 at DPR 1, 1.25, 1.5, 2, 4, then runs the lightweight continuous 257-frame single-instance lifecycle check. It is explicitly reported as 15 selected raster samples, not a second complete 1,285-sample audit. `verify-reproduction.mjs` compares the three PNG files against the frozen PNG-byte and decoded-RGBA hashes in the included reproduction record.

This exact smoke workflow was run against the integrated repository with an output path containing spaces. All three representative PNG bytes and RGBA pixels matched the original frozen full-run frames. All lifecycle candidate and legacy hashes also matched. See `evidence/portable-reproduction.json` and `portable-smoke-summary.json`.

## Complete reproduction

    node scripts/run-review.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/full sip review"

Full mode runs nine child processes serially, at most 32 consecutive phases per child, for all 257 phases × five DPRs = 1,285 raster samples. Each process creates the actual artist and actual selector from `--repo`. It consumes only the frozen logical/exact8× source PNGs. It never reloads or resamples the raw master per phase or DPR. Canvas dimensions are ceiled, while drawing scale remains exactly `1.5*dpr`.

`continuous-instance.mjs` separately renders all 257 phases through one artist/action instance and a reused 219×219 canvas. It verifies source persistence, the loop seam, exact legacy pixels after idle/cancellation/incompatible-view fallback, sticky failure within an instance and re-entry in a new instance. It records artist cache counters before, after and on disposal. These counters do not establish process/native GPU memory bounds.

Full mode aggregates its reports, writes the three-column 257-frame PNG sequence, encodes the 9-second H264 video, then decodes the complete video to verify readability. The exact ffmpeg recipe is implemented in `run-review.mjs`: input framerate 257/9, libx264 CRF 19, yuv420p, 30fps output, duration 9s, faststart. The delivered video is 1320×790 with 270 frames. Column 2 is explicitly labelled old v2b forced diagnostic; the new candidate uses the true production selector.

Individual bounded runs are also available:

    node --expose-gc scripts/renderer-oracle.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/batch" --start=0 --end=31
    node --expose-gc scripts/continuous-instance.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/lifecycle"

## Included evidence and scope

- `evidence/summary.json`: original complete 1,285-sample standard-artist result
- `evidence/continuous-instance-report.json`: complete single-instance and fallback result
- `evidence/contact-low-three-column.png`, `contact-high-three-column.png`: original-size and2× comparisons
- `evidence/sip-front-v2-three-column-9s.mp4`: playable original full-run comparison
- `evidence/portable-reproduction.json`, `portable-smoke-summary.json`: portable final-repository reproduction
- `FILES.sha256.json`: this minimal review's inventory

The heavy 257 PNG sequence and per-phase report are excluded because the scripts regenerate them. A former monolithic multi-surface harness exited 137; the final full audit therefore used serial bounded processes, with continuous lifecycle tested separately. This does not establish native-host memory behavior.

The completed audit found no delivered-root exposure, face overlap, cup/hand pixel gap, body/cup change or fixed-source-matrix violation across 1,285 samples. The original six-opaque-source-pixel low-left-root coverage exception remains documented in the source package: delivered fixed pixels and every original source sample are different claims. The source depth split is a declared research hypothesis. The high-pose upper contour remains an artistic decision. Global runtime readiness stays false; browser/native-host, wardrobe and user artistic acceptance are not claimed.

## Actual production renderer and integrated checks

`node scripts/actual-renderer.mjs --repo="/absolute/path/to/bubu" --out="/absolute/path/renderer evidence"` uses the actual production renderer and form-art, normalizing imports into an isolated temporary wrapper and injecting one real standard Dango artist with the four source gates true only in memory. Across 257 timestamps × DPR1/1.25/1.5/2/4, all four layers remain selected, body-cache identity stays constant and artist caches dispose to zero. The existing 9-second preview loops its final timestamp to phase0; the separate exact-phase oracle covers phase1. `evidence/actual-renderer-audit.json` records the final combined production module hashes. The three-column video remains standard-artist evidence, not this full-renderer capture.

Final combined code verification: Canvas-enabled `npm run check` with task-local CPU affinity0,1,2 exits0 (6024 tests:6015 pass,9 optional skips,0 failures); `npm run test:integration`71/71. The final source checker verifies32 sealed files and independently rebuilds8/8 logical and8× PNGs byte-exact. Unit/runtime tests cover old hiccup compatibility, all-or-none readiness, failed and late resources, instance reset, wrong view/outfit, calm/reduced motion, unchanged other actions and source disposal. These results do not grant artistic, browser or native acceptance.

Ownership: companion presentation owns source selection and its existing bounded action-instance readiness; no persisted state path or native IPC is added. Front sip only, no outfit, unchanged canonical cup/body and fixed shoulder registration. Root-back and continuous fore+palm-front are complementary source masks with an explicitly declared depth hypothesis. All four source flags remain false.

Packaging contract: the authored master, prompt and nested source/mask metadata remain in the repository but are explicitly excluded from the application bundle. The real electron-builder FileMatcher regression recursively rejects this source directory and still includes all four referenced runtime layers.

The final aggregate used `taskset -c 0,1,2 env PET_MOTION_CANVAS_PACKAGE=$PWD/node_modules/@napi-rs/canvas USAGI_CANVAS_PACKAGE=$PWD/node_modules/@napi-rs/canvas npm run check` on this Linux task. Two preceding default-parallelism runs reported a Usagi whole-test-process failure without a failing assertion; isolated19 tests pass. The first also caught the repaired body-offset scanner boundary. No cause is asserted for the process exit, no unrelated Usagi code changed, and no assertion was weakened.
