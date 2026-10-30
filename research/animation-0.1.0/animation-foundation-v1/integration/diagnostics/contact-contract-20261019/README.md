# Bubu cape / tea contact research bundle

Read `FINDINGS.md` first. This is a blocked-compatibility diagnosis, not an approved visual correction or runtime adapter.

Intended repository location:
`research/animation-0.1.0/animation-foundation-v1/integration/diagnostics/contact-contract-20261019/`

## Self-contained sampled-data replay

`requirements-replay.txt` records the NumPy/SciPy versions used for the recovered
replay. Install them in a disposable Python environment when reproducing this
checkpoint. The smoke report also records the actual Python/library versions.

Requirements: Python 3 with NumPy and SciPy. No Blender, Node, source checkout, physics engine, or old workspace/cache paths are required for this replay. All inputs resolve relative to each script's `__file__`; working directory and folder name are arbitrary.

Run using any path to this bundle:

    python /path/to/contact-contract-20261019/audit.py
    python /path/to/contact-contract-20261019/pin-depth.py
    python /path/to/contact-contract-20261019/displacement.py
    python /path/to/contact-contract-20261019/verify-provenance.py

These write analysis reports inside this bundle. Run `audit.py` before `pin-depth.py` when rebuilding all reports. `inputs/` contains original sampled hand/cup positions, shared indices, static cape export, and coarse attachment fixture. Position binaries are content-addressed and deduplicated. `motion.json` and `frozen-cape.json` are source exports used as immutable replay inputs.

To verify directory independence without rewriting original measured reports:

    python /path/to/contact-contract-20261019/portable-smoke.py --output /tmp/contact-portable-new.json

This copies the bundle into a renamed Unicode directory, runs all four replays from an unrelated cwd, and compares with the frozen results (exact structures and integers; floating point rtol=1e-10, atol=1e-12). It verifies the original bundle was unchanged and writes only the caller's new external report. It does not run Rapier physics. `export-paths.mjs` supplies the previously missing repository path resolution for both Node exporters.

## Regenerating the two source exports

Requirements: Node.js and the research tree's installed npm dependencies, including Three.js and three-mesh-bvh, with their versions retained by the existing lockfiles. The two export scripts read existing GLBs/configuration and do **not** require Blender. Rebuilding the upstream approved GLB or coarse geometry from its Blender authoring script is a different operation that **does** require Blender and approved source body inputs; do not rebuild or overwrite those assets as part of this diagnostic replay.

Use the same-repository research root discovered by walking up from this bundle, or provide it explicitly:

    node /path/to/contact-contract-20261019/export.mjs --research-root /checkout/research/animation-0.1.0 --output-dir /tmp/contact-export
    node /path/to/contact-contract-20261019/export-motion.mjs --research-root /checkout/research/animation-0.1.0 --output-dir /tmp/contact-export

Both exporters require `--output-dir`; the frozen bundle cannot be their output directory. `export.mjs` verifies the approved cape SHA256 before loading. It reads `wearable-approved-round5/accessory-expansion/models/07-cape.glb` inside the research tree, not a temporary checkpoint directory. Both scripts support spaces/Unicode paths and arbitrary cwd. Compare regenerated exports with the frozen inputs before accepting them. `source-manifest.json` records original source provenance paths and hashes; those historical path labels are not runtime dependencies.

## Freeze

Retain the entire bundle including `inputs/`, source/export provenance, smoke evidence, `FREEZE-FILES.txt`, and `SHA256SUMS.json`. `FREEZE-FILES.txt` enumerates every deliverable; `SHA256SUMS.json` hashes all listed files except itself. Preserve the original source tree in its existing research checkpoint. No private notes are included.
