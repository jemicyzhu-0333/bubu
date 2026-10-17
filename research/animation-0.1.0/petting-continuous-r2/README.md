# Continuous petting r2

Research candidate on `12b47ac55e54dcc40d0e9b49c16bf7526bc59a94`. Latest drag landing smile tail is preserved. Final visual approval is pending.

## Acting

A qualified surface hold notices the user through approved 08, relaxes, then settles into approved P2. The controller preserves its phase and spring velocity across small contact movement. Long quiet intervals contain a restrained shoulder settling response or a small contact-directed whole-body adjustment. Approximately 32–38 seconds after qualification, one approved 08 response briefly acknowledges the user before returning to P2. Subsequent looks are sparse. Timing values are prototype tuning, not exact user requirements.

P2 .82 is still closed-eyed: it subtly changes the mouth, not eye opening. The genuine 08 response crosses the existing owner’s Basis bridge. No new face geometry or cross-path interpolation was introduced. Release softens P2 and recovers posture; an ongoing 08 response keeps its current face during recovery. Existing shared ownership cleanup returns control to the established rest/P1 policy.

The body uses the existing whole-body pivot and four approved limb joints. Hips remain neutral. Maximum shoulder target is .088 radians; no neck, squash, bone translation or scaling. Contact comes from the shared actor Raycaster. Its displayed marker is a current ray hit, not a fixed material-point constraint or hand simulation. Ground compensation does not constitute dual-foot IK.

## Reproduce

From this package: `npm test` (14 pure controller + 3 actual D2 host tests).
From sibling shared-input-workbench-v2: `node --test tests/*.test.mjs` and `node tools/verify-dependencies.mjs`.

The restored workspace must contain the baseline’s runtime-facepath05, expression-scheduler-p1, drag-body-prototype-v1, drag-landing-r5 and shared-input-workbench-v2 dependencies and their existing Three dependency installation. The only shared runtime code changes are the pet controller import and registering the six pet policy candidates.

`node tools/export-continuous.mjs` checks 63 seconds at 30 Hz using the actual shared D2 host. It exports actual CPU-skinned/morphed world vertices for separate normal-speed windows 0–5, 11–16, 31.5–37.5 and 60–63 seconds. Raw geometry, movie frames and videos are scratch outputs and excluded from publication. `continuous-support.json` contains compact numerical results.

## Validation boundary

Tests exercise real Three scene/skin/face ownership through synthetic EventTargets. Offline Blender previews render those exact exported vertices with source materials/colors. Browser WebGL, compiled GLSL and OS capture have not been verified here. Input capture plumbing is shared baseline code; numerical tests do not prove browser delivery behavior. Long-duration numerical coverage and four short previews do not constitute a continuous 63-second rendered recording.
