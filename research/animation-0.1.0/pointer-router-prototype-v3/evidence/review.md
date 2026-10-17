# R4 independent CPU functional review

Controller result: passed at b76b47359f13a335a8467a1691b70148fccfde18654651e41263b491efb9a281. This supersedes the earlier slow R3 functional record for the current task; it does not confer artistic approval.

Independent cadence tests: 4/4. Additional direct probes at cycle .65/.82/1 ran 1800 steps each (240 Hz) through pickup, hover, brisk motion, recovery and hover. Every pose scalar remained finite. Actual composed quaternion angles remained below shoulder .20 / hip .14 caps, with maximum observed cap ratio 0.985245. Maximum consecutive Euler-channel step was 0.013134 radians. These numeric samples are continuity checks, not visual timing approval.

Old/new oracle: velocity, lag, lagV and pickupAt exactly matched the prior controller at every sampled step for all three cycles; release mode/deadline matched at 8.59, 8.6 and 9 seconds after release at 8 with duration .6. Fast takeover sampled at the same .2 timestamp preserved its pre-takeover pose exactly.

Pointer V3 initial restore: dependency hashes plus 21/21 tests passed independently, including yaw 10/-25 real-Raycast anchor tracking. Diff is limited to R4 import and whitelisted yaw option in addition to the previously reviewed rate pass-through. Review found and fixed a nullable yaw pre-admission validation issue. Final pointer V3 restore passed four dependency hashes and 22/22 tests independently; explicit finite validation rejects null before admission and only the normalized yawDegrees field reaches the adapter, excluding inherited pivotY. Overlay and restored pointer-host hashes match 790254e99a3da2fa10b74141911aff834d5b80ab71d200826b80a179ab5d41b8. No remaining blocker in the reviewed delta.

No rig/rest mutation, new face writer or timing slowdown was introduced by the controller delta. Review excludes live browser, WebGL, OS capture, performance, and artistic acceptance.
