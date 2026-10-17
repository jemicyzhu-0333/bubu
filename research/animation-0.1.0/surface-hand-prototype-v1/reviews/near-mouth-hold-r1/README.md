# Frozen isolated near-mouth HOLD, r1

Not a sipping action or runtime-admitted asset. No original approved rest/face/profile change. One static derivative, same indices as base mesh. Round cap amplitude .24 is this isolated art candidate only; prior .16/.22 experiment bounds are not silently widened in any host.

Actual current static tests: cup shell/handle/tea vs body triangle overlap0; all neutral face meshes vs cup0; body nonadjacent self overlap0; analytic closed ceramic volume contains0 body vertices. Actual hand vertex-to-cup-triangle closest distances left .00040234/right .00050299. Mouth still approximately .012 away, so this is HOLD, not lip contact. Distances are sample upper bounds, not continuous or full triangle-distance minima. No all-expression or motion guarantee.

Source fit/pose/cup geometry hashes are recorded together in contact-triangle-audit.json, contact-distance-audit.json and render-manifest.json. The pose.npy is the frozen derivative positions, not a source GLB replacement. Rendering uses original unchanged face geometry. No giant frame arrays or videos included.

Reproduce: first run ../../tools/export-base.mjs in the restored repository. Copy its generated ../../tools/base.json beside these files (untracked). Run evaluate-contact.py with NumPy/SciPy to recreate pose.npy; node export-contact-cup.mjs exports actual existing cup-model geometry. Blender -b --python contact-triangle-audit.py and contact-distance-audit.py; Python contact-volume-audit.py. build.py remains byte-identical to the frozen cotangent base, while Node import paths here are made repository-relative. No startup/host registration is included.

Next bounded stage: retain this shape and cup dimensions; choose exact approved face mapping for V1 work.rest (content eyes/smile); establish true rim/visible-lip positive contact; design lift/tilt/return and face enter/hold/exit. Freeze one sampled path, audit intersections/clearance at stated cadence plus interruption entry/exit. If contact cannot be reached under those shapes, report the specific measured blocker rather than endless fitting or claiming sipping completion.
