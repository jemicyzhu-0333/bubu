# Reviewed low-pose source extraction

Status: reviewed geometric source masks and source-RGBA cutouts only. No canonical resampling, pose chain, contact acceptance or production integration.

Source SHA-256: cfcb991f89a0948667949b9004301534daeb120bff0d994a9aef2d455c3bdf3a.

The first approximate polygon was replaced by explicit source scanlines. The source pixels were inspected at enlarged scale, the outer contour intervals corrected, and visible cream-cup contamination removed by correcting geometric row endpoints. The extraction program never tests RGB to remove pixels: it copies source RGBA inside saved geometric intervals and sets alpha to zero outside. It asserts the source master hash. Original alpha is retained inside, including sub-255 pixels; it is not silently forced opaque.

The original upper and lower ink contour is retained, with open proximal cut edges. Nothing is drawn or recolored. At the shared lower junctions, the scanline split assigns the palm branch to the palm and the continuing cup branch to the cup; that ownership choice is explicit geometry, not a claim of a physically observed hidden boundary.

- Left: palm owns the shared vessel-side black contour. Source contact is its outward pixel edge at (306.0,520.5), normal (+1,0). The earlier proposed305.5 was the last ink pixel center; the final recipe makes the half-pixel convention explicit.
- Right: cup owns the handle shaft black band x489..498 at y520. Palm starts at x499. Final palm contact is the boundary (499.0,520.5), normal (-1,0). Handle shaft center (493.5,520.5) is a separate reference, never a palm contact. No hidden/back palm was synthesized.

Bounds at the only applied body-based measurement scale69.415385/651 (no actual resampling performed):

- Left source83×104px → 8.850×11.089art units; 68.1% of original13 width and85.3% height.
- Right source71×98px → 7.571×10.450art units; 58.2% of original13 width and80.4% height.

These isolated palms are distinctly smaller than existing13×13hold. Their unequal width also reflects different visible contact/occlusion ownership. Do not fix this by independently enlarging palms while calling the result source-body-proportional. A larger source-supported wrist/fore piece would be a different extraction and needs its own review.

Review images:
- mask-overlay-reviewed.png: exact masks on unchanged source, green retained pixels.
- extraction-review.png: source context and both actual RGBA cutouts on dark gray, 3×.

Reproduce: python extract.py. verification.json verifies each retained pixel's original RGB and alpha and records resulting hashes. The recipe contains every geometric scanline; no heuristic RGB cut or unrecorded contour edits are needed.

Remaining checks belong to the next stage: independent palms aligned to the actual unchanged cup, shared-line ownership against canonical cup pixels, open wrist/fore overlap, fixed-shoulder reach, and near/native-scale appearance. This source extraction does not satisfy those gates.
