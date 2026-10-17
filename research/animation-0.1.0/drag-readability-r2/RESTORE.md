# Restore the pending visual experiment

Suggested Git directory: research/animation-0.1.0/drag-readability-r2, alongside the frozen drag-body-prototype-v1. Hydrate that baseline first using its own restore instructions and install its locked Three.js dependency. This experiment only imports the frozen baseline; it does not modify it.

1. `node src/compare-poses.mjs` exports12 actual body/face comparison frames, using the two included source pose definitions.
2. `blender -b -t 3 --python ../drag-body-prototype-v1/render/render_actual.py -- --input evidence/poses.json --out evidence/poses-render --size 384 --samples 32`
3. `python src/measure.py` reproduces comparison measurements. Optional explicit argument: the exact historical r4-frozen.glb source from PROVENANCE.json, to repeat its already-recorded bind parity check.
4. `node src/short-hold-replay.mjs` exports the four-cell 40-frame1.6s comparison. Render using the same baseline renderer with short.json / short-render. `python render/compose_short.py` encodes the private comparison video.
5. `blender -b -t 2 --python src/audit_swept_mesh.py` repeats the actual40-frame numerical/11-sample intersection screen after step4.

Video, render batches and raw mesh buffers are excluded from this backup and must stay out of Git. The single committed comparison sheet and compact scalar trajectories document the pending direction only. Nothing in this directory replaces the frozen drag controller or approved character source.
