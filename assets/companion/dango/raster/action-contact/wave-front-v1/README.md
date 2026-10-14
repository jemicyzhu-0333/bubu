# Front wave: complete short forearm and rounded palm

This package supplies eleven small rigid wave poses for the existing front-facing free gesture. It makes no grip/contact claim and does not lengthen the generic 6+6 bones, change the canonical body or face, move props, or replace the existing feet and clothes.

The complete raised forearm and single fingerless round palm are decomposed from the existing, previously generated `assets/companion/dango/raster/limbs/sources/masters/short-arm-study-v2.png` master. No new image generation, procedural outline painting, pixel stretching, synthetic joint patch, palm relocation, or full-character redraw is used. Only the original source limb is adopted.

Each pose has a 20×22 logical canvas, one logical pixel per art unit, at `[55,30,20,22]`. Its 160×176 runtime image is exact nearest-neighbor 8×. All alpha is binary; all transparent RGBA bytes are zero. The only opaque RGB colors are `[26,27,38]`, `[240,80,104]`, `[248,104,120]`, `[248,128,128]`. Eleven runtime images total 1,239,040 decoded RGBA bytes.

The fixed source attachment is the existing generic right socket `[58.5,45.5]`. The legacy contact sampler's input shoulder `[58.6,39.712821]` is separately guarded; these two historical coordinate conventions must not be conflated. Uniform source-to-art scale `.105` gives a distal palm approximately 9.03–9.35 art units wide, about 13.0–13.5% of the 69.415385-art body, compared with the approved rest palm's measured 10 art units / 14.4%. Source body and face pixels are never adopted.

The eleven one-pass source samples rotate the complete limb by -20 through +30 degrees in 5-degree steps around that fixed attachment. Two extremes place the palm at `[64.5615,36.3660]` and `[69.3933,44.2722]`. The existing seven-second action performs three sweeps; only the limb silhouette changes. Body motion, face expression and feet remain the existing renderer's responsibility. Entry and exit each fade over 8% of action progress; low/reduced motion uses a fixed complete keypose.

`source-mask.png` is a rectangular anatomical extraction, not a runtime hiding mask. The upper, outer and lower crop edges meet zero opaque source pixels, so they do not cut source ink. Only the proximal cut crosses alpha: all 86 source-alpha cut samples are within the unchanged canonical body for all eleven poses. Every logical pose is one 4-connected component. No external contour pixels are invented or erased.

The final tightly padded exports reproduce all sixteen sampled full-canvas production-renderer images pixel-for-pixel. Padding is intentional: removing the last transparent margin changes edge coverage in the renderer. Preserve the rect and pixel grid.

Rebuild or check with Python 3, Pillow and NumPy:

    python scripts/rebuild.py --check --repo=/absolute/repo

The runtime registration uses the existing atomic source selector. All eleven images must be ready together at episode entry. Missing, failed, late or evicted images keep/fall back to legacy for that episode; later readiness is used only by a new episode. Unsupported views stay legacy. This complete group is enabled only for the reviewed front-wave action. Other view/action policy is unchanged.

The existing master and exact prompt are reused from `assets/companion/dango/raster/limbs/sources/masters/short-arm-study-v2.png` and `short-arm-study-v2.prompt.txt`; their full repository paths and SHA-256 values are bound by `sources/recipe.json`. No duplicate master or prompt is added here. Extraction mask, extracted RGBA, recipe and reference hashes remain under `sources/`. The prior generation prompt's first-study reference hash was not present in the retained source and is not invented. Offscreen renderer and source checks do not establish native Windows/macOS, GPU or user visual acceptance.
