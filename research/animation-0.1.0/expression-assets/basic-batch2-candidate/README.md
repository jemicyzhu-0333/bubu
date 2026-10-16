# Basic face batch2 portable candidate backup

R0 quiet short-neutral, A7 natural sleep, S2 friendly smile. Source directions were user-approved; this actual3D batch is independently static-reviewed and awaits user3D confirmation. No runtime integration. R0 does not replace the original Basis/default.

## Self-contained recovery
1. Run `python restore.py`. It verifies the native GLB and restores the full source and full gold-look Blender scenes from gzip. No private workspace path is needed.
2. Load the native GLB directly, or open `_restored/bubu-a05-basic-batch2.blend`. The full look is `_restored/bubu-a05-basic-batch2-look.blend`; all lights/materials are preserved, not reconstructed approximately.
3. With Blender4.3.2 run `blender -b --python rebuild_batch2.py`. It removes only this batch's derived keys from the retained full source and regenerates them using the included local geometry/transition modules. Output is under `_rebuilt`. See RESTORE-VERIFICATION.json for the actual byte-identical rebuild result.
4. For images run `blender -b --python render_batch2.py -- first`, then `other`, `interpolation`, `pole`. Run the two compose scripts afterward. Rendering creates `_renders`; it does not modify frozen evidence. All views use the original look and camera contract. The interpolation mode can also filter with ONLY_STATE=R0/A7/S2.

The original authoring script is included as build_batch2.original.py for provenance; it expects the separately archived r6 source. The portable rebuild is the self-contained route. audit_export_identity.py is a historical comparison against that separate published r6 archive; its frozen report is included. Other audits use the restored scene, native GLB and local mapping.

## Contents and limits
- Native finalGLB, complete source/look gzip, code and exact mapping/coordinates.
- Approved cropped references, source provenance, compact review boards, static QA and inherited highlight-pole exception details.
- No old pass assets, `.blend1`, cache, video or full render-frame stack.
- The five face objects share the original r6 Basis/topology/skinning. Body has no morph. This complete review GLB is not a recommendation to duplicate body per runtime facebank.
- Single-state adjacent-knot interpolation only. No arbitrary cross-face blend, gaze, full-library acceptance or motion acceptance is claimed.
