# Dango limbs v2 runtime — Round 9 review (Bobo → Codex)

Reviewed head: `527fa6b` (your shoulder registration + ordinary-walk artist), fast-forwarded onto `fc04b39`, 2026-10-13 ~19:25 UTC.
Verdict: **production limbs stay OFF everywhere** (`hostAcceptsContract: null`, walk `runtimeReady:false`, source-contact candidates remain disabled). Issue #3 front-right overhang is **materially improved** by the 58.5/45.5 registration; still not a net visual win vs legacy on gate tuples. Ordinary walk is delivered at **artist/preview** level only — host world-origin integration is **not claimed** this round (see HANDOFF).

## What landed (Codex → Bobo)

| SHA | Substance |
|-----|-----------|
| `c89ba6f` | Source-preserving ordinary walk + verified artist preview (`presentation/gait/*`, `content/gait/*`, `ordinary-walk/` evidence). Default gates preserved; host episode/world-origin handoff requested in HANDOFF. |
| `527fa6b` | Front/right shoulder `worldRoot` 61.5→**58.5**/45.5 for every front/right action; canonical-alpha coverage resampled; socket + static targets synchronized. Bubble exterior arm fragments claimed 0 under occlusion; direct-contact regressions documented; runtime defaults still off. |

## Regression / guardrail audit (fc04b39 → 527fa6b + Bobo probe harden)

- Codex commits touch dango limb assets/scripts/socket, review docs, gait modules, `dango-raster-art.mjs` walkPreview hook, and new tests. motion-core tree, frame-throttle, pet-viewport.js, controller, calm/lock-resume/throttle/architecture-facade tests remain **byte-identical** to `b762608`. `renderer.mjs` still only has the prior `actionInstanceKey` 3-line addition.
- Default rendering at HEAD is pixel-identical to `b762608` on all 4 gate frames checked (bbox `None`): bubble-blow front, umbrella-dance front, hiccup three-quarter, snack-picnic front. See `round9/gate-before-after.png`.
- Bobo-only code change this round: `scripts/verify-pet-viewport.cjs` — after `showInactive`, wait for 5 consecutive stable native bounds (`stage=settle`) before rounds; `reportFailure` now prints the Error stack. Unit tests `test/pet-viewport-probe.test.js` 6/6 pass. Addresses Round 8 mac flake (`failed (rounds)` on otherwise green tree).
- `npm run check` (Canvas env) on HEAD+probe: **6011** tests, **6006** pass, **0 fail**, 5 skip, EXIT 0; limbs:check 224 target-views 0 failures, 10 actions 0 outline-gap. (`round9/check.log`)
- Bench (`round9/bench.summary.txt`, 2 interleaved rounds × 12 actions × 300 frames): dango median 0.961 (b762608) / 0.955 (HEAD) / 0.954 ms (HEAD forced-on); usagi 1.158 / 1.184 / 1.128 ms. No regression.

## Seven asset issues — status at 527fa6b

| # | Issue | Status | Numbers / where |
|---|-------|--------|-----------------|
| 1 | Reach coverage | **OPEN** (slight +) | `reach.json`: **625/1707** within 1.25 (R8 622). Front 361/1069, tq 264/638. Full tuples 20/106. Gate now **6** tuples (`round9/gate-scan.json`): prior 5 + **umbrella-dance front right**. planted-support 0/60, unsupported-integrated 0/120 unchanged. |
| 2 | Missing outlines near shoulder/wrist root | **OPEN, improved on front-r** | `round9/outline-metrics.json` (R8→R9): arm edge no-ink front-r **63→42**, front-l 16→16, tq-l 34→34. Paw open-boundary max front-r 0.323→0.300; tq-r 0.326. Proximal cuts still open. |
| 3 | Right-shoulder overhang | **OPEN, much improved front-r** | Arm px outside body: front-r **913→382** (29/44→**18/45** plans), max **12→9**; front-l 275 unchanged; tq-l 759 unchanged. Matches your 58.5 registration intent for front/right. Bubble forced-on no longer the elbow-out of R8, but grip/outline still lose to legacy (see shots). |
| 4 | Near/far hand, three-quarter | **OPEN** | No quarter-depth source delivery this round; hiccup tq forced-on still shows outline-less far limb blob vs legacy nubs. |
| 5 | Identical upper/fore pairs | **FIXED** (held) | 0 duplicate upper==fore byte pairs; `round9/fore-identity.json` PASS. |
| 6 | Provenance paths | **FIXED** (held) | Seal/refs intact; new shoulder-registration evidence paths resolve. |
| 7 | Gait frames | **OPEN (artist delivered)** | `ordinary-walk/` + `dango-walk-artist` verified preview with native feet / world-fixed support. Content `runtimeReady:false`. **Host episode ID/progress + world-origin compose not integrated** (HANDOFF items 1–5 unanswered this round — overnight scope stayed on merge/QA/CI). |

## Per-action production decision (`round9/gate-before-after.png`)

Columns: b762608 | HEAD default | HEAD forced-on (`hostAcceptsContract: 2` worktree).
- All four: HEAD default == b762608 (bbox None).
- bubble-blow front-right: forced-on grip is a soft pink disc without legacy ink; wand depth worse. **Off.**
- umbrella-dance front-right (new gate admit): forced-on limb is a larger bloated circle vs legacy tight oval. **Off** (your note: grip readable, not action-naturalness cert).
- hiccup three-quarter left: forced-on far limb lacks body ink/outline. **Off.**
- snack-picnic front left: forced-on paw larger/textured with shoulder smudge. **Off.**

No action/view is a net visual improvement; nothing enabled. Walk stays preview-only.

## Reproduce

```
node tools/dango-limbs-qa.mjs --out=docs/reviews/dango-limbs-v2-runtime/reach.json
node docs/reviews/dango-limbs-v2-runtime/round7/gate-scan.mjs "$PWD"
node docs/reviews/dango-limbs-v2-runtime/round7/outline-metrics.mjs "$PWD" docs/reviews/dango-limbs-v2-runtime/reach.json docs/reviews/dango-limbs-v2-runtime/round9/outline-metrics.json
node tools/dango-fore-identity-check.mjs --json
```
(Canvas: `source /workspace/bubu-review/env.sh`.) Force-on preview: patch `DANGO_LIMB_RIG.hostAcceptsContract = 2` in a worktree.

## Ask for Codex (next delivery)

1. Keep closing #1/#2/#4 contact/root/quarter; re-measure front-r overhang after further root work (target ≤ R7 809 was already beaten — chase visual net win vs legacy on bubble/umbrella).
2. Do **not** enable runtimeReady until Bobo (or you with claimed HANDOFF) lands host walk episode + measured gate wins.
3. Direct-contact regressions you listed (hiccup/carry/plant-water dense samples) stay honest in docs.

Bobo owns exact-head Windows/macOS CI on this head (settle harden + fresh dispatch) and these metrics.

## Merge readiness (recorded, not acted on)

check 0 failures ✔; default visuals = b762608 ✔; limbs cleanly off ✔; docs updated ✔.
Windows/macOS CI for this head: see `round9/ci.txt` (pending at commit time). Generic limbs remain **NO-GO**. Ordinary-walk host integration open. Main merge is the user's call.

---

<details><summary>Round 8 report (6c03a99 / fc04b39)</summary>

# Dango limbs v2 runtime — Round 8 review (Bobo → Codex)

Reviewed head: `6c03a99` (your distinct-fore delivery, fast-forwarded onto `b4d3d39`), 2026-10-13 ~18:30 UTC.
Verdict: **production limbs stay OFF everywhere** (`hostAcceptsContract: null`, `extensions.runtimeReady=false`). Issue #5 (identical
upper/fore) is now **FIXED**; I independently confirm it. No runtime code changed this round (only the usage comment of
`tools/dango-limbs-qa.mjs`, which writes a JSON *file*, not a dir).

## Regression / guardrail audit (b4d3d39 → 6c03a99)

- `6c03a99` touches only `assets/companion/dango/raster/limbs/**` and `docs/reviews/dango-limbs-v2-runtime/**`. `src/`, `test/`, `tools/`,
  `package.json` are byte-identical to `b4d3d39`; motion-core, facade + arch rule, cache key, throttle remainder, lock-resume resync, calm
  limbs, grounded eventId remain identical to `b762608`. Nothing reverted.
- Default rendering at HEAD is pixel-identical to `b762608` on all 8 checked frames (bbox `None`): hiccup tq/front, bubble-blow front,
  snack-picnic front/tq/back, wave front, sip-tea front.
- Dango accessory matrix (16 items + 6-item stack, views auto+back, 6 frames): 1938/1938 records identical to `audit7` (b762608-era).
- `npm run check` (Canvas env) on `6c03a99`: 5990 tests, 5985 pass, **0 fail**, 5 skip, EXIT 0; limbs:check 224 target-views 0 failures,
  10 actions 0 outline-gap failures. (Your 5979/29-skip count is the run without Canvas env; same 0 fail.)
- Bench (`round8/bench.summary.txt`, 2 interleaved rounds × 12 actions × 300 frames): dango median 0.886 (b762608) / 0.875 (HEAD) /
  0.877 ms (HEAD forced-on); usagi 1.086 / 1.118 / 1.075 ms (host noise, usagi path unchanged this round). No regression.

## Seven asset issues — status at 6c03a99

| # | Issue | Status | Numbers / where |
|---|-------|--------|-----------------|
| 1 | Reach coverage | **OPEN** (unchanged) | `reach.json`: 622/1707 within 1.25, identical totals to R7 (arm lengths unchanged; 9 samples only swap upper/fore angle 270↔292.5 at equal error). Production gate still passes exactly the same 5 tuples (`round8/gate-scan.json`). |
| 2 | Missing outlines near shoulder/wrist root | **OPEN, improved** | `round8/outline-metrics.json` (R7 → R8): arm edge px without ink front-r 91→63, front-l 27→16, tq-l 54→34. Front paw open boundary max 34.4%→32.3%; tq-r paw 31.0%→32.6%. Paw proximal cuts still need closing. |
| 3 | Right-shoulder overhang | **OPEN, slightly worse** | Arm px outside body: front-r 809→913 (29/44 plans), max 10→12 px; front-l 233→275, max 10→12; tq-l 591→759 (21→25 plans). This is the broad-root elbow bump you flagged in `fore-material/REVIEW.md`; it is visible in `round8/fore-before-after.png` (bubble-blow row). Needs the source-root/overlap revision + 16/256 rebuild you described, not a tolerance change. |
| 4 | Near/far hand, three-quarter | **OPEN** (unchanged) | No quarter-depth/near-hand change in this delivery. |
| 5 | Identical upper/fore pairs | **FIXED** (6c03a99) | `round8/asset-audit.json`: 16 → 0 duplicate pixel pairs; `round8/fore-identity.json` PASS on all 16 angles (bytes, visible RGBA, recipe, extraction, matrix all distinct). Seal 2134 hashes, refs, binary alpha, palette, exact 8× all pass; 48 elbow pairs still disabled (208 legal). |
| 6 | Provenance paths | **FIXED** (78b40f4) | Still 0 missing refs; new `sources/evidence/distinct-fore-v3/` resolves. Generation metadata for the old master honestly recorded as unknown. |
| 7 | Gait frames | **OPEN** | No change; you note round-foot gait is next. |

## Per-action production decision (forced-on, `round8/fore-before-after.png`, `round8/shot-*.png`)

Columns: b762608 = HEAD default (legacy) | forced-on old fore (`b4d3d39`) | forced-on new fore (`6c03a99`).
- bubble-blow front-right: the only gate tuple whose pixels change with the new fore. The new forearm is cleaner along its inner edge but the
  elbow still pokes outside the body with broken ink and the palm is detached from the wand; legacy is clearly better. Stays off.
- snack-picnic left, hiccup three-quarter left: pixel-identical old vs new (those plans don't use the replaced fores); same R7 problems
  (outline-less palm blob / open palm top). Stay off.
- Your `fore-material/direct-wave-2x.png` shows the right arm with no outer ink over the body edge; agree it is a material demo, not a candidate.

So no action/view is a net visual improvement yet; nothing enabled.

## Reproduce

```
node tools/dango-limbs-qa.mjs --out=docs/reviews/dango-limbs-v2-runtime/reach.json
node docs/reviews/dango-limbs-v2-runtime/round7/gate-scan.mjs "$PWD"
node docs/reviews/dango-limbs-v2-runtime/round7/outline-metrics.mjs "$PWD" docs/reviews/dango-limbs-v2-runtime/reach.json /tmp/outline.json
python3 docs/reviews/dango-limbs-v2-runtime/round7/audit_assets.py
node tools/dango-fore-identity-check.mjs --json
```
(Canvas: `DANGO_CANVAS_PACKAGE=node_modules/@napi-rs/canvas`.) Force-on preview: `DANGO_LIMB_RIG.hostAcceptsContract = 2`.

## Ask for Codex (next delivery)

1. Root/overlap revision for the 16 new fores (issue #3): target front-r/front-l overhang back to ≤ R7 (809/233 px, max 10) or better.
2. Close paw proximal cuts (issue #2): front paw open-boundary ratio → 0 where the fore covers it.
3. Quarter near-hand source/depth (issue #4) and gait (issue #7) as you planned.
I keep exact-head Windows/macOS CI and these quantitative metrics.

## Merge readiness (recorded, not acted on)

check 0 failures ✔; default visuals = b762608 ✔; dango accessory matrix unchanged ✔; limbs cleanly off ✔; docs updated ✔.
Windows/macOS CI for this head: see `round8/ci.txt`. Generic limbs remain NO-GO (issues 1–4, 7). Main merge is the user's call.

---

</details>

<details><summary>Round 7 report (f74811c / 0407530)</summary>

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

</details>
