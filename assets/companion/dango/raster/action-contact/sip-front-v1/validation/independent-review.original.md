# Independent v2b source-integrity and visual review

## Decision

**PASS for the bounded upper-ink restoration; NOT ACCEPTED for natural root blending or production promotion.** This review did not modify master, extraction, candidate, renderer or production files. All new outputs are in this review directory. Offscreen Skia evidence is not native desktop validation.

## Source ownership and reproducible guard

`python source_integrity_guard.py` passes its suite using only the Python standard library and Pillow. `--version v2` exits 1; `--version v2b` exits 0. The old-v2 negative is preserved.

- v2b restores exactly 716 left and 216 right source pixels, with zero removed old-v2 pixels. Exact fixed coordinate ownership matches the independent boundary proposal; neither the cup junction nor the proximal cut nor lower boundary is enlarged by this repair.
- All crop RGB values, including masked pixels, match the master byte-for-byte. Alpha equals original source alpha times geometric mask. All nine mustKeep anchors survive.
- The additions lie on the authored upper fore stroke seen in the original master, before the shared cup junction. There is one important qualification: left source (442,738), RGBA (139,48,72,253), is an authored antialias transition adjacent to that stroke, not a pure/quantized-black pixel. Its exact source coordinate and RGBA are individually allowed, with diagnostic context saved. The other 931 additions classify as existing ink. No whole-color or connected-component recovery is used to authorize extraction.
- Source eight-connected nearest-palette ink changes from left [6203,44] to [6962]. The detached upper island caused by old-v2 trimming is repaired. Right changes from [5553,1291,19,6,1] to [5553,1507,19,6,1]. Its upper and palm strokes remain separate because the original cup/hand junction divides ownership; this is not a reason to draw a connecting stroke.
- Four in-memory negatives fail: deleting a mustKeep anchor, changing one RGB byte, damaging alpha, and admitting a body-color pixel outside reviewed geometry. No negative modifies an input file.

The guard establishes source integrity, not visual naturalness. Its connectivity expectation is intentionally tied to this reviewed source identity and fixed proposal. Color classification only diagnoses retained/excluded ink; geometry determines which source pixels belong to the extraction.

## Excluded near-boundary ink: manual classification

`omitted-cluster-classification.json` labels every diagnostic cluster, and `omitted-cluster-context.png` locates the material clusters on the original source. The diagnostic neighborhood is four source pixels from the final mask inside each crop; it is not a whole-master ownership proof.

- Left 267-pixel upper cluster crosses the fore-to-cup connector; left 322-pixel lower cluster crosses the palm/cup-wall junction. Both are mixed ownership, not permission to restore a connected dark region wholesale.
- Right 309-pixel upper cluster is the shared upper arm/handle connector beyond y767. Right 75/42/89-pixel clusters sit along the inner handle/cup-wall exclusions. These boundaries were deliberately left unchanged by the upper repair.
- The remaining small outer/lower clusters are antialias fringe along the fixed contour boundary. Two right proximal upper fringe pixels also remain outside the reviewed envelope. They do not demonstrate the old missing-upper-stroke defect and are not automatically restored.

These classifications do not claim every mixed-junction pixel belongs to the cup. Any later change there requires a separate geometric ownership decision, not a color key.

## Fixed projection: contour and contact

Viewed the requested p0 8x composite and full transfer sheet, plus p0.5 8x and playback frames 000/128 at body-design widths 99 and 198 CSS px on light/dark backgrounds.

- The left upper line is now visibly retained in fixed p0. Both hands have coherent short-fore/palm contours rather than the old isolated upper remnant. The broad lower outline is preserved. This closes the demonstrated source-mask upper-contour defect.
- Right x+17.25 reads as a foreground palm resting across/occluding the inner handle opening. The visible top and bottom handle attachments bracket the palm. At p0 and high pose I do not see a detached palm or an empty gap between palm and handle. This is a plausible inner-handle support/contact reading, not an outer x+22 grip or evidence of a hidden rear hand. I would retain x+17.25 for the next root-focused candidate rather than invent another grip.
- The transfer sheet keeps that relative relationship through the displayed phases. The existing face-overlap report is 257 phases times four DPR values with zero reported overlap. I did not independently rerender those 1,028 checks, inspect all 257 frames as continuous playback, or certify fractional-DPR temporal smoothness. A fixed p0 source projection avoids changing the source-sampling phase; displayed offscreen snapshots do not establish native motion quality.

## Root blocker and source-cut investigation

The roots are open pink cuts, not black closed shoulder rings. Nevertheless their bright diagonal proximal edge is visible against the canonical body. At high pose the light-pink arms read as separate strips attached on top of the torso. At 99 CSS px this is less severe than at 198/8x, but it remains visible; complete hidden-cut coverage cannot make it natural.

`proximal-cut-source-context.png` overlays the actual left (390,708)–(348,753) and right (902,708)–(945,753) cut lines in cyan on source pixels. Both lines cross the bright pink proximal fore highlight. The master retains a small stepped, rounded highlight lobe on the upstream side of each straight cut. Consequently, it is **not true that the complete authored proximal start has already been retained**. The current abrupt diagonal is partly extraction-created, not merely unavoidable source texture.

However, the master does **not** give a fully isolated circular shoulder cap: the surrounding red/pink shoulder shading merges into the body with no universal dark boundary. The defensible next step is a separately reviewed, narrow coordinate proposal for the clearly fore-owned missing proximal highlight/adjacent tissue, retaining the original source colors and proving ownership point-by-point. It must not simply shift the entire cut upstream or flood-fill skin color. The source-context image is evidence for investigation, not an approved replacement mask.

After that limited source-backed test, if a full natural attachment still depends on adding torso pixels, invented tissue, recoloring the cut, or closing a shoulder ring, stop and request a source with an authored attachable fore/root. Do not repair that condition with procedural paint or a body-color patch. The present evidence does not yet justify saying new source generation is the only option, because some clearly visible original proximal fore material is still cut off.

## Artifacts

- `source_integrity_guard.py`: executable read-only guard and mutation tests
- `source-integrity-results.json`: full positive/negative results
- `omitted-cluster-classification.json`: manual remaining-cluster decisions
- `nonink-context.png`: original antialias transition neighborhood
- `omitted-cluster-context.png`: original source with major cluster boxes
- `proximal-cut-source-context.png`: actual proximal cuts over original source

No production/runtime acceptance is granted. Upper-mask repair can advance; root attachment remains the visual gate.
