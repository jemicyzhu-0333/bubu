# Front umbrella: continuous grip source

Status: standard front source integration, validated locally. Base:31bfc60. Other views keep their current behavior, including default automatic three-quarter. No main merge or installer/release. This does not close the other remaining limb categories.

## Material and depth repair

The fixed generic contact marker was already near the grip, but its large palm/fore silhouette and entirely back-layer umbrella made the hand float above a disconnected J handle. The replacement is a new source-authored continuous short wrist/palm, not stretched generic bones or a body-colored patch. Its original geometry is quantized once onto72x72 logical pixels and exported exact nearest8x. Source extraction restores omitted original outline ink; no new ink is painted. The underlying canonical body and the original umbrella are unchanged.

Original umbrella pixels are partitioned into complementary back canopy and foreground shaft/ring/J layers. No alpha intersection; union equals every original RGBA byte. Both layers retain original50x66 art rect and37,-11 origin. Fixed grip61.875,35.75 and identity paw placement retain original pose and motion. Source alpha has74 logical pixels; the palm is about8x9 art, compared with rejected generic13x13 bounds. All11 proximal cut samples are body-covered; hand+shaft+J is one4-connected alpha component.

See [source package](../../../../assets/companion/dango/raster/action-contact/umbrella-front-v1/README.md) for exact prompt, source/reference identities, extraction mask/recipe, palette and hash chain. Rebuild:

    python assets/companion/dango/raster/action-contact/umbrella-front-v1/scripts/rebuild.py --check

## Integration and validation

The three registered resources use the existing atomic readiness/instance window. Missing/failed/late resources keep original legacy composition for that episode. Generic umbrella's rejected chain remains fail-closed; no global bone/contact tolerance is relaxed. Existing action prop opacity also fades the hand. The approved sip module is unchanged.

- 2020 actual renderer samples:101 phases×5DPR×2facing×normal/reduced motion, no failures.
- 2128 front-workbench playback frames:completion, interruption/reopen and reduced-motion recovery. Default auto remains quarter; this is the requested front case.
- 101 face samples and10 headwear×5phases:zero foreground shaft/hand alpha overlap with protected face/headwear.
- 4 added tests:production source hashes, exact8x, byte-complementary prop split, unchanged geometry,257 source phases, opacity through0, metadata/unsupported guards and every single-resource failure/cold-load branch.
- Final ordinary-default-parallelism npm run check:6143 total/6138 passed/5 optional skipped/0 failed, exit0; integration71/71.

These are actual renderer/offscreen Skia checks, not native Windows/macOS visual acceptance. The ordinary action did not emit handoffRecovery in sampled lifecycle scenarios; explicit opacity0 is separately tested. Exact resulting-head CI and independent Bobo review remain required.

Only required production/source PNGs are included. No demonstration image, comparison video or bulk generated frame is committed. The saved generation reference screenshot remains local; extraction rebuild requires the retained approved master, not that screenshot. Reproducible reports and scripts are adjacent; full traces/media stay local.

Portable renderer checks (default JSON only, use --images only for local inspection):

    node docs/reviews/dango-limbs-v2-runtime/umbrella-front-source/scripts/runtime-qa.mjs --repo=/absolute/repo --out=/new/phase-check
    node docs/reviews/dango-limbs-v2-runtime/umbrella-front-source/scripts/lifecycle-qa.mjs --repo=/absolute/repo --out=/new/lifecycle-check
    node docs/reviews/dango-limbs-v2-runtime/umbrella-front-source/scripts/occlusion-qa.mjs --repo=/absolute/repo --out=/new/occlusion-check
    python docs/reviews/dango-limbs-v2-runtime/umbrella-front-source/scripts/source-audit.py --repo=/absolute/repo --out=/new/source-check
