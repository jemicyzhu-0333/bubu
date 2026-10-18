# Original-source hybrid geometry

## Selected asset

`bubu-hybrid-binding.glb`

SHA256: `52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67`

Five meshes: body and feet reuse original skin weights and the current actor's original skeleton; hands remain rigid with the previously verified hidden collars/caps. The eight original facial meshes remain on the source actor and are not included here. No foot collar, artificial sole cap, or new foot bridge is used.

### Why this binding

The earlier rigid-foot masks contained 4,440/4,470 vertices, but only 1,406/1,402 were fully hip-bound sole vertices. Treating thousands of mixed-weight upper-root vertices as rigid produced visible cuff artifacts. Native skinning reuses the original established transition instead of redesigning it. All source foot positions, normals, colors, joint indices and weights are exact; the 230/232 shared body-foot boundary vertices also match exactly.

The body has only the selected hand-root CDT repair. Its 469 new cap-interior vertices bind to Body. Original shoulder influence is redirected to Body only above Y=0.43, outside original hip influence, to avoid moving the repaired hand sockets. The full hand geometry, including hidden roots, matches the earlier tested asset byte-for-byte.

## Storage-only compaction lineage

The runtime-validated uncompressed-layout reference was SHA256 `361a9fa6b425c52d16cd3e0ebe16579db3be63a9e762b52a5ddbec2c8018bf4c`, 20,345,416 bytes. Its GLB retained orphaned source face/morph buffer data. The shipped compact asset is 3,540,376 bytes: 26 referenced accessors, 26 buffer views and one material, instead of 2,377/2,135/four. No lossy compression, quantization, geometry editing, binding change or index reordering was applied.

`compact-equivalence.json` verifies every referenced position/normal/color/skin/index array's dtype, shape and raw bytes; node/scene values and referenced material values are unchanged. Source vertex mappings remain unchanged. The source-only builder now emits this compact layout directly, and it was reproduced from an unrelated working directory.

Original runtime evidence retains its original 361… reference hash. It must not be relabeled as if the compact file were the bytes originally exercised. Compaction equivalence plus separate compact cold-load checks establish the relationship; consult runtime evidence for those checks.

## Runtime binding

See `binding-manifest.json` for mesh names, source vertex maps and binding details.

- Build native `SkinnedMesh` instances for `Bubu_body`, `Bubu_foot-left` and `Bubu_foot-right` using geometry `skinIndex`/`skinWeight`.
- Bind them to **this actor's** original source Skeleton and bind matrices/mode. Do not reuse another actor's skeleton or renormalize the original weights.
- The asset intentionally contains skin attributes but no template skeleton binding. Runtime owns that binding.
- Hands use the established rigid matrices. Keep original source faces and face behavior.
- Mesh boundaries are intentional; the assembled surface is closed. Do not require each skinned component to be individually closed.

## Reproduce from the existing repository source

Required: Python 3.12, NumPy, SciPy, and Blender 4.3.2 available as `blender` on PATH. The recorded exact versions are in `build-environment.json`. No package installation or network access is performed by the tools.

From any working directory, pass explicit paths:

```
python -B /path/to/delivery-package/geometry/tools/build_hybrid.py \
  /path/to/repository/research/animation-0.1.0/expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb \
  /path/to/new-output-directory
```

Approved input SHA256: `84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`.

The input GLB is **not copied into this package**. It must already be available from the repository/source recovery. If the repository has only the `.glb.gz` form, decompress that existing file to a chosen local source path first. A missing input or different hash stops the builder.

The clean seven-script toolchain was actually rerun against the verified input and reproduced the selected output hash exactly. `SOURCE.json` records that evidence without claiming the input is bundled. Rebuilding creates small hand-repair intermediate arrays in the output directory; they are not separately shipped here.

Optional measured-motion audit refresh, only if original-source keypose exports exist:

```
python -B tools/qualify_hybrid_audit.py SOURCE.glb OUTPUT_DIRECTORY \
  --keyposes /path/to/original-source-keyposes/manifest.json
```

## Evidence and limits

- `audit.json`: source equality, scope exclusions, binding changes, assembled topology and the measured tiny-hip contribution.
- `body-provenance.npz`: retained source IDs and changed/new body-vertex indices.
- `hand-regression-hashes.json`: every hand attribute and triangle array equals the earlier tea-tested geometry.
- `compact-equivalence.json`: storage-pruning lineage and per-array equivalence.
- `SHA256SUMS`: hashes of packaged files.

Equality claims cover complete feet, their shared seams, and **retained** original lower-body vertices. The hand repair removes 3,798 source torso triangles and 1,833 original body vertices, including 29 with tiny hip influence (maximum 0.002033). Sixteen new hand-cap interiors lie below Y=0.43. These replacements are excluded from source-equality claims. The omitted hip-motion contribution at the 29 source positions measured at most 4.23e-5 in the sampled t=0/3/3.5 poses; that is not a bound on total geometric replacement error.

At packaging time, matched original-source visual comparisons at drag t=3 and t=3.5 passed and restored smooth foot roots. Continuous interaction, tea, lifecycle, and device acceptance are separate runtime evidence; this geometry package alone does not claim them. No GitHub write, upload, merge, or release was performed.
