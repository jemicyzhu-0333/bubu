# Small round tail restoration candidate

Owning scope: research-only anatomical body attachment. No persisted paths or production contracts change. Nothing was pushed or merged.

## Finding and provenance

The approved D2 `A_mochi_skin` has a smooth lower back in actual original profile/rear renders. Its absence is not inferred merely from node names. The old V1 raster tail asset and `dango-raster-tail-root.mjs` establish a small body-coloured tail, naturally occluded in front and allowed to be covered by a cape. They are 2D references, not recoverable 3D geometry. This candidate is a new user-requested restoration of that feature, not a claimed byte-identical recovery of an original 3D tail.

## Geometry and ownership

- Separate `bubu-round-tail.glb`, with native skin indices/weights and source vertex colour/material.
- Source anchor vertex 21306 at approximately (0, .42734, -.70086), joint 0 `Body`, weight 1.
- Small round .30-wide tail aligned with the measured lower-back surface normal. Its complete 64-vertex open root is embedded behind the original surface, rather than attached at a single tangent point or floating outside.
- No original source/body/face/limb attributes or bytes are modified. Existing hybrid geometry remains untouched.
- `round-tail-adapter.mjs` borrows actor material/skeleton, prevents duplicate ownership, checks identity and transforms, follows actor visibility, and disposes only its attachment.
- Anatomical tail is separate from wardrobe. Capes may cover it naturally. Fin and cloth compatibility is being handled by the wearable worker; these bare-body renders alone do not certify that combination.

## Evidence

- `provenance.json`: source/tail hashes, bounds, complete source attribute hashes.
- `root-burial.json`: all 64 rim vertices inside the measured original surface by .0345–.0422 in local Z.
- `validation.json`: actual old CPU host skeleton replay: drag 271, long-press 1,891, tea 271. Tea body is stationary, with independent rigid hand/cup motion. Max surface-anchor error below 1e-10.
- `binding-stress.json`: 17 isolated imported-GLB cases with rotated/scaled Body joint and rotated actor; anchor error below 1e-10, inverse-bind matrices unchanged. This is separate from actual face-owner playback: that owner explicitly rejects arbitrary Body pose edits, and its fail-closed behavior remains intact.
- `renders/`: actual original D2 GLB plus tail at front, profile, rear-quarter, rear and underside. Blender CPU renders, not native WebGL/Windows/macOS validation.
- `review-sheet.png`: a contact sheet of those actual renders. `小步小圆尾巴-四视图.png` is the Chinese-labelled four-view version.

Rebuild: `python body-tail/build-tail.py`; run attachment tests with `node body-tail/test-tail.mjs`; render with `blender -b --python body-tail/render-tail.py`. These local research utilities require the sibling verified recovery source tree. No network/download needed.
