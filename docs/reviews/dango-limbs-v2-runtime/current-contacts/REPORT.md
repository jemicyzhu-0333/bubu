# Dango contact-target inventory and pre-registration baseline

Read-only pre-shoulder-registration snapshot, 2026-10-13. Material baseline: feature/pet-motion-craft, fore repair `6c03a998592a12942c376c6c024fe6acadd835f0`. All 1,073 recorded fore/elbow PNG Git objects match that publication locally. This directory has no .git; branch identity comes from the task/publication record. The gait-only c89ba6f head does not alter these sampled contact modules. The subsequent uniform front/right shoulder correction changes root-dependent errors and branch/admission results; these TSV errors remain explicitly historical baseline evidence. Targets, props and semantic classes are unchanged. See the sibling shoulder-registration review for paired updated measurements. Run probe.mjs on the new checkout to obtain current errors.

## Scope and reproduction

`contacts.tsv`: all 44 PET_ACTIONS, all 83 allowed action/view combinations, at p=0,.125,.5,.875,1. No unsupported view is forced. F=front, Q=three-quarter. Explicit quarter-left/right requests on actions resolve through semantic policy; Q is the runtime view, reflected from asset three-quarter-left around x=33. Do not solve against a guessed/drawn alias.

`probe.mjs`: node probe.mjs /path/to/bubu [action ...]. Uses that checkout's @napi-rs/canvas, actual source loader, unchanged contactContract/solveLimb and createDangoRasterArtist. Outputs JSON including tools, world targets, target normals, roots, selected lengths, wrist/elbow, errors and admission. DENSE=256 enables a 257-phase summary; eight informative cases were run once into `dense.tsv`. Session-story stages, mirrors, wardrobes, reduced-motion and native desktop playback are not claimed covered.

Coordinates are body-local art units, after tool sampling/transforms and before renderer-wide body/stage transforms. Compare hands and props in this same space. All assets loaded; ready was required for every sampled artwork. No solver, source art, prop, body, renderer or production gate was changed. No images were generated.

## Separate meanings

G=continuous grip while held; T=point/surface touch intent including hover/approach; F=free gesture/auxiliary; S=planted support; I=integrated free running hand with no v2 contact contract. A changing class is listed at each phase. `-` means no sampled hand. Zero-opacity endpoints (paper-return p=0/1, build-blocks p=1) are declared positions, not visible contacts.

These are semantic audit classes, not new runtime contracts. Existing pose-by-prop overgeneralizes: sing/tiny-chef left are labeled shaft-grip by runtime, snack-picnic left edge-hold, mirror-meet right free/rest, and paper-plane/return free/rest even during holding. Read-book right is a page-touch trajectory during .22<p<.72, while runtime still calls it edge-hold. Catch-star hands are free reaches; no continuous grip claim. Keyboard/drum taps are not continuous holds. Dango photo-pose actually has camera grips in this sampler. No unified reach percentage is meaningful.

Target-normal constraints currently exist only for support and press: (0,1), tolerance 22.5 degrees. Thus workout, keyboard, drum and take-note left have this normal. Other current contracts have null normal; a marker match does not prove shaft/surface contact, outline quality or occlusion. High-five and page-turn touch intent currently has no normal contract.

## Fixed geometry and admission

V2 world shoulders: F left (4.5,45.5), right (61.5,45.5); Q left (13.5,43.5), right (63.5,36.5). Legacy sampler roots are left (7.4,39.713), right (58.6,39.713) in both views. They are not interchangeable.

Bones are nominally 6+6. Actual quantized root-to-tip vectors have length 5.656854, 6 or 6.324555 each. The solver uses actual vectors, registered paw grip-root offsets, legal elbow pairs and fixed shoulders. It must not move the body/prop to hide residual error.

`direct mask` means actual painter.plan accepts that sampled frame (error<=1.25 AND front paw depth AND hand.layer!='back'). `standard mask` means actual opt-in standard artist set hand.limb=true. Its whole-side/action/view guard samples 257 phases with error<=0.75, plus per-frame checks. It is conservative sampling, not continuous certification. Q runtime right maps to the package's far paw and stays legacy even when error is tiny.

Only bubble-blow/F right and hiccup/Q left were admitted continuous-grip hands across the five keys. Snack-picnic/F and Q left were also admitted, but are F auxiliary hands. All other sampled hands remain legacy through the standard artist. Generic manifest runtimeReady=false; hostAcceptsContract=null; both hiccup source-contact sprites runtimeReady=false. Tests inject acceptContract:2 only; this is not production activation.

## Actual repair entry points

- Bubble-blow/F right: tool origin (47.671795,32.153846), anchor (6.375,21.5), target (54.046795,53.653846). Constant through the action. Standard admission YES. Selected asset upper=112.5°, fore=22.5°, mirrored right arm; S=(61.5,45.5), E=(63.5,51.5), W=(57.5,53.5). Paw paw-grip-l-front-a000.png, rendered marker (53.5,53.5), error .568. This is the smallest honest next visible root/fore-shape repair specimen: use this unchanged real-admitted pose; do not substitute a forced pose or move its joints/prop.
- Hiccup/Q left: cup (34,38), left anchor (.875,10.375), target (34.875,48.375). Standard admission YES. Asset angles upper=315°, fore=22.5°; world S=(13.5,43.5), E=(17.5,39.5), W=(23.5,41.5), marker (34.5,48.5), error .395. Paw paw-hold-r-three-quarter-left-a135.png with whole-view reflection. Q right target (54.5,48.375), error .875, blocked by far depth.
- Hiccup/F: cup (22,38), targets L=(22.875,48.375), R=(42.5,48.375), errors 1.287/1.125. Neither passes standard admission. Disabled source-contact candidate boundaries (23.25,48.375)/(44,48.375), normals (+1,0)/(-1,0), are NOT current contacts; its right legacy handle-axis claim is explicitly false.
- Sweep: w=pulse(p,.02,.17,.82,.98), q=3 sin(4πp)w. Broom origin F=(49+q,20), Q=(58+q,20); right anchor=(11.375,20.75). F target=(60.375+q,40.75), p=0/.5 error2.253. Dense F error .750..2.453; Q .250..1.152. Neither standard-admitted; Q is additionally far-depth blocked. Only one right hand exists; do not invent a left grip.
- Sip-tea: cup origin interpolates F (23,43) or Q (35,43) toward muzzle minus rim over pulse(p,.08,.34,.66,.92); anchors L=(.875,10.375), R=(20.5,10.375). At p=.5 cup F=(24.421795,36.028846), Q=(43.867949,36.685256). Dense errors F L .395..1.374, R .220..3.125; Q L .350..7.187, R .369..2.609. Every standard-admission result is false. Sparse keys miss F-left's unreachable interval.
- Workout: no held tool. Sole targets F L=(22,64), R=(44,64), errors7.382 each; Q L=(31,64), R=(55.5,64), errors22.946/17.357. The sampler compensates any body groundShift; sampled current values here are64. Historical24 is not the current F error.

Dense sampling also exposes sparse aliasing: take-note/F pen right ranges4.502..16.500 (five keys all10.501), plant-water/F .354..1.605 (five keys all directly accepted), tiny-chef/F right .375..1.068 (all direct, no standard admission). Do not weaken .75 to turn these into a pass. See dense.tsv for per-side values and worst phases.

No hand-contact objects at any of the five keys: pit-fall, stuck-corner, meditate, happy-hop, moonwalk, hide-box (F/Q); spin and tail-wiggle (F/Q/back); magic-trick (F only). Existing resting body hands/props are not new grip contracts.

Fingerprints: canonical F body SHA256 9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9; limbs.json 2897b2e4e4a5efdeeae6c11ff1d83f4760294ce93f0538479dac140a081a565e; composer 4cae93287c713a05d5f61e5e254ed857e80f0c46332b04260681cc9c448c4e61.
