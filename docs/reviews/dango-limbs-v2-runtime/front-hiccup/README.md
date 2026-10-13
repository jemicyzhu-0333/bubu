# Front hiccup contact slice — disabled integration

This module is a deliberately narrow source-pose integration. It is not approval of the generic limb library or all views/actions.

## Source and geometry

The complete portable source module is `assets/companion/dango/raster/action-contact/hiccup-front-v1/`. It retains the official generated master, original prompt and reference order, geometric extraction masks, source pixels, isotropic registration, exact 8× outputs, rebuild scripts and hashes. The original approved character, canonical body and existing 22×19 cup remain unchanged.

Visible forearms and palms are one continuous source-observed piece per side, with open proximal cuts. They are not closed wrist patches. Canonical shoulders stay at (4.5,45.5) and (61.5,45.5). Positive-width internal continuation is contained by canonical body alpha: 103 left and 94 right sampled cells, none outside or unknown. No hidden segment texture or new anatomy is synthesized.

Left shared ink-to-fill contact boundary is (23.25,48.375), contact normal (1,0); the cup outer alpha silhouette at that row starts at x22.5. The palm owns the retained shared vessel-edge ink. the logical silhouette stops at x23, leaving a documented 0.25-art discretization difference. Actual right outer-handle boundary is (44,48.375), normal (-1,0), with zero boundary gap. This is an exterior grasp, not satisfaction of the legacy handle-axis anchor at (42.5,48.375). Source ink #1a1b26 remains opaque: 29 left and 21 right pixels. Short horizontal contour runs are retained source details, not lost ink or recolor artifacts.

## Runtime boundary

Both new sprite contracts remain `runtimeReady:false`. The generic v2 limb pack and `hostAcceptsContract` remain unchanged and disabled. Tests and review tools opt into a cloned manifest only.

Eligibility is restricted to front hiccup, unchanged canonical registration and cup transform, bare appearance, no drag/handoff/custom transform. Both hands select atomically through the ordinary raster source, palette and paw painter. The standard side never supplies a custom limb painter. Other actions, views, clothing and errors retain fallback.

Readiness is latched for the whole action instance per rendering channel. Up to 16 channels are retained without eviction; pet/default/portrait are reserved and excess channels fail closed. A late load cannot replace hands halfway through an instance, even if a portrait is rendered between pet frames. Explicit renderer instance keys distinguish repeated calm actions with constant phase. Resource loss falls back both hands together.

## Verification

- Source rebuild: 10 PNGs and 3 metadata JSONs byte-identical; master/reference/body hashes, original retained RGB/alpha, binary alpha, four colors and exact 8× pass.
- Standard artist matches reviewed source composition at all 257 inclusive phases.
- All 43 other actions retain contact records at start/middle/end (129 comparisons).
- Nonfront/outfit/resource-failure pixels, calm/reduced mode, delayed loading, interleaved portrait and repeated action instances are tested.
- Independent review found and reproduced a cross-channel latch defect. The bounded channel fix passed the same reproduction and focused tests.
- Full repository check: 5960 tests, 5931 pass, 29 documented optional skips, zero failures; syntax, boundaries, architecture and asset checks pass. Integration suite: 71 pass.

The first full check exposed a legitimate pinned workbench asset-count expectation: two new sprites change 417 to 419. The assertion was updated, not removed.

## Reproduce

Run `python assets/companion/dango/raster/action-contact/hiccup-front-v1/scripts/check.py --rebuild` for portable source validation, and `node tools/dango-contact-review/render-hiccup.mjs --out /tmp/dango-front-hiccup-review` for the standard artist sequence, comparison sheets, playback page and compact report. `node --test test/dango-source-contact-pose.test.mjs test/dango-source-contact-runtime.test.mjs` covers eligibility, actual image loading, cross-channel latches and physical boundary semantics.

The new hand `gripPoint` and `sourceContact` report the source-observed physical boundary; `legacyGripPoint` retains the original sampler anchor for comparison. `contactContract` consumes this authored boundary directly instead of treating the old shaft axis or wrist as achieved contact.

## Remaining acceptance

Stored 1×/2× comparisons and adjacent frames show connected fore/palms, no closed wrist rings or detached shoulder fragments, and no tool displacement. This does not substitute for actual interactive browser/native playback. Cloud browser verification remains **not passed**: the requested preview route hit the browser URL security policy; the same call retried once with authorization evidence returned the same denial and was stopped. No user-computer substitution or security bypass was used.

The supplied 6.5-second, 257-frame MP4 is an offscreen standard-artist comparison. It is a review artifact, not native-host certification. Keep activation false until the remaining dynamic visual gate is genuinely completed.
