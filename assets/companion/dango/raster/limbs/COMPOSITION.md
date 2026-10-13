# Composition contract

## Asset status

These are source-derived assets and offline composition references. The application does not load this new manifest automatically. Existing runtime files are unchanged. A successful asset rebuild is not an end-to-end animation test.

The pack contains 240 base layers, 256 paired elbow repairs and three pose-specific root-interface patches. Only 208 elbow pairs meet the maximum 150° bend; the other 48 are explicitly disabled. The base count increases from the original 219 because quarter-view holding needs eight additional observed near-hand frames, body-coverage stencils are authored independently for both sides, and one authored step key pose is preserved separately from the orientation library.

## Geometry

- One logical pixel is one art unit. Production images are exact nearest-neighbor 8× copies.
- Visible art uses four declared colors and binary alpha. Pivot colors and white coverage masks are separate auxiliary data.
- Preserve the approved full-character silhouette. Canvas sizes follow actual source sampling, rather than shrinking hands and feet to the original undersized canvases.
- Upper and forearm controls are each 6 art units. The user approved this revision from 4 + 4; additional rig reach stays behind the body where the pose permits.
- A selected segment has a pixel-center root and tip. Integer-grid vectors approximate the nominal 6-unit bone within ±0.5 units and ±5°. Do not claim exact continuous bone length after quantization.
- Filenames truncate angle labels, such as `a022`; use the manifest's numeric 22.5° angle for calculations.
- Foot `tip` is an internal 3-unit skeletal attachment. `sole` is the actual ground-contact marker. A root-to-tip measurement does not measure the visible toe or root-to-sole distance.
- All placement uses integer translation after choosing the frame. The high-resolution inverse projection occurred during asset creation, never during runtime drawing.

## Fixed shoulders and target solving

Use the fixed view/side shoulder roots recorded in `validation/fixed-shoulder-targets.json`. Do not move the shoulder independently to make each pose pass. The report separates observed source wrists, mirrored counterparts, source-grounded rest positions and canonical-prop targets.

Choose legal segment pairs, minimize wrist error, then prefer body-covered branches to retain the approved short visible arm. A universal outward-bend rule does not reproduce these reference poses.

The maximum measured wrist-target error in the 40 registered goals is 1.662799 art units, in `mirrored-front-support`. This is a discrete IK positioning error, not an error in the surface-contact marker. Fixed floors and tabletops must not be moved to hide it. Such poses still require action-level contact solving. The demonstrated 22 × 19 canonical cup has separately solved bilateral targets with zero wrist-lattice error.

## Paws and props

`root` is the wrist attachment. `grip` is the prop/contact target, with three distinct meanings:

- Press and support: the visible palm-bottom boundary along the recorded surface normal.
- Hold: the actual cup-facing boundary.
- Grip: the shaft axis behind the visible front palm. This can be inside the palm; no unseen hole or back-half was invented.

Solve the wrist target from the desired contact position minus the selected frame's `grip - root` vector. An adapter that directly uses `grip` as the wrist will misplace the hand.

The source wrist axis defines palm orientation independently of its contact vector. Surface anchors are pixel centers, so exact marker coincidence does not imply zero half-pixel boundary error.

Side labels are screen-space left/right. The right three-quarter view is derived by reflecting the entire left three-quarter pose and swapping screen-side labels; the host must transform its world attachments as well as the sprite anchors.

Quarter-view holding has distinct observed `l` and `r` frames with `mirror: false`. Far and near palms have different perspective and occlusion; do not replace either with a scaled or mirrored near palm. For other permitted mirrors, reflect both pixels and anchors (`x' = width - x`). Body coverage and near/far action registration remain side-specific.

## Arm and elbow order

Compose each arm on its own temporary layer:

1. Draw the upper segment.
2. Draw the forearm at the upper tip.
3. Apply the exact angle-pair mask and patch at the elbow.
4. Apply shoulder attachment coverage as described below.
5. Place the arm in the action's body/hand layer stack.

The paired repair changes colors only inside the original source alpha union. Its edit region is the segment overlap and its one-pixel neighborhood. Outer ink uses an actual Euclidean distance of at most two logical pixels from the exterior; an older square-distance band made diagonal joints too thick and is not delivered. Open endpoints prevent added end caps. Covered internal ink may be removed even inside an endpoint plane.

The standalone 7 × 7 elbow file is a source-derived registration reference, not an additional layer in this pair composition. Drawing it independently would change the verified colors.

## Attachment coverage

The socket metadata intentionally differs from the original body-erasure proposal:

- `maskRole: attachment-coverage` means white pixels lie inside actual canonical body alpha at the registered location.
- It is never a mask for deleting body pixels.
- Transparent socket patches are declared no-ops: the approved composition needs no extra body paint or manufactured outlet outline.
- A shoulder stencil only limits the upper arm's open proximal half-space (axis projection ≤ 0). Preserve every positive-axis arm pixel, and retain forearm pixels that overlap that region.
- The stencil's two-pixel padding lies outside its useful sampling domain. Do not interpret that padding as proof that the body is absent beyond the stencil.
- Hip stencils provide registration evidence. Current standing-foot examples use normal body occlusion, without clipping the foot with this stencil.

The unchanged canonical body then covers embedded arm roots. This rule removed six exposed shoulder-root pixels in the waving example without altering the original body, hand, positive-axis arm or forearm images.

## Pose-specific root interfaces

The restored source contours preserve their real outer ink. Open proximal cuts remain open in the reusable palm. Three separately declared patches in `interfaces/interfaces.json` finish exposed root cuts for the demonstrated 225° wave: front three pixels, quarter one pixel, and back one pixel.

Apply these patches only with the recorded view, frame, registration and layer stack. They change color within existing alpha; they do not move the wrist or alter the body. Do not rotate them into unrelated poses or bake a closed wrist ring into every palm. Other visible root intersections require their own action-level check.

The back-wave upper edge also has two reviewed silhouette-quantization corrections with their orthogonal equivalents. Those belong to the base frame, unlike the conditional root-interface patches.

## Body and feet

The demonstrated front and back palms are foreground layers. In the quarter view, the far palm is behind the body and the near palm is in front. An action can declare different occlusion where its source supports it.

Standing support feet and far feet are normally behind the body. Forward swing or toward-viewer lifting can be foreground. The same direction can occur in either role, so do not assign layer order from angle alone. Preserve genuine short foreground-foot outline segments.

The separately preserved `step-keypose` is the authored static stepping layer used by the preview. It is not substituted with the nearest orientation-library frame.

The eight foot directions are a contour-orientation library produced from one high-resolution source per view. They are not an eight-frame walking cycle. Gait timing, planted-foot constraints, motion trajectories and action-specific offsets still need runtime implementation.

## Verified scope

Independent checks cover source SHA and inverse sampling, declared pixel edits, 240 base layers, 256 paired repairs, three conditional interfaces, exact 8× images, pivots, 56 contact-surface anchors, 456 nearest/tie wrist combinations, fixed shoulders across 40 goals, and the actual static examples. Standing, cup holding, stepping and lifting preserve the approved proportions; waving includes the subsequently reviewed source-contour restoration. Source-mask checks cover the six restored outlines.

This does not establish every body intersection for every action, a full walking cycle, all outfit combinations, application loading, or runtime interaction. The existing adapter must explicitly implement the manifest extensions, separate wrist/contact semantics, side selection, attachment coverage and paired repair before these assets are enabled.
