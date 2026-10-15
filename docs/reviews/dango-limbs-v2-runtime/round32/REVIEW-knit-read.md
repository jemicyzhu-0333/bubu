# Round 32: accept front knit-scarf + front read-book

Accepted:
- `53e18f4` fix(dango): integrate source-authored round knitting palms
- `05d7fc7` fix(dango): integrate half-grid round palms for front reading
- `61a477e` fix(companion): dispose limb resources / invalid decoded groups (lifecycle; no geometry)

Excluded from this accept (tip issues / unreviewed):
- `0f17b11` reminder PageDown probe (observation only; Mac root cause unproven)
- `36092d1` front AI stories + Halloween wardrobe — `seasonal.pumpkin-beret` missing from standard raster appearance (`appearance:pumpkin-beret@front` not ready). Codex to wire or keep out of `PET_APPEARANCE_ITEMS` until assets land.

## Visual
- **knit-scarf front:** round palms grip opposite-moving needle shafts; entry/mid/exit and mirrored outfits OK. Three-quarter **0 pixel diff** vs e974ab4 (legacy).
- **read-book front:** half-grid round palms on book; wardrobe ordinary items OK. Three-quarter **0 pixel diff** vs e974ab4 (legacy).
- Best crops: `knit-front-before-after.png`, `read-front-before-after.png`.

## Engineering (on craft tip 36092d1; accept head ⊆ tip minus tip-only stories)
- Knit rebuild: 4 PNG byte-identical. Read rebuild `--check`: union/disjoint/NN8× pass.
- Focused: knit 6/6; read contact pass.
- Knit portable QA: matrix 1032 frames, strict-draw 3168 contrib min132, appearance geo rootOutside0 (36 groups with new seasonal items; aggregate hardcode 32 stale), aggregates pass except appearance count assert.
- Read portable QA: smoke/two-phase/lifecycle pass; wardrobe fails only on `seasonal.pumpkin-beret` (tip).
- `npm run check`: 6760 total / 6755 pass / 5 skip / 0 fail; limbs 224/0, 10 outline actions 0 gaps.

## Remaining open (routine)
- workout three-quarter (legacy support paws)
- short-reach: wave / workout(tq) / catch-star / sweep / read-book(tq) / knit-scarf(tq)
- hiccup three-quarter far-hand (mixed hands) — prior note
- tip `36092d1` seasonal wardrobe ready gap
