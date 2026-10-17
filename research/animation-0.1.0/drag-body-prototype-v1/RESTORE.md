# Restore the minimal source closure

This overlay is intentionally independent of the frozen weighted-owner directory.

1. Check out baseline commit 9d987939db2d0b2d20264803ab26b8c39aa8c251 or a tree containing those exact baseline files. Keep its runtime-facepath05 and expression-scheduler-p1 sibling directories.
2. From this overlay directory run: `python3 tools/hydrate_runtime.py /absolute/path/to/research/animation-0.1.0`. The script verifies five baseline source/asset hashes before copying and restoring the three body capability overlay files. It does not modify the baseline.
3. `npm ci` for the locked Three.js 0.186.1 dependency. Then `npm test`. Original regressions: run `npm test` in vendor/runtime-facepath05 and `node --test test/*.test.mjs` in vendor/expression-scheduler-p1.
4. `node replay/generate.mjs` creates actual keyframe geometry input. `blender -b -t 3 --python render/render_actual.py -- --input evidence/keyframes.json --out evidence/keyframes-render --samples 24` renders it with source materials and vertex colors.
5. Private preview only: `node replay/generate.mjs --video`, then the same Blender command with continuous.json / continuous-render. `python render/compose_preview.py` adds a fixed ground and grip marker and encodes a normal-speed MP4. Do not commit any generated video or raw frame data.

The committed stills are reviewed evidence, not an artistic acceptance. Source geometry, face mappings and sole ownership remain the admitted full18 source; only the explicit optional four-bone rotation contract is extended.
