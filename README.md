# I'm ADHDer

**A small next step. A visible timer. A companion for coming back.**

A local-first desktop app for ADHD-friendly everyday productivity. Capture a thought, choose one next action, start a focus session, and return after an interruption. Built with Electron, with an optional desktop companion and optional AI assistance.

[Project website](https://jemicyzhu-0333.github.io/im-adhder/) · [简体中文](README.zh-CN.md) · [Downloads & builds](#downloads--builds) · [Get started](#run-from-source) · [Documentation](#documentation)

This project is in development (`0.0.1-dev`). It is an executive-function support tool, not a medical device, and does not diagnose, treat, or promise clinical benefits for ADHD. The current app interface is in Chinese; this README is available in English and Chinese.

## A look inside

These are unaltered, app-only captures from native Electron testing on Linux, using disposable test data. Test task names are fictional. They show actual UI states, not mockups or proof of Windows/macOS validation. The characters retain their separate [rights restrictions](#license--artwork).

| Now: one place to begin | Focus: the next action and remaining time |
| --- | --- |
| ![Now panel with a free-focus action, energy estimate, routines, and inbox](docs/images/now-panel.jpg) | ![Running focus session with a synthetic next action, countdown, and pause control](docs/images/focus-session.jpg) |

| Your companion | On the desktop |
| --- | --- |
| ![Companion panel showing the Dango form and relationship progress](docs/images/companion-panel.jpg) | ![Native Usagi desktop companion in a sleeping state](docs/images/desktop-companion.jpg) |

## What you can do

- **Capture first, organize later.** Keep a quick-capture box close by; sort the inbox into tasks, routines, state notes, private emotion records, or saved ideas.
- **Make the next step clear.** Create a task with just a title, then add steps, dates, recurrence, tags, or time estimates as needed. Local suggestions offer both overall priority and an easier place to start.
- **Focus, pause, and come back.** Use a focus timer, take a break, or try a two-minute start. Leave a “next time, start here” step. Sessions that expire while the app is offline need your confirmation before they count.
- **Keep everyday life separate from work.** Set routine reminders, record what happened, and review your timeline and progress. Missed days do not erase progress; there are no streak penalties. Energy estimates are everyday planning aids, not medical measurements.
- **Have a desktop companion nearby.** Interact with Dango and Usagi forms, feed them, spend food tickets on food, and choose available outfits. Do Not Disturb, reduced motion, and low-stimulation settings are separate controls.
- **Use AI only if you want it.** Bring your own OpenAI-compatible provider for task breakdown, next-step suggestions, and ongoing collaboration. Choose the reference context, inspect proposed changes, and confirm before applying them. Core features work without AI.

The main panel has **Now / Plan / Review** sections (现在 / 安排 / 回顾). Plan includes tasks, routines, inbox, and archives. The app lives in the system tray or menu bar.

## Downloads & builds

- **Project website:** visit the [project page](https://jemicyzhu-0333.github.io/im-adhder/) for an overview and current download notices.
- **Current test packages:** [v0.0.1-dev-r3](https://github.com/jemicyzhu-0333/im-adhder/releases/tag/v0.0.1-dev-r3) provides Windows x64 and macOS ARM64 builds from the updated `main` source. The app version remains `0.0.1-dev`; `r3` identifies this release's replacement test packages. Read the Mac limitations below before downloading.
- **Earlier releases:** [r2](https://github.com/jemicyzhu-0333/im-adhder/releases/tag/v0.0.1-dev-r2) and [v0.0.1-dev](https://github.com/jemicyzhu-0333/im-adhder/releases/tag/v0.0.1-dev) are retained for history. Do not install the initial v0.0.1-dev Mac package, which was reported as damaged.
- **New test builds:** the manual [Build Windows and macOS (test) workflow](https://github.com/jemicyzhu-0333/im-adhder/actions/workflows/build-desktop.yml) targets **Windows x64** and **macOS ARM64**. Download a successful run's artifacts while retained; GitHub may require sign-in. Check the run's branch and commit. The workflow does not create a Release.

Windows test builds are unsigned. New Mac test builds use **ad-hoc signing**, without an Apple Developer ID or notarization. Strict signature integrity, direct startup of a DMG-installed copy with an isolated profile, and SQLite persistence have passed CI, but Gatekeeper's distribution assessment still rejects the Mac build. These checks do not establish that a browser-downloaded app will open normally. Do not disable Gatekeeper or remove quarantine to install it.

This is a development test version, not a stable release. **In-app updates are not currently available**; update metadata has not been published. Download test builds manually. Use a fresh test profile. Linux has limited native testing and known rendering issues; see [validation and limitations](docs/VALIDATION.md).

## Run from source

Requirements: **Node.js 22.12.0+**, npm, and a desktop environment capable of running Electron. Install the full dependencies, including devDependencies.

```bash
git clone https://github.com/jemicyzhu-0333/im-adhder.git
cd im-adhder
npm ci
npm run dev
```

`npm run dev` uses an isolated development profile. `npm start` uses the everyday profile. Their data, credentials, and Chromium storage are separate (`im-adhder-dev` and `im-adhder`). This testing revision uses a new default profile and credential identity: it starts empty, leaves previous profile directories untouched, and does not migrate old data or credentials. An explicit `--user-data-dir` remains respected.

Current production data admission accepts only complete, canonical **schema 18** profiles. Use a fresh test profile. Older or damaged profiles are rejected without automatic import, conversion, repair, or reset.

```bash
npm run check               # Unit, syntax, architecture, and generated-resource checks
npm run test:integration
npm run dev:bench -- --scenario=level-up  # Disposable test scenario
npm run test:electron       # Requires a usable native desktop
```

These are validation commands, not a claim that every platform has passed them. See [ARCHITECTURE](docs/ARCHITECTURE.md) for data contracts and [VALIDATION](docs/VALIDATION.md) for native checks and known limitations.

### AI setup & privacy

AI is **off by default**. To use it, enable AI in Settings, provide a public HTTPS OpenAI-compatible Base URL, model name, and API key, then save the configuration. Keys are stored using Electron's `safeStorage`; protection depends on the operating system and its credential backend. Saving fails when Electron reports encryption unavailable. The development profile needs its own configuration.

Local-first means the core data and workflow stay on your machine; it does not mean the app never connects to the network. When you use AI, your messages and the context assembled for that request are sent to the configured provider. Review the reference scope and your provider's data policy before sending sensitive information. No working in-app update channel is currently published. Optional activity mirroring is off by default and uses local activity categories, not desktop contents, music contents, or AI conversation text.

### Build an installer

```bash
npm run build                  # Installer for the current OS and Node architecture
npm run pack                   # Unpacked app for the current OS
npm run build:win -- --x64
npm run build:mac -- --arm64    # Run on macOS
npm run build:linux
```

`pack:win`, `pack:mac`, and `pack:linux` are also available. Build entry points support x64/arm64; that does not imply every OS/architecture combination has passed native validation. macOS requires Xcode Command Line Tools. Build scripts do not publish automatically, and Windows cannot directly build a macOS package.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt/Option + Space` | Open the main panel |
| `Alt/Option + Shift + Space` | Open the quick-action panel |
| `Alt/Option + Shift + N` | Focus a visible reminder |
| `/` in the main panel | Quick capture |
| `Esc` | Close the current overlay |

If a shortcut is taken, the app tries another combination. Settings shows the actual bindings.

## Documentation

The detailed product and engineering documents are currently in Chinese.

- [Product principles](docs/PRODUCT.md): feature semantics and interaction boundaries
- [Architecture](docs/ARCHITECTURE.md): layers, state ownership, IPC, SQLite, and AI safety
- [Validation](docs/VALIDATION.md): automated checks, native acceptance, and known limitations
- [Pet visuals](docs/PET_VISUAL.md) and [layered rig](docs/PET_RIG.md): production geometry, layers, and asset construction
- [AGENTS.md](AGENTS.md): repository rules for coding agents

For asset work, use `npm run rig:check`, `npm run rig:build`, `npm run rig:preview`, `npm run raster:check`, and `npm run usagi:wardrobe-check`. `npm run frames` checks rendered frames; offscreen output does not replace native desktop testing.

The public repository includes generated runtime assets, source-specs, and runtime-resource checks. Complete Dango/Usagi design-master reconstruction, historical action-approval evidence, and original run-sample reconstruction remain in the original author's private archive and are outside this repository's reproducibility scope. Normal app development and installer builds do not depend on those master workflows.

## License & artwork

Project code that its contributors have the right to license is available under [PolyForm Noncommercial 1.0.0](LICENSE). This is **source-available software with noncommercial restrictions**, not OSI-approved open source. See [LICENSE-SCOPE.md](LICENSE-SCOPE.md) for the full scope; internal business use is not automatically allowed just because no copy is sold.

Third-party dependencies, characters, and artwork retain their own licenses and rights restrictions. **Usagi materials are not relicensed by this project.** Their inclusion does not establish permission from the rightsholders, and noncommercial distribution alone does not establish permission. Retain the [Usagi usage notice](assets/companion/usagi/USAGE.txt). Dango artwork rights likewise cannot be inferred from the code license; check the applicable sources and permissions before reuse or redistribution. These restrictions also apply to artwork shown in screenshots.
