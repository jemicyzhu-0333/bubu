> **Archived research snapshot with a known initialization cleanup defect.** Its 22 CPU tests did not cover failed initial RAF request / listener registration. Such a failure can leave an admitted actor/cache/listeners allocated. Use [shared-input-workbench-v1](../shared-input-workbench-v1/README.md) for the maintained full18 or explicit D2 research input chain, including fail-stop cleanup. See [KNOWN-ISSUES.md](KNOWN-ISSUES.md). This does not imply production src integration or browser/WebGL acceptance.

# Shared DOM pointer router, continuous-flow integration

One admitted full18 ActorPool actor, one WeightedExpressionOwner/face timeline, one BodyRigAdapter writer. Uses the new drag-flow-r4 controller with the user-approved R2 opposed-limb poses and the frozen petting pure controller; does not compose their incompatible host shells or modify those packages.

## API

Browser: import createPointerHost from src/pointer-host.mjs and supply {target, camera, profile, readPack, windowTarget, documentTarget, scheduler?, dragPixels?, qualifySec?, dragOptions?, bodyOptions?}. readPack is the admitted runtime's bounded browserPackReader, not an arbitrary hit/eligible callback. Node CPU tests use src/fixture-host.mjs, which supplies localPackReader separately; there is no Node import in the browser entry's dependency graph.

The returned owner/pool/body are exposed for scene attachment, inspection and resource accounting. Treat their writers as router-owned: do not call owner.completeBatch or body.applyPose from another controller. Attach body.root to your Three.js scene. dispose() releases the shared actor/pool, callbacks, listeners and capture. frame(t) is provided for controlled hosts/tests; do not drive a second clock alongside the default RAF scheduler.

scheduler.now(), request(callback) callback time and frame(t) use one monotonic clock in seconds. The default converts performance.now/RAF milliseconds. DOM event timeStamp is deliberately not mixed into that clock; events are sampled at receipt and queued. At each frame, all available equal-time events are processed before one face-owner batch. Ordinary events at/before sealed time reject before queue/body/controller mutation. A matching sealed up/cancel/lostcapture instead performs an explicit synchronous lifecycle retirement at the current time, with no epsilon timestamp. Such stale terminal events reset safely rather than animate an obsolete drop. Window blur, visibility hidden and disposal clear input and capture immediately, including queued-but-unprocessed down events; resume cannot resurrect them.

## Continuous-flow integration

The browser workbench imports this revision of pointer-host.mjs, which imports drag-flow-r4 rather than the frozen v1 controller. The original body-poses profile remains unchanged: the cadence controller owns and imports the approved R2 A/B poses. dragOptions is passed through to the controller constructor without reinterpretation. struggleCycleSeconds defaults to .82 and supports .65–1 seconds (implementation prototype values, not exact user-specified timings). The confirmed intent is continuous light, quick airborne struggle, real drag inertia, return to continuous struggle after stopping, and natural release. The earlier 2.4-second paused cadence was superseded. Only the airborne struggle implementation changes; pickup, velocity classification, real pointer tracking, inertia and height-dependent release retain unscaled monotonic seconds. The router still passes one height-derived release duration to both pose and landing-position paths.

An integration regression compares the router pose at 2 seconds to the new controller with a .75-second setting, asserts it differs from the .82-second setting, and verifies wall/controller clocks have not been scaled. Original 17 functional tests remain required.

bodyOptions accepts only yawDegrees within [-180,180]. The adapter default remains 52 degrees; this workbench explicitly selects 10 degrees to match the near-front R4 preview. This is adjustable presentation orientation, not a motion-clock or production-default change. Tests raycast the actual transformed skin at multiple yaw values and verify the same barycentric contact follows the camera-plane pointer.

## Gesture and coordinate contracts

- Only primary, button-zero down can start, and only a real camera Raycaster hit on this actor's owned skinned mesh. No caller-supplied eligible, hit, or ray is accepted by the DOM adapter.
- Any body surface may start pending drag; long-press additionally requires local skin y in [1.2,1.65]. The head region is rechecked while qualifying and throughout petting. Pointerleave while pending cancels even if captured. Below threshold, losing petting surface contact cancels.
- Movement greater than 8 CSS pixels enters drag from pending or any petting phase. Petting qualifies at .4 seconds. The fixture face intent refreshes its lifetime every 20 seconds to stay live under the 30-second candidate hold, including large foreground time gaps. Those values, head region and all artistic choices remain prototype fixtures, not product defaults or art approval.
- Capture is requested for the active pointer. Other pointer IDs and nonprimary/right-button down cannot steal it. Capture acquisition/release exceptions are caught, and uncaptured leave or window up cancels/releases safely. Real OS capture success is not certified by CPU tests.
- Captured drag can leave both the skin and canvas. CSS client coordinates map using current getBoundingClientRect to NDC, then a camera ray intersects the original contact plane. Actual barycentric skin contact anchors the actor. clientY is inverted only for the drag controller's world-up motion intent. Rendering DPR/backbuffer dimensions never affect thresholds or ray mapping.
- Petting-to-drag body pose is blended over .22 seconds. Final move/up position is applied before recording landing height. Release preserves horizontal location and returns sole minimum smoothly to pregrab ground. A landing gesture currently ignores new down until finished.
- CSS resize is read per ray; camera/projection updates remain the renderer's responsibility. Workbench updates camera and renderer together. For touch hosts, set touch-action:none on target. Transformed/rotated CSS canvases and cross-document frames are outside this prototype's mapping contract.

## Verification

Run node --test tests/pointer.test.mjs. Tests use fake EventTarget/capture/scheduler and actual admitted full18 mesh, real Three Raycaster, real controller/body/owner writes. Tests cover batching/final release location, forged eligibility refusal, pointer isolation, capture errors, all terminal lifecycle paths, long-press/drag handoff, continuous contact loss, resize/DPR independence and complete disposal. Independent review found a same-time final-move loss, fixed with release-before-snapshot application and position assertions.

workbench.html is a small runnable browser integration entry using the bounded browserPackReader; it has NOT been browser-executed. No browser socket workaround, user-computer operation, deployment, WebGL/OS end-to-end test, performance certification, fixed-contact IK certification or final artistic acceptance is claimed. Full-mesh foot sampling is correctness-first and may be expensive.

## Backup

Only source, tests, README, small evidence and pinned restore metadata belong in Git. Do not include node_modules, videos, frames or large geometry exports. Publication overlay uses sibling drag-body-prototype-v1 and petting-prototype-v1; restore those first.
