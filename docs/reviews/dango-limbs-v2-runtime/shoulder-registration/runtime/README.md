# Front/right shoulder registration: bubble-blow evidence

The source-authored shoulder x is 58.6. The former fixed socket 61.5 added an outward 2.9-art offset. Restore the authored x to the existing half-pixel lattice, round(58.6−0.5)+0.5=58.5, while keeping y 45.5. Only the front/right socket and its source-alpha coverage change. Other sides/views, source pixels, body/prop geometry, generic orientation rules and contact thresholds remain unchanged.

At y 45.5, canonical body alpha ends at x 63.5231 and pink fill at 61.8821. The former outward offset left insufficient room for the original arm root. Source anchors and exact cross-sections are in source-registration.json. Fully restoring canonical y 39.712821 would put the required wrist 13.952 units away, beyond the nominal 6+6 chain; this correction deliberately restores x only.

## Result

The unchanged standard generic artist selects upper 337.5/fore 112.5 and grip/front/a 090, with S [58.5,45.5], E [52.5,43.5], W [54.5,49.5]. The existing contact target stays [54.046795,53.653846]; selected contact [54.5,53.5] has error 0.478606 (previous 0.568026). Exposed arm pixels drop 67→0, including the upper-arm root 28→0. The round palm remains in front of the original wand. No action-specific inward pose, new source frame, wrist-orientation exception, or arbitrary alpha mask is needed.

The independent source/surface audit verifies original upper/fore/palm source hashes, unchanged joint alpha union, zero exposed arm pixels at logical centers and actualDPR 4 composition, and real alpha overlap: arm/palm 1224, body/palm 3703, tool/palm 1947 device pixels, including 576 within 2 art units of the contact target. The marker error alone is not the grip proof.

## Evidence and interpretation

- evidence/generic-bubble-full-cycle.mp 4: actual production renderer and form-art with test-time source dependency injection only.9.000 seconds, 270 frames at 30 fps, before/after native 1 x and 2 x views. True body/face motion and natural bubble emission are retained.
- evidence/generic-runtime-keyframes.png: six sampled video comparisons.
- evidence/generic-standard-native.png: standard-artist 1 x/2 x light/dark comparison.
- evidence/generic-runtime-audit.json: DPR 1,1.25,1.5,2,4 ×257 timestamps from 0..9 seconds. The existing preview wraps 9 s back tophase 0, so these are 256 distinct phases plus the loop point. All natural standard admissions, one branch perDPR,45 naturally emitted bubbles per 9 s.
- evidence/generic-exact-phase-audit.json: separate direct standard-artist checks at exact 0..1 inclusive,257 phases atDPR 4, includingp=1. Original body and prop pixels are equal at every phase.
- evidence/generic-source-surface-audit.json: original input hashes and actual alpha-overlap measurements.

## Reproduce

From any directory, using the repository's existing locked dependencies and ffmpeg:

    node reproduce.mjs --repo=/absolute/path/to/bubu --out=/absolute/path/to/new-evidence

The script reads all art and code from --repo. fixture.mjs explicitly creates BOTH old [61.5,45.5] and corrected [58.5,45.5] registrations and regenerates both coverage stencils from canonical body alpha. Reproduction therefore also works after the repository manifest adopts 58.5. No failed generated source or experimental candidate is an input. Temporary import-injection modules are removed after success; batch frames are not saved. Source recipes remain in the repository.

Run source/syntax checks with the repository's normal validation suite before integration. This evidence covers bubble-blow front/right only; the separate full-action regression owns global acceptance. Generic runtimeReady=false and hostAcceptsContract=null remain unchanged. Offscreen Skia and encoded video are not browser/native Windows/macOS execution or release acceptance.
