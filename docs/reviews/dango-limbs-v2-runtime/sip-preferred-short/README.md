# Preferred short front sip: bounded integration review

## Status and visual choice

**The user accepted this appearance and requested submission without videos. The narrow front/bare sip selector is enabled and locally verified.** Only the two `sip-front-short-v1` source flags are true. Generic limbs and the newer `sip-front-v2` source remain disabled. The user-selected original pixels are unchanged. Publication is based on shared head `4490e75317d76a4369f8c4d8c1fe8f1ba8e7efdd`, preserving the later native viewport fix. The complete test was run on the previous shared base `838edbfff42e5a0fb763df57e284898a7758729c`; both subsequently changed viewport files were synced byte-exactly before targeted regression checks. No main merge or release is performed here.

The user selected the middle column of the three-column sip comparison: “其实我感觉中间的最好” (user message `Sentinel_22d587273bbc8191a08ddd451206d0e6`). The preceding description identified the columns as legacy, old limbs diagnostic, and new source (`Sentinel_d2362e05e0ac8191bc2084c026a974e6`). This establishes a preference for the middle column's compact forearm/palm proportions and pose. It is not approval of every technical gate or of generic limb activation.

The selected pixels are the old `sip-front-v1` package's fixed v2b projection. They are not the newer `sip-front-v2` forearm artwork. The original comparison is retained in [sip-complete-source](../sip-complete-source/README.md); its [renderer oracle](../sip-complete-source/scripts/renderer-oracle.mjs) loads the two `sip-front-v1/*-logical.png` files and draws them through a forced diagnostic painter. Metrics for that comparison's newer right column must not be reassigned to the selected middle column.

## Exact retained source

The complete historical source package remains at:

`assets/companion/dango/raster/action-contact/sip-front-v1/`

No source master, source mask, extraction recipe, original metadata, logical sprite, or exact8× export is replaced by this narrow integration. No new image generation is part of this delivery.

| Package-relative file | SHA256 |
| --- | --- |
| `sources/masters/low-cup-continuous-v2.png` | `bce60ee4e11ea4740f2243d62a45899bf004c28c436b03348772a4b57f1ac6ee` |
| `sources/extraction/extraction-recipe.json` | `b8b637ec08df2d2b60c0da487fde47667d89be3482d9a2613edecdd6feb71f4a` |
| `sources/extraction/left-geometric-mask.png` | `9e69184b3696f12073cb0336f06384cc6bdbbb5abadb887a43e9ca6daca90753` |
| `sources/extraction/right-geometric-mask.png` | `6e61c93c31e34c22568eaf10fc2122799b7ccf5842b2cbc7f198484b4b8726bf` |
| `sources/extraction/left-source-rgba.png` | `e41c4adf611914d117f1085372e2c36256cc5b18e72d732c4a73ff8ea409bfe8` |
| `sources/extraction/right-source-rgba.png` | `5ef9e48f47679318dd0191a04e992ac95b4fb608a5f2e1566c8ce68cef1f604a` |
| `left-logical.png` | `8d992901f43bc62089e36b5464d916a3dfd84c170e6356121f4e29dd27654fdc` |
| `right-logical.png` | `31ccdba5d85a53525f65bb033bcf39a368ae63381279a2ec6afec00b6515856d` |

The package's `sources/resolved-provenance.json` resolves the original generation references, including the retained v1 master used to produce v2. Original prompts and invocation metadata are in `sources/masters/`. `scripts/rebuild_source.py` reconstructs the explicit geometric extraction; `scripts/build_pose.mjs` performs the fixed projection; `scripts/check.py` verifies the inventory, dependencies, source integrity and output contracts. See the [source package README](../../../../assets/companion/dango/raster/action-contact/sip-front-v1/README.md) for its complete portable rebuild instructions and historical limits.

The fresh read-only source audit passed the package and dependency hashes, original RGB plus source-alpha-times-mask preservation, source-integrity positive/negative cases, binary logical alpha, the four-color palette, and exact nearest-neighbor 8× exports. The final owner also reran the full portable source rebuild successfully: raw extraction, logical pixels, exact8×, recipe, frames and verification are equivalent. Both logical sprites were also pixel-identical to the retained historical `v2b-fixed-projection` outputs.

## Narrow rendering contract

- Exactly two unchanged foreground sprites, each 66×72 at origin (0,0); no invented back/root sprite or hidden shoulder segment.
- Left has 133 opaque logical pixels; right has 132. Their opaque silhouettes are single connected components. The measured two 8-connected dark contour arcs remain consistent with the retained source; a separate dark arc is not by itself evidence of missing ink to paint in.
- Source scale is 69.415385/969, or 0.07163610423116615 art units per source pixel. Quantization occurs once; runtime does not rotate, stretch, redraw, re-cut, switch source, or resample the pose per phase.
- Base cup is (23,43), with original 22×19 rect. Both sprites receive the same translation `cup(p)−(23,43)`.
- Left contact is cup+(1.25,10.375), normal (+1,0); right is cup+(17.25,10.375), normal (−1,0). The right palm supports/occludes the inner handle opening. This does not assert an outer-handle grip or hidden rear hand.
- Ordinary entry and exit use a common opacity envelope over the first and last 0.04 progress for the cup and both source hands. Explicit recovery retains the original cup and hand fade rather than applying a second ordinary-entry/exit envelope.
- This selector is limited to front view with no outfit. Unsupported contexts retain their existing fallback. Atomic resource readiness and action-instance lifecycle behavior require the final checks below.

## Internal seam and coverage are different questions

The selected source deliberately retains its visible light-pink proximal diagonal starts. Historical review called these a visual blocker under the earlier natural-root objective. The user's later middle-column preference selects this compact appearance; this delivery preserves it rather than substituting the wider new forearms.

The extraction does omit some original proximal highlight. That fact does not establish a missing dark contour requiring repair, nor authorize a broader mask. The v2b source repair already restored the independently identified upper-ink loss. No further proven missing-ink correction is included here. There is no repeated upstream mask exploration, body-color patch, recoloring, manufactured cap, or addition of ambiguous torso pixels.

The foreground root remains visible as an internal seam even when its pixels lie inside the canonical body silhouette. Zero exterior exposure and adequate body alpha therefore do **not** prove natural buried attachment, complete shoulder anatomy, or removal of that seam. This source contains no separable hidden shoulder from which to make such a claim. Its applicable safety gate is coverage against the unchanged canonical body, together with contact and face-clearance measurements.

Historical `frames.json` retains its original right-shoulder 61.5 registration. Those archival records are not silently relabeled as current generic-shoulder validation. This narrow cup-anchored pose must be judged by its actual current composition and coverage; it does not repair or certify the generic shoulder contract.

## Final evidence

- `qa/results.json`: original preferred pixels, ordinary 257 phases × DPR1/1.25/1.5/2 and genuine recovery 257 phases × the same DPRs. Hand–cup pixel gap, exterior root exposure, root-over-body-alpha-below240 and face overlap are all zero. Recovery also checks fully opaque geometry separately from existing fades. This measures containment, not removal of the internal highlight seam.
- Two-source selector tests cover257 ordinary phases ×4DPR and257 recovery phases ×2DPR, exact independent composition, load failures/cold loading, bounded interleaved channels, malformed contracts, unsupported views/outfits and competing-source fail-closed behavior.44 focused tests pass after production activation.
- `evidence/report.json`: final enabled actual `createPetRenderer` replay,7 scenarios/2317frames.1647frames select the source;1498/1498 middle-window frames equal the originally preferred forced painter, maximum cup-coordinate difference0. Full expiry, interruption/reopen, pause, reduced motion, outfit invalidation, hide-command replay and original three-quarter handoff are covered. Quarter handoff remains entirely legacy. The host fixture owns action expiry; this does not claim real controller timers, OS visibility, native clicks or GPU visual acceptance.
- The locally reviewed 10.23s full-action and 17.23s interruption/reopen comparisons were delivered separately to the user, who accepted them. Videos and demonstration images are deliberately excluded from this commit. The retained capture script reproduces both comparisons; its outputs are offscreen actual renderer, not native/browser evidence. Source opacity is shared during the first/last360ms of an ordinary9s action.
- `evidence/final-validation.json`: complete ordinary-default-parallelism `npm run check` exit0,6131tests/6126pass/5optional skips/0fail plus every subsequent aggregate check; integration71/71. Source PNGs and historical package metadata stay byte-identical. Current code/manifest identity is retained in the renderer report.

Reproduce the actual lifecycle with `node docs/reviews/dango-limbs-v2-runtime/sip-preferred-short/scripts/capture.mjs --repo="/absolute/repo" --out="/new/evidence" --allow-enabled`. The fixture uses in-memory isolated baseline/selected artists, leaves production files unchanged and rejects an ambiguous source registration. Source-only geometry reproduction is documented in `qa/REPRODUCE.md`.

Publication retains the unchanged source package by reference, compact reports and portable scripts. Per the user, no videos or demonstration images are added. Full per-frame traces, generated fixture wrappers and bulk PNGs are reproducible and excluded; nothing previously saved is deleted. After syncing the two later viewport files,48/48 targeted viewport/sip/source/packaging/workbench tests pass,0 skips. Exact resulting-code Windows/macOS CI remains pending at publication and cannot be substituted with an earlier branch/main run.

## Scope boundary

This is the selected short front/bare sip slice, not generic limbs. It does not close quarter-view/depth, broader hold/grip, other source-root/shoulder issues, outfits, or unrelated actions. It must not be reported as full closure of issues 1–4 or of the complete limbs request, and it grants no automatic main merge or release.
