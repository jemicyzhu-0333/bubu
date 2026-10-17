# Surface-swimming rounded hands: isolated candidate review

2026-10-17. Latest user direction supersedes the earlier fixed-hand-root assumption: hands may swim over the body surface and stretch modestly; avoid humanlike long arms/elbows. This is a design proposal, not approved production capability. Do not modify the current host or admitted asset.

## What the failed experiment does and does not establish

The rejected experiment tangentially transported the original hand's material vertices while keeping a small surrounding boundary fixed. Its edge distortions and graph-path contradiction remain valid for that operation. A traveling *shape* is different: retract the old local bump while neighboring surface locations grow and shrink a rounded bump. The character's visible hand can move without transporting the same skin vertices over the full distance. The previous proof does not prohibit this design.

This can remain a single connected mesh. A separate hand mesh is optional, not mathematically necessary. Either way, adding body shape controls or a derived skin invalidates the original whole-asset hash. Preserve the original admitted asset and register a separately reviewed candidate only after approval.

## Candidate 1: same-topology traveling bump (preferred first test)

- Retain original body vertex positions and indices as the exact rest state. Author a side-hand retraction correction and a smooth surface-local rounded-hand displacement along a short authored route to the front-side cup grip.
- Evaluate one reversible shape field per hand: the original bump fades down as a single contiguous bump travels through the route. Do not crossfade two detached full-size hands. Local support follows the route; it is not the rejected narrow fixed boundary.
- Use a smooth carrier surface fitted to nearby torso samples, excluding the original protruding hand. Its tangent frame defines the hand position and outward direction; do not use the distorted hand surface itself to locate the next frame. Freeze the route and frame data after authoring.
- Keep the original rest geometry plus a small bounded set of authored body pose deltas. For the first tea action, offline-baked shape keys at rest/approach/grip/sip/return suffice; interpolate only after checking intermediate geometry. No general surface locomotion engine is required.
- The face and feet are excluded by explicit vertex masks and immutable face meshes. Front-side route must stay below/outside the face layer and eye silhouette. Use continuous first-derivative falloff at the influence boundary, not a hard positional clip.
- At each pose the one visible bump supplies the physical grip surface/frame; derive cup contact from that evaluated surface, not from a separate hidden socket that can float away.

Advantages: one connected skin, no mesh intersection seam, rest POSITION/index identity can be exact. Risks: flattening the old hand may leave a dimple; insufficient vertex density may cause ripples; too broad a bump can flatten the torso or change its silhouette; a rim-adjacent bulge can occlude/intersect face layers. Interpolating acceptable endpoints is not enough to prevent these issues.

## Candidate 2: surface-attached separate round hand plus reversible body correction

- Make an isolated derived body where the original side protrusion retracts during the action, plus a rounded hand instance following the authored surface route. Its root remains buried below the body surface; its visible length is bounded.
- Start with the simplest geometry experiment: hand and body share material/color; evaluate root embedding through the entire arc and in all views. The attachment frame is surface-driven, never an unconstrained world-space translation.
- This requires a derived split representation if adopted: the original hand is currently part of one connected mesh. Do not detach faces from the original admitted asset in place or leave both the original and moving hands visible.
- Root burial only hides an intersection; it does not produce a truly smooth union. Matching materials alone cannot guarantee matched normals, specular highlights, depth/ambient occlusion or shadows. A camera-facing fade also cannot fix a silhouette or shadow seam. If the natural overlap cannot pass under varied light and side/back views, reject this minimal candidate or escalate to a real blended surface.

Advantages: easiest to pose and keep a rounded hand silhouette; small stretch bound is explicit. Risks: ring seam, dark occlusion crescent, double shadow, hand floating on the surface, disappearing root from oblique views, and overlap with existing head accessories. A visually seamless result is unproven until rendered.

## Candidate 3: locally blended implicit shape, baked offline (fallback only)

- Offline sculpt a local smooth union of a torso carrier and a rounded moving appendage at authored poses, then fit/bake those surfaces back onto one stable connected candidate mesh.
- Prefer fitting to the original topology so the original rest is exactly retained. If fitting cannot preserve mesh quality, local remeshing changes topology and requires explicit review of rest-surface parity, UV/colors/normals and silhouette; it cannot be labeled byte-identical rest geometry.
- No runtime SDF mesher, physics solver, remeshing loop or generic soft-body engine. Output the same small pose-delta set as candidate 1.

Advantages: directly designs the attachment transition and avoids an intersecting-root seam. Risks: significantly more authoring, volume drift and topology correspondence errors; may not be necessary for this stylized short hand. Use only if candidate 1's real mesh density or shape quality fails.

## Minimal capability after art approval

One isolated `surface-hand-tea` candidate record needs only exact baseline/derived source hashes; allowed body deformation IDs and intervals; frozen route and reference surface; vertex influence/exclusion masks; hand thickness and permitted extension range measured relative to approved rest; one grip frame per hand; cup grip/rim frames; named contact intervals; collision clearances; and resource counts.

Do not invent a numerical extension allowance before seeing the approved reference. Start with near-constant round-hand width and a small explicit length range chosen from that reference, then measure it on actual geometry. Do not automatically retain the old 1.35 edge cap as an artistic law for the new migrating-shape representation; record edge/area distributions, require no collapse/self-intersection, and obtain approval for any changed numeric guard. Never relax a guard silently to make a failed design pass.

At future runtime integration, body morphs belong to the same exclusive body writer as joint poses; face weights remain exclusively owned by the existing director. A body correction must not reuse face morph channels. Existing drag/pet retains its original source, channels and caps.

## First-art and first-geometry gates

1. Art: true front, both three-quarter views and strict side; rest/approach/sip. One short round hand per side, no elbow/long connecting tube, no old-root pit, no duplicate hand, and a believable cup grip. Generated reference is a target, not mesh evidence.
2. Rest parity: deformation zero restores original POSITION/index arrays exactly for candidates 1/2-body-correction when using original topology. Original facial arrays/D2/feet remain immutable. Evaluate rest after complete enter/exit and repeated cycles, not only on initial load.
3. Actual mesh: close-up clay, wireframe, silhouette and ordinary beauty renders with front/side/back lighting and cast shadows. Check shoulder-root disappearance and new-root continuity; do not hide a seam behind the cup or use one flattering camera.
4. Shape migration: record maximum hand length/width, torso volume/silhouette drift, edge/area distributions and minimum triangle areas across sampled route positions. Test non-adjacent triangle self-intersections and body-versus-face collisions; rest-normal dot products alone do not prove inversion.
5. Contact: physical hand-to-handle/support and rim-to-mouth residuals plus ceramic-volume collision. An open cup surface requires a reliable closed ceramic solid/proxy for interior classification. Do not reject the intended hollow opening as solid or permit the ceramic wall to pass through the body.
6. Sequence: include intermediate route samples and entry/retraction/return, then interruption and complete rest restoration. Static approval remains separate from continuous-motion and host admission approval.

## Next step

Review the new art reference with the author. If it depicts a single rounded bump swimming smoothly with no long arm, build only candidate 1's isolated few-pose geometry test. Candidate 2 is a quick seam-risk comparison if needed; candidate 3 remains a fallback. Preserve all failed evidence so nobody later treats the rejected carrier as an approved rig.

## Six-pose concept review, 15:01 UTC

Viewed actual pixels in `bubu-bare-action-migration-20261017/gliding-hand-concept-v3/gliding-rounded-hands-sixposes.png`. Direction fits the latest request: short rounded hands relocate to the front side, no long arm or human elbow, and the old side region appears smooth in target poses. Suitable as an art target for candidate 1, pending user approval.

Do not transfer generated changes to the torso side silhouette, ears or feet into the approved model. The lower middle/right panels still show a dark circular root/ball-attached appearance; the image does not prove a seamless union. It also does not demonstrate intermediate migration, exact cup-mouth/hand-cup contact, or absence of self-intersections. Add three intermediate side-view positions and grazing-light root inspection to the actual geometry test. No actual model implementation or host admission is approved by this concept review.
