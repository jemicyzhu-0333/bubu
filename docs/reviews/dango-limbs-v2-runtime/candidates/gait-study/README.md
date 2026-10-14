# Quarter-right source feet and grounded gait proposal

Status: source-derived anatomy candidate and offline canonical-body review. Not production-integrated, not activated, not a completed runtime gait acceptance. All work is confined to this directory.

## Read these first

- `canonical-phase-css-light-dark.png`: actual extracted feet composed with unchanged canonical body, ears and face; 99/198 CSS pixel body-design widths, both backgrounds.
- `canonical-phase-set-review.png`: logical 1× and 2× with external ground guides; these are art-unit views, not CSS/native desktop screenshots.
- `extracted-feet-review.png`: eight separately observed source foot silhouettes.
- `gait-source.json`: source polygons, original source hash, uniform sampling transform, root, lowest observed sole, palette and exact8× paths.
- `phase-set.json`: four static pose registrations; runtime support/clearance is separate from original source-panel description.
- `gait-helper-proposal.mjs`: pure candidate run/walk sequencing helper. It is not installed in the host.
- `asset-check.json` and `gait-helper-check.json`: measured evidence and limitations.

## Source outcome

Three official image_gen calls were made. Untouched masters, exact prompts, output dimensions, SHA-256 and attachment order are in `masters/*.json` and corresponding PNG/TXT files. No seed or model version was provided; they are recorded as unknown. Approved full-character-v2 was the identity attachment. The runtime reference is an exact whole-image horizontal reflection of the package's canonical quarter stepping composite; its preparation and hash are recorded under `references/`.

The first two eight-cell sequences (`run-quarter-right-v1` and `v2`) were rejected as complete gait sources: foot support/phase ordering did not follow the prompt. Their pixels were not used in the extracted candidate. Requiring feet to cross the entire broad belly was recognized as inappropriate for the approved short limbs and corrected before the next request.

The narrower `run-contact-study-v3.png` provides independently observed support and raised/recovery anatomy for both near/far feet. Its panels are contact studies, not proof of a complete timed run. Near = screen-left, far = screen-right for this right-facing two-eye quarter view. Exactly eight source-derived feet are delivered, four per anatomical side; none is a rotated copy of another. Production body/ears/face are unchanged.

The generator added a faint low-alpha glow. Extraction uses explicit geometric anatomical masks intersected with source alpha >=200, retaining source RGB inside the mask before the declared palette projection. This is not global background color-keying. Two far-foot proximal polygon boundaries were tightened after the first native assembly to exclude body-contour fragments, not to manufacture a foot contour. Original masks and master can be inspected/rebuilt. No per-pixel artwork painting, geometric replacement feet, anisotropic scaling or procedural redrawing was used.

## Scale and anatomy

One common scale is 73.025641/465 = approximately 0.157044 art units per source pixel for all eight feet. 73.025641 is the measured canonical quarter body raster width, not the 66-unit body-design box. Source torso scans, excluding hands, are 466 px at y280 in both upper panels; lower panels near corresponding widest torso levels are 459–460 px (y725), with contour width varying by row. Nominal 465 ±8 px is used consistently, rather than stretching individual cutouts. The body-relative scale uncertainty is about 1.7%.

Support alpha bounds are about 20–21 by 12 art pixels; oblique lifted feet are about 19–22 by 12–16. Height changes reflect observed oblique source shapes rather than vertical stretch. Compare the approved shallow support foot and source sheet before accepting a wider production range. All feet remain round-bottomed and broad, without toes, long legs, boots, circular sole stamps or a closed ankle ring.

The observed support soles contain a one-pixel quantization step at the bottom. The registered sole is a genuine lowest opaque pixel, not a fabricated center/floor. Do not claim an entire flat contact patch from that marker. Support and foot-root anchors remain separate.

## Composition

The four review poses place support feet behind the unchanged body and lifted distal feet in front. For lifted feet, the proximal root half-space is behind body and distal half-space in front, using the observed root-to-opaque-centroid axis. This changes depth only; source union pixels are not repainted and body alpha is not edited. Review this split with actual clothes and shoes before reusing it in production.

The review uses actual canonical source body/ears/face data from `sources/canonical/render-reference.json` and existing resting hands. The faint pink root highlights are preserved source palette features; no universal erasing/outline ring was applied.

## Proposed gait contract

The helper accepts continuous cycle time, the extracted frame records, mode, groundY, stride, lift and an optional ground-relative `travelAt(cycle)` function. Default stride is 3.5 art units around each hip. It does not make feet cross the full body. GroundY is an input, not moved to conceal contact error.

- Run: each foot's nominal stance duty is 0.36; sides are offset by half a cycle. There are two flight intervals.
- Walk: stance duty is 0.62, yielding alternating single and double support with no flight.
- Stance: a selected foot's true sole marker is fixed in world coordinates from its landing; root is solved from the selected source root-to-sole offset.
- Swing: root follows one continuous trajectory independent of source-frame switches; extra lift accounts for longer oblique root-to-sole distance. Support source remains at toe-off/landing edges, and genuinely distinct recovery/reach source art appears through swing.
- Half-pixel root/sole centers yield integer image translations only. No runtime rotations or scaling.
- All eight feet are used. Source pose labels remain observed anatomy labels; timing is in this helper, not falsely claimed as generator-authored gait.

10,001 samples per mode: run support counts 1/0, 2,112 samples with both raster soles genuinely above floor; walk counts 2/1 and no flight. Both have zero stance marker drift and no floor penetration. Maximum adjacent quantized ankle increment is 1 art unit. The earlier naive sole-driven swing caused ~5.83-unit root jumps; it was rejected and replaced by continuous root motion.

Important limits: world contact is established only if the consumer uses the same `travelAt` trajectory for body and feet. A fixed-body preview requires an explicitly moving treadmill ground; silently subtracting body travel and claiming stationary planted feet is invalid. Raster rounding leaves short lift-off/landing transitions with zero visible clearance even though nominal phase says swing. `flight` requires actual positive clearance of both raster soles; `airborneIntent` preserves the nominal timing separately. Frame-switch silhouette continuity, final body flight/bob policy, true source-compatible shoe binding, cold cache behavior, all outfits and actual desktop/DPR review are still open.

## Reproduction

Run with Python/Pillow and Node:

1. `python extract_gait.py`
2. `python render_phase_set.py`
3. `python check_assets.py`
4. `node check_gait.mjs`

Only this directory is written. `extract_gait.py` needs the immutable approved host canonical measurements/assets at the recorded repository location; no repository file is edited. Master generation is nondeterministic; extraction and exported PNGs are deterministic.

No additional view, dedicated walking generation, source approval by the user, runtime integration or production activation is claimed. A shared-source walking timing proposal is included for evaluation, not advertised as newly generated walking artwork.

## Compact backup staging

The two animated GIF previews are intentionally omitted from this backup staging and have not been submitted. MP4 previews, filmstrips, all generation masters and exact prompts, provenance, extraction recipes, masks, foot PNGs and checks are retained. The GIFs are reproducible with `python rebuild.py --canonical-package PATH_TO_LIMBS_PACKAGE`; the playback renderer recreates both GIFs. No publication has been performed by preparation of this directory.
