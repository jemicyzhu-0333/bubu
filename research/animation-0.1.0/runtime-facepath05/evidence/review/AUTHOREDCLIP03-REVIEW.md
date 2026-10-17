# Authoredclip03 independent review

Target: bubu-runtime-0.1.0-authoredclip03-20261016. Mechanics only. No frozen art changes, final interaction activation, renderer/GPU execution, user-device access or publishing performed by this reviewer.

## Contract and implementation

Independent joint/accessory key timings; STEP right-continuous absolute-time comparisons; LINEAR shortest-arc quaternion interpolation; explicit entry bridge before authored phase; end holds final key and clears active track reference; cancel wins equal-time events; same-priority play/playClip uses insertion order. Entry/interruption C0 is distinct from STEP's intended jumps and does not claim C1/contact continuity. Unknown/root/face/plugin tracks are rejected. Existing target primitive remains a separate internal primitive, not a V1 runtime route.

## Issues found and repaired

1. Exact minimum 0.0001-second key gap was spuriously rejected for duration .02 and phases .01/.015 because floating subtraction gave .00009999999999999999. Validator now uses a phase/duration-scaled roundoff allowance. Sampling key boundaries retain exact canonical comparisons with no epsilon. Independent minimum-gap positive and sub-threshold negative probes pass.
2. Existing target primitive accepted near-unit quaternion norm1.000005 without normalizing it. When interrupted by a clip, endpoint-copy kept the exact event value, but the next arbitrarily small time normalized it: ~4.984e-6 component jump, violating limiting C0. All target plans now normalize/canonicalize and cap validation checks normalized angles. Same reproduction now has norm1 at entry and ~6.38e-13 change for dt1e-12. See clip03-entry-normalization.mjs / clip03-entry-normalization-rerun.json.

## Independent verification

- Latest full suite: 79 passed, 0 failed/skipped (`clip03-final-tests.txt`).
- 10 malformed categories independently rejected: duplicate/descending/nonfinite times, near-zero/nonfinite/nonunit quaternions, cap violations, duplicate/unknown targets, below-minimum gaps.
- 104 hand-computed axis-angle samples through actual QuaternionLane for STEP/LINEAR, decimal boundaries, sign-equivalent quaternions and clocks 0, .12345, 1e6, 999999980. Exact ends hold and drop active references.
- Existing suite independently covers actual prepared assets, world-matrix interruption, 24/30/60/120/144 Hz and skipped clips, .02-second minimum clip/entry, mixed play/playClip ordering, per-actor scalar/shared source budgets and disposal.

## CPU measurement review and independent run

Actual pipeline: preparePack → ActorPool → GLTFLoader/createSuite → clip event/sampling → disposal. Nine cases: small fixture / medium / large crossed with mixed, STEP-only and LINEAR-only tracks. One and four actors, two measured lifecycle runs in this independent run. Each uses 4 timed batches ×128 group ticks; event samples24; individual samples64. Warmups and raw samples are retained.

Both medium/large ceiling cases have 2048 keys/10240 scalars over 16 tracks, encoded in108250–108282 bytes (below128KiB). These hit the key ceiling, NOT the maximum72 active-track ceiling. Do not describe them as the worst possible admitted clip.

Source/dependency/fixture fingerprints unchanged during measurement. Every tested reservation/cache balance returned to zero, repeated disposal held, and normal CPU SkinnedMesh.getVertexPosition calls were zero.

Large four-actor examples from this run:
- STEP: active group-tick batch-mean median0.0518ms; separately bracketed individual group-call p95 0.1039ms.
- LINEAR: active group-tick batch-mean median0.1041ms; individual group-call p95 0.1265ms.

These are CPU observations under shared scheduling/JIT/GC and measured timer overhead. Group means four sequential actors. Batch-mean percentiles are not individual tick tails. No inference to FPS, GPU skinning/morphing, VRAM, native power or end-to-end input latency. O(nodes) matrix updates remain. Load/clone/event entry/bridge/end/jump/dispose are measured separately.

Evidence: clip03-independent-cpu.json (raw), clip03-independent-cpu.md (generated summary), clip03-reviewed-source-sha256.txt. Reproduction command:
node tools/benchmark-authored-clips.mjs --runs 2 --batches 4 --ticks 128 --warmupTicks 128 --eventSamples 24 --individualSamples 64 --out evidence/review/clip03-independent-cpu.json

## Decision and remaining gates

No remaining blocking defect found within the tested authored mechanical-clip scope. Maximum72-track performance, real WebGL/GPU/browser recovery, retargeting, artistic choreography/face library and final long-press/drag behavior are not established by this pass.

Fingerprint clarification: clip03-measured-source-sha256.txt records the exact files used by this reviewer's independent measurement (also embedded before/after in raw JSON). clip03-reviewed-source-sha256.txt records the latest reviewed source. After the measured run, only the benchmark/report harness changed to add STEP changed-state ratios and remove an environment-specific import path; runtime src files remained unchanged. The independent run's numbers belong to its embedded/measured fingerprints, not the later harness revision.

Final producer-data review: evidence/authored-clip-cpu.json and authored-clip-cpu-summary.md verified against current files. Fingerprint 6949cec44dac2c33f6f392a3206a5055ecfa78fd4aa57bc013f137060368b9fa matches before/after, no file mismatch. Nine cases, 54 measured lifecycle runs, all ownership balances zero, zero CPU skinned-vertex reads. Large four-actor batch-mean median STEP0.047604ms / LINEAR0.096468ms. Changed actor-tick ratios21.09% /99.95% are explicitly disclosed: STEP skips many matrix updates, so this is not an equal-work interpolation-instruction comparison. Separate72-active-track ceiling remains explicitly unmeasured. Final documentation and data closure accepted within the stated CPU/mechanical scope.

Portable-copy note: the independent JSON environment import path was replaced with its package-relative description. Timings, counts, source/dependency hashes and all raw samples are unchanged. The prior measured harness revision is identified by fingerprint; current reproduction uses the reviewed harness and will yield new observations.
