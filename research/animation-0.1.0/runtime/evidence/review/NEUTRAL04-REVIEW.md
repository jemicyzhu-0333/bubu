# Independent neutral04 review closure

Reviewed stage: bubu-runtime-0.1.0-neutral04-20261016. 2026-10-16. No unresolved blocking finding in the tested neutral-only scope.

## Found and resolved

Initial art parser ceiling of 200,000 indices rejected approved r6: body accessor 392 has 275,658 indices; the complete asset has 299,850. Reported with an exact-source reproducer. Independently scoped art ceiling is now 300,000; mechanical limits were not raised by this fix. Exact r6 regression passes.

## Independent regression

- Current suite: 120 passed, zero skipped/failed.
- 16 parser cases: exact r6; extra unreferenced bytes; unknown extension/material fields; active morph weights; duplicate scene roots; lowered scalar/backing budgets; sparse duplicate/descending/out-of-range/invalid-type indices, missing-base offset, excessive count, nonfinite sparse overlay and alignment. Evidence includes rejection messages, preventing unrelated early failures from masquerading as sparse coverage.
- Eight lifecycle scenarios: static05/r6 concurrent shared-source actors; r6 skeleton/bone independence; repeated disposal; abort during creation; pool disposal during creation; one aborted waiter while another completes; pending admission; pre-parse decoded budget; mixed mechanical and neutral actors sharing admission. Tested ownership counters and references return to zero.
- Four neutral-demo VM windows: preparation/creation pending, followed by disposal/pagehide. Zero late actors attached; stale created candidates disposed exactly once. This is simulated lifecycle, not browser/WebGL execution.
- r6 source comparison: 483 array comparisons including repeated references by mesh; 25 normalized weight scalars, maximum difference 5.960464477539063e-8. Actual geometry backing 8,044,044 bytes; conservative backing reservation 16,200,432 bytes. Static05 backing 2,337,048 bytes. Numeric parity treats +0/-0 as equal. Source hash locking and offline extraction byte equality are separate guarantees.
- Final disposal closure release/nulling change was included in lifecycle, full-suite and CPU reruns.

## Architecture and boundaries

Fixed hash allowlist admits only static05/r6; readiness cannot activate expressions or motion. No play/enqueue/clip/face API. Returned scene is explicitly a trusted rendering handle, not a hostile-caller sandbox. Every clone asserts source rest transforms and zero morph weights. COLOR_0 vertex-color activation and allowed material extensions are checked. Sparse work and full dense allocations are bounded before decoding. Active/pending actors share one admission domain with unique source and decoded reservations.

Geometry backing accounting excludes caller-held prepared bytes, temporary parity arrays, JS objects, per-actor skeleton state and renderer staging/GPU resources. Do not call it a total memory ceiling. No face-bank residency policy or expression/contact/IK/drag/gaze approval follows from this neutral diagnostic. Browser/GPU appearance and performance remain unverified.

## Independent CPU rerun

Producer harness run independently to a separate output, one warmup plus five measured runs per asset/count. Source fingerprints match before/after and current files. Zero getVertexPosition calls. Static advance is a no-op, not render performance. Prepare includes disk read/snapshot/hash/preflight/profile checks; standalone preflight is a separate measurement, not an additional cost to add. Cold create includes full source parity and first clone. Four-actor cached group means three additional clones; one-actor group is empty. Cloud noise and no forced GC apply. Cold verification is material work; no stall-free/FPS/GPU inference.

Median milliseconds:

| Asset | Actors | Preflight | Prepare | Cold create | Cached clone group | Dispose group |
|---|---:|---:|---:|---:|---:|---:|
| static05 | 1 | 11.141 | 18.588 | 21.704 | 0.001 | 0.075 |
| static05 | 4 | 5.361 | 14.758 | 18.311 | 0.466 | 0.045 |
| r6 | 1 | 24.117 | 43.801 | 102.275 | 0.000 | 0.051 |
| r6 | 4 | 28.470 | 46.823 | 134.548 | 1.592 | 0.100 |

## Evidence

parser-adversarial.mjs / parser-results.json; lifecycle.mjs / lifecycle-results.json; demo-race.mjs / demo-race-results.json; full-tests.tap; independent-cpu.json; reviewed-source.sha256.

SHA-256 of reviewed src/tools/fixtures checksum listing: 3d1d984837c23174077335ae21cc0c0b682cce0b5a715a1c8b69f59efc236758

Portable reproducer copies rename paths only: neutral04-parser.mjs, neutral04-lifecycle.mjs, neutral04-demo-race.mjs. They use this package's bundled fixed source and current runtime. Their separate rerun outputs are also archived. Original independent source fingerprint listing is retained unchanged.
