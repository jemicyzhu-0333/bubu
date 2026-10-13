# Independent distinct-forearm review

The 16 new forearms are source-distinct and reproducible. This is a **material/engineering check, not full-action acceptance**.

- Baseline: pre-change package at commit `27d9846`; candidate: current package containing the narrow distinct-forearm integration. `aggregate.json` records exact old/current manifest, elbow JSON and all 16 forearm PNG SHA-256 identities. This directory does not duplicate either package.
- Independently reconstructed 16/16 inverse-sampled RGBA outputs. All forearms differ from their old counterpart and upper arm. Upper/body bytes remain unchanged.
- Independently replayed actual PNG elbow masks/patches: 256/256 exact declared changes and unchanged alpha union for both packages; 208 pairs are legal.
- **New contour risk:** the candidate's wider source root creates small upper/lower elbow bumps in legal u0/f0 and broadens u45/f45 (`representative-elbows.png`). Representative body composites hide most of this area; that is not a universal contour pass. Alpha-preserving recolour cannot remove exterior bumps. A measured source-root/overlap revision and 16+256 rebuild would be needed; none was done here.
- **Bounded source repair did not pass:** rootX trials 634.5, 637.5 and 640.5 retain the bumps; 643.5 reaches the palm neck while retaining the lower bump; 646.5 makes the tip transparent. Keep original root `[634.5,305.5]`, crop `[620,248,686,356]`, scale `69.415385/458`. The untouched source is `assets/companion/dango/raster/limbs/sources/masters/short-arm-study-v2.png`. No alternate 16+256 set was promoted. The trials are excluded here; this submission closes source-distinct material integration only, not natural seams or complete actions.
- **Real standard artist fallback:** wave, photo-pose, high-five, sip-tea, hiccup and type-keyboard, each at 97 progress samples, all yield zero composed `hand.limb` frames. The matching old/new standard images prove fallback only.
- **Direct material demonstration:** `direct-wave-2x.png` displays the original painter's accepted right-hand plan, explicitly bypassing only whole-action admission in review artwork. Original body, props, targets and per-frame error checks remain. It is not a production-enabled action.
- Wave p=.355–.475: 25 successive samples, max contact error 1.0333 art units, no selected-angle/wrist movement. This is a quantized plateau, not accepted continuous waving.
- High-five p=.05–.95: 49 successive samples, max contact error 1.10465; old and new both have 8 angle-branch changes, max adjacent wrist jump 7.2111 art units and contact jump 2. Existing jumps, right-shoulder and hold-root problems remain.

Scope: actual offscreen Skia executing repository source loader/standard painter/artist, explicit preview contract 2. `runtimeReady=false`, host opt-in null. No browser or native-window acceptance; no complete seven-goal closure. Normal display scale is 1.5 CSS px/art unit, body design width 99/198 px at 1x/2x, not full foreground height.

## Reproduce

Requires Python 3/Pillow, Node, and the repository's pinned `@napi-rs/canvas` dependency. Use the reviewed code revision and extract the baseline package from commit `27d9846`. In a Git checkout, an example baseline extraction is:

```sh
mkdir baseline-27d9846
git archive 27d9846 assets/companion/dango/raster/limbs | tar -x -C baseline-27d9846
python verify.py --repo /path/to/repo \
  --baseline-package /path/to/baseline-27d9846/assets/companion/dango/raster/limbs \
  --candidate-package /path/to/repo/assets/companion/dango/raster/limbs \
  --out /path/to/review-output
```

All four CLI parameters are required. `verify.py` calls `reproduce.mjs` with the same parameters. No package files or runtime sources are modified. JSON source hashes let the reader distinguish an exact rerun from later asset revisions.

Excluded reproducible outputs: full standard artist comparison panel, raw per-phase sample/direct records. The original local full 256-joint sheets, large GIFs, frozen baseline/source packages and all batch frame strips are deliberately not published. This six-file review includes two representative images, aggregate evidence, and the two reproducible scripts only.
