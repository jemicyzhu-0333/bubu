# Accepted opposed-limb direction, independent slower cadence

The user accepted the r2 opposed hand/foot direction and asked to control overall action speed. Exact quote and source are in APPROVAL.json. The 2.4-second default is an adjustable implementation choice, not a user-specified exact number.

This new sibling revision imports the unchanged approved full18 owner/body adapter from drag-body-prototype-v1. It does not modify the frozen directory or historical r2 candidate. No rig, weight, static geometry, material or face changes.

## Independent clocks

- `new DragController(profile,{struggleCycleSeconds:2.4})`. Bounded configurable range2–2.5s.
- The airborne idle A/B cycle contains held extremes and smooth transitions. It fades in after the original1.075s protected pickup, over0.4s. Only this idle cadence is slowed.
- Pickup duration, DIP speed-window thresholds, surface positioning, inertial spring and release duration are NOT scaled by cadence.
- Fast movement gives actual signed inertia full ownership of the pose; idle periodic sway is suppressed rather than combined at the same frequency.
- Release continues to accept the host's height-derived duration. Body-pose recovery and ground-position descent share that duration.
- Original input queue/sealed timestamp, hidden, early release, regrab and finite-source checks remain unchanged.

The router revision must import this controller and pass `dragOptions` unchanged. It must not scale timestamps. The workbench explicitly selects2.4s; original body-poses.json remains the pickup/lag/landing profile, with approved A/B in src/approved-struggle-r2.mjs.

## Restore and reproduce

Place this directory at research/animation-0.1.0/drag-cadence-r3 next to the hydrated drag-body-prototype-v1 from baseline4dcf3c. Run npm ci for this package's locked Three.js0.186.1. It reuses the baseline approved GLB and runtime; no duplicated runtime is needed.

- `npm test` runs19 focused inherited gesture + cadence tests in this restored layout.
- `node replay/generate.mjs --video` produces7s actual controller/owner/body data with slow pickup, stationary struggle, fast movement/reversal, release and landing.
- `blender -b -t 3 --python ../drag-body-prototype-v1/render/render_actual.py -- --input evidence/continuous.json --out evidence/continuous-render --samples 24`
- `python render/compose_preview.py` annotates the actual grip and floor, then produces the private normal-speed video.

Video/raw frames/cache are never part of the Git closure. CPU and offline rendering do not certify browser/WebGL/OS performance or final speed acceptance. Face01/N3/T05 continue through the existing sole weighted owner.
