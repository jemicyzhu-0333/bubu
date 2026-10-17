# Continuous airborne struggle r4

The user corrected the r3 slow/held-beat interpretation. See APPROVAL.json. R3 is historical and superseded; the direction remains the accepted r2 opposed limbs.

The default prototype loop is .82s, configurable .65–1s. It has no holds: staggered limb phases and small orthogonal arc channels keep motion continuous, with a modest harmonic shaping the stroke. Whole-body idle rotation is zero. All original quaternion caps and static rig, geometry, material, skin weights and face source remain unchanged.

Phase is derived from the same pickup origin throughout hover, drag and recover. Actual signed spring lag smoothly takes ownership during motion, fully suppressing the loop at brisk motion. On stop the same continuing phase returns. Fast pickup interruption captures the current pose and blends over .14s. Protected pickup is still1.075s; pointer input and release use original seconds and thresholds. There is no global speed multiplier or idle pose hold.

## Restore
Place at research/animation-0.1.0/drag-flow-r4 alongside hydrated drag-body-prototype-v1. Run npm ci and npm test. This package reuses the frozen body and sole WeightedExpressionOwner by sibling imports. Dependencies are pinned in DEPENDENCIES.json.

## Actual preview
node replay/generate.mjs --video
blender -b -t 8 --python ../drag-body-prototype-v1/render/render_actual.py -- --input evidence/continuous.json --out evidence/continuous-render --samples 8
python render/compose_preview.py

7 seconds,30fps, fixed5world-unit view at384px. R4 uses near-front10° rather than prior52° quarter view so both sides are visible; this view difference is explicit. Actual root follows the grip; no added whole-body oscillation. Source vertex colors and full18 face use unchanged renderer. Video/rawframes/cache excluded from Git. CPU/offline evidence does not certify WebGL/OS behavior or final artistic acceptance.
