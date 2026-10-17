# Reproduce rejected offline carrier experiment

Status: rejected research, not admitted. Run from this directory in a restored animation-0.1.0 tree containing the original petting-continuous-r2/runtime-facepath05 and Three dependency. No runtime asset is changed.

1. node measure.mjs
2. node cup-reach.mjs
3. node experiment.mjs
4. python patch-reach-bound.py (NumPy/SciPy required)
5. blender -b -t 4 --python render-probe.py -- --input experiment-frames.json --out experiment-render --size 384 --samples 16 --span 3.1

The generated frame JSON is about116MB and is deliberately excluded. Metrics and small QA PNGs are retained. Model vertices are CPU-deformed offline and Blender-rendered; this is not a running WebGL or app acceptance test. Normal reversal count is not proof of triangle inversion. Source hash/rest/face/feet identity is preserved; the shoulder deformation fails edge-stretch gates.
