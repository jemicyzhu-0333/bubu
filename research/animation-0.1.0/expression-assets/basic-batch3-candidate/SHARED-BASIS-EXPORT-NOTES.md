# Shared-basis bank contract

Body remains45945 vertices with no morph. Five original face meshes retain exactly the r6 Basis, normals, skinning and topology. Do not duplicate the body for each face. Original historical targets remain unchanged.

BasicN3_01..08 and BasicT05_01..08 are unique names and can be banked separately. Existing A_brow_L/R share all exported base attributes and indices with batch1, so later library composition must share those layers rather than duplicate them. A_tongue is a new257vertex/448triangle Body-weighted layer, with intentional zero-area Basis. It is needed only by N3 and future explicitly reviewed mouth-colour states.

Store all eight authored POSITION/NORMAL knot deltas and preserve float32 values. Decode sparse accessors without bufferView from zeros before applying sparse records. Do not replace knot paths with endpoint interpolation or recalculate normals without a separate equivalence gate. All inactive layers must return to Basis; do not leave N3 brow/tongue values active for legacy states.

These independent review GLBs are not the final banked runtime package. Full-library composition must check shared Basis equality, unique semantic names, roster coverage and zero-rest identity after all batches are approved.
