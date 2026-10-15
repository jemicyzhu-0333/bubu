# Front story candidate (2026-10-14)

Scope: Dango front presentation. The visual review and full-frame audit use the canonical pink skin. Unsupported quarter/back poses retain the existing artist. Usagi Halloween stays an isolated design prototype and is not enabled here.

## Entry points and ownership

- `halloween-lantern` is an explicit manual preview in the application pet catalog, resolved through `formArt.previewAction`. It is absent from autonomous `PET_ACTIONS` and seasonal scheduling. Preview loops only while explicitly open.
- The existing real `mirror-ai` session controller and mirror playback own AI entry, termination, blocking, and the 600 ms exit. Listen/consider/acknowledge/settle are authored companion phases, never provider/tool progress. No timer or event collector is added.
- `seasonal.pumpkin-beret` and `seasonal.plum-cape` are opt-in wardrobe choices using existing headwear/backwear preferences. They do not enter default level/skin choices. The action never equips/unequips clothing. Quarter projection hides unsupported art without rewriting saved IDs.
- Lantern, ghost and grip are transient action layers; the hat/cape/lapels persist until the user changes clothing.
- `createFrontStoryArtist` owns the new sources and delegates all original artist APIs and terminal disposal. Whole selected resource groups are required before replacement. Pending/failure leaves the original AI laptop/action and original body/wardrobe intact.

## Layer order lesson

An isolated compositor drew the cape behind a complete body. Production draws separated anatomy before the wardrobe-back pass. Placing the same cape in wardrobe-back therefore obscured the middle of each foot. The wrapper now draws only this cape rear panel before the base anatomy-back pass, with lapels in the normal wardrobe-front pass. Original foot pixels and transforms are unchanged. Runtime quarter fallback cannot draw the rear panel. Portrait-fit rendering retains its separate complete-body ordering.

Do not generalize this patch into global limb lengths, source rotation, wardrobe clearing or altered feet. Validate the actual registered production renderer, not only an isolated overlay composition.

## Reproduction

- Application dev pet preview: select `南瓜灯与小幽灵（小步正面）`; explicitly select the two seasonal clothes separately if desired.
- `node tools/front-story-check/production-audit.mjs` writes actual production frames outside the work tree in `../evidence-production/actual/`.
- `--omit=palm`, `--omit=pumpkin`, `--omit=feet`, `--omit=cape`, etc. decode the one target as a same-size transparent negative control. They do not edit artwork.
- `--failure=robot-listen` and `--failure=ghost` exercise whole-group fallback. `--dense` captures 72 additional front story samples at 100 ms intervals.
- `node --test test/front-stories.test.js` checks opt-in defaults, no wardrobe mutation, atomic admission, view/drag fallback, authored phases, real mirror lifecycle, disposal and layer ownership.
- `USAGI_CANVAS_PACKAGE=@napi-rs/canvas DANGO_CANVAS_PACKAGE=@napi-rs/canvas PET_MOTION_CANVAS_PACKAGE=@napi-rs/canvas npm run check` enables all optional Canvas gates.

The independent handoff binds per-file hashes, baseline regressions, final-stage source omission plans, and the same input/pose hashes for each control. These Node Canvas checks are not Electron/native/browser acceptance. No remote publication or user-state migration is part of this candidate.
