# Shared-basis bank contract

Body remains45945 vertices without morph targets. All five original face meshes preserve r6 base attributes, topology and historical morph deltas exactly. BasicA4_01..08, BasicA8_01..08 and BasicD4_01..08 are unique semantic knot names. A_brow_L/R share the batch1 Basis/topology/weights exactly and should be shared when the library is assembled. No tongue is added by this batch.

Preserve all authored float32 POSITION and NORMAL knot deltas, including sparse accessors with omitted zero base bufferView. Reset the entire face roster before applying one semantic state; activate at most two adjacent authored knots. Do not replace paths with endpoint interpolation or silently recompute normals.

The independent batch GLB is a review/restore package. Future full-library composition must verify shared base equality, unique target names, roster coverage and exact neutral. It is not approved for runtime yet.
