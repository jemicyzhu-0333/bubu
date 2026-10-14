# Three-quarter snack resting fore/palm

Only the screen-left near resting hand for `snack-picnic` in runtime `three-quarter` is replaced. The original eating hand, body, face, sandwich and picnic mat remain unchanged. This is a source-authored continuous fore/palm, not a stretched generic arm.

The independent generated quarter master is isolated by the retained anatomical polygon mask. One uniform body-proportion projection uses the original rest endpoint [23,54] and a fixed [0,+0.5] quantization registration to retain the lower ink edge. No per-frame scale, shoulder move or hand-painted contour is used. The four-color projection preserves extraction alpha exactly. `near-logical.png` has126 opaque logical pixels; `near-8x.png` is an exact nearest8x copy. Transparent RGBA is zero.

Reproduce the delivered files from the retained master/mask/recipe:

    python assets/companion/dango/raster/action-contact/snack-quarter-near-v1/sources/rebuild.py --check

`sources/generation.json` records the original prompt, ordered reference paths/hashes and unchanged master identity. The local generation-reference preview is not needed for deterministic extraction and is intentionally not committed. Runtime/demo screenshots, videos and bulk reconstructible frames are excluded. The sources directory is excluded from release packaging.

See `docs/reviews/dango-limbs-v2-runtime/snack-quarter-source/` for the portable real-renderer replay and exact scope. Native desktop visual review and the earlier reported fragment reproduction remain reviewer work; no claim is made that every historical fragment was reproduced.
