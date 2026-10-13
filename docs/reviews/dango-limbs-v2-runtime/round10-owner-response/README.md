# Round 10 viewport probe review

Reviewed probe: `8a411eb2b642f4dd5c4f9f8d57c8b68114db023e`.
Production viewport: the unchanged `src/platform/electron/windows/pet-viewport.js` from the supplied `d5f260c` snapshot.
This directory contains review evidence only; no production or probe change is proposed here.

## Reproduce

From a checkout containing the reviewed probe:

```sh
node docs/reviews/dango-limbs-v2-runtime/round10-owner-response/reproduce-nudge.cjs /absolute/path/to/repo
```

To use an exact probe copy with a separate production checkout:

```sh
node docs/reviews/dango-limbs-v2-runtime/round10-owner-response/reproduce-nudge.cjs /absolute/path/to/repo /absolute/path/to/verify-pet-viewport.cjs
```

The second argument can also be `/dev/stdin`. The script reads the probe without editing it and resolves its original relative imports against repoRoot. It uses the real production createPetViewport with synthetic native/window/screen ports. It does not launch Electron, fetch files, write repository files, or use a real user profile.

Exit 0 means the four recorded review observations reproduced. It does **not** mean the probe passed every scenario or native behavior was validated. A changed probe may appropriately change these observations and return 1.

## Observed results

- Unchanged control: PASS.
- +3 y before setMenuOpen captures geometry: PASS.
- +3 y during the first yield: FAIL, `913 !== 910`, at the y-center assertion.
- +4000 y before geometry: PASS despite the entire 220×220 logical anchor being outside the native rectangle.

The exact reviewed seven-test probe suite passed 7/7 when loaded in memory. The unchanged production viewport suite separately passed 7/7. Neither suite currently covers the during-yield case above.

## Findings and limits

1. In probe lines 31–43, geometry is captured before await but compared with native bounds read after await. The new unit test nudges on the second native read, inside setMenuOpen, so it does not cover a nudge during yield. The +3 counterexample demonstrates a remaining timing-dependent assertion failure. It does not establish that this was the timing or cause of the real macOS CI failure.
2. Position rebaselining has no containment or displacement constraint. The geometry equations can still balance with offsets that put the pet outside the backing window. The +4000 case is a deterministic coverage blind spot, not evidence that such a displacement occurred in production.
3. Do not silently replace the captured geometry with a fresh post-yield calculation and call that rendered-anchor validation. Production geometry is delivered through menu IPC and viewport publications; createPetViewport has no native move-event publication. Native and renderer freshness require separate evidence. This review does not claim a reproduced native visual defect.

The script/source digest and full synthetic results are in `results.json`. No CI run was started or changed by this review.
