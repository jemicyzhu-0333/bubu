# Sip-tea isolated full rest chain

UNADMITTED research prototype. V1 action #27 sip-tea, 9s, cup + steam. #1/#2 still unmigrated. Existing approved08 is a work.rest expression candidate, not a newly approved face. Original source GLB, rest shape, admitted host/drag/petting remain unchanged.

Sequence: rest → round short hands migrate → cup enters via .3s scale/fade → lift/tilt/sip → return to hold → cup exits → hands restore to rest. A single supplied time samples the offline cue; no RAF, additional owner, timeline registry, or production body writer is created. Face frames are exported through the existing actual weighted owner. Cancellation freezes the held pose while the cup fades, rewinds the lift without the prop, then restores hands. Face exit waits for cup disappearance. Reduced motion suppresses this scene; isolated prop/effect resources can be hidden and disposed idempotently. Steam is DISABLED/PENDING: its first render looked like dark specks and was rejected. Resource implementation is retained opt-in for research, default hidden; do not claim V1 steam migration complete.

Evidence: normal271 samples at30Hz (0..9 inclusive), nine cancellation times ×7 samples; all tested visible body/cup/face intersections and analytic ceramic-inside-body vertices zero. Six lifecycle/resource tests pass. Actual-owner face continuity also passes at all nine cancel times, comparing initial face vertex bytes with normal(c). A rejected earlier export replayed08 on late cancel; release history now preserves the earlier normal release. The final preview is9s at30fps; video stays outside Git. FINAL-FREEZE binds original workspace raw data and outputs; portable tools here have adapted imports and their own SHA256SUMS.

Limits: discrete samples do NOT prove continuous safety. Full-chain shared-vertex fan folding is not completely audited. Selected18 poses retain max edge ratio3.50418/min area ratio.066423; do not claim the old strain thresholds passed. Body shape/art remains subject to review. The approved08 smile corners remain partly exposed above the cup and read as two dark tips; this known visual issue is pending user review. A bounded -.20 tilt experiment fully covered the mouth but introduced40 hand/cup triangle intersections and4 ceramic penetration points, so it was rejected and is not included in this action. No host capability extension has been admitted.

The local private package pins Three.js 0.186.1. Run `npm ci --ignore-scripts` in both `research/animation-0.1.0/sip-tea-prototype-v1` and this directory before `npm test`; the sibling cup module resolves its own locked dependency. The lockfile belongs to this isolated research package and does not change production dependencies.

Reproduce inside the restored research/animation-0.1.0 tree (Node/Three, Python NumPy/SciPy, Blender):
1. node tools/export-base.mjs; node tools/export-tea-face.mjs
2. node --test tests/*.test.mjs
3. node tools/export-full-lifecycle.mjs
4. python tools/build-full-geometry.py; python tools/add-steam.py
5. blender -b --python tools/audit-full.py
6. blender -b --python tools/render-full.py -- --input tools/generated/normal-geometry.json --out /tmp/sip-preview --size 384 --span 3.3 --samples 12
Use ffmpeg at30fps, first270 frames for9s. Large generated geometry, face arrays, frames and videos remain local. build-entry.py standalone uses the checked-in frozen hold pose for endpoint consistency; build-full-geometry evaluates its functions without writing standalone frame loops.
