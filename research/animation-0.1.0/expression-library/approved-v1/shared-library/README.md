# Bubu approved static expression library v1

The user approved the actual eighteen-slot 3D overview on 2026-10-17 at 04:18 UTC: “通过 可以继续推进” (Sentinel_fa6cf24f4da88191b7c704f6355aa0a0). The approval applies to the reviewed static looks. Their single-face intensity paths also passed independent technical/visual review; this does not claim the user individually reviewed every intermediate frame. Historical candidate records remain unchanged. It does not imply acceptance of new animation timing, direct cross-face mixing, independent gaze, or engine integration.

## Files and recovery

- `bubu-expression-library-v1.glb`: shared body, rig, eight face layers, eighteen current semantic states / 144 authored knots per face layer. Canonical float32 POSITION and NORMAL arrays preserve every source bit, including signed zero.
- `bubu-expression-slice7.glb`: the same base and layers with only 04, N3, A7, 07, S5, R0, N2 (56 knots). This bounded representative integration subset does not claim all eighteen states are runtime-resident.
- `bubu-expression-library-v1-look.blend.gz`: complete editable Blender4.3.2 authoring scene with all current keys, frozen lights/materials/camera. This includes the source model; a second duplicate model-only .blend is unnecessary.
- `library-arrays.npz`, `library-array-spec.json`, `compose_gold.py`, `glb_io.py`: self-contained byte-exact reconstruction inputs. `python compose_gold.py --rebuild` uses these local arrays, not the old workspace paths.
- `restore_library.py`: verifies the backup manifest, rebuilds both GLBs into an independent output directory, restores the full look. Optional `--render-smoke` renders the neutral front and compares pixels to the supplied reference. Requires local Python3/numpy; the render check also needs Blender4.3.2 and Pillow. No network/install step.
- `face_library.py`: sole static mapper oracle. Full eight-layer clearing and one current semantic face at a time are mandatory. `FACE-LIBRARY-CONTRACT.json` and `EXACT-METADATA.json` define the complete boundary.

## Important distinctions

- All-zero Basis retains the historical small O mouth. R0 is an explicit short-horizontal-mouth state; it does not silently replace Basis.
- T05 is the newly corrected full-round-eye, small horizontal-open-mouth face. T5 is the closed-eye sadness state. Bare `05`, superseded `Face05`, old Surprise/Blink/Content targets are excluded from this formal current library, while their original archives remain intact.
- White caps are attached highlights. They are not pupils and do not provide a gaze channel.
- Adjacent knots within one semantic path may interpolate. Simultaneously adding two semantic states is forbidden. A temporal controller may use a completely cleared Basis bridge only under separate visual review; the small O bridge can read as a flash even when geometry is valid.
- Absent source brow/tongue layers are explicitly filled with zero deltas at the common hidden Basis. Zero-area fully collapsed hidden layers and the precisely recorded source highlight-pole exceptions are intentional, narrowly scoped conditions.
- Eighteen slots are not eighteen wholly independent emotions. D1/A4 are adjacent states; T5/S5 are two sadness states; D4 is a yawn passage; S2 needs context to imply a request. Shyness and the unresolved awake-but-sleepy exploration are outside this release.

## Scope of verification

Source-to-output audits compare body/base attributes, topology, source morph POSITION/NORMAL, materials, hierarchy, bone rest and inverse bind. Authoring renders use the exact source look and camera, independently checking all eighteen endpoints in four views, neutral in four views, and seven representative half-intensity states. Original source batches contain the denser approved path and attachment checks. Render evidence is Blender offscreen, not a claim of live WebGL behavior.

The complete merged GLB intentionally exceeds the old neutral-only runtime budget. Do not globally relax parser limits or allocate every morph target on the GPU solely because the archive is valid. The representative slice is for a separately bounded integration gate.
