# Approved direction, candidate models: paired fins, short cape, thin shoes

User approved the reference sheet on 2026-10-18. The reference is AI-generated; the fin/shoe review is actual Three.js mesh export rendered with Blender CPU. This approval does not constitute runtime acceptance.

This additive candidate is based on feature/pet-animation-v2 at 6c981acad195308b19320b83fb10633f710de292. No production wardrobe, main, or release switch. Files are overlays for external-assets-v1 with the same relative locations. The shared Blender builder imports geometry primitives from its themed-accessories/src/build_models.py; run with --body-input pointing to the independently verified Bubu_body.npz fixture. The authoritative body GLB remains 84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a, hybrid remains 52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67.

- Paired aqua fin wings have buried membrane roots, no external round attachment sockets. Existing round body tail remains a separate actor-owned asset.
- Shoe surfaces derive from original foot vertices/weights with 0.002 source-unit shell allowance and a curved ankle opening. No body elevation or larger feet.
- Short cape prototypes use source body BVH fitting rather than an ellipsoid guess. Free low hem samples its support at height 0.36 and drops vertically; this is an authored drape, not a physical cloth solve.

Verification: drag 271 frames and longpress 1891 frames replayed for both fixture groups; source body unchanged, resource teardown checked. Fin has zero hand/cup edge-triangle intersections over 271 tea samples; continuous contact and containment are not proven. Shoes retain native weights but numerical shell/ground tolerance is not a native engine landing guarantee.

BLOCKED: cape front panels/closure still collide during tea (13 of 16 keyframes in current fitted candidate). Rest-position clearance improved but dynamic front-cloth contact remains unsolved. Do not weaken this gate or call cape compatible. All new model hashes require fresh secondary-motion binding admission. Native GPU, final continuous visual review, and full wardrobe compatibility remain open. No fixture may silently accept an old model hash.
