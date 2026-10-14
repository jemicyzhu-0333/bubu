# Motion craft replay

These tools reuse the production renderer. They do not modify a profile, run a native desktop window, or copy source artwork into the report.

Run from the repository root with the existing development Canvas backend installed:

```sh
node tools/pet-motion-craft/capture-lifecycle.mjs --suite=full-tea --out=dist/pet-review/full-tea
node tools/pet-motion-craft/capture-lifecycle.mjs --suite=tea-boundaries --out=dist/pet-review/tea-boundaries
```

- `base` (default): 24 cases, both forms, bare/heavy valid outfits; complete story, three short replacement chains, reduced motion and clock pause. The replacement tea deliberately lasts only 500 ms here.
- `full-tea`: both forms in heavy valid outfits; interrupt paper flight, run tea for its full 9000 ms, then observe 1000 ms of idle.
- `tea-boundaries`: both heavy outfits; force drag cancellation or a new wave 200 ms before tea expiry. Four cases, maximum 17.1 seconds each.
- Unknown suite names fail closed. These are finite offline captures, not monitors.

Outputs include transparent PNGs and `index.json` containing timestamps, requested behavior, observed public renderer state/expression/progress, file hashes, capture-tool hash and limitations. `observedActionId` stays null because the renderer does not expose that transient field. Null does not mean idle. The same renderer, state, channel and animation clock survive action changes; manual records come from the production helper.

Without `--seal`, the tool records a Git revision only if the repository root is exactly the application root, marks tracked worktree changes, and explicitly labels the capture an **unsealed local preview**, not acceptance evidence. A restored snapshot without `.git` is also unsealed. For acceptance, supply the independently frozen source/asset manifest:

```sh
node tools/pet-motion-craft/capture-lifecycle.mjs --suite=full-tea --seal=/path/to/source-seal.json --out=/path/to/evidence/full-tea
```

The seal file must identify `baseCommit` and `seal`; independently verify its file hashes against the app before relying on it. The tool records the supplied identity rather than claiming it verified the entire source tree. Keep each capture directory and seal immutable. Re-run after relevant source changes; do not add new observed fields to old PNG records.

Other commands:

```sh
node tools/pet-motion-craft/render-review.mjs --action=paper-return --video --out=dist/pet-review/story
node tools/pet-motion-craft/wardrobe-review.mjs --out=dist/pet-review/wardrobe
node tools/pet-motion-craft/export-trace.mjs --character=usagi --revision=YOUR_VERIFIED_SOURCE_ID --out=dist/pet-review/trace
```

The trace is pure pose. It does not prove the final viewport, clipping, native GPU compositing, memory safety or aesthetic continuity. Review actual frames at the shipped 99 CSS px body width and at normal playback speed. Asset rights remain governed by the repository's `LICENSE-SCOPE` and asset `USAGE` files.
