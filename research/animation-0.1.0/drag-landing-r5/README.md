# Landing settle r5

Source baseline03023e9, user accepted R4 and asked for a final settling action. The held R4 .82-second struggle and all pickup/input/inertial clocks remain byte-equivalent in behavior; a299-frame direct oracle tests this.

Smile-tail adjustment follows user message Sentinel_c80e46667d7481918db9340e420a6252 on baseline1325d43. These are prototype timing choices, not user-provided precise durations.

After the original height-derived descent duration, the controller enters settle for.48s. A zero-endpoint/zero-endpoint-velocity damped bend uses body pitch at most.025rad, hips.045rad and shoulders.035rad. The shared host keeps the actual skinned sole minimum on the original floor and preserves release x/z. No scale, rig, skin weights, rest geometry or materials change.

The bounded face tail requests landingP2 from contact until contact+.9s, independently of the .48s body settle: a distinct policy key mapped to the existing approved P2 face with .10s enter, about .8s full smile and .40s exit. Other P2 uses are unchanged. Then the interaction face is released. After the bounded face intent ends, shared-input-workbench-v2 enables an explicit single-R0 context through the existing P1 idle scheduler with interactionOwned=false. It does not indefinitely impersonate an active interaction. Cancel suppresses landingP2. New grabs, explicit cancel and hidden/disposal invalidate the tail, including after body motion has already returned to rest. The host can receive new gestures throughout this resting face tail.

## Interface
Same DragController API as R4, plus release(t,{duration,cancel=false}) and interrupt(t). New mode settle; the host may regrab during settle. interrupt clears held/tail/lag without changing visibility. Source admission and face-only contracts remain in the unchanged shared runtime.

## Restore
Place at research/animation-0.1.0/drag-landing-r5 beside drag-flow-r4,drag-body-prototype-v1 and new shared-input-workbench-v2. npm test exercises pure controller; shared workbench's tests cover actual D2/full18 pointer, resource and lifecycle behavior. node replay/generate.mjs and Blender render/render_actual.py reproduce actual CPU-skinned/morphed frames; python render/compose_preview.py creates the private preview. Preview includes more than one second after the completed settling motion. No video, raw frames or cache belongs in Git.

The offline renderer reproduces the admitted D2 N3 cavity's existing linear diffuse delta using its immutable mask and the sole face owner's state. It does not write a second animation timeline. Actual browser shader/OS execution remains unverified.
