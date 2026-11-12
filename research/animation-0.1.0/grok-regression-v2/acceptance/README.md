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
`f2` F2 acceptance B: straight horizontal line, 1px steps timed at 1/speed
(66/74 DIP/s alternating), with renderer-side logs (inbound pointer events,
controller-measured speed and faceIntent from a test-side wrap of
`DragController.prototype.move`, displayed face owner/requestId per frame);
every face switch is classified as explained (measured speed <64 / >76, or a
>=120ms stationary-timeout reset) or unexplained. `f2circle` is the old
integer-pixel circle, kept only as a quantization/curvature STRESS scenario:
its measured speed really leaves 64..76, so it is not an in-band check. `f3` reduced motion
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
integer-pixel steps. Under SwiftShader the pet renders irregular frames (p95
about 50ms, max about 100ms) and pointer moves are coalesced per frame, so the
controller-measured speed spreads well beyond the planned value; report the
logged in-band fraction with any result. Add `GROK_REP=<n>` to keep one
renderer log per repeat.
