# Local contact evidence, 2026-10-24

Production accepted: **false**. Task complete: **false**.

- `audit.json`: repairs, rejected candidates, exact remaining implementation and environment gaps.
- `summary.json`: final 36-stage run; 828 Node and two Python cases. A successful diagnostic stage does not promote its failed production gates.
- `welded-body-proxy-certificate.json`: certificate for the actual final welded input. `local-body-proxy-final-audit.json` is an earlier **unwelded** proxy comparison; its numbers are historical.
- `*-failure-replay.json`: independent replay of saved failures, not new successful trajectories. The triangle coupling replay reconstructs source rest lengths before comparing the saved cage.
- `verification-run.tar.gz`: raw final run, logs and browser evidence.
- `experiments.tar.gz`: historical successful constructions and failed candidates, authoring inputs, saved failure geometry, two rejected triangle-metric source variants, and replay scripts.
- `candidate-sources.tar.gz`: the tested cloth-probe source and fixture snapshot. The triangle shape-matching variant was removed and is only in the experiment archive.
- `diagnostic-logs.tar.gz`: application validation and local diagnostic logs.
- `ARCHIVE.json`: SHA-256 for files and every tar member. The archive does not hash itself.

Reproduce the unified verifier from `research/animation-0.1.0`:

```sh
node animation-foundation-v1/verification/run.mjs --output NEW_EXTERNAL_DIRECTORY --browser /usr/bin/chromium --software
```

For saved-geometry replays, extract `experiments.tar.gz` into a fresh directory and run its `replay-failed-render.mjs RESEARCH_ROOT RUN_DIRECTORY NEW_OUTPUT_JSON` (four render failures) or `replay-triangle-coupling.mjs RESEARCH_ROOT RUN_DIRECTORY NEW_OUTPUT_JSON` (triangle coupling failure). Read the owning cloth-probe README for diagnostic authoring commands and limitations. Historical source hashes differ where the diagnostic was subsequently corrected; these records are intentionally not relabeled as current successful runs.

Frozen GLBs/controllers, previous backup and existing demo remain intact. The final dirty-worktree backup and its per-file hashes are recorded externally at `/workspace/artifacts/bubu-v2-local-contact-20261024/source-backup.json`; no commit or push was made.
