# Bobo review of 77bb40c (front umbrella source)

Verdict: ACCEPTED. Reproduced all four acceptance entries on 77bb40c: runtime 2020 frames 0 failures; lifecycle complete/interrupt-reopen/reduced-resume 0 failures; occlusion face/headwear overlap 0 (10 headwear, 10 skins); source-audit and rebuild --check byte-exact.
npm run check: 6148 tests / 6143 pass / 5 skipped / 0 fail; limbs:check 224 target-views 0 failures, outline gaps 0.
Regression: 77bb40c touches only dango-source-contact-pose.mjs + new dango-umbrella-contact-pose.mjs under src; calm limbs, grounded eventId, facade arch rule, accessory cache key, throttle remainder, lock-resume/late-show, mac probe, limbs gate, sip accessory consistency, paw outline all untouched and their tests pass.
Gate: `visibleDefects['umbrella-dance'].front` intentionally kept: it now only blocks the defective generic chain as fallback when the source resources are not ready. Front umbrella in production uses the source hand (runtimeReady=true).
Sheet: umbrella-front-before-after.png (rows: 31bfc60, 77bb40c, each bare/+outfit).
Still open for Codex: snack-picnic three-quarter fragments; three-quarter far hand (hiccup); six-action reach (wave/workout/catch-star/sweep/read/knit); umbrella three-quarter (auto view) still legacy.
