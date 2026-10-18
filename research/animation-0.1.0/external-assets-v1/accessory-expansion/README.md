# First accessory expansion batch: halo, sparkle shoes, short cape

Research-host deliverable only. No production wardrobe, persistence, unlock, native window or new action design changes. Models are independently generated/constructed accessories attached to the unchanged approved D2 source and hybrid geometry. Generated worn images are design references, never replacement body geometry.

## Entrypoints

- `attach-manifest.json`: asset hashes, provenance, constraints and validation status.
- `src/accessory-adapter.mjs`: Three.js research adapter. Supply this actor's original `sourceSkin`, external host parent, parsed accessory scene, and source ownership guard. Shoes additionally require this actor's two native hybrid foot meshes in `occludedFeet`.
- `src/build_models.py`: Blender halo/cape builder.
- `src/build_boots.py`: exact hybrid-foot geometry/weight footwear builder with separately weighted star accents.
- `src/test_and_export.mjs`: replay existing drag and long-press trajectories and export actual world geometry.
- `src/test_lifecycle.mjs`: actor isolation, failure-close, visibility lease and resource ownership tests.
- `src/audit_tea.py --full`: sampled triangle intersections across the existing 271-frame tea trajectory.

## Coordinate and ownership contract

GLB geometry is in the original source's local coordinate frame, Y up. Adapters compute the full source-to-parent matrix and reject nonfinite/singular transforms. Shoe asset nodes must be identity transforms, explicitly rejected otherwise. Native shoes bind to the current actor's original skeleton, never a template or another actor.

The footwear adapter holds an exclusive visibility lease over exactly two caller-owned hybrid foot render meshes. It stores and restores each prior visibility on disable, failure, unequip or disposal. It does not change approved source geometry, skeleton, material or shared geometry. This avoids coincident bare-foot rendering while preserving exact original foot/ground geometry. Simultaneous footwear owners on one actor are rejected.

Assets are borrowed across adapters. Adapter disposal never frees shared geometry/materials. `disposeAsset` refuses to release an asset while any actor borrows it; call it only after the last adapter releases it.

## Design revisions

- Halo: a slight ring tilt makes the opening legible from the front, above both ears.
- Shoes: the initially expanded sole penetrated the ground during original foot rotation. Replaced with exact native foot geometry and explicit bare-foot occlusion, rather than moving the actor or inventing a ground offset.
- Cape: the initial front clasp/collar and front panels collided with hands/cup during tea. A newly generated back-only cape reference replaces that design. The final rear panel leaves the front contact workspace clear. No cloth simulation or new flutter motion is introduced.

## Validation boundaries

CPU Three.js trajectory replay and Blender rendering are supported here. Browser WebGL, real macOS/Windows windows, all other wardrobe combinations, automatic shop/equip integration and final user acceptance remain pending. These are not claimed production-ready.

Dependencies reused read-only from sibling recovery package: Three.js 0.186.1, approved source and original recorded trajectories. Blender 4.3.2 and Python/NumPy are present in the task environment. No remote commit or paid generation service was used. The image-generation tool outputs and exact prompts are under `references/`.

For a relocated candidate, set `BUBU_RECOVERY_ROOT` to the read-only approved research support root containing `research/animation-0.1.0/`, `delivery-package/geometry/`, `runtime/`, `split-tools/` and `tea-runtime/`. That support data is deliberately not duplicated into this three-item accessory patch. The test scripts accept this explicit override; the local sibling fallback is only a task-workspace convenience.
