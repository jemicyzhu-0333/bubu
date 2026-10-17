# Independent sign-off: isolated sip-tea r2-clean

Date: 2026-10-17 16:32 UTC

## Disposition

Accept as a reproducible, complete **offline candidate pending visual review**. Do not admit it to the production host or describe it as a fully approved, continuously collision-free migrated action.

Exact configuration: `sip-tea-isolated-rest-chain-r2-clean`.

- Freeze: `bubu-surface-hand-experiment-v4-20261017/lifecycle/FINAL-FREEZE.json`
- Freeze SHA-256: `17fcd06c5e0557ac5cbc445b25e088d2e27d70dcdf62b90917e86cc461f9eb5d`
- Video SHA-256: `486bcae69c46109aadcaf59e0354e733deba975130b117891dd64659f036a1e7`
- Audit SHA-256: `86a8882c70106c6a2c86bead0b2a5c6198a1363fd6a2b200fe754a24287fb96d`

The rejected tilt study is not part of this sign-off. Rejected r1 cancellation/steam evidence remains historical and must not replace r2-clean.

## Independently verified

1. All 4,044 declared source/input/output/geometry hashes match the frozen manifest.
2. Full Blender audit rerun in a separate review directory is JSON-identical to the frozen audit: normal 271 samples plus nine cancellations × seven = 334 samples. All tested body/cup, actual owner face/cup, new body/face, nonadjacent body self and ceramic-inside-body counts are zero. All body coordinates finite; maximum foot discrepancy 2.84672e-8 is float32 export roundoff.
3. Nine cancellation starts match the corresponding normal(c) face path/amount and all 72 face-layer position byte arrays. The late-cancel7.5 face revival bug is fixed.
4. Normal plus all nine cancellation terminal frames return body and every face-layer byte array exactly to the initial exported rest; cupScale and handEntry are zero.
5. Six Node tests rerun and pass: normal bounds/continuity, cancellation prop/body order, reduced motion, late face release, resource disposal/idempotence.
6. Video metadata: 9.000 seconds, 30fps, 270 encoded frames. Geometry audit includes both endpoints, hence 271 normal samples. Actual clean keyframe pixels inspected; earlier static/front/side and fixed08 trajectory views reviewed separately.
7. The original admitted D2 GLB remains SHA `84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`. Review made no production source or host modifications.

## Preserved limitations / remaining admission gates

- 08 mouth-corner partial occlusion remains visually unresolved. No new face shape was approved by this review.
- Steam is disabled/pending after visual rejection; do not count it as migrated.
- Selected18-pose deformation measurements remain max edge ratio3.50418 and min area ratio.066423. The earlier proposed rest-relative quality guard is not declared passed; exact rest recovery does not prove acceptable deformation aesthetics.
- Collision evidence is discrete. It does not prove absence of intersection between samples; full-chain shared-vertex/coplanar neighbor fan checks remain incomplete.
- Offline Blender/CPU geometry evidence is not WebGL, OS interaction, or production performance evidence.
- The existing face owner is used for actual08 enter/exit; the isolated body/prop samplers consume supplied time. Future admission must preserve one logical clock, one exclusive body writer including deformation, original drag/pet asset/profile limits, and explicit resource leases/budgets. This review does not authorize adding a second owner or timer.
- V1 #27 sip-tea is the representative candidate; earlier #1/#2 are not thereby migrated.

## Evidence

Full narrative and failure bounds: `SURFACE-EXPERIMENT-REVIEW.md`, `REVIEW.md`, `SURFACE-HAND-CANDIDATES.md`.

Independent final evidence: `full-chain/r2-audit/freeze-check.json`, `result.json`, `full-audit.json`, `rest-restore-check.json`, `rerun.log`; cancellation evidence `full-chain/cancel-fix-verification.json` and historical `late-cancel-face-discontinuity.json`.

The author additionally reports a clean `/tmp` portable rebuild reproduced all4,008 position binaries and passed six tests. That portable smoke is author evidence; this review independently checked final hashes and reran geometry/tests, but did not repeat the full portable rebuild.
