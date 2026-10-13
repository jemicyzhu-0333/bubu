# Dango limb layers

Source-derived pixel-art hands, feet and short arm segments for Bubu's Dango companion. The approved whole-character reference establishes the soft rounded proportions; the existing body, ears and face remain unchanged.

## Contents

- **240 base layers:** 152 palm frames, 30 foot frames, one authored step key pose, 32 arm segments, one elbow registration layer and 24 socket layers.
- **256 elbow angle-pair repairs:** 208 permitted combinations; 48 exceeding the 150° bend limit are explicitly disabled.
- **Three pose-specific root-interface patches:** the documented front, quarter and back 225° wave compositions only.
- Logical PNGs, exact nearest-neighbor 8× exports, pivot markers, a manifest, original generation masters, prompts and reproducible extraction recipes.

Quarter-view cup holding has separate near and far hands because their perspective differs. Socket coverage is registered separately for each side of the actual body.

## Rendering contract

Arms use **6 + 6 art-unit bones**. Select pre-baked direction frames, then apply integer translation or declared mirroring. High-resolution reprojection is an offline production step; runtime must not rotate or stretch these pixel layers.

Keep shoulder roots fixed for each view and side. Choose the elbow branch using the visible area of the actual segment silhouette, not only its centerline. Shoulder coverage constrains the open proximal attachment region; it does not erase or repaint the body. Elbow patches repair only the real segment union.

Contact anchors describe the observed contact: underside for press/support, vessel edge for hold, and shaft axis for a gripping front palm. They are distinct from the wrist root and palm center. Lifted feet use their registered pose offset and replace the corresponding standing foot.

Six source contours were restored from their original masters to preserve the full outer ink arc. Root-interface patches complete only the documented visible attachment cuts; they must not close every reusable palm root.

## Verified scope

Static standing, cup holding, waving, stepping and lifted-foot composites use actual exported layers against the canonical character. Palette, alpha, nearest-neighbor scaling, anchors, direction combinations and recoloring have accompanying checks. See the validation report for exact coverage and any remaining limits.

This package does **not** activate itself in the app. Loading the manifest, applying its coverage and joint rules, contact-constrained IK, continuous motion and native Windows/macOS behavior require a separate integration check. Static key poses are not a complete walking or push-up cycle.

Discrete fixed-shoulder IK currently has up to **1.663 art units of wrist-target error** (mirrored front support). This is separate from contact-anchor accuracy. A fixed support surface must not be moved to conceal that error; contact-constrained action integration remains necessary. The demonstrated canonical cup pose has zero discrete wrist-target error.

## Rebuild

Run `python scripts/rebuild.py --output /tmp/dango-rebuilt --verify` to rebuild all base, joint and interface images and compare them with the package. Run `python scripts/render_previews.py --output /tmp/dango-previews --verify` to reconstruct the five reviewed static poses from their individual exported layers. The deterministic stage starts from preserved source images and explicit extraction data; image generation itself is not deterministic. Consult the source index for master and prompt hashes, and `COMPOSITION.md` for changes from the original small-canvas specification.

The reproducibility check used Python 3 and Pillow 12.3.0. The pinned image dependency is in `scripts/requirements.txt`. Run `python scripts/check.py` for read-only asset checks.
