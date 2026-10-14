# Manual original-foot step-in-place

## Result and entry

The existing desktop pet devtools action list now includes `原地踏步（团子裸身三分之四）`, ID `ordinary-walk-in-place`. Select it to run the bounded manual preview. Its defaults choose pink level1, native three-quarter-right and no outfit. This is the desktop `createPetDevtools` / `PET_CATALOG` path through `createPetRuntime`, not the separate standalone HTML pet-workbench page.

`DANGO_WALK_WORKBENCH.enabled=true` enables only that explicit preview. Ordinary autonomous/native walking, travelling walk source readiness and generic limbs remain unchanged/disabled. No new desktop roaming, IPC, world-position acknowledgement, timer, persisted data or reward/surprise action is introduced.

Original body/ears/face and round-foot PNGs are reused byte-for-byte. A dedicated zero-travel gait keeps the stance foot fixed, lifts the other on a closed recovery trajectory and coordinates a small body bob. It is not the earlier travelling sampler with body travel removed. Each7.2s episode gets a fresh readiness identity, without accumulated x. No newly drawn toe-off deformation or renamed direction library is credited.

## Lifecycle and ownership

Companion presentation owns the pure step sampler/artist. `bounded-gait-playback.mjs` owns only ephemeral manual phase and normal close recovery from the existing host time. Pause freezes progress and full pixels; reduced motion returns to stand and resume starts a new entry. When restored appearance remains compatible naked native idle, normal close preserves the first foot matrices, then settles over220ms to the original native stand. Restoring an incompatible outfit instead immediately falls back to its original rendering/facing. The idle bridge retains this native view until a new action/view/policy takes over. Higher-priority drag/hidden/calm policy may discard recovery immediately. Unsupported view, outfit, mirrored outer facing or unavailable assets fail closed.

The surface renderer forwards existing state/policy/hidden to playback reset and consumes one presentation-facing hint consistently across its existing five facing uses. Actual resolved view/outfit/state eligibility is owned by body-presentation; the bounded playback owner admits only the exact manual record. Existing motionOffset evaluation moves after appearance resolution without changing the expressions. Controller/main have no edits. No second state writer or native window owner is created.

## Evidence and reproduction

- `workbench-step-in-place.mp4`:23.35s actual production runtime plus Skia with injected DOM/rAF ports, including two cycles, pause/reduced/resume and close. Body design width99 CSS px, full stage219 CSS px.
- `ordered-keyframes-1x.png` / `ordered-keyframes-2x.png`:ten ordered real captures with original arc feet, alternating lift/support and final standing pose.
- `runtime-summary.json`:four DPRs1/1.25/1.5/2;809 adjacent planted-matrix comparisons per DPR with zero drift,485–487 lifted samples. The initial front body uses one cache identity; native three-quarter preview adds a second, then the cache stays at2 across all660 sampled frames (>2 cycles), with no phase-key growth. Pause/full-pixel stability, normal-close matrix continuity, final stand, reopen, view switch, drag interruption, hide/resume and disposal all pass.
- `verification-origin.json`:actual tested input and protected PNG hashes.

Reproduce: `node tools/dango-walk-review/verify-workbench.cjs --repo=/absolute/repo --out=/absolute/new-output`. The portable verifier uses a temporary source copy and existing runtime, leaves the input repo unchanged and deletes only its own temporary copy. All per-frame PNGs/full runtime trace are excluded reproducible outputs; the scripts recreate them.

Final integrated shared-code verification: Canvas-enabled `npm run check` with task-local CPU affinity0,1,2 exits0,6024 tests/6015 pass/9 optional skips/0 fail; integration71/71. Actual runtime fixture was rerun after both the enabled walk and disabled sip source selector were installed. Final focused lifecycle/artist/renderer suites pass93/93, including an independently replayed3-case facing regression.

This is an enabled manual ordinary-step slice with offscreen runtime evidence. Cloud browser use remains policy-blocked; these captures are not real browser clicking or native Windows/macOS acceptance. Bobo should check this exact published head on both target platforms. Overall seven-item limb repair remains NO-GO because action grip/root/reach and quarter acceptance remain open. No main merge or release.

Final independent review caught and repaired two boundaries before publication: a leftward drag used to leave facing=-1 and silently suppress stepping, and closing a naked preview over a restored scarf could retain an incorrect visual reflection. The actual left-pointer-drag → manual button → stepping → compatible close path now keeps runtime facing=-1 throughout while showing the native unreflected source. Unsupported state/view/outfit immediately restores real facing; scarf-close is checked on its first frame. The artist-facing guard remains unchanged, and no controller-facing write occurs.

The final aggregate used `taskset -c 0,1,2 env PET_MOTION_CANVAS_PACKAGE=$PWD/node_modules/@napi-rs/canvas USAGI_CANVAS_PACKAGE=$PWD/node_modules/@napi-rs/canvas npm run check` on this Linux task. Two preceding default-parallelism runs reported a Usagi whole-test-process failure without a failing assertion; isolated19 tests pass. The first also caught the repaired body-offset scanner boundary. No cause is asserted for the process exit, no unrelated Usagi code changed, and no assertion was weakened.
