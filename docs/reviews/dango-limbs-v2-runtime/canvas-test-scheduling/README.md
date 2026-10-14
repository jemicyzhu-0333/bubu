# Canvas test scheduling diagnosis

Two unchanged default-parallelism `node --test --test-reporter=tap` runs passed: **6,024 total / 6,015 passed / 9 skipped / 0 failed**, in 50.39s and 52.23s. Both Canvas environment variables were enabled. No CPU-affinity or concurrency limit was applied. These were the Node suite, not the complete `npm run check` pipeline.

## Finding and limits

Usagi's long synchronous native Canvas readback loops grow to approximately **5.7 GiB RSS** with a roughly 10–14 MiB JavaScript heap. A no-bubu control reproduces this with two 584×584 canvases and the same **1,884 paired readbacks**. It loads no production code or assets. Yielding the event loop every ten samples allows native buffer finalizers to run and removes this growth.

The historical whole-test-process failure did **not** recur in either diagnostic suite. Its original exit code/signal and exact killer remain **unknown**. Memory pressure is consistent with the observed footprint; a SIGKILL/OOM was not captured and must not be claimed. `/sys/fs/cgroup` was unavailable, so OOM counters could not be checked.

## Controlled comparisons

| Run | Largest process sampled peak RSS | Coverage/result |
|---|---:|---|
| Full original suite #1 | 5,828.36 MiB (Usagi) | 6,015 passed / 9 skipped |
| Full original suite #2 | 5,815.82 MiB (Usagi) | 6,015 passed / 9 skipped |
| Isolated Usagi baseline | 5,827.84 MiB | 19/19 |
| Isolated Usagi, yields | 247.48 MiB | Same 19/19 and samples/assertions |
| Isolated sip baseline | 924.06 MiB | 4/4 |
| Isolated sip, yields | 415.55 MiB | Same 4/4; 257 phases × both DPRs |
| Canvas-only baseline | 5,769.38 MiB | Checksum 960840 |
| Canvas-only, yields | 225.66 MiB | Same checksum 960840 |

RSS sampling is at 100ms and can miss shorter peaks. Canvas-only also self-reported 6,097,862,656 bytes at synchronous loop completion. Aggregate descendant RSS peaked at 6,454.83 and 6,511.16 MiB during the two full runs; sums include shared pages and are not cgroup usage. `measurements.json` preserves aggregate and largest-process metrics separately.

In both full runs, sip exited around 13.9s and Usagi started around 33s. Their memory did not overlap. Both sip artists held exactly **318 entries / 53,968,060 decoded bytes** at all measured phases, with zero failed or pending images; disposal reduced both to zero entries/bytes. `source-cache-audit.json` preserves the phase facts. Combined with the no-bubu control, this excludes the new source cache as the origin of the reproduced Usagi loop growth. Long-running application memory safety remains a separate question.

## Patch and scope

`native-buffer-yields.patch` changes only two test files:
- Usagi: async callback and one event-loop yield per ten existing samples.
- Sip: one event-loop yield per ten existing phases.

All sample counts, views, actions, DPRs, pixel comparisons, assertions, thresholds, and explicit animation times are unchanged. No production/cache changes, forced GC, heap changes, or global concurrency cap. `source-hashes.json` gives exact original and proposed SHA-256 identities.

The baseline/yield comparisons used `instrument-tests.cjs`, a diagnostic Node loader hook that transforms only these test sources in memory and records its hashes. No checkout file was changed by the diagnostic worker. The parent applies the final patch and validates the complete default aggregate gate separately. Do not mistake the diagnostic comparison for final aggregate validation.

## Reproduce

Run from the repository root with Node 24 (observed v24.19.0; nine available CPUs) and the lockfile's @napi-rs/canvas. Place this directory anywhere, set `D` to its absolute path, and use an empty output directory outside normal Node test discovery. Linux `/proc` is needed for sampling; unavailable cgroup counters are explicitly recorded.

```sh
export PET_MOTION_CANVAS_PACKAGE="$PWD/node_modules/@napi-rs/canvas"
export USAGI_CANVAS_PACKAGE="$PWD/node_modules/@napi-rs/canvas"
export D=/absolute/path/to/this/directory
export O=/absolute/path/to/diagnostic-output
mkdir -p "$O"
python3 "$D/monitor.py" "$O/default-full" node --test --test-reporter=tap

# Use ORIGINAL file hashes for baseline/yield hook comparisons.
for mode in 0 1; do
  for spec in usagi:usagi-production-contact.test.js sip:dango-sip-source-runtime.test.mjs; do
    label=${spec%%:*}; file=${spec#*:}
    out="$O/$label-$mode"; mkdir -p "$out"
    DIAG_YIELD=$mode DIAG_OUT="$out" python3 "$D/monitor.py" "$out"       node --require "$D/instrument-tests.cjs" --test --test-reporter=tap "test/$file"
  done
  DIAG_YIELD=$mode python3 "$D/monitor.py" "$O/canvas-only-$mode" node "$D/canvas-only.cjs"
done
```

`monitor.py` reports only its own invocation and descendants. All examples are sequential; do not overlap heavy diagnostic runs. The baseline source identity supplied by the parent was commit `c0c092c15e4e29f20f607be47c16586fbc43d867`; this checkout had no Git metadata, so file hashes are the directly verified source identity.

## Compact evidence packaging

Full TAP, full per-process command records, 100ms sample histories, raw per-phase instrumentation logs, temporary patched copies, and scratch reports are intentionally excluded. Their relative paths, byte lengths, and SHA-256 are listed in `excluded-evidence.json`. The included portable scripts regenerate these outputs. They are retained in the local diagnostic directory, not bundled here. No artwork, user data, credentials, or unrelated repository content is included.

## Final checkout validation

The exact two-file patch was applied to the shared checkout after the controlled comparisons. With both Canvas environment variables, ordinary **default-parallelism `npm run check` exits0**:6024 tests/6015 passed/9 optional skips/0 failures, followed by all syntax, boundary, architecture and asset checks. No taskset, test-concurrency cap, forcedGC or enlarged heap was used. `npm run test:integration` also passes71/71. `final-validation.json` records commands, source hashes and retained log hashes. The prior c0c092 bounded-CPU pass remains historical; this default-parallelism result supersedes that limitation.

For baseline hook comparisons, use the two original test-file identities from the cited c0c092 commit in an isolated test worktree; do not reverse the patch in an active checkout. The no-bubu Canvas control and current default suite can run directly on the patched repository. Neither the default-suite successes nor the controlled memory reduction retroactively identifies the unknown historic exit signal. Native application/platform validation remains separate.
