# Shared full18/D2 input workbench: short landing tail

Current maintained shared input entry: `shared-input-workbench-v2/workbench.html` and `src/d2-pointer-host.mjs`. The previous `shared-input-workbench-v1` and older pointer-router revisions are historical baselines. Keep them for reproducibility; do not use them as the current landing integration. Only this frozen V2 contains the reviewed rest-idle hidden invalidation fix.

Smile-tail update based on 1325d43 shared-input-workbench-v2 with its initialization/runtime/disposal cleanup, explicit D2/full18 admission, shared body capability and face-only protections intact. Imports drag-landing-r5, which preserves the accepted R4 held struggle and inertia; this host does not duplicate phases or time-scale motion.

## Landing behavior

Pointer release keeps the existing height-derived descent duration and the same ground/xz placement curve. The controller then reports a .48-second grounded settle; host mode remains landing until it reaches rest. A normal release uses the isolated landingP2 policy key (approved P2 face, .10 enter/.40 exit) from contact until contact + .90 seconds. The body still finishes its settle at +.48 seconds; the remaining bounded smile does not slow body movement. Cancellation has no blink.

A new actual-raycast grab is allowed during settle and body rest, but not during descent. It interrupts the old controller tail, keeps the original ground, releases the prior face intent in the same batch, and blends the small body remainder for .12 seconds before ordinary pending/petting/drag recognition. Hidden/blur/dispose invalidate immediately. Capture errors, late events and all previous cleanup rules remain active.

## Explicit idle handoff, not permanent interaction ownership

When the bounded landing smile expires (or immediately after a canceled landing finishes settling), the host releases its interaction request and supplies context=rest, enabled=true, interactionOwned=false. The existing P1 scheduler then chooses the new restR0 candidate (approved R0 face) under its existing p1_idle priority. This uses the same actor, director, face timeline and body writer. No new owner, timeline, runtime bypass or permanent interaction R0 refresh is created.

Only this research workbench policy adds landingP2 and restR0; the original 18 candidates, including ordinary petting P2/R0, are unchanged. Both new gap values are the existing scheduler's legal minimum .001 seconds, not zero and not an invented event timestamp. Initial idle remains none/disabled. A valid new gesture or hidden state clears the rest context. A brief genuine Basis bridge between expression exits and P1 idle entry may exist; it is not cut from the preview or claimed absent without evidence.

The owner-level takeover test exercises the existing director contract after interaction has been returned. It is not a completed scene UI or external scene-routing integration. Actual new gesture/context interruption and hidden cleanup are tested end to end through this CPU host.

## API and model

createPointerHost accepts target, camera, profile, readPack, modelVariant, scheduler, dragOptions and bounded bodyOptions.yawDegrees. createD2PointerHost is the explicit D2 entry used by workbench.html. D2 pack, policy hashes and canonical runtime are admitted together. bodyOptions forwards only validated yaw; the default remains 52 degrees and the workbench selects 10. The held struggle option stays at the accepted R4 prototype default .82 seconds; pickup, tracking, inertia and landing use unscaled seconds.

DOM samples CSS client coordinates, maps through the current bounding rect/camera and raycasts the actor's actual skinned mesh. Captured dragging retains the skin anchor outside the canvas. No caller eligibility is accepted. Equal-time input is collected before one face-owner batch. Late ordinary events reject atomically; terminal lifecycle events retire safely without epsilon timestamps.

## Verification boundary

npm test validates pinned dependencies and runs the inherited and added CPU suites: full18/D2 admission, face-only body protections, shared geometry/private materials, actual Raycaster/skin anchor, lifecycle and init failures, grounded settle, cancellation, regrab, 30/60/120 Hz settle snapshots, existing P1 idle handoff and no tail revival. Tests use fake EventTarget/capture/scheduler with actual admitted models.

This is not browser, compiled GLSL, WebGL, OS capture, performance or final artistic acceptance. The workbench HTML is an integration entry, not browser execution evidence. Full-mesh ground sampling remains correctness-first.

## Frozen verification

Initial R5 physical sibling-layout restore: 59/59 tests and 15 dependency hashes passed. The subsequent smile-tail delta passed a full 62/62 suite and 15 pinned dependency hashes; see evidence/smile-tail-tests.log. Independent review separately ran the prior 58-test suite plus five final-delta tests and actual D2 30/60/120 Hz long-tail/hidden probes. See evidence/restore-test.log and evidence/independent/REVIEW.md.

## Bounded smile-tail delta

The current V2 keeps the interaction face through body rest only until the controller’s absolute contact + .90 deadline. On the next frame at or after this deadline, it releases interaction and enables the existing P1 rest context. landingP2 exit is .40 seconds; ordinary P2 remains unchanged. Actual new grab clears the tail before pending recognition; hidden clears the tail immediately. A long frame gap cannot restart or extend the deadline. The body settle, held struggle, inertia, descent and ground placement are unchanged.
