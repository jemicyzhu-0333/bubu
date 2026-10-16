# Batch3: N3 / revised05

Status: reference directions approved; actual3D static candidate passed independent shape, four-view attachment and single-face intensity review. Awaiting user3D confirmation. Runtime remains paused.

- N3: fixed round eyes, small raised brows, vertical black open mouth with a small bounded warm inner tongue colour.
- T05: the user-corrected05, fixed full round eyes and horizontal rounded opening. Historical r6 Face05 is preserved but superseded as the current design direction.
- Source/actual boards use matching character height; actual99px is not an enlarged surrogate.
- Four views and five intensities are reviewed for both faces. Eight extra N3 frames inspect the tongue visibility threshold.
- r6 historical 483 accessor/target comparisons and four neutral renders are exact. New brows share exact exported Basis and topology with batch1.

## Tongue depth correction
The first version passed front containment but 46 of705 visible side samples at full strength had no black mouth behind them. Body and tongue self-occlusion were tested before counting. Only N3 mouth outermost12% gained a smooth maximum .004 forward depth; front X/Z contours and all T05 attributes remain exact. The tongue follows the evaluated black surface. Final65 intensity mask tests pass, and the85degree before/after actual render shows no thick lip step. Keep the original diagnostic and result as regression evidence.

## Limits
Single semantic face, at most two adjacent authored knots. Reset all old/new morphs across all eight face layers, including hidden brows and tongue. Zero-area hidden layers and collapsed mouth inner boundary are intentional. Do not add faces directly. Gaze is not implemented; white caps remain reflections. The pink tongue is a stylized mouth-interior colour surface, not a physical oral cavity. This review does not certify dynamics or final user acceptance.
