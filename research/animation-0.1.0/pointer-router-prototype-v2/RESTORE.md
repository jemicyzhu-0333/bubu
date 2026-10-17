Place at research/animation-0.1.0/pointer-router-prototype-v2 beside drag-body-prototype-v1, petting-prototype-v1 and drag-cadence-r3. Restore the first two frozen packages as documented, then restore the cadence package. Install this package's pinned Three.js dependency and run npm test.

The browser workbench and tests use this revision's pointer host. That host imports DragController/smooth from drag-cadence-r3; the body adapter/runtime and base profile are still from drag-body-prototype-v1. The controller imports its approved R2 limb-pose dependency. No global clock scaling is applied.

Browser execution remains pending; evidence here is actual full18 CPU/Raycaster with fake EventTarget/capture.
