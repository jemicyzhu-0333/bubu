# Dango limbs v2: branch handoff

Updated 2026-10-13 17:06 UTC. Shared branch: `feature/pet-motion-craft`. The front-sip source repair is committed as `d0e0827600c18b5cff7a723ab3525a12227dffc5`. This update adds quarter wiring evidence and regression coverage on that base.

## Status

**Merge readiness: NO-GO for the requested complete limbs repair.** Do not merge to main, release, or activate generic limbs on the strength of candidate/source checks. The user requested a merge-ready result by the next morning, not lowered acceptance criteria or an automatic merge.

- Complete provenance paths: repaired in the earlier branch work.
- Front hiccup: authored continuous fore+palm source package and standard artist integration exist, deliberately disabled. Its 257-phase standard/reference comparison passed. This is one action/view slice, not approval of all limbs.
- Front sip: this change faithfully restores master ink lost to extraction masks and delivers a compact reproducible source candidate. It is not runtime integration and not an accepted natural-root result.
- Generic independent fore, quarter near/far composition, grip/root contour and full action reach remain open. The current generic fore and upper share16 corresponding source/pixel frames; naming them differently does not make an independent fore.
- Real gait remains open. Thick/jumping four-phase candidates must not be enabled.

## What this change completed

`assets/companion/dango/raster/action-contact/sip-front-v1/` contains original masters/prompts/metadata, resolved repository-relative source dependencies, explicit geometric masks and recipes, fixed logical and exact8× outputs, and portable rebuild/integrity scripts. No body, cup, shoulder, production manifest, renderer or persistent state was changed.

The v2b mask recovers716 left and216 right authored pixels, removes none, retains9 pinned anchors, and preserves original RGB and source-alpha-times-mask. Of932 additions,931 classify as ink; one explicitly reviewed antialias transition remains source-exact. The old-v2 negative fixture and missing-anchor/recolor/alpha/extra-body mutations all fail the guard. No procedural contour painting was used.

A single low-pose quantization is translated with the unchanged cup instead of repeatedly re-quantizing source art each phase. This keeps the raster shape stable. Both hands are single4-connected components with four colors/binary alpha; registered raster boundary error is0.25 art units. The actual artist with a research-only hand painter gave257 source-coverage passes and zero hand/face overlap in1028 DPR checks. This is offscreen Skia evidence, not standard production integration or native validation.

## Remaining blocker and integration contract

The current straight proximal cuts visibly cross light-pink forearm highlights, producing a diagonal patch seam. A bounded upstream investigation found identifiable omitted highlight pixels but no complete fore/body-separated cross-section. Do not extend masks into ambiguous body, move metadata alone, add body-colored covers, or manufacture a root. A genuinely separable authored root or a bounded action-specific full fore+palm key-pose/occlusion solution is needed.

Candidate base cup=(23,43), rect=(0,0,22,19); left boundary=(24.25,53.375), right=(40.25,53.375), normals=(+1,0)/(-1,0). Right is an inner-handle foreground palm, not the outer handle at x+22 and not the old axis target. Sprites are66×72 at origin(0,0). Both must share exactly `cup(p)-(23,43)`, with no per-phase resampling, runtime rotation/stretch or connector paint. `frames.runtimeReady=false`; generic `extensions.runtimeReady=false` and production `hostAcceptsContract=null` remain unchanged.

Cloud interactive browser verification is blocked by an explicit URL security-policy denial, including one authorized same-route retry. Do not bypass it, switch browser routes to evade it, or call the supplied videos native/browser passes. Windows/macOS native and exact-head CI remain separate final gates.

## Verification

- `python assets/companion/dango/raster/action-contact/sip-front-v1/scripts/check.py --rebuild`: source hashes, old/new guard outcomes, isolated extraction/logical/8× rebuild pass. A relocated path containing spaces was also verified.
- `npm run check`:5960 tests,5931 pass,29 optional skips; syntax, boundaries, architecture and asset checks pass. The optional Canvas outline-gap scan is skipped and is not claimed passed.
- `npm run test:integration`:71 pass.
- No activation, main merge or release performed. These local checks precede the source-only commit; recheck CI against the actual resulting branch head before a merge-ready judgment.

## Latest completed slice: quarter wiring (17:06 UTC)

Completed: four behavior regressions verify independent near/far source identity, target/normal reflection, source-pixel placement, exactly one Skia pose reflection including outer facing, and the deliberate far-depth fallback. All99 standard-artist samples preserve canonical body pixels, props, anchors and matrices. Six actual rendered midpoint comparisons (sip/carry/read, both facings) are byte-identical default versus opt-in because unsupported limbs fall back. No production wiring defect was demonstrated, so no speculative code or source change was made.

Evidence: `quarter-wiring/README.md`, `quarter-wiring/results.json`, two small PNG comparisons, and `test/dango-quarter-limb-contract.test.mjs`. Reproduce with `node tools/dango-contact-review/render-quarter.mjs --out /tmp/dango-quarter-review`. Source/depth defaults remain unchanged. Final focused suite16/16; full `npm run check`5964 tests,5935 pass,29 optional skips; integration71/71. The relocated review output is byte-identical.

Still blocked: midpoint quarter sip near-hand marker error7.1868 art units; carry near7.2687; read near1.3051 (>1.25 limit), far15.0131. Sip/carry far markers are geometrically near their targets but back-depth composition is unreviewed and intentionally rejected. These marker numbers do not certify physical grip or root contours. Do not move the prop/shoulder, swap true near/far sources, or remove the depth guard to manufacture a pass.

Next owner: independent-fore identity/material work can proceed separately; quarter needs a source-supported action/depth slice at the unchanged actual targets, not a mirror patch. Overall requested feature remains NO-GO. Coordinate ownership via commits and this handoff.

## Next agent task

1. Read the latest remote head and this handoff before changes. Preserve concurrent branch commits and update by an expected-head lease; no force overwrite.
2. Close one real slice at a time. First add independent-fore identity/source/pixel boundary checks that detect the existing16 duplicate pairs; do not call a renamed upper a fore or enable the failing library.
3. Then verify quarter near/far source assignment, reflection and actual depth with existing reviewed sources in an explicit standard-artist comparison. Do not use contact-axis geometry alone as visual acceptance.
4. Stop iterating an unverifiable sip root crop. If continuing sip, use one bounded low/lift/sip whole-fore+palm key-pose plan with original-body occlusion and unchanged cup/body. Require source ownership, natural roots and continuous native-size playback before integration/activation.
5. Record completed work, evidence, remaining blockers, integration contract and next task here with each small commit. Coordinate through this branch and committed handoff, not private external messages.
6. Final delivery must explicitly say MERGE-READY or NO-GO for the exact shared head, including both target-platform CI/native limitations. The user has not authorized an automatic main merge.

## Bobo Round 7 review (2026-10-13 ~17:40 UTC, on f74811c)

Per-issue status and numbers are in `README.md` + `round7/`. Summary: no reverts; default render identical to b762608; `npm run check`
5975/5970/0 fail/5 skip; provenance FIXED; reach, root outlines, right-shoulder overhang, quarter near hand, upper==fore (16), gait still
OPEN. No production activation (including front hiccup source-contact); no runtime code changed by Bobo this round.
