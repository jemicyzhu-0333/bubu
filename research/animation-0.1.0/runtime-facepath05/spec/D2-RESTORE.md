# Restore D2 capability after checkout

This delta updates canonical runtime-facepath05 and one expression-scheduler-p1 binding. Keep all unlisted paths; do not overwrite body/pointer vendored snapshots. Production policy/default style is unchanged.

From repository root:

```sh
cd research/animation-0.1.0/runtime-facepath05
python3 tools/materialize-full18.py
python3 tools/materialize-d2.py
sha256sum -c D2-SHA256SUMS
npm ci --ignore-scripts
npm test
(cd ../expression-scheduler-p1 && npm test)
```

The first materializer is an existing dependency from the original full18 publication; it remains in the repository. D2 uses the existing archive at `../expression-library/d2-style-variant/asset/bubu-full18-d2-static-blush.glb.gz`. Neither GLB is duplicated by this source delta. Expanded D2 asset is gitignored. Both scripts verify exact sizes/hashes and fail closed. Python 3 standard library suffices; no download or temporary absolute path is required.

D2 registration is only selected through prepareD2FacePack and matching P0/P1 policy source/profile hashes. Actual shader compilation/rendering and body/pointer workbench integration remain separate verification steps. Historical FULL18/WEIGHTED locks describe older snapshots; D2-SHA256SUMS is this candidate's current runtime/P1 lock.
