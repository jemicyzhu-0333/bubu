# Quarter hiccup visible near/far source pair

Two independently observed quarter hand surfaces replace normal-playback generic/legacy mixing only for hiccup in runtime three-quarter. This uses the actual right-facing quarter body; the renderer reflects the whole character for opposite facing. It does not mirror a front hand into a far hand.

Near is an authored continuous fore/palm; far contains only the original master’s visible lower-palm surface. Unobserved hidden anatomy is omitted. Near draws foreground; far draws after body and before the unchanged cup/handle. Cup stays at34,38 with22x19 size and contacts34.875,48.375 /54.5,48.375. Body, face, feet and original timing remain unchanged.

Both sources require the existing whole-instance readiness latch. A missing/late/failed member prevents either new source from drawing in that episode. The inherited host fallback is retained, including its previous generic/legacy mixture when the generic limb package is loaded; this module does not redefine global fallback policy.

One uniform projection to66x72 logical pixels and exact nearest8x deliver149 near /54 far opaque pixels. Palette is the fixed four source colors (far uses three), alpha0/255 and transparent RGB0. The final masks retain observed hand-outline ink and exclude cup material; no procedural ink, body-colored patch or runtime scaling is used.

Rebuild from retained official master, anatomical masks and fixed recipe:

    python assets/companion/dango/raster/action-contact/hiccup-quarter-pair-v1/sources/rebuild.py --check

The source package retains prompt, ordered input paths/hashes and unchanged master identity. Input preview screenshots are identified in provenance but not duplicated; deterministic extraction only needs master and masks. Sources are excluded from the app package. No demo PNG/video or bulk frames are added. Review scripts and compact real-renderer/alpha evidence live in `docs/reviews/dango-limbs-v2-runtime/hiccup-quarter-source/`.

This is an action-specific visible-surface drawing, not a general far-arm rig. Offscreen checks do not certify native desktop visual acceptance.
