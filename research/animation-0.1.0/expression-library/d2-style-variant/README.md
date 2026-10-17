# Full18 D2 static style variant and N3 cavity patch

D2 parameters are root-verified following user feedback “差不多，整体可以稍淡一点”. This package prepares an independent opt-in style variant. It does NOT replace or register any existing asset/profile, and it does not change the old 7/18 entry points.

## Minimal integration
1. Load the new body-only asset through a separate explicitly admitted style variant, preserving the original source and hash checks. The GLB JSON is byte-for-byte original; no extras/schema expansion. Only body COLOR_0 bytes change.
2. Add the small N3 cavity patch to the existing face owner (state, amount), not a new clock or expression system. All other 17 states and Basis have gate exactly zero. N3 transitions continuously with smoothstep(.375,1,amount), after the actual source cavity has closed. Cheek color stays static at all times.
3. Mask is read-only template in canonical GLTF A_mouth_ring POSITION vertex order. It was calculated from BasicN3_08. Source mouth/eye material is shared: clone/bind a private mouth material. Use a cloned geometry binding for the extra mask; never mutate source shared geometry. A per-source immutable augmented geometry can be cached before actor allocation; each actor needs its own material/uniform. Dispose resources by actual ownership/lease count.
4. Add to diffuseColor after source color evaluation: vec3(.027,.004,.006) * .66 * gate * interpolatedVertexMask. Keep roughness, specular, opacity, tongue and all geometry unchanged. Never multiply the black base to obtain the target, and never tint the whole ring uniformly.
5. The runtime worker owns integration tests, old-entry regression, interrupt/cancel/reset, two-actor isolation, teardown and actual WebGL verification. No runtime code has been modified in this package.

## Exact asset
- asset/bubu-full18-d2-static-blush.glb.gz is the losslessly compressed artifact for source control (10,915,162 bytes); uncompressed GLB is 16,867,596 bytes and exceeds a 16MiB transport ceiling.
- Source SHA256: 1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677
- Variant SHA256: 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a
- Only accessor 1760, A_mochi_skin COLOR_0, absolute byte range [12322780,12874120), changes. 1111 of 45945 body vertices change; outside compact support colors are exact. All bytes outside that color accessor are identical, including JSON, rig, Basis, all 18 states, all 144 morph targets per face mesh, every non-color accessor, materials and original tongue.
- Fixed cheek mix .56; same D compact support x=±.61,z=.80, radii .27,.17. Canonical tint target (.86,.08175,.1140873015873016) is the source-space equivalent of verified look tint (.95,.090,.125).

## Rebuild / recovery
Python 3 standard library only:

    python build_variant.py --source PATH_TO_EXISTING_APPROVED_FULL18.glb --out OUTPUT
    python build_mouth_patch.py --source PATH_TO_EXISTING_APPROVED_FULL18.glb --out OUTPUT/mouth-patch
    python recover_asset.py --gzip asset/bubu-full18-d2-static-blush.glb.gz --out OUTPUT/bubu-full18-d2-static-blush.glb
    node mouth-patch/test-mask.mjs

Inputs are explicit; no workspace absolute paths. Source archive/gold are not duplicated. Rebuilding the variant preserves binary layout and refuses unexpected source hashes.

## Evidence
VARIANT-AUDIT.json records the exact byte proof. All 18 actual variant endpoint meshes were rendered from the new GLB and visually inspected in review/all18-body-variant.png. Actual P2/N3 quarter and ±one side (-85°) renders are included; local tint remains attached to the body and no new geometry exists. These renders intentionally show the unmodified source mouth, before runtime cavity patch. Mouth patch tests cover 19 states including Basis × 65 amounts, closure/endpoint continuity and 64 exact-black outer-rim vertices. This numerical check is not a replacement for the runtime worker's shader/occlusion/reset tests.
