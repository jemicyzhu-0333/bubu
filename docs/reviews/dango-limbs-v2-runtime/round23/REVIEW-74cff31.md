# Bobo review of c4c3f45 (quarter hiccup pair) + 74cff31 (front wave)

Both ACCEPTED. Base reviewed: ece8e18. Branch head after review merges origin/main 87793b6 (mac install, no conflicts) so the PR to main carries it.

- hiccup three-quarter: near hand is now an outlined paw on the cup in both facings, bare and 6-item outfit; far lower palm reads as the cup-side hand, no off-body fragment. Mixed generic/legacy look in normal playback is gone. capture.mjs 12 scenarios 0 failures; alpha-audit OK; rebuild.py --check byte-exact.
- wave front: compact short arm now visible and waving (before: tiny fragment at body edge). Entry/exit fade smooth; with cape the arm is mostly occluded, same as other actions. runtime/lifecycle/contour/source-audit all 0 failures; rebuild --check OK.
- Nit (not blocking): in the last ~2 frames of the exit fade the semi-transparent outer palm reads slightly detached from the body because the root fades into the body color. Consider fading the palm a touch faster or ending the fade with the arm in the lowest pose.
- Unchanged: wave three-quarter, hiccup front (pixel-identical to ece8e18).
- Accessory matrix (49 items/outfits, auto+back, 5358 records) vs round22: 0 flag diffs; pixel-only changes are wave auto/back (wave always draws front), as expected.
- npm run check on merged head: 6178 tests, 6173 pass, 5 skip, 0 fail; limbs:check 224 target-views 0 failures, 10 actions 0 outline gaps.
- Regression: src change limited to dango-source-contact-pose.mjs selector branch + two new pose modules; earlier fixes (calm limbs, grounded eventId, facade arch rule, accessory cache key, throttle remainder, lock-resume/late-show, mac probe, limbs gate + visibleDefects fallback, sip accessory consistency, paw outline, snack/umbrella sources) untouched and their tests pass.

Still open for Codex: umbrella-dance three-quarter; short-reach actions workout, catch-star, sweep (incl. three-quarter), read-book, knit-scarf.
