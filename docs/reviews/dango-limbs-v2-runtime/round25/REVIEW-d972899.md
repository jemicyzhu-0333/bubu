# Bobo review of d972899 (quarter sweep source grip)

ACCEPTED. Base reviewed: b6b0a09. Branch head after review merges origin/main dc998b0 (PR #10 merge plus PR #8 reminders, no conflicts).

- sweep three-quarter: the small sideways mitten that floated beside the shaft is replaced by the closed quarter palm overlapping the body edge, so the paw now reads as gripping the broom. The shaft enters above and leaves below the palm in every phase. Checked both facings, bare and 6-item outfit, DPR 2, all 60 cycle frames including entry (frame 0) and exit fade (frame 59): no ghost, no air gap, no half-arm (see `sweep-tq-before-after.png`).
- Nit (not blocking): the palm is a slightly lighter salmon than the body, and its left contour draws a dark ring over the body edge. At native size it reads as a paw in front, consistent with the hiccup/wave sources.
- Unchanged: sweep front, both facings, bare and outfit (60/60 frames pixel-identical to b6b0a09).
- Codex acceptance entries rerun here: `sources/rebuild.py --check` OK; `dango-sweep-contact.test` pass; portable replay `sweep-quarter-source/run.mjs` passed, 2184/2184 source frames, min original-axis alpha 255.
- Accessory matrix (49 items/outfits, auto+back, 5358 records) vs round24: no new popping/eye-cover flags; only sweep auto/back changed (17 records each), and the prop-over-accessory count dropped in those frames (cape, bat-wings, scarf, satchel, stack).
- npm run check on merged head: 6210 tests, 6205 pass, 5 skip, 0 fail; limbs:check 224 target-views 0 failures, 10 actions 0 outline gaps.
- Regression: src change is the selector branch plus the new sweep pose module; earlier fixes (calm limbs, grounded eventId, facade arch rule, accessory cache key, throttle remainder, lock-resume/late-show, mac probe, limbs gate + visibleDefects fallback, sip accessory consistency, paw outline, snack/umbrella/hiccup/wave/catch-star sources) untouched and their tests pass.

- Bobo fix: d972899 rewrote the Chinese product name and description in `package.json` as `\u` escapes (same JSON value, noisy diff). Restored the literal UTF-8 text; only the new `sweep-quarter-grip-v1/sources` exclusion remains from your change. Please keep `package.json` in UTF-8 when editing it.

Still open for Codex: umbrella-dance three-quarter; short-reach actions workout, read-book, knit-scarf.
