# Uniform front/right shoulder registration regression

## Result

The single source-backed registration change `front/r [61.5,45.5] -> [58.5,45.5]`, with newly sampled canonical-alpha coverage, eliminates the actual generic bubble arm fragments. It is **not an all-action approval**. No production files were edited here.

Bubble's unchanged production composer/artist chooses `upper337.5 / fore112.5`, with right-side reflection, grip/front/a090. S=[58.5,45.5], E=[52.5,43.5], W=[54.5,49.5]. Target stays [54.046795,53.653846]; contact=[54.5,53.5], marker error=.478606 (old .568026). Across 1,025 phases, right-hand direct and whole-action standard admission both remain 1,025/1,025. Branch is constant. Total exposed arm pixels after canonical body/front-paw occlusion are 0 (old67); exposed upper pixels 0 (old28). `bubble-generic-actual-artist.png` is the actual standard artist, not a forced or experimental painter.

## Scope and invariant evidence

- All 44 actions, all 83 allowed action/view combinations, phases0,.125,.5,.875,1:415 paired artworks and520 hands per variant.
- All 43 front combinations,1,025 phases each:44,075 paired artworks and57,304 hands per variant;34,501 are right-side hands affected by this registration. Dense phase count was completed before the request to prefer257.
- Both variants use the actual limb-source loader and actual production composer/artist. Candidate metadata is a frozen in-memory clone. Only front/right worldRoot and its alpha coverage change. No candidate search, per-action root, source image edit, prop target edit or length change.
-44,490 paired artwork comparisons preserve body descriptors/matrices, anchors, attachments, targets, hands (except limb admission flag), tools, face and effect origins. Non-front and front-left solved outputs are exactly equal.
-107,368 planned contacts agree with actual integer-translated rendered markers. Segment lengths stay within6±.5 art units. Existing runtimeReady=false and hostAcceptsContract=null stay unchanged.

## Direct admission is not whole-action admission

`direct` is actual painter.plan acceptance (contact<=1.25 and layer eligible) at that sampled phase. `standard` is the actual artist hand.limb flag after its whole-action257-phase guard requiring<=.75. Counts are sampled hands, not distinct actions. Generic diagnostic errors do not prove physical surface grip.

Affected right-side dense direct counts:

| Class | Samples | Before | After | Standard before→after |
|---|---:|---:|---:|---:|
| Continuous grip |19,127|9,270|8,157|1,025→2,050|
| Free auxiliary |8,712|2,464|3,202|0→0|
| Point touch |3,587|1,001|1,828|0→0|
| Planted support |1,025|0|0|0→0|
| Integrated auxiliary |2,050|unsupported|unsupported|0→0|

Within paired samples, direct admission is lost4,765 times and gained5,217 times. Standard admission is never lost;1,025 gained samples all belong to **umbrella-dance/front/right**. Bubble is retained. Umbrella's new standard exposure is36 total arm pixels, including7 upper pixels and its branch is constant; the parent reviewed the five-phase 1x/2x comparison and found no new obvious contour issue. This is limited comparison evidence, not all-action naturalness approval.

Important continuous-grip diagnostics:

- hiccup: direct1,025→0; max error1.125→1.505199. Standard0→0.
- carry-energy: direct1,025→0; max1.059515→1.891673. Standard0→0.
- plant-water: direct952→459; max1.626445→2.760611. Standard0→0.
- sip-tea: direct510→494; max3.124753→3.149681. Standard0→0.
- umbrella-dance: direct1,025→1,025; max.976281→.673146; standard0→1,025.
- type-keyboard point-touch: direct0→931 (not all1,025); max3.702997→1.502103; standard0→0.

Hiccup source-contact pose is **not active**: runtimeReady=false on both source-contact records, sourcePose=null and sourceContact=null. Both actual standard variants retain the existing legacy fallback. `hiccup-current-probe.json` records this. An earlier message incorrectly inferred source-pose takeover; this result supersedes it.

## Discrete branch changes remain

An elbow jump is E step>6 while target step<.5; wrist jump is W step>2 while target step<.5, at adjacent dense phases of the same semantic class. These diagnostics include unreachable plans and therefore must not be called visible animation jumps without admission/layer evidence.

Affected continuous-grip branch changes145→131; large elbow jumps56→60; large wrist jumps83→72. Free auxiliary branch changes92→103, elbow27→41, wrist55→75. Point-touch branch changes44→53, elbow8→6, wrist26→37. Bubble and newly admitted umbrella have no branch changes. Full per-action values are in aggregate.json, with exact worst samples in dense.json.

## Reproduction

Run `node compare.mjs --repo REPO --out OUTPUT_DIR --steps 1024`, then `python summarize.py --out OUTPUT_DIR`. The portable wrapper explicitly reconstructs old [61.5,45.5] and new [58.5,45.5] roots and BOTH canonical-alpha stencils, whether the repository currently has either registration. Other input roots fail closed. Preflight against the actual old repository and the actual new staged package produced identical paired stencil bytes and 32 identical plan comparisons, with both sources unchanged.

Run `node inspect-umbrella.mjs --repo REPO --out OUTPUT_DIR` for the sole delivered five-phase 1x/2x actual-artist sheet and exact plans. The shared `registration-sources.mjs` wrapper regenerates the 25x25 coverage within usefulLocalRect against source.bodyAlpha and leaves unknown margins to the actual composer fallback. No batch renders are needed. Bubble plan values are retained in the aggregate review; its separate visual evidence belongs to the parent delivery.

`aggregate.json` is the compact delivered report and includes source/module hashes, invariant counts and portability preflight. Reproduction also emits sparse.json and dense.json containing per-action/side/class summaries only; no individual dense-frame dump is generated.

## Additional review and behavior tests

`umbrella-five-phases-1x-2x.png` shows the actual old fallback and new standard generic artist at five requested phases, in body-local1x/2x pixels. The parent reviewed the newly visible fore/elbow segment and larger round palm and found no new obvious contour issue in this bounded comparison. This does not extend to all-action naturalness; marker admission alone is not acceptance. Exact records are in `umbrella-plans.json`.

`dango-shoulder-registration.test.mjs` is staged for repository `test/dango-shoulder-registration.test.mjs`. It passed3/3 tests against the package worker's actual staged manifest/coverage with unchanged production assets as an explicit read-only overlay. It verifies default gates, source-bound fixed root, independence from animated legacy shoulder points, whole-limb parent translation exactly once, and257 actual-artist bubble phases with unchanged target/full admission/zero exposed arm. Result: `behavior-tests.log`.
