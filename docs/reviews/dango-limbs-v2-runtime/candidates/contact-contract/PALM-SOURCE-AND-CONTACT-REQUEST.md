# Palm proportions, contact roles and source request

Audit only. No production edits. Rejected book/knit circle wrists and catch-star horizontal palm were not integrated.

## Approved identity versus action-source size

Verified full-character source SHA256:9e77a9c2a455c3a7c9cc145bb8b0f458ede80bd367e4eb89539c6abddc8b6fdd. Its standing hands are small rounded flank protrusions. Normalized rest recipes explicitly use a shared isotropic scale69.415385/411=.16889388 art/source pixels; no per-view shrink was applied. The approved full-character image does not itself depict broad wave/reach palms or book/needle grasping.

Measured opaque bounds at rotation-neutral a000, excluding transparent canvas:

| Family | View/side | Opaque WxH | Alpha area | Width/body width |
|---|---|---:|---:|---:|
| rest |front|10×12|108|14.4%|
| rest |quarter|12×12|125|16.4%|
| rest |back|11×12|113|15.2%|
| wave |front|23×17|289|33.1%|
| wave |quarter|24×15|271|32.9%|
| wave |back|21×14|225|29.0%|
| hold |front|13×13|133|18.7%|
| hold |quarter near|14×13|142|19.2%|
| hold |quarter far|12×10|99|16.4%|
| reach |front|21×14|239|30.3%|
| reach |quarter|19×13|176|26.0%|
| press |front|14×12|135|20.2%|
| press |quarter|14×13|122|19.2%|

Exact measurements, source frames and recipe paths are in palm-measurements.json; script palm-measurements.py reproduces them. Body width is each source registration's canonical body rect (front69.415385, quarter73.025641), not a guessed66 grid or transparent canvas.

Front reach has2.21× standing-hand alpha area; wave2.68×; hold1.23×. This explains why reach becomes a large face-covering horizontal palm when used for every star hand. It does NOT justify globally shrinking approved action frames or restoring tiny6px hands. Reach/wave were derived from separate enlarged action references and have different semantic silhouettes. Their source-body scaling is isotropic; the issue is suitability of source pose, not a proven export scaling bug.

## Catch-star: distinguish actual anchor from auxiliary gesture

Current sampled source:
- Star approaches from p=.08 to.42.
- Right hand reaches from.12 to.37. Before.42 it is an approach gesture; hand and star trajectories intentionally differ.
- After.42 right target approximately matches the registered star anchor, within.125 art unit in x because sampler uses8.5 while tool right anchor is8.375. Lowering is.67-.90.
- Left appears only when lowering>.3, at held+(-10,+3). Relative to the17×17 star's origin this is(-1.5,17), outside the tool bounds. Star has ONLY a right anchor. Therefore left has no registered star-contact role; treating it as a second star grasp is unsupported. It is an auxiliary/free hand trajectory until new source evidence registers a contact.

Using smaller cup hold here would replace one wrong role with another: its grip is the observed cup-facing edge, not a star grasp. Existing rest hand can establish the compact visual identity for a new free/receiving pose, but using it as a contact without an observed source is not justified. Keep current legacy secondary gesture rather than declaring a transplanted cup hand approved. Request a compact right receiving/catching source and separately a small left auxiliary gesture/optional under-star support with an actual observed contact; reject face overlap in the source composition before extraction.

For free wave/reach, orientation must be authored from the gesture/body silhouette and face clearance, not selected solely because the forearm can reach a marker. For hold/press, orientation follows the observed prop/surface normal and source wrist axis independently. A single poseByProp value cannot cover both hands/phases.

## Why foreground forearm alone fails

Experiment forearm-layer-experiment-1x.png and2x pairs the exact same candidate pose with forearm behind versus in front of body, for knitting, book, sip, hiccup and keyboard. It uses the real new forearm alpha and existing joint-repaired colors, never draws a fabricated connector or closes the palm root.

Observed result: foreground forearm often exposes upward black crescents/strips near cheeks/eyes and a second floating proximal root. Some palm/fore overlap becomes more legible, but the circle sticker is not repaired. A universal front-fore rule is rejected.

The correct layer contract can split upper-behind / distal-fore-plus-palm-front only when the action-specific source shows a continuous wrist and the forearm's emergence point. The elbow patch must remain restricted to real source union; ownership of overlap pixels between passes must be explicit. An open forearm root cannot simply be exposed at an interior-body elbow. Natural overlap needs source-supported contour/occlusion at that junction, not a globally closed palm ring or skin-colored eraser over body/ink.

## Initial family1: stationary cup hiccup, then ordinary sip

Start front hiccup because both cup contacts are static in art space. Preserve cup22×19 pixels and its existing position(22,38). Left target(22.875,48.375), right(42.5,48.375), throughout p0..1. The right anchor is on the handle side; do not invent a symmetric vessel edge on that side. Body motion applies to hand and cup together once.

Ordinary front sip uses cup(23,43) at rest and(24.421795,36.028846) at the lifted plateau. Current target data:
- Rest left(23.875,53.375), right(43.5,53.375).
- Lifted left(25.296795,46.403846), right(44.921795,46.403846).
- Local phases: p0-.08 held-rest; .08-.34 lift while both hold; .34-.66 sipping plateau while both hold; .66-.92 lower while both hold; .92-1 held-rest. These are continuous hand/cup contacts, not repeated pickup/release phases.
- Global presentation entry/exit envelope is separate and common to hands/prop. Hiccup's cup-specific(-1,-5) refinement does not apply to ordinary sip.
- Special paper-return->sip recovery is a separate instance contract: cup drops by5*ease(t/.6); hands begin release only aftert=.7 and fade/home through1. Do not impose that release on ordinary sip.

Per-hand source request:
- Keep approved compact soft hand identity. Existing front hold13×13 and quarter near14×13/far12×10 are reference envelopes, not a request to enlarge to reach/wave21-24px or force an exact box.
- Source must visibly show the unchanged actual cup and each real contact: left vessel-side hold, right handle-side grasp; open wrist attached to a short forearm in the SAME source composition. Give separate transparent palm and distinct forearm cutouts plus the uncut source for join evidence.
- Record wrist root, wrist axis, actual cup-facing contact/normal or handle shaft-axis, contact boundary vs opaque-center convention, foreground/prop occlusion, and body-entry region. Front left candidate normal points toward the vessel(+x); right handle registration requires the observed handle-grasp source, not an assumed mirrored normal.
- Request three whole-character key poses: stationary/low hold, mid-lift, mouth-height hold, using unchanged body/face/cup placements and current contacts. Natural outer outline must continue across wrist; proximal cuts remain open. No full ring, global erasure, body redraw, or longer visible palm.
- Quarter is a later gate requiring independent actual near/far source and action depth; mirror reflection alone cannot authorize far hand in front.

## Initial family2: front keyboard alternating presses

Keep keyboard-front50×16 at(9,53), original anchors L(14,6.125),R(35.875,6.125). Source key-top anchors in body coordinates are L(23,59.125),R(44.875,59.125). Current hand endpoints at zero lift are(23,57.125)/(44.875,57.125), i.e.2units ABOVE those anchors. These inherited endpoint trajectories are legacy palm-center guides, not verified new underside-contact markers. It is incorrect to declare them literal surface-contact points for a newly registered press palm.

Current phase data is fully deterministic:
- work=pulse(p,.02,.17,.82,.98).
- tap=sin(14*pi*p)*work.
- Left lift=max(0,tap)*4; right lift=max(0,-tap)*4.
- Horizontal targets oscillate oppositely bysin(4*pi*p)*work (up to1unit).
- Thus L lifts during positive tap half-cycles while R is lower; R lifts during negative half-cycles while L is lower. Zeros atp=n/14 switch hands; at work-envelope edges both settle.

Physical contact contract must distinguish release/lift, descent, actual press, and recovery per hand. A proposed source-supported model can bind the new underside marker to the real key plane during its lower phase and follow the existing lift above it. The required2unit endpoint-to-contact semantic conversion must be documented against the old palm/keyboard source; do not move the keyboard or simply add2 to every unrelated hand target. At minimum provide an explicit oldPointRole=legacy-palm-center and separate keySurfacePoint, not a silent coordinate rewrite.

Source request:
- Front left/right compact press palms at key-top contact and lifted recovery; press14×12 is an existing source envelope, while approved rest10×12 establishes identity. Do not globally scale either without source review.
- Show unchanged keyboard, short natural wrist connection, actual palm underside touching a key, source normal toward key plane, and the same palm lifted. Record projected surface normal; existing front press a045 has a7degree tilt, so exact horizontal key surface needs a source-aligned offline frame or a registered actual tilted key-plane normal.
- Preserve alternating timing and opposite horizontal motion. No fixed contact requirement during lifted half-cycle, no forearm crossing the face, no round root cap.
- Start front only. Quarter keyboard is a separate surface plane and near/far registration, not a horizontally compressed front.

## Evidence/data

initial-contact-family-samples.json contains78 samples of hiccup/sip/keyboard in front/quarter across all major phase boundaries, with final sampled tool transforms, exact sprite anchors, per-hand endpoint/gripPoint and opacity. These are measured current-runtime values. Source requests and physical-contact reinterpretations above are proposals requiring source verification, not completed implementation.

No third-link candidate or rejected pass experiment should be enabled on the strength of this audit. The next useful decision is a source-backed compact cup-hand/forearm join for front hiccup, then sip phase extension; keyboard contact conversion and exact press normal can proceed as the second independent family.
