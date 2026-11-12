# grok-regression-v2

Regression tests written by grok for the first-round Bubu V2 animation/interaction
review (mailbox reply `G-20261112-002`). They encode the **intended** behavior and
are **expected to fail** on the baseline until the matching fix lands. Test code
only: no product code is changed here.

- Baseline: `feature/pet-animation-v2` @ `3751977ceac5c9bdcefd76a47aa5fa482f207a7a`
- Owner decisions encoded (2026-11-12): F3 reduced motion keeps drag/pet and only
  tones down motion (no 2D fallback); F6 petting allows back-and-forth stroking.
- foundation-v1 adopts the F2 hysteresis on condition that the dedicated 64/76
  test below passes on the integrated code.
- Suite names all start with `grok-regression`.

| File | Finding | Baseline result |
| --- | --- | --- |
| `f1-lower-body-drag.test.mjs` | F1 slow 1px drag from lower/middle body is silently cancelled | 4 fail (y=0.3/0.6/0.9/1.1); 2 guards pass |
| `f2-face-hysteresis.test.mjs` | F2 face intent flickers around the speed threshold | fail on baseline (159 switches / 160 frames); passes with dot's fix on `review/dot-face-intent-hysteresis-r3` (`4eb3377`) |
| `f2-foundation-hysteresis-64-76.test.mjs` | F2 adoption gate for foundation-v1 (owner decision 2026-11-12): 64/76 DIP/s band exercised through the foundation-v1 pointer host | fail on baseline (67 DIP/s drops T05); passes with dot's `4eb3377` controller |
| `f2-inband-straight-line.test.mjs` | F2 acceptance A (G-20261112-013): straight line at 66/74 DIP/s whose controller-measured speed (logged from the real DragController) stays in 64..76; 0 switches not explained by crossing 64/76 | fail on baseline (205/205 in band, 10 unexplained); passes with dot's `4eb3377` controller (205/205 in band, 0 unexplained) |
| `f2-analyzer.test.mjs` | Analyzer v2 for F2 acceptance B (BUBU-V2-20261112-012): dot's two synthetic counterexamples against analyzer v1, timeout scope, owner restart pairing | passes (tests the analyzer, not product code) |
| `f3-reduced-motion-interaction.test.mjs` | F3 reduced motion disables V2 interaction | fail |
| `f4-fall-regrab.test.mjs` | F4 no re-grab while falling; blank face mid-air | 2 fail; 1 guard (re-grab once settled) passes |
| `f6-petting-stroke.test.mjs` | F6 lateral stroking while petting turns into pick-up | 1 fail; 1 guard (deliberate upward pull still picks up) passes |

F5 (terminal event at the sealed timestamp) is left to dot and has no test here.

## How to run

These files live outside the folders scanned by the root `npm test` and by
`npm run foundation:test`, so they never break the default checks. Run them on
their own:

```bash
cd research/animation-0.1.0
npm ci --ignore-scripts
npm run foundation:prepare   # restores the tracked D2 fixture asset
node --test grok-regression-v2/*.test.mjs
```

A non-zero exit code is expected until the fixes land. When a fix lands, its tests
should turn green; the guard tests must stay green throughout.

## Evidence level

Local tests only: synthetic pointer input on CPU through the repository's own
`body-runtime/fixture.mjs` and `FoundationPool`. Not CI, not real OS input, GPU
or on-device acceptance. Thresholds used here (1px/8ms steps, +-16px strokes at
1.5 Hz, at most one face switch per 0.25s) come from the review's acceptance
criteria and may be tuned with the owner after on-device checks.

## Coordination

Please do not edit these test files while fixing the findings; if a test needs
to change, say so in the mailbox and grok will update it on this branch.
