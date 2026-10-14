# Integrated wave QA and production tests

These files supplement the sealed source handoff. They do not change any source pixels, masks, geometry or production files. Syntax and portable actual integrated execution passed against raster asset digest 106c8744ed8a62c1e3ff8ef32dbd5487d5d8ed3f453f00fb5fb90e8200d77dbe. Results are in the sibling integrated-validation directory. The parent owns the separately running eight formal tests and whole-repository regression.

## Production test

Run `node --test test/dango-wave-contact.test.mjs` from the repository root. The test reads the actual registered manifest, source helper and shared selector.

Eight tests cover:

1. All eleven PNG registrations, SHA-256, 20×22 / 160×176 sizing, four-color binary alpha, zero transparent RGBA and exact nearest 8×.
2. Immutable free-gesture semantics with no shaft/normal/grip claim, unchanged body/tool references, fixed attachment, all eleven keyposes, bounded one-keypose steps, fade endpoints and reduced-motion freeze.
3. Unsupported action/view/transform, body mismatch, each missing image descriptor and 110 per-frame metadata tamper cases.
4. All eleven individual loading/failure/missing states and mid-episode image loss: no partial source group or late pop-in.
5. Recovery/opacity do not reset episode readiness; cancellation, reopen, channel budget and selector disposal.
6. Real integrated artist with generic limbs loaded over 257 phases: body/face/feet/matrices/tools remain identical to the same host with only wave disabled.
7. An actually delayed PNG: current episode remains legacy after decode, the next episode adopts the complete group, and dispose releases bytes/entries.
8. An actually failed PNG with generic limbs loaded: the whole contact matches the host legacy fallback and no wave frame leaks.

## Portable actual-renderer capture

All commands accept `--repo=/absolute/repo` and `--out=/separate/output/directory`. The repository must already contain the module, all eleven production descriptors and a fully enabled group. Missing integration fails explicitly; the scripts do not supply it.

    node docs/reviews/dango-limbs-v2-runtime/wave-front-source/scripts/runtime-qa.mjs --repo=/absolute/repo --out=/tmp/wave-runtime
    node docs/reviews/dango-limbs-v2-runtime/wave-front-source/scripts/lifecycle-qa.mjs --repo=/absolute/repo --out=/tmp/wave-lifecycle
    node docs/reviews/dango-limbs-v2-runtime/wave-front-source/scripts/contour-qa.mjs --repo=/absolute/repo --out=/tmp/wave-contour
    python docs/reviews/dango-limbs-v2-runtime/wave-front-source/scripts/source-audit.py --repo=/absolute/repo --out=/tmp/wave-source

Default output is aggregate JSON only. Add `--frames` for compact per-frame/per-case JSON. Add `--images` to runtime/lifecycle only when local visual inspection is desired; it writes representative PNGs and the native/2× light/dark sheet. Images are not publication inputs.

The candidate is the actual production artist using the exact integrated `DANGO_RASTER` and shared selector. The comparison artist clones that manifest and only disables wave's eleven runtimeReady flags. A disposable renderer dependency bridge observes the two artist instances, but never patches the candidate selector, source metadata, eligibility or pose. The bridge is removed at completion. Sequential QA cases reuse the bounded pet channel with distinct explicit episode identities, without weakening the production channel limit.

- Runtime: 5,640 frames / 141 playback samples per case, five DPRs, both facings, bare/heavy outfit and normal/reduced motion.
- Lifecycle: completion, interruption/stop/reopen, reduced/resume and heavy mirrored playback; 1,944 frames.
- Contour: original production body plus foreground action painters, eleven poses × five DPRs × two facings; no source alpha fragments.
- Source: existing shared repository master/prompt and action-local mask hashes, exact palette/alpha/8× and all 86 proximal-source cut samples covered at all eleven poses.

## Discrete motion limit

The source poses span -20° through +30° in 5° increments. Three sweeps occur within the existing seven-second action. The largest adjacent authored palm-position change is 0.956339525 art units (about 1.43451 CSS px at the normal 1.5× art scale). The sampled 50 ms production sweep never skips a keypose. Adjacent logical-alpha Hausdorff distance is at most √2 art units. These are discrete-art measurements, not a claim of subpixel continuous deformation. The fixed source root remains `[58.5,45.5]`; the distinct historical legacy input root `[58.6,39.712821]` is guarded separately.

Offscreen Skia evidence does not replace native Windows/macOS transparent-window, GPU or final user visual acceptance. Do not upload PNG demonstrations or video. Run the final whole-repository check and relevant integration suite separately after these focused checks.

Final validation:6160 tests/6155 passed/5 optional skipped/0 failed; full check exit0 with all three Canvas backend variables. Integration71/71. The eight wave tests and source regressions pass33/33. `final-validation.json` binds the tested production file hashes and these four compact report hashes. Workbench preview wraps at duration; exact progress1 and real completion are separately tested. No observed lifecycle handoffRecovery is claimed; opacity0 is independently covered.
