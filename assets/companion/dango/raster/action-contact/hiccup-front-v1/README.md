# Front hiccup: continuous source forearm + palm

An action-specific source-pose package for integration verification. `frames.json` keeps `runtimeReady: false`. This is not approval of generic IK, the whole limbs package, other actions/views, or a generated replacement body/cup.

## Drawing contract

Two independent left/right layers, each logical66×72 at origin(0,0), plus exact nearest-neighbor8×528×576 exports and diagnostic pivots. Draw the preprojected pose once without another translation, scale, rotation or generic connector arm. Actual action opacity/occlusion and whole-character motion remain the host's responsibility.

Cup registration is fixed at(22,38), rect(0,0,22,19). Source contact records the actual shared-ink surface and outer-handle boundaries separately:

- Left: shared ink-to-fill boundary(23.25,48.375), normal(+1,0). The actual cup alpha silhouette starts at x22.5 on this row; retained shared edge ink belongs to the palm, so these are not the same boundary.
- Right: boundary(44,48.375), normal(−1,0).

These are continuous boundary coordinates, not wrist roots or opaque pixel centers. At contact row48 the exported raster edge is left23 (gap0.25) and right44 (gap0). The right contact is the outer edge, not the old handle-axis grip42.5. No cup relocation/resize or silent axis conversion is permitted by this package.

## Original sources and extraction

Master `sources/masters/hold-visible-fore-v7.png`, SHA256 c9eeb81908d4f1350053f67e90dd7477898b8b72958b832ca8928353cf29ff94, is preserved unmodified together with exact prompt text and original generation JSON. The source image is1254×1254. One body-relative scale is69.415385/678 =0.10238257374631268 art units/source pixel.

Generation reference order is preserved in the original JSON and resolved by `sources/dependencies.json`:

1. The exact asymmetric-hiccup actual-body8× reference, copied under `sources/references/`, hash30fefd64eb549b04367200f8fafe9ee622f57552ab5b113e3850f8848ad27792.
2. Approved full-character-v2, an explicit external read-only reference under the supplied raster root at `limbs/sources/masters/full-character-v2.png`, hash9e77a9c2a455c3a7c9cc145bb8b0f458ede80bd367e4eb89539c6abddc8b6fdd.

The generator's model version and seed are unknown; no values were invented. Original source/provenance script bytes are retained under `sources/provenance/` as historical evidence, not executable entrypoints. Use the portable scripts below.

Final masks are explicit reviewed geometry and exact source scanlines. The left row corrections remove source cup-colored fragments while preserving the original dark contour. Every RGB value, including RGB under transparency, is copied from its exact original master crop; alpha is original source alpha multiplied by the saved geometric mask. No RGB background key, manufactured hidden palm, painted wrist cap or additional body tissue is used.

The pose compiler applies source alpha≥240, the declared four-color palette, and one offline nearest source sample. The source forearm and palm are one continuous observed piece; no inferred wrist landmark or separate wrist joint is asserted.

## Fixed shoulder / proximal-cut evidence

S is fixed anatomical shoulder. P is the center of the observed source proximal cut, not a new shoulder:

- Left S=(4.5,45.5), P=(12.346255896017698,46.07139209070797); cut width7.593585117022279, hidden continuation length7.86703378072804.
- Right S=(61.5,45.5), P=(54.28944866150442,46.07139209070797); cut width7.58253386850013, continuation length7.233155571837507.

World/source cut endpoints and transforms are in `frames.json`. The read-only body dependency is pinned by exact image hash and rect in `sources/dependencies.json`. Independent reconstruction finds all103 left /94 right positive-axis conservative raster cells covered by unchanged canonical body alpha. No exposed or unknown cells occur; the complete source cut sampled at≤0.125 art-unit intervals is covered.

The envelope uses half the real source cut width plus sqrt(0.5) cell-intersection allowance and excludes only the nonpositive proximal half-space. This is a coverage proof, not a rendered connector or permission to clip positive-axis material, paint over the body, or move S. The original audit inputs/coverage arrays are preserved under `validation/original-evidence/`; the portable check recomputes them directly from the pinned body image.

## Ink and visual limits

Dark source ink is retained as exact #1a1b26, alpha255. Left has29 ink pixels, right21. Horizontal upper contour examples are left x16–21 at y45 and right x46–50 at y45. Complete row runs are recorded in `validation/package-check.json`. The exported pixels match independent inverse sampling; no dark pixels were removed to make the forearm read less like a belly line.

Whether these horizontal lines read naturally during the actual hiccup is a dynamic visual-review question. Palette, connectivity and coverage checks do not answer it. Existing whole-body hiccup motion, outfit occlusion, native display/DPRs and final visual acceptance belong to the integration review. The previous audit's257 offscreen samples are historical evidence, not a claim of native-host approval or production activation.

## Rebuild and independent check

Python3 and Pillow12.3.0 (`scripts/requirements.txt`). No image-generation service or network is needed to reproduce these saved-source outputs.

From this package directory:

```sh
python scripts/check.py --rebuild
```

When the package is outside the repository, provide the canonical Dango raster directory explicitly:

```sh
python scripts/check.py --raster-root /path/to/assets/companion/dango/raster --rebuild --report /tmp/hiccup-front-check.json
```

Manual stages, writing only a fresh output directory:

```sh
python scripts/rebuild_source.py --output /tmp/hiccup-rebuilt/sources/extraction
python scripts/build_pose.py --source-root /tmp/hiccup-rebuilt --output /tmp/hiccup-rebuilt
```

The independent check verifies master/prompt/reference/dependency hashes, full source RGB and masked alpha, mask reconstruction, logical palette/binary alpha, source inverse sampling, exact8×, S/P full-width coverage, true contact edges and preserved ink. Rebuild compares all10 PNG files (six production/pivot images plus four source RGBA/masks) and three metadata JSON files byte for byte. `FILES.sha256.json` checks the complete packaged file set.

This module does not edit `source-specs/tools.json`, `dango.raster.mjs`, runtime/test modules, or any old limb assets. Its acceptance flag remains false for the separate integration gate.
