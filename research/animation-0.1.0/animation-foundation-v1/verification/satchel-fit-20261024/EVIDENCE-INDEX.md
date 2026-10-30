# V2 satchel closure checkpoint — 2026-10-24

Production acceptance remains **false**. This phase closes the two remaining
sampled outfit crossings, preserves previous repairs, and audits the next cape
constraint boundary. It does not certify continuous wardrobe contact or tea cloth.

| Evidence | Result |
| --- | --- |
| Original pouch/body and strap/right-hand | Both crossed in all 481 action samples |
| Final default complete outfit | 481 samples, zero cross-garment crossing pairs |
| Minimum actual hand/strap and body/pouch gap | 0.01933808 / 0.03877589 |
| Pouch/strap attachment embedding | Present in every frame, 42–55 stitch triangle pairs |
| Final browser review | 14 default-path captures, pixel-identical to candidate |
| Research verifier | 36 stages, 838 Node cases and 2 Python cases pass |
| Application | 6,742 pass, 29 explicit skips; integration 71/71 |
| Stable frame rate | Failed: software browser interval P95 248.4 ms |
| Native desktop / physical GPU | Not run |

See [audit.json](audit.json), [summary.json](summary.json), and
[the actual default renderer frame](frames/integrated-dpr2-idle-0-dark.png).
The figure is an actual render, not a generated illustration or a real-time
performance certificate. No new recording, distribution package, commit or push.

## Repair and scope

The binding provider owns the pouch/flap/catch rigid local frame. It preserves
all geometry buffers and uses the original pouch support vertex as its pivot.
The three parts keep their relative geometry. The strap remains continuous.
The satchel's rigid calibration keeps its spring origin fixed; the daily cape
is tilted back 2 degrees about its original `back.upper` anchor. The complete
fixture's offset remains inside its original anchor bounds.

The actual visual result is a looser waist sling below the hands. All spring
parameters, pin weights and maximum angles are unchanged, but gravity relative
to the assembly frame changes the waveform: satchel maximum secondary movement
is 0.20014728 (before 0.23225688); cape is 0.12889686 (before 0.12953907).
This is not an amplitude-limit reduction or a claim of identical trajectories.
Embedding throughout the replay does not certify a pointwise sewn seam.

Fit code hashes and exact matrices enter contact identities. The staged equipment
owner retains the old outfit and frees all new resources if assembly fitting
fails. Tests cover private buffers, fixed pivots, rigid pair distances, malformed
inputs, renamed mounts, reset, identity invalidation, and real secondary cleanup.
No persisted canonical state or IPC contract changes.

## Audit and preserved failures

The first rigid tilt cleared the rest pose but retained 10 hand-crossing frames
and introduced cape-edge crossings in 288 frames and cape-cloth crossings in 15.
It was rejected. A finite 125-orientation check found 17 statically clear poses,
all of which failed critical dynamic frames without the compatible cape fit.
Bounded offset checks retained the original limits. The final combined candidate
then passed the full replay and actual shared renderer review.

An external distance diagnostic failed to refresh geometry bounding boxes after
posing. Its BVH crossing and inside-vertex tests were unaffected, but individual
distance values were not reliable. `motion-corrected.mjs` and the shared surface
probe recompute bounds; the final gap and all three prior flower gaps were
rechecked. Original failed measurements remain in the raw archive. The slow
orientation-distance script was cancelled with exit 130; its bounded BVH-backed
replacement completed. No threshold was loosened.

The exact pre-fit rest state is reproducible without replacing the worktree:
`before-after-replay.mjs baseline` restores only private diagnostic calibration
frames, the old satchel offset and the absence of the pouch fit. All 66,391
captured rest vertices match exactly, and all 481 crossing/inside-vertex witness
rows reproduce the original measurements. Stale per-frame distance fields are
excluded from that equality claim. This is a diagnostic control, not a new
accepted contact identity. The original source backup is also preserved at
`/workspace/artifacts/bubu-v2-flower-fit-20261024/working-tree-after.tar.gz`, SHA-256
`0fcacb84d4a1ec9100e3cb30b543d524b947dc1a0c912b1e94b8d86299adcc9a`.

## Remaining boundary and independent research

The daily foundation cape is different from the frozen round5 tea cape. In the
16 saved tea keyframes, round5 fixed supports 6, 9, 13, 427, 431 and 435 are inside
the closed hands. Maximum measured displacement needed merely to exit a hand
is 0.11738959. [Independent winding evidence](cape-boundary-16.json) and the
verifier's endpoint exclusion retain the original 65-support failure. The existing
released-ten-support candidate has not passed contact, material strain or CPU
cost. The scope question is whether a new local arm-adjacent attachment mapping
is allowed while model geometry and the tea controller remain frozen. No such
production change is adopted here.

An independent next-step piping representation uses local capsule envelopes
that cover the unchanged detailed trim triangles. Ten segments collided with the
old conservative proxy at rest. The first refined proxy failed the unchanged
degenerate-face gate. A quantization-safe second candidate passes full body
containment and actual initial garment gaps, with maximum global outer error
0.00893559 below the existing 0.01 limit. Its 1,490 vertices / 2,392 triangles stay
inside the resource caps; minimum capsule/proxy gap is 0.00001738, above 1e-5.
[These are rest checks only](piping-wire-rest-refined-v2.json): no wire dynamics,
coupling, seams, full tea motion, strain or timing acceptance is claimed. This
candidate is not a default proxy or runtime path. Material transfer and CPU
solver cost remain implementation gaps, separately from missing native hardware.

The full-wardrobe gate is `not-established`, with continuous contact and global
containment not run. Cup/clasp retains its partial 1,173-sample / 295-interval
certificate. Real-time cloth and cape/tea remain blocked. Software WebGL passed
its scoped checks; physical GPU recovery and native window/input did not run.

## Reproduction and saved evidence

From `/workspace/bubu/research/animation-0.1.0`, using fresh output directories:

```sh
node animation-foundation-v1/verification/run.mjs --output /tmp/bubu-satchel-recheck --browser /usr/bin/chromium --software
node animation-foundation-v1/contact/outfit-sweep.mjs /tmp/bubu-satchel-outfit-recheck
node /workspace/artifacts/bubu-v2-satchel-fit-20261024/before-after-replay.mjs baseline /tmp/bubu-satchel-before-recheck
```

The root application commands are `npm run check` and `npm run test:integration`.
Actual visual checks start a localhost server from the research root on port 8766
and run `visual-final.py`; use a new capture directory. The final capture path has
no module interception. Candidate captures explicitly declare their intercepted
calibration/offset modules. Historical prototype scripts require their recorded
source state; use the controlled before/after helper or the original backup for
baseline reproduction instead of running historical snippets against changed
bindings. Raw scripts use the recorded workspace paths and must be adjusted if
replayed elsewhere.

`experiments.tar.gz` retains all numerical runs, candidate/final images, scripts,
rejected nominees and rest-proxy failures. Its member hashes are in
`experiments-manifest.json`. `verification-logs.tar.gz` contains the full verifier
outputs and application logs. `source-hashes.json` records the 2,014 files present
at verification time; later evidence files are additions, not part of that tested
snapshot. Every tested file was checked again after evidence creation. A verified
whole dirty-worktree backup is recorded by `preservation.json`; no commit or push
was performed.
