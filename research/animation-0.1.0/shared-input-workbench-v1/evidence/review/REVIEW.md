# Shared D2 + fixed body + pointer input review

Result: acceptable for committing this bounded CPU/API integration. No remaining blocking correctness issue found in reviewed scope. This is not GPU shader compilation, rendered appearance, browser input or complete product integration approval.

## Evidence
- Independently reran runtime 333/333, P1 26/26 and shared input 52/52 tests. Shared suite verifies pinned controller/profile dependencies before execution.
- Independent body-boundary probe confirms ordinary face-only actor remains exact rest; body capability is weighted-only and opt-in; shoulder 0.19 rad accepted / 0.201 rejected; hip 0.141 rejected; translations and other bones rejected. Two actors keep private transforms/materials and share prepared geometry safely.
- Independent D2 probe: 630 samples across all 18 faces and lifecycle/intensity points; N3-only gate, other faces/Basis zero, retirement zero, independent uniforms, last-source geometry and private-material disposal exactly once. Decoded reservation remains 40,685,900 bytes per cached source. These are ownership counters, not GC/GPU measurements.
- Shared suite exercises actual Three Raycaster on loaded geometry, r4 cadence passthrough, pet qualification, capture failure/outside release, visibility/blur, same-time input grouping, one weighted face owner with shared time, D2 gate/body coexistence, invalid/null yaw and inherited pivot isolation. No second face writer was introduced.

## Blocking defect found and resolved
Initial RAF registration failure after admission rejected construction without releasing owner/pool/listeners. Independent before probe showed one active actor, one cache entry, 40,685,900 decoded bytes and 11 listeners retained. Implementer added failure cleanup around admission/body setup, all subsequent initialization and registration, plus best-effort disposal and scheduled-frame fail-stop. Independent same probe now reports actor/cache/decoded zero and zero listeners. Both before/after evidence are retained.

## Capability boundary
Only the fixed four-bone quaternion profile is admitted for weighted original-full18 or D2 packs. Position/scale and unrelated rest invariants remain strict. Arbitrary skeleton permission is not exposed. D2 source/profile/hash pairing, pre-cache mouth clone/mask accounting and per-actor shader state retain prior reviewed behavior. Geometry and material references are intentionally shared/private respectively; retaining disposed external handles is not a promise of GC collection.

The host is an explicitly selected full18/D2 prototype. It does not certify live Electron/browser event delivery, GPU shader compile, visual quality, app state coordinator wiring or arbitrary scene body clips. Existing user-approved model remains selected by explicit variant, with no fallback to a different model on admission failure.

## Locks
REVIEWED-SHA256SUMS locks code, tests, manifests and controller dependencies inspected/retested. Key source hashes:
- pointer-host: 15254bc5bbe2b16a049eb5f028133720c74ecd44530812ac12565ace0285e2f0
- host-admission: b6ced1190f1f433f52b35e289537c93e898f1b73bf5d0907c44ba0ad8ba10304

Probe files and raw test outputs are colocated. No implementer source was edited by this review.

Final implementer SOURCE-SHA256SUMS independently checked: all 12 entries match candidate. Manifest SHA256: 81679912e2fad75a6916d600f4d0e44ced8f2f827dc81b907b0b7c9be4472333. Publication physical-restore test is an additional implementer check, not represented as independently rerun here.
