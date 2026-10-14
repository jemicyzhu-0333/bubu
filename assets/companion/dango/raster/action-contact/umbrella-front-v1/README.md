# Front umbrella contact source

This action-only source replaces the front umbrella hand with one continuous short wrist/palm. It does not enable other generic limbs, move the fixed shoulder, change body/face pixels, or change the umbrella's coordinates. Default automatic umbrella view is still three-quarter; this source is selected only for front-view presentation.

- `right-logical.png`: 72×72 art-space canvas, binary alpha and four declared source colors; 74 opaque pixels, bounds `[55,31,66,40]`. The distal palm is about 8×9 art units, versus the legacy oval's 9.2×6.705 rectangle and the rejected generic palm's 13×13 bounds. This is a short observed wrist/root, not a newly claimed skeletal shoulder.
- `right-8x.png`: exact nearest-neighbor 8× copy, with no runtime rotation or stretching. Source grip is `[61.875,35.75]`, shaft direction `[0,1]`; hand placement is identity.
- `umbrella-back.png` and `umbrella-front.png`: an exact, nonoverlapping pixel partition of the unchanged original 400×528 umbrella. Front holds the original shaft, ring and entire mint J handle. Canopy remains behind the body. Both keep the original 50×66 art rect at `[37,-11]`.
- The foreground partition uses source rectangles `[187,248,213,389]`, `[177,389,221,410]`, `[177,410,272,477]`. The narrow upper rectangle intentionally excludes a canopy fragment present in an earlier diagnostic partition.

The generated master is a source study; only the declared short wrist/palm polygon is adopted. Master body, face, ears, and generated umbrella are never used. `sources/` records the untouched master, exact prompt, generation response facts, original geometric mask, source RGBA crop, reference identities, hashes and deterministic recipe. The initial local screenshot reference is not distributed; rebuilding depends only on the retained master and existing canonical umbrella.

The corrected source mask restores real upper/right outline pixels; it does not paint new ink. No runtime transparency mask hides a forearm. The source hand alpha is a single 4-connected component, the hand/shaft/J union is connected, and all eleven proximal root samples are within the unchanged canonical body alpha. Detailed reports are under the runtime review directory, not demonstration media in the repository.

Rebuild or check (Python 3, Pillow, NumPy):

    python assets/companion/dango/raster/action-contact/umbrella-front-v1/scripts/rebuild.py --check

The runtime uses the same guarded, atomic source selection and clothing paw pass as other approved action contacts. Opacity follows the existing sampled action. Offscreen checks are not native window/GPU acceptance.
