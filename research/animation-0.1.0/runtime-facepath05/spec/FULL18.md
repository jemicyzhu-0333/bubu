# Full18 opt-in CPU capability candidate

2026-10-17. This extends owner08 + preparse07 without changing the seven-slot default, neutral/mechanical ceilings, pool defaults, source art, or the single-writer lifecycle. It is not a release, GPU capacity certification, transition art approval, or drag/long-press implementation.

## Explicit boundary

- Call `prepareFullFacePack`, using `fixtures/face-full18/manifest.json`. Calling the existing `prepareFacePack` on this manifest rejects it.
- Purpose/kind: `approved-full-face-paths-opt-in`; binding: `fixed-eighteen-slot-opt-in`.
- Source SHA256: `1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677`.
- Frozen profile SHA256: `1d2a1de36a5f2ead25aa0b0d64d13f1c31011410a785cf963c84b6f28e631c45`.
- Registration derives exact meanings and eight authored knot names per slot from the formal FACE-LIBRARY-CONTRACT. The separate wire schema fixes all profile content and declared asset hashes and constrains every allowed budget.
- IDs in authored target order: R0, D1, A7, D4, 01, N2, N3, T05, 07, P2, 08, A4, 04, A8, S2, S3, T5, S5. T05 is revised uneasy/braced attention; T5 is closed-eye setback/sadness. Bare 05, old r6 Face05, numeric aliases, and historical S/B/C are not admitted. Basis remains original source rest, distinct from R0.
- Director supports two exact registered source/profile pairs. Actor construction checks policy against the admitted pack before reservation or loading. Retirement rebuilds the same snapshotted policy and registered ID roster. A full18 policy cannot operate a slice7 actor or vice versa.
- `ExpressionOwner` remains the production single-writer API. No alternate timeline, new expression, gesture, random policy, or art timing was introduced.

## Measured CPU/data accounting

Encoded source 16,867,596 bytes. Preparse loaded 2,351 accessors and 2,109 unique views. View copies total 16,389,416 bytes; sparse/zero-base dense allocation 4,954,392 bytes. Conservative BIN allowance 16,867,596 yields decoded reservation 38,211,404 bytes. Input source copy is charged separately, giving 55,079,000 charged source+decoded bytes for one live source. Exact runtime geometry backing is 20,999,184 bytes; decoded accessor total 20,999,632 includes the 448-byte inverse bind accessor outside geometry.

Each actor costs 51,036 rendered vertices, 20 actor-inclusive nodes and 784,140 expanded deformation units. Eight face layers contain 5,091 vertices, each with 144 morph knots; body has 45,945 vertices and no morph targets. The deformation convention includes base vertices in addition to target-expanded face vertices. The frozen gold source contains 38,601 JSON values at depth 7; only the explicit full18 GLB parser uses its scoped 38,601-value allowance. Existing JSON and slice budgets are unchanged.

Default pool deformation budget remains 1,000,000: one full18 actor fits, a second rejects before parsing/reservation changes. Two actors were measured only with an explicit 1,568,280 deformation budget. They share one source and immutable geometries, while keeping weights and skeletons separate. Last disposal releases all ownership counters. This does not establish immediate browser heap or VRAM reclamation.

The allocation plan excludes caller-held prepared packs, parse/preflight/parity temporary arrays, JavaScript objects, skeleton arrays, renderer staging, and driver/GPU memory. It is not a process peak-memory cap. The renderer's unpadded packed morph staging estimate is 23,459,328 bytes, not measured VRAM. No full-resident-vs-bank-swap GPU comparison has been run; full residency remains an explicit CPU capability candidate rather than a replacement default.

## Evidence

- `npm test`: 277/277 tests, including all 247 prior tests plus full18 binding/admission and the owner lifecycle suite on real gold geometry.
- All 18 slots × 259 sampled intensities (257 grid samples, tiny positive, near-one), on all eight actual Three layers. Every sample is single-semantic, at most two adjacent knots; all unrelated weights clear; Basis clears all 144 weights/layer. Clone remains neutral. Captured base/morph arrays remain byte-identical throughout.
- Actual load parity compared 2,350 arrays / 5,554,845 scalars. Existing source-check records the pinned loader's 25 normalized skin scalars (max delta 5.96e-8); source GLB remains unchanged. This work does not claim the loader preserves unnormalized skin weights bit-for-bit.
- Rapid repeated all-slot interruptions, exact source and profile pairing, unknown/legacy IDs, default second-actor refusal, and one-unit-below each instance/source/decoded budget refusal.
- Full18 owner tests cover every slot, destruction during loading, late completion cleanup, draw/core errors, observer errors, freeze/retire/rebuild, stale epochs, timers, and simulated visibility/context restore. EventTarget context tests do not test real WebGL context restoration.
- `node tools/benchmark-full18.mjs`: one warmup + five measured CPU runs. Median prepare 88.11 ms, cold create/parity 217.39 ms, shared-source clone 0.95 ms, two-actor disposal 0.13 ms. Median per-run interrupt tick p50/p95/max: 11.46/17.76/256.89 microseconds. Assertions excluded from tick timer. Shared-cloud load/JIT/GC make these observations, not latency promises. Raw counts/timings: `FULL18-CPU-MEASUREMENTS.json`.

## Reproduction / packaging

Use pinned Three 0.186.1 from package-lock. `node tools/build-full-face-pack.mjs <gold.glb>` checks exact source hash and frozen profile structural/byte identity before reconstructing the portable fixture. The committed profile is a required frozen input; it is not regenerated with a different JSON serialization.

Run `npm test`, then the CPU benchmark separately. The local development `node_modules` link is dependency tooling only and MUST be excluded from archival closure; all required source, fixtures, schemas and reports are real files. No push, publication, or default-demo selection change was performed.
