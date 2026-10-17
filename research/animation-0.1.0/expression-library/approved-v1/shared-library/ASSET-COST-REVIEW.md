# Independent approved-library asset cost and fidelity check

2026-10-17. CPU/data inspection, no renderer activation or GPU measurement.

## Fixed outputs verified

- Gold: 1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677.
- Seven-slot slice: a9ae09635658ac15c55cf1571db53e284bd463eaab9a84ff24e7836270a1808e.

Independent decoder compared all 2,304 gold and 896 slice POSITION/NORMAL target arrays directly with the hash-locked approved source catalog. Missing source layers resolve to explicit zero arrays (480 gold / 224 slice comparisons). All are byte-identical after the composer fixed signed-zero preservation. There are also 231 cross-source base/index/skin-attribute comparisons per output, all byte-identical. Body appears once with zero morph targets. Source files were unchanged during comparison.

The initial composer emitted numerically identical sparse arrays but canonicalized some source negative zeros to positive zeros: 296 comparisons across the two outputs failed byte equality. Composer changed sparse row selection to raw nonzero bit patterns. The current outputs have zero byte mismatches. This fix concerns fidelity/hash correctness; it does not imply a visible shape change.

## Measured or directly counted values

| Metric | Gold18 | Slice7 |
|---|---:|---:|
| Encoded GLB bytes | 16,867,596 | 8,509,100 |
| Decoded accessor bytes | 20,999,632 | 10,247,440 |
| Morph array bytes | 17,594,496 | 6,842,304 |
| Targets per face mesh | 144 | 56 |
| Full face-layer vertices | 5,091 | 5,091 |
| Body vertices | 45,945 | 45,945 |
| Index count | 303,882 | 303,882 |
| Actual Three geometry backing bytes | not measured in this probe | 10,246,992 |
| Three packed morph staging estimate, unpadded | 23,459,328 | 9,123,072 |

Decoded accessor bytes include the 448-byte inverse-bind accessor excluded from the geometry backing figure. Geometry backing deduplicates ArrayBuffer ownership, not total application memory. Source bytes, parser/parity intermediates, JS objects, skeleton state, renderer staging and GPU allocations are separate costs.

Slice preflight reports 943 accessors, 839 bufferViews, 9 meshes, 18 nodes, 51,036 rendered vertices, 336,132 morph-expanded vertices, 2,866,909 accessor scalars and 2,915,869 decode-work scalars. The new purpose requires explicit scoped ceilings beyond neutral04's eight meshes, 768 accessor/view counts and 300,000 indices. The gold's 144 targets and larger source/accessor roster must not silently enter the seven-slot purpose.

## Sharing and runtime evidence boundaries

The full roster comprises eyes/highlights/mouth, two 257-vertex brows and one 257-vertex tongue. Old 4,834-vertex estimates excluded the tongue and are obsolete for this library. Zero influence does not remove geometry morph storage or guarantee zero shader cost.

Actual Three CPU binding was sampled 1,449 times across all seven slots, knots, intermediate values, zero, tiny positive intensity and near-one intensity. Every layer had at most two active knots belonging to the one selected path; second-clone influences stayed neutral; geometry/index/normal/skin arrays remained unchanged. This verifies immutable shared geometry and actor-local weights at CPU level, not shared GPU lifetime behavior.

Three packed estimates follow the pinned renderer's two RGBA float32 texels per position+normal morph vertex (32 bytes); they exclude width padding, driver copies and actual allocations. They are not VRAM measurements. The first runtime checkpoint keeps the seven-slot slice resident; no bank swap or residency-policy selection is inferred. A full 18-slot runtime remains a later scoped checkpoint.

## Reproduce

`compare-library.py` → `library-comparison.json`.
`binding-adversarial.mjs` → `binding-results.json`.

The Python probe reuses the independent previous GLB decoder; the Node probe uses the pinned stage Three package. Review source and exact output hashes before reuse after asset changes. Visual merged-look equivalence, transition appearance, runtime admission/lifecycle and actual browser rendering are separate gates.
