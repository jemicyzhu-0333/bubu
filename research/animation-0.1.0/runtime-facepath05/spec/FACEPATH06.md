# Facepath06: safe return to the current semantic

Facepath05 remains the historical checkpoint and failure evidence. This checkpoint changes controller policy, not approved art, rig, body, materials, path knots, or the seven-slot asset.

## Observed issue

In the unchanged return_current scenario, 04 is held, N3 is requested at 0.8s, then 04 is requested again at 0.92s. Facepath05 completed withdrawal anyway, visiting the original small-O/round-eye Basis at 1.08s and returning to 04 only at 1.50s. The offline source-resolution replay visibly added an unnecessary round-eye/small-O action even though N3 never entered.

## New policy

Only return to the still-active semantic can abort the pending Basis bridge. The current value and velocity are retained. An at-most-40ms bounded brake stops outgoing velocity before adjustment towards the new amount. Existing brakes are never extended by repeated intent. A later different semantic or cancel restores the required neutral bridge. Cancel generation and same-time precedence remain unchanged.

The scalar is C1. Authored piecewise-linear POSITION/NORMAL shape paths guarantee C0 geometry; this is not a claim of geometric velocity continuity or visually approved animation.

## Evidence and limits

- npm test: 167 passed, 0 failed; evidence/tests-final.log.
- Independent 10-group adversarial review: evidence/review/same-face-reversal-independent.json.
- Fresh actor/runtime morph weights: evidence/facepath-replays; unchanged events/30Hz sampling.
- Offline render uses approved 414x342 source resolution and one uniform reduction to141x116, yielding a99px Basis height. Direct native rendering is no longer the default because it exaggerates surface grain.
- Facepath05 Basis source render matches the approved reference image in all RGBA pixels.
- This is Blender replay of actual controller weights, not browser/WebGL capture. Browser, GPU, all18 slots, drag and long-press remain untested here.
- Continuous visual comparison is still pending at the time of this initial checkpoint note.
