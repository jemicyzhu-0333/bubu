# Independent functional review — 2026-10-17

Scope: bounded four-limb quaternion capability, sole face writer, actual skinned surface input qualification, drag release/grounding, and same-timestamp/visibility lifecycle correctness. No main implementation files were edited by the reviewer.

Result: no remaining must-fix issue in the reviewed controlled-prototype scope at the source hashes in source-sha256.txt.

Independently executed validation:
- Drag targeted boundary tests: 6/6 passed. Covers hidden cleanup; same-time move/release and atomic rejection; elevated pre-grab ground and foreign actor rejection; frozen logical-time suspend/resume and hidden ticks; falling regrab; forged/nonfinite/topology-mismatched hit rejection.
- Petting full test suite: 17/17 passed.
- Additional actual-surface probe: real down followed by null-hit small movement during qualification now remains idle, held=false, face Basis.
- Earlier combined suite run: 30/30 passed before final input-boundary additions. It is not presented as a final full-suite count.

Issues found and fixed during review: same-time batch double submission, resume-at-frozen-time resubmission, petting same-time hiding partial mutation, pre-drag floor capture, owned/finite/topology/triangle hit validation, and pending petting qualification after lost contact.

Static inspection and earlier capability tests preserve shoulder cap 0.20 radians, hip cap 0.14 radians, face-only rest checks, immutable model position/scale, and the existing sole face writer.

Visual evidence: actual Three.js deformed world vertices rendered offline. The corrected color drag nine-frame contact sheet and petting color frames were visually inspected; no obvious torn mesh or anomalous stretching. Petting per-foot audit is nonpenetrating; maximum opposite-foot lift about 0.01372 model units is explicitly not two-foot IK. Drag independent limb motion remains visually weak (approximately 2 px, as measured by implementer) and is not artistically approved.

Exclusions: real browser/WebGL/OS integration, DOM pointer capture wiring, fixed-pointer petting contact solving, performance certification, and artistic timing/amplitude approval.
