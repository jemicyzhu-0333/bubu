# Flower/body repair, 2026-10-24

**Three known sampled flower/body crossing pairs repaired in the default runtime. Overall production acceptance remains false.**

| Part | Before: crossing frames / triangle pairs | Deepest tested vertex | After: crossing frames | Minimum actual triangle gap |
|---|---:|---:|---:|---:|
| sakura_petal_1 | 481 / 65 | 0.03879363 | 0 / 481 | 0.00481819 |
| sakura_petal_2 | 481 / 86 | 0.04026735 | 0 / 481 | 0.00336543 |
| sakura_leaf_-019 | 481 / 177 | 0.02732633 | 0 / 481 | 0.00768002 |

The baseline overlaps persist across idle, pending, petting, drag and landing. Recorded worst-depth frames are 208, 256 and 263; depth differences across poses are under 1e-12. Vertex depths are witnesses, not a maximum over the entire triangle interior.

The binding provider changes only three actor-owned rigid part frames: 30/25 degrees about the original petal centres and 10 degrees about the original leaf proximal tip. No vertex, normal, index, material, source GLB, controller, mount bound or secondary-motion limit changes. The fit module hash participates in flower contact identity. The remaining full-outfit failures are pouch/body and strap/right-hand. Full continuous contact, containment, self-contact, cape/tea, realtime cloth and stable renderer frame time remain unaccepted; native desktop and physical GPU tests are separately not run.

Actual default-browser views: [front](frames/integrated-dpr1-idle-0-light.png), [side](frames/integrated-dpr1-idle--60-light.png), [drag](frames/integrated-dpr1-drag--60-light.png), [2x dark](frames/integrated-dpr2-idle-0-dark.png). Compare the [original front](baseline-frames/baseline-dpr1-idle-0-light.png). Fourteen default-path frames match the reviewed candidate pixel-for-pixel. One earlier Playwright screenshot stability timeout is retained in raw evidence; the successful retry verifies three identical RAF bounding boxes before clipped capture.

`summary.json` records 36 completed stages, 831 Node and two Python cases, with unchanged tested sources. Application check passes 6,742 cases with 29 explicit skips; integration passes 71/71. Software browser frame-interval P95 is 217.5 ms, not a hardware-GPU measurement.

From the research directory:

```sh
node animation-foundation-v1/verification/run.mjs --output NEW_EXTERNAL_DIRECTORY --browser /usr/bin/chromium --software
node animation-foundation-v1/contact/outfit-sweep.mjs ANOTHER_NEW_EXTERNAL_DIRECTORY
```

For detailed per-frame crossing/depth/gap diagnostics:

```sh
node flower-motion.mjs baseline NEW_BASELINE_DIRECTORY /absolute/path/to/research/animation-0.1.0
node flower-motion.mjs integrated NEW_CURRENT_DIRECTORY /absolute/path/to/research/animation-0.1.0
```

The portable baseline restores only the three private part frames. It reproduces all 47,925 saved pre-repair outfit surface vertices exactly at rest. Exact historical measurement scripts and intermediate candidates are preserved in `experiments.tar.gz`; they are not default modules. `verification-run.tar.gz` contains raw verification outputs; `diagnostic-logs.tar.gz` contains local/application logs; `candidate-sources.tar.gz` contains the changed implementation and regression sources. `ARCHIVE.json` hashes each file and every tar member, excluding itself.

Previous same-volume body partition: narrow phase improved 184→69 ms in the failed sample, solver worsened 149→280 ms and overall physics P95 worsened 337→351 ms. It remains an isolated diagnostic option, not enabled by default, and was not repeated here.

No new video, interactive distribution package, commit or push. The full dirty-worktree backup is recorded externally in `/workspace/artifacts/bubu-v2-flower-fit-20261024/source-backup.json`; earlier archives/backups remain intact.
