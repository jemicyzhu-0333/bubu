# Dango limb artwork contract

## Visual identity

The approved whole-character prototype is `full-character-v2.png` (SHA-256 `9e77a9c2a455c3a7c9cc145bb8b0f458ede80bd367e4eb89539c6abddc8b6fdd`). Preserve its soft, short mittens, natural body joins and shallow round-bottom feet. Its approval covers limb identity and proportions; the existing canonical body, ears and face remain separate and unchanged.

The prototype's visible standing foot is approximately 19 × 9 art units. Earlier 6-pixel palms and small feet failed the user's proportion review. Do not restore those sizes merely to satisfy the original canvas table. A larger transparent canvas does not by itself solve undersized artwork.

## Extraction and directions

Retain original generation masters, prompt text, hashes and declared reference roles. Each cutout uses an explicitly reviewed geometric mask. Keep original RGB inside the mask; do not remove background by a global color threshold. Any edge exclusions or final pixel edits are listed in the extraction recipe.

Map source body scale to canonical body scale uniformly. The four-color production layer and the unchanged source-color reference are inspected side by side. Root, skeletal tip and contact/sole are different registrations; never move a contact solely to make an internal bone-length test pass.

Direction frames may be pre-baked by inverse-projecting logical pixel centers into the high-resolution source once, using a recorded rotation and uniform scale. Runtime selects the resulting PNG; it does not rotate or stretch it. Use one consistent uncompressed foot source per view for a direction family. Do not alternate compressed standing and extended feet, or call an internal tip angle proof of visible orientation.

## Joins and depth

Natural palms may overlap the body's original edge. Preserve the approved near/far depth: quarter near hand in front, far hand behind. A view-specific registration correction is explicit; it is not a moving shoulder for each action. Standing feet sit behind the body; lifted and stepping foreground feet use their authored pose offsets and replace the corresponding standing foot.

A source outline that separates two overlapping forms may be retained. A closed wrist outline pasted onto another closed body outline is a seam defect. Grip, cup and surface contact sources distinguish the palm from the prop and its occluding edges. Hidden roots are not evidence of a fully observed component.

## Acceptance scope

Inspect native and 2× composites, both sides, meaningful joint angles, nearest-frame boundaries, recolored skins and representative contact props. Pixel-count, alpha, palette and anchor tests complement visual review. Static samples do not establish a full locomotion cycle, integrated renderer behavior or native Windows/macOS acceptance.

This is an asset-only package. Runtime loading, bone configuration and socket/joint consumers require a separately verified integration. The final acceptance report must name unfinished or unsupported cases instead of marking the complete inventory as passed by implication.

## Source-specific limits

- A closed front gripping mitten may cover the pole. Its prop pass-behind channel is a compositing relationship, not a fabricated transparent hole in the observed palm. Any departure from the original two-pixel-hole request is listed in the final contract.
- Author-registered skeletal axes are control metadata, not landmarks supplied by the image generator. Contact points remain on the actual observed contact surface.
- The source-derived outline follows the approved character's pixel rhythm. Global erosion or a universal two-pixel ring must not turn soft palms into black hooks. Report measured outline exceptions explicitly.
- Support references distinguish a light resting contact from a weight-bearing push-up. A plausible single contact pose does not prove the latter's loading, recovery or loop.

## Contact anchor semantics

`grip` is the point a prop or contact target aligns to. For press and support, it lies on the true outer palm underside along the declared contact normal, not at the palm center. For hold, it lies on the observed vessel-contact edge. For a wrapped pole, it may lie inside the front palm silhouette because the shaft passes behind that palm. A source `palmCenter` may be retained separately; it must not silently become the IK contact target.

When quantizing a contact point, preserve its direction and choose an actual opaque boundary pixel near the source contact position. Record the source-to-logical error. Updating a blue pivot requires new anchor verification even if artwork pixels are unchanged.

## Thick-limb rig evaluation

Arm bones are now six art units per segment, following the user's explicit approval. The observed source stem is approximately 9.845 art units thick. Keep the extra internal chain concealed through fixed, view-and-side-specific shoulders and a valid elbow branch; do not shrink the source stem to the previous five-unit suggestion.

Elbow branch scoring must use the transformed segment's actual opaque area outside the canonical body and foreground palm, not just the bone centerline. A centerline can be completely inside the body while a thick source limb still produces a detached pink strip beyond its outline. Compare branches at the same shoulder, wrist target and bone lengths, recording contact error independently.

The upper-arm proximal overlap is explicitly a body-internal attachment region. Its non-positive-axis extent, including the open root cross-section, may be constrained by the real body mask; this rule must not erase the root-to-tip limb or act as a post-hoc painted repair of the final character. Elbow seam patches may change colors only within the actual combined segment silhouette and must retain the union alpha.

## Inventory adjustments

The base inventory is 240 layers: 182 palm/foot frames and one authored step key pose, 32 arm segments, one elbow registration layer, and 24 socket-related layers. The increase from the original 219 comes from eight authentic perspective-specific near-hand frames for quarter-view cup holding and twelve additional socket layers for explicit left/right body coverage, plus the separately preserved authored step key pose. A 256 angle-pair elbow patch set is auxiliary; 48 pairs exceed the 150-degree bend limit and remain disallowed for runtime use.

Socket coverage is an attachment stencil applied to the limb's open proximal region. It is not permission to erase or repaint the canonical body. A transparent no-op color patch is valid where no new visible body patch is needed; label it honestly. View-specific body coverage must not be obtained by blindly mirroring an asymmetric body view.

## Exposed root interfaces

A source cutout must preserve the real distal outline before any attachment correction. Six source-mask contours were restored after comparison with their complete-character masters; source ink must not be replaced with an arbitrary diagonal open cut.

An open proximal cut can become visible when the reference's body is replaced with the canonical body. Such an interface is a separate, pose-specific repair, not a reason to close every palm root. The demonstrated 225° wave uses three ink pixels for the front interface, one for the quarter interface and one for the back interface. These patches preserve alpha and registrations, and apply only to the documented composition. They must not be blindly rotated into every runtime pose or embedded as a closed ring in the reusable palm.

Distal sampling corrections are different: the back-wave upper contour's two explicitly reviewed pixels are part of the reusable silhouette correction and are recorded with their exact orthogonal equivalents. Preserve this distinction in the manifest and acceptance report.
