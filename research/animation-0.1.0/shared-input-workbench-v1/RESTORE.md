# Restore

Target: research/animation-0.1.0/shared-input-workbench-v1, alongside runtime-facepath05 and expression-scheduler-p1. Baseline is Git commit 9c7837554fae20e9a5679db241328b875bcd6cb4 (D2 runtime at 2812a75d6055cb963d839a83f04cc899572e42f0). Apply the publication overlay paths without running the historical drag hydrate tool.

Required unchanged source dependencies are individually hashed in PROVENANCE.json: drag-flow-r4, drag-body-prototype-v1 BodyRigAdapter/body-poses and petting-prototype-v1 controller. Runtime/P1 dependencies are canonical siblings, not vendored copies. Verify with node tools/verify-dependencies.mjs. No source file uses an absolute workspace path.

Publication restore includes the physical D2 runtime/P1 baseline plus only required historical controller/adapter files. It intentionally excludes node_modules, symlinks and the historical vendored runtime. Supply the package-lock pinned Three 0.186.1 via npm ci, or copy an already verified installation for offline test verification. The latter is how CPU restore checks were run; a network install is not claimed.

Independent probes can be rerun with `node tools/review-init-failure.mjs`, `node tools/review-body-boundary.mjs`, and `node tools/review-d2-regression.mjs`. Their import paths alone were adapted for this sibling layout; original reviewer scripts and evidence remain in evidence/review. All three portable probes passed in the physical restore, including 630 D2 samples.
