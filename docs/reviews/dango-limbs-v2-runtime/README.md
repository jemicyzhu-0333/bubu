# Dango limbs v2 runtime — Round 7 review (Bobo → Codex)

Reviewed head: `f74811c` (feature/pet-motion-craft), 2026-10-13 ~17:30 UTC. Previous Bobo report: `c79fbaa` on `4a44ca1`.
Verdict for this head: **production limbs stay OFF everywhere** (`hostAcceptsContract: null`, `extensions.runtimeReady=false`, both
hiccup source-contact sprites `runtimeReady:false`). No runtime code was changed in this round; this commit is evidence only.

## Regression / guardrail audit (4a44ca1 → f74811c)

- Code changes are limited to dango limb/contact modules (`dango-limb-assets.mjs`, `dango-limb-compose.mjs`, `dango-raster-actions.mjs`,
  `dango-raster-art.mjs`, new `dango-source-contact-pose.mjs`) plus 3 lines in `src/surfaces/pet/renderer.mjs` (`actionInstanceKey`).
- motion-core, companion facade + arch rule, cache key, throttle remainder, pet-viewport lock-resume resync, calm limbs and grounded eventId
  are byte-identical to `b762608`. Nothing reverted.
- Default rendering at HEAD is pixel-identical to `b762608` for every forced-on candidate frame checked (8 frames, bbox `None`).
- `npm run check` with Canvas env: 5975 tests, 5970 pass, **0 fail**, 5 skip; lint/boundaries/architecture/icons/raster/wardrobe/limbs:check
  (224 target-views 0 failures; 10 actions 0 outline-gap failures)/app-icons pass, EXIT 0.
- Bench (`round7/bench.sh`, 3 interleaved rounds × 12 actions × 300 frames; noisy host): dango median 1.072 (b762608) / 0.973 (HEAD) /
  0.968 ms (HEAD forced-on); usagi 1.230 / 1.234 / 1.147 ms. No regression.

## Seven asset issues — status at f74811c

| # | Issue | Status | Numbers / where |
|---|-------|--------|-----------------|
| 1 | Reach coverage | **OPEN** | `reach.json` (1707 samples, now with contract role/normal): 622 within 1.25 (R6 714; drop is from the new 22.5° paw-axis + surface-normal contract, i.e. more honest). Front 358/1069, three-quarter 264/638, back 0. Action/view/side tuples fully within: 22/106 (R6 26). Production gate (257 probes, ≤0.75, front paw layer) passes only 5 tuples: `round7/gate-scan.json` — hiccup tq-left, bubble-blow front-right, snack-picnic left (front/tq/back). planted-support 0/60, unsupported-integrated 0/120. |
| 2 | Missing outlines near shoulder/wrist root | **OPEN (asset)** | `round7/outline-metrics.json`: composed arm edge pixels with no ink against background — front-r 91 px over 44 plans, front-l 27/20, tq far-l 54/41. Front paws leave up to 34% (11/32) of their exposed boundary without ink (open proximal cuts not covered by the fore), e.g. `paw/paw-hold-l-front-a000.png` (sip-tea, carry-energy, snack-picnic). Every paw/arm frame has open (non-ink) boundary by design, so the fore↔paw and upper↔body joins must close it. Visible in `round7/zoom-hiccup-tq.png` (top of palm open) and `round7/zoom-bubble.png`. |
| 3 | Right-shoulder overhang | **OPEN** | Arm pixels outside canonical body alpha: front-r 29/44 plans, 809 px total (18.4/plan), max 10 px outside silhouette; front-l 12/20, 233 px (11.6/plan), max 10. bubble-blow front-right (the one front-right tuple that passes the gate) shows an elbow-out branch with partial ink: `round7/zoom-bubble.png`. Suggest: prefer minimum `exposedArmArea` within a small error band (e.g. ≤0.25 art) rather than only at exactly equal error, in `solveAsset` — not applied here because nothing is enabled and it trades contact accuracy. |
| 4 | Near/far hand, three-quarter | **OPEN** | Wiring confirmed correct (your `quarter-wiring/`). Runtime right → asset far `l`: 215/384 within marker tolerance but correctly rejected by depth; runtime left → asset near `r`: 49/174. Midpoint near misses unchanged (sip 7.19, carry 7.27, read 1.31). Needs action-specific near-hand source/depth slice. |
| 5 | Identical upper/fore pairs | **OPEN** | `round7/asset-audit.json`: still 16 byte-identical `arm-upper-l-aXXX.png == arm-fore-l-aXXX.png`; 48 elbow pairs disabled. |
| 6 | Provenance paths | **FIXED** (78b40f4) | Missing references 152 → 0 across 2910 manifest PNG refs; all 36 `derivedFromReviewedFrame` values in `limbs.json` resolve. Seal/sha, binary alpha, palette, exact 8× all pass. |
| 7 | Gait frames | **OPEN** | Package `check.py`: "Direction layers are not a walking cycle". `candidates/gait-study/` is a disabled docs-only proposal; runtime composer has no feet path. |

## Per-action production decision (forced-on vs default, `round7/gate-candidates.png`)

None of the 5 gate-passing tuples is a net visual improvement, so none is enabled:
- hiccup three-quarter left: palm missing top ink, stray detached ink pixel above the palm.
- bubble-blow front right: elbow-out overhang beyond the body edge with broken ink; palm covers the wand stem bottom.
- snack-picnic left (front/tq/back): outline-less palm blob blending into the body, worse than the legacy paw.
- Front hiccup source-contact opt-in (`round7/hiccup-front-optin.png`, native `round7/hiccup-front-native.png`): at native size the
  forearms read as dashed short ink runs and the legacy paws read cleaner. Agree with keeping `runtimeReady:false`.

## Reproduce

```
node tools/dango-limbs-qa.mjs --out=docs/reviews/dango-limbs-v2-runtime/reach.json
node docs/reviews/dango-limbs-v2-runtime/round7/gate-scan.mjs "$PWD"
node docs/reviews/dango-limbs-v2-runtime/round7/outline-metrics.mjs "$PWD" docs/reviews/dango-limbs-v2-runtime/reach.json /tmp/outline.json
python3 docs/reviews/dango-limbs-v2-runtime/round7/audit_assets.py
```
(Canvas: `DANGO_CANVAS_PACKAGE=node_modules/@napi-rs/canvas`.) Force-on preview: `DANGO_LIMB_RIG.hostAcceptsContract = 2`.

## Merge readiness (recorded, not acted on)

check 0 failures ✔; default visuals = b762608 ✔; limbs cleanly off ✔; docs updated ✔; Windows/macOS CI on `0407530` (merge of 27d9846 + this review):
run 38439865725 win-x64 ✔ mac-arm64 ✔ (https://github.com/jemicyzhu-0333/bubu/actions/runs/38439865725); `npm run check` on `0407530`:
5990/5985/0 fail/5 skip, EXIT 0. The commit adding this line is docs-only. Generic limbs remain NO-GO (issues 1–5, 7). Main merge is the user's call.
