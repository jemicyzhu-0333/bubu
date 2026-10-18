# Bubu: seven head ornaments, research candidates

Each item has its own imagegen prototype (wearing and isolated four views), saved prompt, true GLB model, and actual unchanged approved D2 + hybrid host render. Generated character illustrations are concepts only and never replace the approved character. No new actions were designed. No remote write or production wardrobe integration occurred.

## Review
- `review/{forest,sakura,moon,flame,crown,antenna,pumpkin}-actual-fourviews.png`: actual CPU-deformed meshes, front / 45° / side / back, rendered with Blender. Not a browser or native desktop screenshot.
- `references/*-prototype.png`: separate imagegen concept sheets, not model renders.
- `attach-manifest.json`: exact catalog IDs, original exclusivity/unlock restrictions, GLB and concept hashes, material colors, bounds, scale and attach contract.
- `models/*.glb`: real meshes with physical depth. Not textured image cards.

## Validation boundaries
`reports/host-audit.json`: 271 existing drag frames and 1,891 existing long-press frames replayed. Actor geometry hash unchanged; accessory per-frame bounds finite and diagonal under 3 actor units; detach, idempotent disposal and explicit borrowed-resource release tested. Source actor and hybrid asset hashes recorded.

`reports/tea-collision.json`: corrected 16 existing tea keyframes. `reports/tea-collision-full.json`: corrected 271 discrete 30fps frames. All accessory world exports are transformed by the actual inverse source skin matrix before comparison with tea-local geometry. `reports/tea-coordinate-proof.json` independently compares body and both feet with approved hybrid NPZ source positions. The old coordinate-mismatched result is retained only as `tea-collision-superseded-coordinate-error.json` and is invalid evidence. These checks detect sampled triangle intersections, not continuous collision, containment, cloth simulation or universal outfit compatibility.

Host adapter is research-only. The combined scene is a diagnostic export of mutually exclusive alternatives; it must not be shown as a valid wardrobe outfit. Production exclusivity remains authoritative. Seasonal pumpkin originally exposes front-only views; this research adds review angles but does not modify production admission. Effects are catalog metadata only, not newly implemented animations.

All candidates await user's final batch acceptance. Browser WebGL, native desktop, production wardrobe integration and all outfit combinations are untested.

## Reproduce
Run from this directory:
1. `blender -b --python src/build_models.py`
2. `node src/test_and_export.mjs`
3. `python src/audit_tea.py`
4. `bash src/render_batch.sh`
5. `node src/write_manifest.mjs`
6. `python src/contact_sheets.py`

Dependencies are borrowed read-only from the existing recovery environment. No persistent app state is written.

## Mount and motion revision (2026-10-18)

Owning scope: standalone companion accessory research adapter. No persisted state, IPC, production integration, source body edits, or model redesign. Existing seven GLBs remain byte-identical. V1 placement evidence is `assets/companion/dango/dango.appearance.vector.svg` and `src/content/appearance.mjs` in the reference repo: forest, sakura and moon attach behind the right ear; remaining four attach centrally.

`AccessoryAdapter.update({time, dt, acceleration, enabled, reducedMotion})` uses seconds and world-unit acceleration per second squared. Time is injected, never read globally. Omitted dt derives from injected time, and omitted acceleration estimates mount acceleration after two samples. The nearest actual skin vertex supplies its complete weighted skin transform, including head deformation, rather than copying only the object matrix. Geometry and skeleton identity, bindMatrix, bindMode and finite nonsingular actor transforms are checked. The inverse bind matrix remains actor-updated.

Physical clips have bounded damped elastic inertia, a weak world-down torque and acceleration lag. Forest has 0.10 rad travel; sakura 0.065; moon 0.035; crown/pumpkin 0.025; antenna 0.085. These are secondary-motion bounds, not a universal collision solver. Flame mount remains fixed while height-weighted tip vertices flicker. Materials are cloned per actor for leaf shimmer, petal glint, moon glow, crown jewel shine and antenna signal pulse. Pumpkin has no invented catalog effect. Reduced motion resets mechanical lag and freezes all cycling at neutral. Disable/re-enable, rewind and dt over 0.25s reset accumulated dynamics; integration work is bounded to 0.1s and 120Hz substeps. Zero dt holds mechanical state. Dispose releases only adapter-owned material/geometry clones, not borrowed GLB resources.

Validation: `src/test_dynamics.mjs` exercises all seven assets with zero dt, time-only automatic inertia, extreme dt/acceleration, return to rest, rewind, reduced motion, disabled/re-enabled reset, repeated disposal, cloned material isolation and translated actor roots after world-matrix propagation. `test_and_export.mjs` replays actual drag/longpress poses and exports current adapter meshes. Tea checks cover 271 discrete original tea frames against corrected neutral mounts; they do not establish continuous swept collision or all wardrobe combinations. Source and input hashes bind the deliverables in `reports/revision-evidence.json`.

Actual CPU-rendered four-view evidence is `review/revision/corrected-headwear-fourviews.png`, with representative 2-second forest/flame/antenna clips and start/lag/recovery sheet. `headwear-99-bodywidth-light-dark.png` derives 99px body width from exported body bounds, retaining fixed source geometry. These are Blender CPU renders of actual Three.js deformed geometry, not WebGL, native OS, CSS/DPR, or production integration verification. Full application gates were not rerun because this package has no production source changes.
