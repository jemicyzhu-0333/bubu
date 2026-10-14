# v7 continuous fore+palm extraction

Verdict: usable as a source-observed continuous fore+palm piece for isolated canonical pose-layer evaluation. Both upper/lower black contours now continue through the short fore into the palm. Proximal ends remain open; no wrist ring or new connector was drawn. This is source extraction approval only, not fixed-shoulder/actual-cup/runtime acceptance.

## Source and proportions

Master SHA-256: c9eeb81908d4f1350053f67e90dd7477898b8b72958b832ca8928353cf29ff94.

Source1254×1254. Maximum high-alpha body width678px at y731, x288..965. One uniform scale69.415385/678=0.1023825737art/source pixel.

- Left complete fore+palm109×109sourcepx →11.1597×11.1597art.
- Right complete fore+palm103×112sourcepx →10.5454×11.4668art.
- These bounds INCLUDE the visible short fore; they are not standalone palm sizes. Do not shrink again. They remain below the earlier13×13hold-palm envelope.
- The visible proximal runs are about45–55sourcepx (4.6–5.6art), depending on where the source's smoothly joined palm is distinguished from fore. No anatomical wrist marker is claimed to be directly observed.
- Source cup outer envelope is approximately216×161px, or22.1×16.5art, so the generated cup is shallower than the real22×19asset. Do not replace or resize the real cup, and do not infer exact old contact registration from this generated cup.

## Explicit registration and ownership

Coordinates refer to full source. Contacts use continuous pixel-edge x and row-center y, not opaque pixel centers.

- Left observed outer contact:(548.0,800.5), normal(+1,0). Source palm owns the shared vessel-edge ink through x547 at y800; cream starts x548. Open proximal cut endpoints:(444,741)→(439,815).
- Right observed contact:(714.0,800.5), normal(-1,0). Cup owns handle shaft ink x706..713; visible palm begins714. Shaft center reference(709.5,800.5) is separate. Open proximal cut endpoints:(813,741)→(816,815).

The real canonical cup's right axis anchor20.5 is inside its cream handle, whereas its outer boundary is22. These v7 boundary contacts do NOT establish an old-axis grip match. Align to the corresponding real boundary with an explicit semantic conversion; don't silently put the exterior contact on the old axis point.

## Mask review and verification

Final masks are reviewed source geometry, not the earlier seed polygons. Polygon bounds and exact final source scanlines are recorded. The left cup-colored fragments at y771/x534..539 and y778/x540..546 were excluded by explicit geometric row corrections, retaining the real dark contour. No RGB color key is used by extraction.

Every retained pixel keeps original RGB and original alpha. No hidden/back palm, cap, contour painting, body replacement, or additional body region is fabricated. Small original downward ink notches near the fore/palm junctions remain source pixels; they were not redrawn or silently smoothed.

Final checks pass: source SHA, RGB bytes versus master crop, masked original alpha, and exact mask reconstruction from recipe scanlines. Both finished cutouts have zero cream-colored audit candidates; this audit was inspection only, not an extraction rule.

Files: left/right-source-rgba.png, left/right-geometric-mask.png, extraction-recipe.json, verification.json, review-overlay.png, and extract.py. Reproduce using python extract.py. Existing v6/low-palm assets and production remain unchanged.

Next gate: compose each whole fore+palm piece at the actual unchanged cup boundary, ensure the open proximal cut lies naturally inside canonical body, inspect both fixed shoulder registration and body ink ownership, then native-size/2× action poses. Source silhouette plausibility does not authorize moving a shoulder or stretching the source piece to reach.
