# Quarter hold wiring review

2026-10-13. Reviewed source base d0e0827600c18b5cff7a723ab3525a12227dffc5.

## Result

No source-independent quarter side/reflection/depth wiring defect demonstrated. No production code or asset change justified. Added regression coverage only. Overall natural quarter holding remains NO-GO; correct mapping is not visual-action acceptance.

- Asset screen-left is the separately authored far palm; screen-right is the separately authored near palm. They have different source hashes, and both preserve mirror:false.
- Left quarter uses those authored sides directly. Right/canonical quarter swaps runtime screen sides, reflects target/contact normal into asset space, and reflects the completed composition once around x=33 (x'=66-x). Independent source-pixel comparison and Skia byte comparison pass. Canonical quarter plus outer renderer left-facing reflection returns the original asset placement exactly.
- Fixed asset shoulders stay (2.5,36.5) / (52.5,43.5). No shoulder/prop/body movement was introduced.
- Far paw depth remains back. createDangoLimbPainter.plan intentionally rejects it even at an exactly reachable registered marker; it is not silently drawn in front. Actual quarter actions remain on their legacy path where this prevents supported contact.
- 99 standard-artist samples (33 phases each of quarter sip-tea, carry-energy, read-book) preserve body pixels, all matrices, tools and anchors between default and explicitly opted-in preview.
- Six midpoint full-character offscreen Skia comparisons (three actions × both renderer facing directions) are byte-identical default vs opt-in. This proves fallback, not generic limb integration. PNG is at the production 1.5 CSS px/art-unit scale, giving 99 CSS px design body width; it does not claim foreground height of 99 px.

## Concrete remaining blockers from unchanged action targets

At progress=.5, quarter sip's runtime screen-right/far hand is within 0.4592 art units but forbidden by unreviewed back depth. Its runtime screen-left/near hand misses by 7.1868 art units. Carry's far hand is within 0.7145 but rejected by the same depth gate; its near hand misses by 7.2687. Read-book has near error 1.3051 (>1.25 threshold) and far error 15.0131. These are discrete marker errors, not physical grip/root/contour scores. Moving a cup, swapping independent palms, moving a shoulder, or dropping the depth guard would manufacture a false pass.

A source-supported action-specific contact/depth solution at the unchanged body and prop is needed before replacing these fallback hands. Existing generic upper/fore source quality remains a separate issue.

## Checks and files

Repository change: test/dango-quarter-limb-contract.test.mjs only (four behavior tests).
- Direct quarter tests: 4 pass.
- Final quarter + limb contact contract + canonical body alpha suite:16 pass, including the outer-facing assertion.
- Full repository check and integration are recorded in the shared HANDOFF for this commit.

Evidence: results.json, standard-quarter-default-optin.png and independent-quarter-palms-8x.png. Reproduce with `node tools/dango-contact-review/render-quarter.mjs --out /tmp/dango-quarter-review` and `node --test test/dango-quarter-limb-contract.test.mjs`.

No sip/hiccup source package edits, fore edits, activation, remote publication, main merge, release, image generation, browser retry, or native-host claim. hostAcceptsContract=null and extensions.runtimeReady=false remain unchanged.
