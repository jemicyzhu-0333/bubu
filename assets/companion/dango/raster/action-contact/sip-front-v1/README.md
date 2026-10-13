# Front sip: disabled source candidate

This compact module packages the v2b front sip-tea forearm+palm candidate. It is not enabled or accepted: frames.json keeps runtimeReady=false. It changes no production renderer, contact guard, body, cup, shoulder, outfit, runtime manifest, or existing source. No new image generation was performed while packaging.

## Source and contact contract

The official v1/v2 masters, exact prompts and original generation metadata are preserved byte-for-byte. v2 is the extracted master. v1 remains necessary because v2 explicitly references it. The v2b correction only recovers authored upper ink wrongly removed by the v2 mask. Extraction preserves every original RGB value and multiplies source alpha by an explicit geometric mask. The saved boundary proposals and extraction metadata are historical records; words such as “reviewed” in those records do not grant package or visual acceptance.

sources/resolved-provenance.json maps original reference order to complete repository-relative paths and hashes. The canonical identity, canonical body and existing hiccup hold-v7 master are referenced in place, not duplicated. Original absolute paths, originalGeneratedPath and historical request targets remain unchanged as evidence; rebuild never follows those paths. Original source-request.json and low-source.prompt.txt propose the superseded right outer boundary. The active candidate contract is frames.json:

- Base cup (23,43), original rect (0,0,22,19)
- Left observed boundary (24.25,53.375), normal (+1,0)
- Right inner-handle foreground boundary (40.25,53.375), normal (−1,0), not the legacy handle axis or outer x+22
- Shoulders remain left (4.5,45.5), right (61.5,45.5)
- Logical sprites 66×72 at origin (0,0); exact nearest-neighbor 8× exports 528×576

The four-color logical projection is quantized once at p0. At all other phases both hands must use exactly the original cup translation cup(p)−(23,43). No source switching, per-phase resampling, scaling, rotation, inferred wrist, connector paint, root clipping or new body tissue. Raw source PNGs remain separate from the palette-mapped display exports. Canvas decode/readback deliberately matches the original experiment, including its alpha rounding behavior.

## Rebuild and integrity check

Requires Python 3, Pillow 12.3.0 and the repository's installed Node/@napi-rs/canvas dependency. No network or generation service is needed.

Run from any directory:

    python /path/to/sip-front-v1/scripts/check.py --repo-root /path/to/repository --rebuild

Repository discovery works automatically when this module is at its canonical location. Rebuild writes into a fresh temporary directory and compares raw extraction/masks, logical sprites and exact8× pixels, extraction metadata (except resolved source path), verification bytes and frames.json. It also verifies the full file inventory and external reference hashes. The package can be moved if --repo-root points to a repository containing its original canonical and hiccup dependencies. Manual rebuild stages accept --output and never write into runtime assets.

## Evidence and remaining gates

validation holds compact historical experiment summaries and representative source/composite sheets. These are offscreen research evidence, not native-host screenshots or application activation. Fixed-projection versus earlier per-phase reproject findings must not be conflated. In particular, the historical isolated-ink reduction from 70 to 36 does not establish an overall pass.

Independent bounded upper-ink review accepts only that restoration: 716 left plus 216 right pixels, no removed old-v2 pixels. Of 932 additions, 931 classify as source ink; left source (442,738), RGBA (139,48,72,253), is an individually retained authored antialias transition. It is not a claim that every restored pixel is pure black.

The known light-pink diagonal proximal/root patch seam remains a visual blocker. The independent review finds the current straight cut crosses a proximal highlight lobe and excludes some original fore-owned material. A subsequent bounded upstream investigation stopped without an executable v2c cut: a few excluded fore-highlight pixels are identifiable, but a complete upstream cross-section would cross ambiguous fore/body material. A genuinely separable source root or explicit artist ownership is still required; wholesale upstream cut shifts, body tissue, recoloring, caps or generated seams are not authorized by this package. Source-integrity repair is not proof of a natural root. Independent contact/coverage review and dynamic visual acceptance are still pending; representative wardrobe, fractional-DPR/native-host and final integration validation are separate gates. This package grants none of them, makes no test-count claim, and remains a disabled candidate.

The portable source-integrity guard also verifies the v2b repaired boundary and rejects the old-v2 negative fixture plus missing-anchor, recolor, alpha-damage and extra-body mutations. Its old-v2 fixture stores only two masks and crop coordinates; RGBA is reconstructed from the unchanged v2 master. Original guard bytes and fixed-boundary proposal are retained under provenance. This is source-integrity evidence only. Run separately with:

    python scripts/source_integrity_guard.py --report /tmp/sip-source-guard.json

## Deliberately excluded reproducible bulk

Not copied: v2b-fixed-playback/frames/ (257 rendered frames), full playback-report.json per-screen rows, independent review diagnostic context images and full per-cluster guard results, v2b-fixed-projection/samples.json, individual pose-*-8x.png sequences, duplicated body/cup reference variants, v1/v2/per-phase candidate sequences, upstream-cut probe images, intermediate audit logs and large review reports. Original audit/render scripts are retained as provenance only, not portable entrypoints. Their filesystem-specific imports must not be used as the package rebuild. The minimal package check is the portable entrypoint; broader integration research must be rerun in its own reviewed environment.
