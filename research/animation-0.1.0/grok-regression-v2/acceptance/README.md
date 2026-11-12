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

## F2 analyzer v2 and raw evidence (BUBU-V2-20261112-012)

`f2-analyzer.mjs` replaces the v1 inline classifier, which only looked at the
post-move controller state and accepted any transition after a >=120ms gap.
v2 checks three layers: (1) every logged `DragController.move` snapshot against
the faceIntent contract (`hysteresis` = r3 64/76 with enter >70 and a >=120ms
gap that only clears the latch; `threshold` = the single-70 baseline);
(2) every per-frame change of the owner candidate against an expected controller
transition with the same from/to inside a two-frame window (a timeout or timed
pickup exit may land anywhere in its gap); (3) every owner requestId change
paired with a candidate change and vice versa. It uses the same 64/76 rule as
r3, so it proves conformance to the contract, not that no switch is visible.
The frame layer reads the owner state per rAF (candidate/requestId), not the
rendered blend weights.

Raw renderer logs from the six F2 acceptance-B runs (3 baseline, 3 r3; synthetic
input, SwiftShader) are in `evidence/f2-straight-20261112/`. Re-run:

```bash
cd research/animation-0.1.0
node grok-regression-v2/acceptance/reanalyse-f2.mjs [--details]
node --test grok-regression-v2/f2-analyzer.test.mjs
```

## F2 live run with screen capture (`f2live`, G-20261112-017)

Live Grok 电脑验收 of F2 acceptance B with pixel evidence. `GROK_SCENARIOS=f2live`
(test-side only): widens the window to 1000x220 and the canvas to 680x220 (height
unchanged, so DIP per world unit and the controller's DIP/s are unchanged; the
dev bench leaves the pet where it lands, and a 220px canvas loses it off-screen),
paints an opaque page background, and records the window region of the Xvfb
screen with `ffmpeg -f x11grab` (60fps requested, wall-clock pts) for the whole
run. Each run is one calibration contact (110 DIP/s -> T05, then 40 DIP/s -> 01)
followed by `GROK_SESSIONS` (default 3) straight-line F2 contacts; between
contacts the pet is dragged back to the start point in an unlogged contact.
Analyzer v2.1 checks every session (both contracts); coverage minimums apply to
the run total. Wider canvas = slower SwiftShader frames (about 16 presented
frames/s instead of about 60), so this is not G1 evidence either.

`f2-pixel-faces.mjs <variant-dir> <rep>` classifies the face on screen in every
captured frame: pink body mask -> pet, the two largest dark blobs -> eyes, a face
patch resampled in eye coordinates, nearest of the two live reference patches
from the same run's calibration contact (margin 0.85, else `ambiguous`). It
reports per session: in-band samples, controller / owner / pixel face switches
in the band window and how many are not explained by the 64/76 rule (a pixel
switch inherits the explanation of the latest owner switch to the same face
within 600ms before it), leave-one-out accuracy on the calibration frames, and
agreement with frames whose owner candidate was constant for 400ms. Capture and
renderer clocks are aligned only by the motion onset; no latency is derived.
Evidence (renderer logs, per-run pixel results, frame strips, short mp4 clips;
the full mkv recordings are not committed) is in `evidence/f2-live-20261112/`.

Analyzer v2.1 (BUBU-V2-20261112-013): pending moves must log null and pickup
moves N3; a displayed null is only legal before the first displayed face or
after `end`, N3 only before the first airborne face (so a mid-run
T05->null->T05 or late N3 is unexplained); empty or low-coverage logs fail
(`coverage.problems`), and sessions must open with `down` and close with `end`.
