# Grok 电脑验收 harness (software rendering, synthetic input)

Test tooling only, no product code. `harness.cjs` is an Electron main entry that
starts the isolated dev bench (it requires `tools/dev-bench/launch.js`, the same
entry `npm run dev:bench` uses) with the realtime pet, then for each scenario:

- injects synthetic mouse input with `webContents.sendInputEvent` (window-relative
  and global DIP, like `tools/pet-realtime-capture`),
- samples the pet stage state after every input (`mode`, drag mode, `faceIntent`,
  pet phase, face owner, body root height),
- saves PNG frames (`capturePage`) and a JSON log per scenario.

Scenarios: `scan` (which heights accept a press), `f1` lower-body slow drag,
`f2` drag at 66/74 DIP/s around the face threshold, `f3` reduced motion
(emulated `prefers-reduced-motion: reduce` via the DevTools protocol), `f4`
re-grab while falling and face while falling, `f6` back-and-forth stroking
while petting.

```bash
# from the repository root, after `npm ci` and the research prepare step
BUBU_DEV_REALTIME_PET=1 GROK_ACCEPTANCE_OUT=dist/grok-acceptance GROK_VARIANT=baseline \
  xvfb-run -a -s "-screen 0 1920x1080x24" node_modules/electron/dist/electron \
  research/animation-0.1.0/grok-regression-v2/acceptance/harness.cjs \
  --dev --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader
```

Optional `GROK_SCENARIOS=f1,f2,...`. To compare a controller variant, swap the
file in a scratch checkout before running and restore it afterwards.

Limits: SwiftShader software rendering, Xvfb, synthetic input. Frame timings
are NOT G1 evidence. Results are labelled 「Grok 电脑验收」, not 真实实机验收.
`sendInputEvent` only takes integer DIP, so speeds are produced by timing
integer-pixel steps; event delivery jitter in this environment is larger than
on real hardware is likely to be.
