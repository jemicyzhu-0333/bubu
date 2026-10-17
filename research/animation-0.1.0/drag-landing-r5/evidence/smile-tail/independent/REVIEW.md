# Landing smile duration independent review

Result: PASS for CPU functional scope on frozen controller 0413b3b1604b32fa4e969ce29a8ebc1885e36316b8f94e16fea8f60e7a91efb1, pointer host f1775a69c562ab30a44450a48a0978b589aa70b803eff643ca05bc35cd15a455, admission 263bc0c1e131915289a65efa1351fa38d581e87ecc65e35592a881b8f8162fb9.

Independently executed controller tests 4/4 and restored host npm test 62/62 plus dependency hash checks. Actual D2 independent probe passed at 30/60/120 fps: matching settle pose and root, actual minimum sole stays at pre-drag ground, body returns to rest at contact + .48 seconds while landing smile remains bounded to contact + .9 seconds. Interaction ownership subsequently returns false and P1 idle R0 runs; hidden/resume does not revive the tail. D2 style gate remains zero and dispose clears active actors and decoded arrays.

Source diff confirms unchanged body pose calculations, release/settle clocks, held R4 behavior, runtime source, and initialization cleanup. Face-only change is finite landing deadline plus landing-only exit .40 seconds. New gesture, cancel, interrupt, hidden and dispose clear the tail; ordinary P2 policy unchanged. Tests include new gesture during idle smile tail and hidden tail retirement.

Evidence: controller-tests.log, host-tests.log, actual-tail-probe.mjs/log, SOURCE-SHA256SUMS, empty runtime-diff.txt. This is actual Three geometry and owner evaluation with fake DOM/scheduler, not a browser/WebGL/OS test or visual acceptance of the face transition.
