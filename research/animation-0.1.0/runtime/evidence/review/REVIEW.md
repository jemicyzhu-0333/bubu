# Independent implementation review and regression

2026-10-16. Target: bubu-runtime-0.1.0-20261016. Read-only review, independent scripts stored separately. No art activation, user computer, WebGL fallback, upload, or source edits.

## Defects reproduced, repaired and independently retested

- Accessor alias CPU amplification: ~407 KB GLB, 100 aliases, 10 million scalar reads, 927 ms local preflight. Now scalar budgets reject 20/100 aliases before scan; one scalar buffer ~5 ms. Shared DataView avoids per-value allocation.
- Unbounded/default morph influence, fractional buffer length, repeated scene roots: originally accepted, now rejected with typed errors. Node-name object and duplicate name rejected.
- A skinned body accepted as rigid accessory: produced four cloned skeleton objects and disposed two twice. Now rejected as unsupported before instantiation; disposal uses global uniqueness.
- Asset-definition budgets understated repeated node/equipment instances: implementation tests now cover and reject budget bypasses. Audits separate definition and instance budgets.
- Local package symlink escaped package boundary to reviewer-owned harmless text: now PATH rejection after realpath.
- Browser reader follows redirects: changed to redirect:error (source verified; not a live browser/network test).

Reproductions: glb-adversarial.mjs, instance-budget-probes.mjs. Original and rerun JSON files retain findings. These mutate in-memory fixtures and reviewer-owned files only.

## Independent successful runtime checks

runtime-independent.mjs loads real mechanical GLB, profile, motion and accessory using actual runtime:

- Exactly equal sampled state at 0.51 seconds with 24/30/60/120/144 Hz and one large jump, including multiple path interrupts and cancellation.
- Two actors share immutable assets but retain separate skeleton and morph state; releasing one does not break the other.
- Equal-time cancellation wins, old queued plays invalidate, past-time enqueue rejects.
- Cache tests: cancel only pending waiter then late success disposes once; cancel one shared waiter preserves sibling; failed loads evict and retry succeeds; repeated release is idempotent.
- 30/30 implementation tests independently rerun successfully, including world-transform interrupt continuity, single-face simplex and rigid slot composition.

## CPU performance evidence

50,000 actual mechanical-fixture advance calls after warmup, batch timing. 148 submitted vertices, 164 derived vertex/morph elements. First run median batch-per-tick 0.00272 ms, p95 0.00346 ms; subsequent run 0.00307/0.00553 ms. Normal tick CPU vertex-read count exactly zero. These are Node CPU timings, not GPU, WebGL FPS, native input latency, RSS allocation or production-bubu performance. Batch quantiles are NOT per-frame latency percentiles. Do not claim a speedup against old 45,945-vertex model because workload differs.

## Last open lifecycle probe

DemandLoop.draw can synchronously dispose the loop; run then schedules a new RAF/timer because stopped is not rechecked after draw. Reproduced with scheduler-independent.mjs: stopped=true, frame=2. Reported to implementer; awaiting fix and rerun. No other blocking finding in tested mechanics-only scope at this checkpoint.

## Explicit remaining limits

Browser WebGL/GPU/render lifecycle and context loss not exercised. No texture/image support. No contact/IK/cloth/LOD or final long-press/drag approval. Pure mechanical correctness does not approve artistic face timing or asset production fitness. Dependency lock pins Three 0.186.1; no runtime V1 import path observed.

## Closure update, 18:48 UTC

- Demand-loop post-draw stopped check fixed and independently rerun: no second RAF/timer survives disposal. `scheduler-rerun.json` records frame=null.
- Demo async create/dispose race independently reproduced using the actual demo source under mocked browser lifecycle: dispose during pending prepare previously added an actor after cancellation. Generation ownership and AbortController now prevent resurrection; `demo-race-rerun.json` reports zero added actors. This is a VM lifecycle test, NOT WebGL evidence.
- Final implementation suite independently run: **34 passed, 0 failed, 0 skipped**, log `final-tests.log`.
- No remaining blocking defect found within this mechanics-only, CPU-tested scope. Review is not certification against all malformed inputs and does not waive browser/native/GPU, art-library or final interaction gates.

## Portable evidence copy

This package includes portable runtime/cache/scheduler/demo reproduction scripts. The earlier malformed-GLB and instance-budget cases are represented by the packaged contracts tests; original external scratch paths are not needed. The post-review source layout changed whitespace/comments only, verified by token equivalence and a fresh 34-test run.
