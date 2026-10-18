# Existing four wearables: new hybrid research-host installation

This candidate adds a thin lifecycle/admission owner over the unchanged original Sprout, Sunhat, Satchel and Scarf adapters. It does not replace the original four GLBs, their materials, attachment points or accepted artwork. Sprout visual approval remains pending unified user acceptance. No production wardrobe/native integration is claimed.

## Ownership and installation contract
- Owning capability: research wearable installation. Writes only its private attachment tree, resource lease counts and same-actor exclusive-group admissions. No persistent state paths; no original actor geometry/material edits.
- Caller supplies the actual source actor root/skin, external BodyRigAdapter.offset parent, contract-checked mixed-binding owner, source assertCurrent callback, and explicit external eligibility callback. Matching source/hybrid SHA admission happens in the mixed-binding constructor; wrapper also rejects a foreign actor skeleton.
- The external wardrobe owner remains responsible for level, skin, form, opt-in and cross-family policy. The wrapper calls that owner before installation and enforces occupied exclusive groups across wrapper instances for the same actor. It does not invent an unlock rule or make a production selector.
- Every update checks source ownership, geometry/skeleton/bind identity, valid transforms and live mixed owner before calling original accessory update. Revocation detaches its complete wearable set. Finite host time and reduced-motion behavior remain in original adapters.
- GLB assets are borrowed and may serve independent actors. Detach never disposes shared geometry/material/texture. Scarf's original adapter disposes its own cloned tail geometry. Explicit final release rejects outstanding leases. Failed construction removes only newly attached nodes and leaves retry possible.

## Fresh evidence
host-audit.json binds actual GLBs, sourceD2, hybrid, original adapter code, wrapper/test code and trajectory hashes. The run replays each of all four wearables over 271 drag and 1891 longpress records. Maximum attachment-anchor error is below 1e-15. The numeric replay checks source invariants and transform ownership every frame; six complete-actor geometry keyframes are exported. This is not full per-frame swept-triangle collision testing or native pointer execution.

Static files contain original 13 meshes (five hybrid body/limbs plus eight original face meshes), never a faceless body proxy. Four views use actual exported geometry and original GLB materials, CPU Blender, yaw 0/45/90/180, orthographic span5.264, targetY1.05, CSS219. static-stage.json checks every exported vertex at those views. Rendering now explicitly includes source vertex colors and resolves multi-material accessory primitives by original material name. Early black-body/white-scarf diagnostic images were overwritten and are not acceptance evidence.

tea-collision.json reruns 271 source-space frames. Actual inverse sourceToWorld is applied to accessory geometry, with all five hybrid meshes independently compared against source-local NPZ vertices (<1e-6). All input hashes are bound; input changes during the audit reject. verify-evidence.py recomputes source vertex correspondence and byte freshness, and proves a +.32 world-matrix shift, +.32 body-vertex change and stale wrapper hash are rejected.

## Tea compatibility findings, not a zero-collision claim
No sampled cup/accessory crossings and no sprout/sunhat hand crossings. Satchel strap/right-hand intersections occur in190 frames, pouch/left-hand in20, flap/left-hand in12. Scarf collar1/left and right hand intersections occur in143/137 frames; collar2 intersects either hand in32 frames. These are triangle-pair observations, not counts of visible bad pixels.

The satchel strap has the same104-pair overlap at rest t0 and final t9. This is a stable attachment seam, but cannot simply be called body-internal: actual crossing-point local signed-distance diagnostics locate the strap crossings outside the body. At the t0.6 entry peak, part of pouch/hand overlap is body-internal and part is outside; flap crossings are outside. Scarf entry crossings at t0.5 and t0.6667 also sit outside the body. Source body signed-nearest-triangle classification is explicitly a local diagnostic, not watertight inside or visibility proof.

contact-keyframe-index.json selects first, maximum total triangle-pair and high-cup sip(t3.4) frames for each of satchel/scarf. Each is rendered front/45 at512px,64 samples, with magnified orthographic span3.0 clearly separate from stage-size evidence. contact-visibility.json casts orthographic rays from actual crossing points against the full visible scene to distinguish hidden contact seams from sampled exposed crossing seams. Read the corresponding actual images; no blanket action-compatibility pass is awarded. High-cup t3.4 has no crossings in either item.

All original accepted artwork remains unchanged. Any visible action incompatibility needs a separate mounting/hand-path decision. No cloth simulation, complete gesture library, all-new-prop combinations, production wardrobe, WebGL/GPU memory or Windows/macOS acceptance follows from this work.

## Reproduce
Use the sibling bubu-recovery-20261017 dependency layout, Three.js0.186.1, Python numpy/scipy/Pillow and Blender. The dependency manifest references original assets by relative path and SHA; do not copy source GLBs into this candidate.

1. node src/test-and-export.mjs
2. python src/audit-tea.py
3. python src/verify-evidence.py && python src/audit-stage.py
4. bash src/render-all.sh && python src/compose-review.py
5. python src/prepare-contact-review.py && bash src/render-contact-review.sh
6. python src/classify-contact-points.py
7. blender -b --python-exit-code 1 --python src/audit-contact-visibility.py

CANDIDATE-ALLOWLIST.txt contains only scripts, compact reports and final actual images. Large regenerated JSON geometry and transient render logs are intentionally excluded; regenerate before rerunning byte/geometry verification. Input/source provenance is retained in dependency-manifest.json and hash-bound reports.
