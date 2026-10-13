# Level support additions: boundary-aware candidate assessment

Audit only. Source producer added two offline source-reprojected level frames in candidate-pack: front axis109degrees and quarter113degrees, both exact projectedNormal(0,1). No production integration.

Verified from actual alpha: each new grip is an opaque pixel center and the lowest opaque boundary is exactly gripY+.5. A surface at floorY therefore requires target center=floorY-.5. Placing the marker itself at floorY would produce half-pixel penetration even if marker error were zero.

## Actual geometry results

Used the explicit S-H-E-W candidate with unchangedS, source-backed distinct forearm, approved existing proximal-halfspace rule and positive-width internal body coverage. Sampled129 progress positions per view/side,516 hand samples total. Filtered to exact level source normals, then measured the composed palm's actual lowest opaque boundary, not just its blue pivot.

| View/side | Level-contact chain exists | At least one nonpenetrating candidate | Actual gap0..0.25 |
|---|---:|---:|---:|
| Front left |105/129|41/129|16/129|
| Front right |105/129|41/129|16/129|
| Quarter left |104/129|64/129|16/129|
| Quarter right |129/129|41/129|16/129|
| Total |443/516|187/516|64/516|

Quarter far-side action depth remains provisional, independent of these geometry counts. Candidate filters do not establish loaded support or whole-action acceptance.

## Remaining blocker is lattice/surface geometry

The new source resolves the tilted-normal problem, but the finite pixel lattice cannot generally place the bottom on the moving local floor without gap/penetration. Existing6-unit vectors have even coordinate deltas; a fixed half-integer shoulder plus some hidden-link directions produces only one wrist parity. Example: front internal0/180 route with the new level palm's+7 vertical grip offset can produce bottom65 when the required floor is64. A1px error must not be accepted by the generic1.25 contact tolerance. Other phases need a fractional local floor due to body offset, while integer-translated sprites cannot follow it exactly.

The all-geometry best gap range includes penetrations of1.25 and gaps above1art unit. No clamp, crop of lower palm pixels, arbitrary contact shift, shoulder motion, floor movement, or runtime stretch was used to hide them.

A strict sequence sheet at.25/.50/.85 (`level-support-strict-1x.png`,2x) remains blocked in every candidate cell and therefore preserves existing runtime support. This is the correct failure behavior; the visually level new source does not authorize a falsely planted sequence.

## Evidence and tests

- `assess-level-support.mjs`, `level-support-assessment.json`: exact per-sample targets, floor, normal error, actual bottom, gap, S/H/E/W and candidate counts.
- `level-support.test.mjs`:4/4 pass, checking source opaque-center/boundary relation, floor-.5 target convention, strict no-penetration/gap bounds, and rejection of treating level reach as planted success.
- `render-level-support.mjs`, `level-support-render-records.json`,1x/2x strict sheets:61-frame continuity-aware diagnostic from.25-.85.
- Existing audit candidate test now verifies strict support admits only the new level-normal frames; the earlier claim that no level source exists is historical and superseded.

Next decision should address a source-preserving fixed-plane lattice contract and body-motion support phase together. More reach alone cannot solve parity/fractional surface alignment. Any finite additional prebaked registration family must be explicitly authored and tested against exact contact boundary; no generic marker tolerance can certify planted support.
