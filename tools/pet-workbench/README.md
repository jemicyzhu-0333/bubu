# Private offline pet acceptance workbench

Build from the repository root using only Node and the existing production sources:

```sh
node tools/pet-workbench/build.mjs
```

The result is `dist/pet-workbench.html` and its source/asset hash manifest. Open the HTML in a modern browser supporting import maps. No server, package CDN, login or network requests are needed by the artifact. Its CSP blocks network connections. Browser support and local-file attachment handling still depend on the user's browser; a build is not a browser acceptance result.

**Keep the generated HTML private. Do not commit it or publish it to a website.** It embeds existing restricted character artwork. Full LICENSE, LICENSE-SCOPE and Usagi USAGE notices travel inside the HTML. Existing rights are not expanded by this tool. The builder follows only reachable production module manifests; it rejects reference paths and never reads the prohibited turnaround reference. No new third-party art or runtime is introduced.

## Coverage and controls

- Both forms and their production skins; all 44 actions, 12 session activities, 3 desktop mirror activities, all expressions and scenes.
- All 43 appearance items: 16 Dango, 27 Usagi; all three existing Usagi outfit recipes. Dango has no such recipe catalog, so the tool does not invent one.
- Free legal combinations use the production exclusive groups, not an invented one-item-per-slot rule. Selected versus resolved items and requested versus resolved view are separate. Explicit wardrobe selection uses the renderer's existing includeLocked preview semantics; no user profile or economy is changed.
- Play/pause, 30 fps stepping, restart, loop, speed, scrub, direction, four requested views, native 99 CSS px body or enlarged display, light/dark/checker backgrounds and reduced motion.
- Old `paper-plane` (9500 ms) versus new `paper-return` (10500 ms) share the same elapsed seconds, and each reports its own progress and resolved view. The shorter action holds its last frame. No fabricated old-version screenshot is used: both are preserved production actions.
- New paper phases come from `samplePaperReturn`; authored session labels come from production `sampleAction`. Actions without a timeline explicitly say so. These are derived diagnostic labels, not observed public transient action IDs.

The existing gallery harness owns real production renderer instances. Selecting a different item resets the preview. The preview keeps at most two fixed rig-transition channels, clearing old poses through the existing clock-rollback behavior. Backward seeking reconstructs the instances and replays their springs/particles to the target with a bounded 30 fps step. Large seeks yield in chunks; a newer request cancels old pending seek work. This workbench is a preview, not a controller lifecycle test. Natural manual interruptions, priority handling and native OS windows have separate tests.

## Reproducible checks

```sh
node --test test/pet-workbench.test.js
node tools/pet-workbench/verify-catalog.mjs
npm run check
```

The finite Canvas sweep covers every action/session/expression on both forms, each garment in all four requested views, and every existing Usagi outfit with every action, at three points each. A nonempty drawing is a smoke check, not proof of aesthetic correctness or every arbitrary wardrobe combination. Use the HTML to visually inspect and pause those combinations. The diagnostic Canvas backend is the repository's existing `@napi-rs/canvas` development dependency; no production runtime depends on it.
