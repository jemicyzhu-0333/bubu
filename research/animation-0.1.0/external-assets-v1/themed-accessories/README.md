# Four Bubu themed accessory candidates

Independent research package. Approved D2 body and hybrid geometry are loaded read-only from sibling bubu-recovery-20261017. No production code, persistent wardrobe, remote branch, or new action timing was changed.

- `references/`: separate built-in image-generation sheets, wearing plus detached front/side/45/back. Concept imagery only. The current plum reference is `plum-side-clasp-r2-prototype.png`.
- `models/`: exactly four actual GLB candidates, with real thickness and side volume.
- `review/*-actual-fourviews.png`: actual Three.js-installed, CPU-deformed geometry rendered by Blender using accessory material color, roughness and metalness. Not generated imagery or browser/native screenshots.
- `reports/host-audit.json`: 271 drag + 1,891 long-press recorded frames; body position-buffer hash unchanged, finite bounded geometry, mutual-exclusion tests, detach/idempotency, ownership revocation and explicit owned asset release.
- `reports/tea-collision-full.json`: final full tea trajectory probe; compare recorded asset hashes with the manifest before using the result. Sampled clearance is not continuous collision or cloth simulation.
- `reports/tea-coordinate-proof.json`: inverse exported sourceToWorld checked independently against approved source-local body and both feet.
- `attach-manifest.json`: IDs, slots, mutual exclusion, ownership, scales, materials, hashes and limitations.

The three backwear models are mutually exclusive. Combined exports are diagnostic sources for independent per-item collision checks, not valid outfits. Call `assertCompatible` before multi-item installation.

## Visual revisions

Woodsman cap keeps both original front ears visible, a compact moss-green crown and cream feather. Ocean fin was revised from a rear-flank petal/shelf appearance to a continuous dorsal membrane centrally attached to the back; natural front occlusion is intentional. Wing surfaces have corrected outward normals, rounded rims and substantial side depth.

The current plum cape is the generated side-shoulder-clasp revision: deep plum cloth, broad soft folds, undulating hem, thick folded rear band and a small gold clasp behind the shoulder. The chest is genuinely open, with no front band, lapels or center clasp. It remains visually distinct from the pale-lavender/mint-trim milestone cape. Front views naturally occlude much of the rear garment.

The previous center-clasp design was rejected because the gold clasp entered the cup opening and the front collar/lapels intersected tea hands and props. Its model, build source, actual image and collision localization remain in `review/rejected-center-clasp/`. Its reports are historical evidence, not the current compatibility status. No body or tea motion was changed to hide that issue.

## Remaining acceptance

All four remain pending final batch user review, runtime wardrobe integration, full multi-accessory combinations, browser/WebGL and native desktop checks. Collision evidence is recorded sampled geometry, not a continuous cloth solve. No new actions were designed.


## Weight/contact revision candidate

The v2 candidate preserves the source body and accepted materials/design identity. Cape necklines are supported upper-back arcs with tapered vertical drape, soft hems and local clearance for the restored round tail. Wing roots sit on the back; the fin retains a rear root while its lateral lobes curve toward the silhouette. The basic boots use an open ankle shell plus a rolled native-foot cross-section rim, keeping the real foot visible instead of painting the upper foot/body junction.

`update({time, reducedMotion, calmVisual, reset, enabled})` uses externally supplied seconds. Local free sections alone receive bounded world-gravity/inertial response; collars, clasps, roots and native footwear binding remain supported. Halo emission and boot-star glints use privately owned material/geometry. No autonomous clock, source actor mutation, wardrobe write, IPC or production entry is added.

This secondary-motion/effect implementation is an experimental comparison candidate, not a settled production interface or a substitute for a mature cloth/physics/particle evaluation. `reports/weight-v2/current-evidence.json` binds the current files and actual CPU exports. Old reports outside `weight-v2` are prior-stage provenance. Actual four-view, before/after and selected drag/longpress/tea evidence is under `review/weight-v2`; it does not certify native browser/Electron rendering or continuous collision.
