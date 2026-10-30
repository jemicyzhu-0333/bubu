# Actual cloth surface audit

This checkpoint repairs local render mapping, seam checking and redundant CPU work. Production acceptance remains false.

- `audit.json`: findings, adoption decisions, remaining implementation gaps and exact reproduction commands.
- `normal-failure.json`: the 0.5167 s compression is fixed locally; actual piping/body contact still fails at 0.5333 s.
- `cancel-02-sampled-pass.json`: full 9 s / 540-step cancellation at 0.2 s passes actual sampled contact, strain, pins and joined seams. It does not cover every cancellation time.
- `cancel-05-failure.json`: the later cancellation still crosses the body at 0.5667 s.
- `saved-seam-audit.json`: independent actual-geometry evidence of previously unchecked seam separation, including the regional collision candidates.
- `outfit-continuity.json`: 481 clear outfit samples, plus a conditional common-rigid continuous separation certificate for flower/leaf/halo pairs. Dynamic/body pairs remain outside it.
- `edge-cache-comparison.json`: all 540 geometry-check rows remain identical and final geometry is byte-identical; full CPU cost improves but still exceeds the budget.
- `frames/`, `visual-review.json`: six inspected actual-GLB diagnostic stills, not a new demo recording or final motion approval.
- `summary.json`, `source-hashes.json`, `application-validation.json`, `verification-logs.tar.gz`: final unchanged-source checks and explicit production gates.
- `experiments.tar.gz`, `experiments-manifest.json`: retained failed candidates, raw geometry, scripts and logs; every archive member verified.
- `preservation.json`: dirty-tree backup and prior immutable backup.

The original models/controllers, failed baselines and acceptance thresholds remain unchanged. Body-frame detail and joined piping are explicit research options; the normal collision failure prevents default/production adoption. Internal shared cloth/piping collision/constraint repair is still needed and remains authorized. Native desktop/physical GPU validation is separately not run. No commit, push, deployment, new video or demonstration package was made.
