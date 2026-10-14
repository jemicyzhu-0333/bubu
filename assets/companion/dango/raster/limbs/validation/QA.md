# Asset validation

## Historical source-contour verification

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
- The current 40-goal report has a maximum wrist-target error of 1.500496 units in front/left support. The fixed canonical cup has zero left error and 1-unit right error. Exact contact remains unresolved; no goal or prop was moved to improve this number.
- Hidden prop surfaces are not reconstructed. Partial source visibility cannot establish complete support contact or collision safety.
- Body coverage outside each stencil's declared domain is unknown. A transparent stencil margin must not be interpreted as absent body tissue.
- Hip stencils currently register coverage only. Foot layering and grounded motion still require action-specific integration and testing.
- Single-angle interface patches must not be generalized to other poses, mirrored sides or occluded roots without a new assembly check.

## Historical package verification

The final portable package contains 240 base layers, 256 elbow pairs and three pose interfaces. An independent comparison checked 2,015 packaged PNG files against the reviewed candidates and resolved 1,096 manifest file references with no discrepancies. Source and recipe hashes match.

Independent executions of the packaged asset check, full deterministic rebuild and five-pose preview rebuild passed. The rebuilt native-resolution and 2× preview pixels match the reviewed images. This verification covers the final source-contour corrections.

## Current uniform front/right registration

- New fixed root [58.5, 45.5] applies to every front/right action. Canonical X 58.6 is quantized to the existing half-pixel lattice; prior Y 45.5 is retained. This is not a complete canonical-anchor restoration.
- Canonical body hash/anchor and all other eleven sockets are checked unchanged. Twelve full 25 × 25 stencils (7,500 pixels), useful 21 × 21 domains, transparent padding, local pivots and exact 8× coverage are independently verified against source alpha.
- Ten front/right solutions are recomputed in the 40-goal report and the 33-pose preview report. All original requested wrists and the other solutions remain unchanged.
- Nine regression cases pass, including stale old-root coverage with a recomputed matching hash, old root metadata, altered body hash/pixels, padding, 8× errors and moved targets.
- Current five-pose images are rebuilt from actual delivered layers. Historical images and target reports are retained separately. The prior waving image already failed pixel reproduction before this registration revision, so it cannot be presented as current reviewed evidence.
- The right canonical cup wrist is one unit left of its original target. Reproducibility and visual inspection of these static images do not establish exact bilateral contact.
- The old hiccup source-contact pose at [61.5, 45.5] remains disabled and unregistered for the new generic shoulder. No body, prop, palm, foot, upper/forearm source art or joint/interface pixels are changed.
- Generic runtimeReady remains false; hostAcceptsContract remains null. Separate actual-artist, continuous-phase and native-platform evidence must retain their own scope.
