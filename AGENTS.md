# I'm ADHDer repository rules for coding agents

Read `docs/ARCHITECTURE.md` (especially 「分层与能力」 and 「事务、投影与 IPC」) before any structural or
cross-module change. Product invariants in `docs/PRODUCT.md`, the data rules of each feature in
`docs/ARCHITECTURE.md`, and the checks in `docs/VALIDATION.md` are mandatory. Read `docs/PET_VISUAL.md` before
touching pet pixel art, accessories, poses, or stage geometry: its coordinate table and layering invariants are
defined by production geometry and each active asset, not guessed from legacy grids. Read `docs/PET_RIG.md` before touching the layered rig. A task is not
complete merely because the UI appears to work.

## Documentation

- Keep the README focused on features and setup. Maintain the five existing engineering/product documents in `docs/`; do not add implementation diaries, recovery logs or duplicate plans. License notices are separate and must be retained.
- Code comments cite a rule by section name, e.g. `ARCHITECTURE「日常与能量」` or `PRODUCT「界面语言」`,
  never by the number of a deleted design document (no `F6 §6`).

## Architecture direction

- I'm ADHDer is a modular monolith. Organize new work by capability, with explicit application workflows and
  Electron/platform adapters; do not introduce microservices, a generic service locator, or a generic event bus.
- `src/main.js` is a legacy composition hotspot under active extraction. Do not add a new business rule, IPC
  family, persistence mutation, timer, or window concern to it. A necessary defect fix may touch it, but must not
  increase its responsibility or create a second source of truth.
- The same freeze applies to the surface entries still under extraction: `src/surfaces/pet/controller.mjs`,
  `src/surfaces/pet/renderer.mjs`, and `src/renderer/popover.mjs`. New capability work belongs in a focused
  module; legacy edits should be paired with extraction whenever practical. `PRUNED_LEGACY_MODULES` in
  `scripts/check-architecture.js` lists the files an earlier extraction already removed; do not recreate one
  as a convenience alias.
- A capability owns its state and invariants. Another capability may use only its public `index.js` facade or an
  application workflow; deep imports and direct mutation of another capability's state are forbidden.
- Cross-capability atomic behavior belongs in `src/application/workflows/`. A workflow calls public capability
  APIs, commits once, and publishes side effects only after a successful commit.
- Pure domain code must not read Electron, DOM, filesystem, network, process globals, wall-clock time, or random
  values. Supply time, IDs, randomness, and external operations through arguments or narrow ports.
- Platform adapters may depend inward on ports/contracts. Domain and application code must never import platform
  adapters. Only the Electron bootstrap/composition root may know all concrete modules.
- `shared` is for zero-business-meaning primitives used by at least three modules. Never add catch-all files named
  `utils.js`, `helpers.js`, `common.js`, `manager.js`, or an unqualified `service.js`.

## Interface layer

- Popover styles live in `src/surfaces/popover/styles/` with the layer order
  `tokens, base, components, features, theme, utilities`. `theme.css` is the first-pass interface and only
  restyles; follow PRODUCT「界面语言」: pixels for the character only, system font for tools, one accent colour,
  red only for errors, no emoji as icons (inline 1.5px SVG instead), declarative copy without commands,
  self-justification or internal jargon, tabular numbers, and layout driven by `body[data-session]`.
- Never insert `<style>` at runtime; never add a global `window.FocusPix*`.

## State, IPC, and renderer rules

- Every persisted top-level path has exactly one owner. Do not add a second writer. Keep one canonical transaction
  boundary and validate the complete candidate state before writing.
- Do not change the persisted shape merely to match a folder move. A real shape change requires a new schema,
  byte-for-byte backup, explicit migration, idempotence test, corruption test, and rollback/failure-close plan.
- Renderer disabled states are UX only. Commands must re-check invariants in the main-process application/domain
  boundary.
- Every IPC command/query belongs to one capability contract with a closed payload validator and an explicit
  surface allowlist. Never expose `invoke(channel, payload)`, `ipcRenderer`, Electron, or a broad store API to a
  renderer.
- Renderer features receive scoped clients and immutable projections. They must not call `window.focuspix`
  directly outside the surface adapter, mutate canonical state, or add new `window.FocusPix*` globals.
- Domain transitions return facts/results. Notifications, window operations, pet animation, and telemetry are
  post-commit effects; an effect failure must not turn an already committed command into a retryable failure.
- Never hold a state transaction open across an LLM/network request. Capture a bounded intent, perform I/O, then
  re-enter through a command that revalidates target identity and freshness.

## Size and cohesion budgets

- Line counts are review signals, not universal pass/fail rules. Around 300 logical lines for a production module,
  180 for an entry/facade/composition file, and 50 for a function should trigger a cohesion review; a cohesive
  module may exceed those guides with a short rationale in its review.
- Architecture checks fail on responsibility mixing, forbidden dependency direction, cycles, state ownership,
  unbounded public APIs, or increased legacy coupling. They do not fail merely because a file crossed a line count.
- Declarative content tables, generated files, migrations, and focused test fixtures naturally have different size
  profiles. Keep their schema and validator tests close instead of splitting them mechanically.
- Existing oversized legacy files use a responsibility-and-size ratchet: a migration may temporarily keep the same
  line count, but must not add a business responsibility, dependency, direct IPC family, renderer bridge call, or
  global. Do not game the signal with minification, multiple statements per line, nested callbacks, or giant data
  literals.
- Prefer one use case per application file and one reason to change per module. If a change needs unrelated nouns
  in its filename or description, split it or move the coordination into a workflow.

## Change workflow

1. Name the owning capability and state paths before editing.
2. Search for an existing invariant, port, validator, projection, and UI primitive before adding one.
3. Add or update a behavior test at the lowest valid layer. Source-text assertions are a last-resort architecture
   check, not a substitute for behavior tests.
4. Implement through the public capability boundary. Do not bypass it for convenience.
5. Run `npm run check` and the relevant integration/smoke suite. For persistence, security, animation, or packaging
   changes, also run the specialized checks in `docs/VALIDATION.md`.
6. State which capability changed, which state paths it writes, which contracts changed, and which checks passed.

Temporary exceptions require an issue reference or a scoped entry in the owning architecture section, an owner, a removal condition, and a test that keeps
the exception narrow. “The AI generated it” and “it was faster” are never valid exceptions.

## Data, publication, and asset safety

- Production accepts only complete canonical payload schema 18 in its bound SQLite profile. Never use a real user profile for migration tests or silently import/reset old data. Use disposable fixtures and retain fail-closed behavior.
- Local-first does not mean network-free. AI is opt-in; preserve provider grants, cancellation, freshness checks, and explicit change confirmation.
- Keep project code under the root license and preserve third-party notices. Noncommercial licensing does not establish character/artwork rights. Do not claim Usagi or Dango permissions are settled.
- Record current validation evidence separately from requirements. Do not describe PET12's intermittent Linux stripes as fixed, or Node/offscreen tests as native Windows/macOS validation.
