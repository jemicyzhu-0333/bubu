# Action/effect lifecycle review

Research checkpoint, not production acceptance.

## Reproduced failures
- After an authored stop, a second halo action created an entering handle and immediately lost its burst before the normal effects tick. First action produced two particles; the second produced zero.
- Hidden-time rewind failed in strategy pause outside the actor frame cleanup boundary, leaving a live actor with a disposed strategy and retained budget claims.
- An instanced-mesh disposal observer could interrupt effect cleanup: actor claims reached zero while effect geometry/material disposal had not been attempted.

## Current contract
Every burst now queues a bounded request. Its return value means accepted request count, not already spawned particles. The single ordinary tick samples the current anchor and current frame policy, consumes requests once, and remains the sole time advance. Hidden, paused and reduced-motion ticks discard requests; resume does not replay discarded work. No legacy immediate-spawn or extra-tick path remains. Stop cancels requests; reset/dispose clear them; stale generations cannot resurrect an emitter.

Actor suspend/resume and action pause/resume run inside the frame failure cleanup boundary. Original and cleanup errors are retained together. Effects invalidate before disposal, independently attempt every owned mesh/geometry/material cleanup, and aggregate observer errors. Borrowed glow geometry is excluded. Ledger zero and attempted disposal do not prove GPU reclamation.

## Verification
- Ten added combination regressions passed, including real halo restart, same-timestamp canonical commit count, hidden rewind cleanup, policy transitions and observer failures.
- Full foundation suite: 115 passed, zero failed.
- Existing bounded effects exercise: 120,000 frames passed; CPU P95 0.006422 ms, maximum 3.694827 ms.
- Integrated CPU replay: 900 frames passed; P95 5.305906 ms, maximum 19.015599 ms.
- Source identities and measured details are retained in the accompanying reports. No stable-frame-rate claim follows from these individual runs.

## Remaining gates
Historical CPU spikes, native transparent-window/GPU behavior, actual wearable hand/cup/contact coverage and isolated cloth performance remain unresolved. The cloth candidate is still blocked from the default runtime. This checkpoint closes the bounded lifecycle findings, not all production acceptance gates.
