# R2 controller integration contract (frozen controller dependency)

Baseline router functionality is the frozen pointer-router-prototype-v1 on branch head 5ba731e. No phase, pose, classifier or motion amplitude is implemented in this router revision. It imports the drag author's new controller and use the unchanged base profile and controller-owned approved pose dependency for the DOM workbench and CPU tests.

Required controller exports/API:
- DragController and smooth
- constructor(profile, optional author-owned rate configuration)
- begin(time, DIP), move(time, DIP), release(time, {duration}), advance(time)
- snapshot() with pose and faceIntent; time and mode fields
- suspend(time), resume(time), dispose()

Router uses unscaled monotonic seconds. Thresholds remain CSS DIP. Gesture classification, direct camera-plane tracking, pickup, idle struggle, inertia and release are not globally time-scaled.

Release duration must be shared by the controller's release pose and router's ground-height curve. Current host computes the height-dependent duration and passes it explicitly. Any author-owned release-rate helper must be applied exactly once before both consumers use the duration.

Acceptance: original 17 functional tests, a new-controller/profile provenance assertion, author-provided rate-config pass-through verification, and publication restore tests. HTML browser execution remains unperformed unless separately authorized and successfully run.
