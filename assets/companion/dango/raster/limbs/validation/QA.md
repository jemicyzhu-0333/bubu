# Asset validation

## Verified

- 182 paw and foot sprites: 152 paw frames and 30 foot frames. Logical dimensions, binary alpha, four-color palette, transparent padding, exact nearest-neighbor 8× images, pivot markers and recorded source hashes pass.
- One additional observed quarter-view step key pose matches the previously reviewed source sample exactly; its inverse sampling, production image and anchors pass. It is distinct from the eight-direction foot library.
- 32 arm segments: six-unit upper and forearm bones across 16 directions. Quantized lengths stay within ±0.5 unit and directions within ±5°. Inverse sampling matches the recorded source transforms.
- 256 elbow combinations: 208 permitted nominal bends and 48 disabled combinations. Color patches preserve the original segment union alpha; masks identify only changed pixels. Production images and pivots pass.
- 12 left/right shoulder and hip registrations: coverage stencils match the canonical body alpha in their declared domain. Transparent patch images do not erase the body.
- 56 palm or cup-side contact markers match their declared surface normals. Rod-grip markers retain their separate shaft-contact semantics.
- 456 nearest-angle forearm/paw combinations, including ties: no enclosed transparent holes in non-grip combinations. This test does not by itself establish a correct exterior outline.
- Source-contour review repaired six affected pose families. All 48 directional frames were rechecked against their source transforms; 124 explicitly reviewed pixel adjustments match the recorded edits and quarter-turn mappings.
- Three registered wave poses have separate interface patches: five existing opaque pixels are recolored. These patches are restricted to the documented 225° pose and layer combinations.
- The six repaired body compositions have no remaining exposed pink pixels along the inspected paw exterior. Native-resolution and 2× renderings were visually reviewed with the canonical body and fixed registrations.

## Limits

- These are asset and offscreen composition checks. Application runtime integration, native desktop behavior and continuous animation have not been accepted by this report.
- The fixed-shoulder discrete solver has a maximum tested wrist-target error of approximately 1.663 units in a front-support case. Exact contact with a fixed support surface remains unresolved. The two canonical cup targets have zero discrete endpoint error.
- Hidden prop surfaces are not reconstructed. Partial source visibility cannot establish complete support contact or collision safety.
- Body coverage outside each stencil's declared domain is unknown. A transparent stencil margin must not be interpreted as absent body tissue.
- Hip stencils currently register coverage only. Foot layering and grounded motion still require action-specific integration and testing.
- Single-angle interface patches must not be generalized to other poses, mirrored sides or occluded roots without a new assembly check.

## Final package

The final portable package contains 240 base layers, 256 elbow pairs and three pose interfaces. An independent comparison checked 2,015 packaged PNG files against the reviewed candidates and resolved 1,096 manifest file references with no discrepancies. Source and recipe hashes match.

Independent executions of the packaged asset check, full deterministic rebuild and five-pose preview rebuild passed. The rebuilt native-resolution and 2× preview pixels match the reviewed images. This verification covers the final source-contour corrections.
