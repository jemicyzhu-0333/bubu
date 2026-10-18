# Isolated cloth feasibility probe

The already-pinned Rapier 0.21.0 package exposes soft bodies; no new dependency or
physics integrator is introduced. This probe is not imported by FoundationActor
and does not replace the approved body, cape geometry, bindings or spring chains.

After the shared research-root setup, run from `animation-foundation-v1`:

`node secondary-motion/cloth-probe/run.mjs`

A 100-particle vertical sheet follows moving pinned particles while a kinematic
sphere pushes through its original plane over 600 fixed 1/60-second steps. The
probe checks finite bounded particles, pin error below 1e-5, and every sampled
collision triangle's nearest distance to the sphere (penetration below 1e-4).
Particle clearance alone is insufficient. `World.free()` runs in `finally`.

The measured small-scene CPU cost is exploratory. Large outliers remain; this
cannot certify a native/GPU frame budget. It also does not establish continuous
collision, fast teleports, self-contact, garment fitting, render-mesh transfer,
multiple simultaneous garments or the fixed clasp's clearance from a cup.
Those are separate admission tasks before this route can become a runtime mode.

Official references:
- [Rapier soft bodies](https://rapier.rs/docs/user_guides/javascript/soft_bodies/)
  documents cloth, pinned particles, deformable surfaces and kinematic targets.
- [Rapier rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)
  explains that authored kinematic trajectories are not corrected by contact forces.
- [VRM sphere collider](https://pixiv.github.io/three-vrm/docs/classes/three-vrm-springbone.VRMSpringBoneColliderShapeSphere.html)
  is a sphere-to-target distance interface, not whole-cloth collision acceptance.

## Actual cape mapping research

The canonical high model remains byte-identical. An adaptive meridian grid uses
444 simulation vertices for its thin surface; 7,739 render vertices in five
parts bind to local simulation triangles. The fixed clasp remains separate.
Angular-panel checks keep mappings from crossing the front opening. Rest error
is approximately 1e-14; 38,695 comparisons against a separate Three vector
implementation have maximum error below 1e-7. These are geometric checks, not
full seam or contact acceptance.

From `animation-foundation-v1` after the shared setup:

1. `python3 ../external-assets-v1/shared/export-foot-inputs.py --repo-root ../../.. --out /tmp/bubu-cloth-input --all-parts`
2. `blender --background --python secondary-motion/cloth-probe/author-coarse.py -- --cols 64 --rows 18 --spacing .08 --body-input /tmp/bubu-cloth-input/Bubu_body.npz --out secondary-motion/cloth-probe/cape-coarse.json`
3. `node secondary-motion/cloth-probe/bind-render.mjs`
4. `node secondary-motion/cloth-probe/check-rest-clearance.mjs`
5. `node --test secondary-motion/cloth-probe/thin-surface-mapper.test.mjs`
6. `node secondary-motion/cloth-probe/verify-mapper.mjs`
7. `node secondary-motion/cloth-probe/run-cape.mjs --frames=30 --body-collider=trimesh`

Blender and Python/NumPy are offline authoring requirements. `/tmp` in the example
is a caller-chosen output directory; on Windows select an ordinary temporary
folder. The author checks both NPZ arrays against the hash-pinned repository GLB.
The approved builder's two geometry functions are reused without running its
model-export side effects.

**Blocked:** the real-shape 30-frame trial has no body intersections at its four
sampled instants, but excludes clasp/hands/cup, containment, self-contact and
continuous checking. Physics step P95 is approximately 585 ms, far outside a
real-time budget. `--skip-contact` and `--body-collider=none|convex` are diagnostic
isolation switches, never admission modes. Each run writes a unique running,
completed or failed record with accepted=false; a killed process may leave
running status and does not prove cleanup. The existing lightweight runtime is
not replaced. See DESIGN.md for the remaining gates.
