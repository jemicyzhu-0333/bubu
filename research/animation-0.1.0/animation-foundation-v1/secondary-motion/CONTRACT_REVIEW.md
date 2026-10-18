# Secondary world-transform and cleanup review

Research checkpoint; no new contact model or production admission.

## Reproduced failures

A valid static profile (tail distance 1, proxy radius 0.5, hit radius 0.05) initialized at unit scale, then parent-scaled to 0.5, returned successfully on a no-substep or continuously paused frame despite library clearance -0.05. Initializing directly at that scale instead rejected the rest pose. A first geometry disposal observer throwing prevented later geometry release and root detachment.

## Contract and fixes

Both parent and sampled root actual world transforms must be rigid, unit scale, with proper rotation. Scale, shear and reflection are unsupported and rejected. Checks cover initialization, all display paths, sampled substeps and reset. Reset/update errors invalidate and dispose the instance. Disposal marks invalid first and completes independent cleanup before aggregating errors; admission disposal also attempts all owned geometry releases. Equipment cleanup preserves original errors alongside cleanup errors. Hot-path transform validation adds no temporary vector/array or callback allocation.

## Validation

- Eight regression tests: unsupported parent transforms; no-substep/pause/resume/reset/sampled-world rejection; supported rigid transforms; instance/admission disposal failure; reset/sampler failure; construction observer failure; equipment original-error preservation with lease cleanup failure.
- Existing secondary test.mjs and test-recovery.mjs passed.
- Full foundation test suite: 94 passed, zero failed.
- Integrated replay: 900 frames passed; this run CPU median 2.128 ms, P95 4.653 ms, maximum 23.211 ms. GPU excluded. See sibling evidence and integration/evidence/integration-report.json.
- Equipment regression explicitly covers the original-error plus lease-release-error case; all multi-asset pending failure combinations have not been exhaustively tested.

## Remaining gates

Historical long-tail timing spikes remain unresolved; this one run does not establish a stable frame budget. Native Windows/macOS/GPU validation remains open. Static sphere proxies check chain tails only, not garment triangles, hand/cup contact, seams, or fixed clasps. Cloth research remains separately blocked and is not enabled here. Source body and approved assets remain unchanged.

Formatting-only cleanup followed the full test/integration run; the eight targeted regressions were rerun and passed afterward. The integration report retains its actual pre-format source hashes rather than rewriting historical evidence.
