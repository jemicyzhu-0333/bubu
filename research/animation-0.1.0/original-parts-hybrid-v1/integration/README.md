# Actual pointer-host integration harness

This is separate from `npm test`. Unit tests do **not** replay the complete source host, create all animation frames, or render videos.

## Requirements

- Node.js 24 (tested with 24.19.0) and Three.js exactly 0.186.1.
- `npm ci` in this delivery package installs its pinned Three dependency.
- An existing source checkout containing the complete `research/animation-0.1.0` tree. Keep its transitive imports intact and make sure that checkout also resolves Three 0.186.1.
- In particular: `petting-continuous-r2`, `shared-input-workbench-v2`, `drag-body-prototype-v1`, `drag-landing-r5`, `expression-scheduler-p1`, and `runtime-facepath05`, including their source imports.
- The original approved source pack at `runtime-facepath05/fixtures/face-d2/{asset.glb,manifest.json,profile.json}` and body pose profile `drag-body-prototype-v1/replay/body-poses.json`. The source GLB SHA must be `84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a`.

The source research tree is **not** bundled in this delivery package. Missing source files cannot be replaced by running `npm test`.

## Full actual-DOM export

Run from the delivery-package directory:

```sh
npm ci
node integration/actual-pointer-regression.mjs \
  --research-root /repo/research/animation-0.1.0 \
  --asset ./geometry/bubu-hybrid-binding.glb \
  --manifest ./geometry/binding-manifest.json \
  --output /tmp/bubu-full-pointer \
  --full-export
```

Asset and manifest default to the package's compact geometry SHA `52a080d81606fbe92e9cd71593bd703f356eb50a0e1c74ccc34547a0db308e67`. Research root defaults to `research/animation-0.1.0` in the working directory. Output defaults to `integration-output` in that directory. Equivalent path environment variables: `RESEARCH_ROOT`, `ASSET_PATH`, `BINDING_MANIFEST`, `OUTPUT_ROOT`.

The harness runs seven actual DOM lifecycle cases, then the unchanged sourcehost interaction schedules: 271 endpoint-inclusive drag samples over 9 seconds and 1,891 long-press samples over 63 seconds, both at 30 Hz. All live face morph positions, normals and D2 N3 diffuse colors are exported. It verifies source contract/owner freshness, finite transforms, source visibility/disposal and zero final source-actor pool reservations/references. Native feet/body deform through this actor's original Skeleton; only hands use rigid overrides.

The process can take around 10–15 minutes or longer, depending on the machine, and writes several GB. CPU export throughput is not renderer FPS. Preserve the `report.json` provenance hashes; do not relabel another artifact's completed run as this compact file.

Options:

- `--scenario drag` or `--scenario longpress` runs only that motion after lifecycle checks; the default is both.
- `--lifecycle-only` performs the seven small lifecycle checks with no motion export.
- `--numeric-only` runs actual host frames without binary geometry exports.
- `--windows-only` exports only selected normal-speed windows and keyframes. These windows must **not** be stitched and described as a continuous full-duration clip.

## Outputs and rendering

Each scenario directory contains `trajectory.json` and `manifest.json`. The latter stores topology once and references Float32 world-position, normal, and per-frame mouth-diffuse binary files. `fullExport: true` plus verified contiguous frame indices is required for continuous playback. Hidden original skin is excluded from rendering; its existing ray/anchor/ground proxy remains in the source host.

This Node harness exports geometry and evidence. It does **not** generate MP4, GIF or rendered screenshots. A renderer that consumes the complete manifest and preserves 30-fps timing, materials and per-frame N3 diffuse reset is a separate dependency/step. Endpoints are included in the data: a strict 9.000/63.000-second encoding may omit the repeated final endpoint sample rather than adding a one-frame hold.

## Provenance

The completed recovery full-DOM run used the original candidate SHA `361a9fa6…`; the package's compact SHA `52a080d8…` is linked by `geometry/compact-equivalence.json` and separate cold-load/contract/keypose evidence. All 26 loaded render arrays and 81 representative world-position/normal/diffuse binaries were checked byte-identical. This equivalence does not rewrite the original run's SHA. Consult EVIDENCE-SUMMARY.json for actual completion status; this README alone does not establish that a run finished.

The portable harness was smoke-tested using explicit research/output paths and its default compact asset. See the integration evidence summary for exact completed scope. The original running harness was not overwritten while preparing this portable copy.

## Parts-asset ownership and production scope

The new parts pack is loaded outside `SourceOwner` / `ActorPool` and borrowed by the adapter. The caller owns its geometry/material lifetime, shared-asset leases and CPU/GPU resource accounting. Disposing an adapter does not dispose these borrowed template resources. The caller must retain them while any actor uses them and release/dispose them after the last consumer finishes.

Reported zero pool counts establish cleanup of the tracked source actors and their reservations/references only. They do **not** establish that the new parts pack has been unloaded, that all GPU resources are zero, or that its memory is included in the source pool budget. No GPU-memory measurement was performed.

Production admission still requires a parts-asset lease/currentness guard and budget registration covering the externally loaded pack, in addition to the existing source contract/owner checks. This deliverable verifies the split asset and adapter behavior; it does not complete that production admission/accounting integration.
