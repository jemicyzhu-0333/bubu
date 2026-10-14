# Runtime review of 2442672 (sip preferred short) and generic limbs v2

Reviewer: Bobo's agent. Base for "before": main `996a4d3`. "Gated" = feature head with production defaults.
"Forced" = same tree with `DANGO_LIMB_RIG.hostAcceptsContract = 2` (generic limbs v2 enabled). Offscreen
production renderer, pink skin, DPR 2; no native/GPU evidence.

## Decision

| Scope | Production |
| --- | --- |
| `sip-tea` front, no outfit | Codex `sip-front-short-v1` source (as shipped in 2442672). Generic limbs must not replace it. |
| every other action/view/side | legacy paws; generic limbs v2 stay off (`hostAcceptsContract: null`) |

Generic limbs v2 were not a net improvement anywhere they activated in the forced run
(bubble-blow front, snack-picnic all views, umbrella-dance front, hiccup three-quarter): the palm
becomes a large flat blob with partial/absent outline, does not wrap the handle/wand, and in
umbrella-dance does not touch the handle. Reach is still the main limit: 629/1707 sampled
contacts within 1.25 units (`node tools/dango-limbs-qa.mjs`).

## Verified

- Sip lifecycle capture (`sip-preferred-short/scripts/capture.mjs --allow-enabled`): 7 scenarios, 0 failures,
  middle-window frames identical to the selected painter.
- `limbs:check`: 224 target-views / 10 pixel actions, 0 failures.
- Sip start/end frames (progress .01–.06 / .94–.99): cup and both source hands share one fade; no hard switch.

## Open issues for Codex

1. **Outfit switches the sip look.** With any Dango accessory (all 14 tested, incl. `milestone.*`, `skin.*`, stack)
   sip-tea falls back to legacy round paws, while bare uses the short source. Wearing a hat therefore changes
   the hands. The accessory matrix reports this as 168 new `covers-prop` + 12 `over-budget` findings on
   sip-tea (the worn-vs-bare diff is the hand change, not an occlusion). Needs either outfit-compatible
   source hands or an explicit acceptance of the inconsistency.
2. **Three-quarter sip stays legacy**, so turning between front and quarter changes hand style mid-action.
3. **Generic palms (paw/hold, paw/grip front & quarter)**: no outline where the palm overlaps the body; reads as
   a ghost blob. Grip palms do not wrap prop handles.
4. **Reach**: 6+6 arm length cannot reach most prop contacts (workout, catch-star, read-book, knit-scarf 0%).
   Needs action-level contact re-authoring or different bone lengths.
5. If generic limbs are ever enabled, the forced run shows them altering the sip-short right paw region; the
   source-contact pose must keep precedence (code side, to be guarded when enabling).
