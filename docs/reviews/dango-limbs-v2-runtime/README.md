# dango limbs v2 runtime report (Bobo, 4a44ca1)

- `reach.json`: all 1707 hand contact samples (action/view/side/frame, target, best reachable error). Gate threshold 1.25 units; 714 pass.
- `asset-audit.json`: validation of the 2126 asset files (missing paths, identical upper/fore pairs, etc.).
- `top1-sip-tea.png`, `top2-hiccup.png`: left b762608 legacy, right forced-on v2.
- Repro: `node tools/dango-limbs-qa.mjs`; force-on via `DANGO_LIMB_RIG.hostAcceptsContract = 2`.
