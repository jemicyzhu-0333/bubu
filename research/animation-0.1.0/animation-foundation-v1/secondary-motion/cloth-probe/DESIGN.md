# Cloth research: bounded implementation and validation plan

Status: research candidate only. No garment admission or production integration.

## Fixed scope

- Keep the canonical body, its animation, and the finalized render mesh unchanged. Deform only a private runtime copy; do not rewrite source positions, topology, UVs, materials, or files.
- Investigate one garment in an isolated Rapier 0.21.0 world using the installed dependency. Do not migrate the existing detached-prop world or spring-chain adapters.
- Use a low-resolution, rest-shaped thin simulation surface plus an offline render-to-simulation binding. This is a candidate mapping, not a new physics solver.
- Separate fixed clasps and other rigid trim from simulated cloth. Existing clasp/cup interference remains an asset/trajectory compatibility blocker; cloth cannot resolve a fixed constraint occupied by an obstacle.

## Current evidence and limits

`run.mjs` / `evidence.json`: synthetic 100-particle sheet, 600 frames, moving pins and a kinematic sphere. Maximum pin error is approximately 2.97e-8; sampled particle/sphere and simulation-triangle/sphere penetration are zero. Latest measured world-step P95 is 2.325 ms and maximum is 266.916 ms. Performance is **not passed**.

These results do not establish continuous collision safety, render-mesh clearance, self-contact, real hand/cup contact, garment binding, multi-instance costs, or native/GPU behavior. They do not replace the round5 cape's failed tea-contact admission. Timing excludes the complete render-mesh update pipeline.

The later actual-shape prototype uses 444 adaptive particles and 7,739 render
vertices without modifying the approved model. Its 30-frame body-only trial has
no surface intersections at four sampled instants, but step P95 is about 585 ms;
this route is not real-time-ready. Fixed clasp/hand/cup and full seam checks remain
open. Rest mapping and independent vector-reference evidence are available in
`cape-binding.json` and `mapper-evidence.json`; they do not complete the checklist.

## Candidate adapter contract

1. **Offline inputs:** immutable render geometry identity; authored thin simulation rest positions, triangles, structural/bending constraints, pin IDs, and cloth-region/seam labels. Preserve openings and disconnected pieces; do not weld front/back surfaces by proximity alone.
2. **Offline mapping:** for each deformable render vertex, record a simulation triangle, barycentric weights, and a rest-local detail/thickness offset. Define a deterministic triangle frame and how offsets are transported. Reject ambiguous cross-region mappings, out-of-range weights, excessive offsets, and degenerate triangles. Record seam-equivalence groups explicitly.
3. **Admission:** hash both mesh inputs and mapping; validate indices, finite values, byte/particle/triangle caps, rest reconstruction, pin ownership, and coordinate/unit conventions. Old spring-chain bindings do not authorize the new mapping.
4. **Runtime inputs:** timestamped, revision-matched pin and obstacle snapshots in one declared world coordinate system. Advance canonical animation once; interpolate snapshots without advancing it again. Initially accept only rigid unit-scale transforms.
5. **Runtime output:** private deformed render buffers, normals/bounds, and explicit accepted/blocked diagnostics. Detect degenerate/inverted mapping frames and excessive strain. Never present stale accepted state as safe without checking it against current obstacles.
6. **Ownership:** one research instance owns its world, soft body, obstacle bodies, and private render buffers. Clean up in construction failure, cancellation, and idempotent disposal. Source geometry/materials remain borrowed. A future shared-world owner would step once per substep and adapters would remove only their own resources; that migration is out of scope.

Rapier's `setSkin` is documented as embedding a mesh in cells; in 3D those cells are tetrahedra. Do not assume it directly implements thin-cloth triangle mapping. A volumetric cage would be a separate experiment, not a prerequisite for this candidate.

## Validation checklist and required evidence

Before implementation, declare numerical tolerances and resource budgets per fixture; do not choose passing thresholds after observing failures. Save asset/mapping hashes, dependency versions, commands, frame counts, and all failures alongside each report.

- [ ] **Rest reconstruction:** reconstruct every render vertex without stepping; report maximum/RMS position error, unchanged UV/topology, normals, and bounds. Test rigid transforms and reject unsupported scales.
- [ ] **Pins and seams:** measure pinned render vertices as well as simulation particles. Test attachment motion, seam gaps, fixed/moving boundaries, trim alignment, and impossible pin/obstacle overlap. Block infeasible cases instead of silently moving fixed parts.
- [ ] **Simulation contact:** retain full triangle/sphere distance tests, including pinned regions and declared thickness. Add fast crossing and between-sample cases; label sampled evidence separately from continuous guarantees.
- [ ] **Actual high-model contact:** test the deformed render triangles, including hems, offsets, and rigid clasps, against actual hand/cup geometry through the tea trajectory. Report each failing part/time. A clear simulation cage is insufficient.
- [ ] **Shape validity:** quantify stretch, triangle degeneracy/inversion, mapping discontinuities, and visible silhouette/seam changes. Self-contact remains explicitly unverified until tested with it enabled.
- [ ] **Time/lifecycle:** exercise 30/60/120 Hz, no-substep display frames, pause/reduced motion, resume, backward time, long jumps, hidden/unhidden, obstacle removal, stale revisions, interrupted creation, unload/reload, and double disposal. Validate the final displayed pose, not only solver ticks.
- [ ] **Multi-instance:** use a bounded small instance count; verify independent state, removal isolation, aggregate resource caps, and behavior when admission exceeds budget. Do not extrapolate one garment's timing linearly as a guarantee.
- [ ] **Full-chain cost:** separately measure snapshot sampling, physics step, particle readback, high-model mapping, normals/bounds, contact verification, and total frame wall time. Record P50/P95/max, warm-up policy, repeat runs, allocation peaks, and after-disposal state. Keep WASM capacity, live allocations, and GC-dependent process measurements distinct.
- [ ] **Platform/visual checks:** inspect the actual garment in motion and run native Windows/macOS/GPU validation before any production claim.

## Decision gates

Proceed first to rest reconstruction and pin/seam tests on an unchanged garment. Only then attempt its real contact trajectory. Keep the cape blocked if fixed geometry conflicts, the mapped high model penetrates, or any safety/budget gate fails. No full migration, automatic fallback to penetrating rest geometry, stable-frame-rate claim, or release follows from the synthetic probe.

## Primary sources

- [Rapier 0.21 soft bodies](https://rapier.rs/docs/user_guides/javascript/soft_bodies/): cloth, surfaces, kinematic particles, shared-world interaction, removal.
- [Deformable colliders and skinning](https://rapier.rs/docs/user_guides/javascript/soft_bodies/#deformable-colliders-and-skinning): volumetric cage/cell embedding and collision-skin distinction.
- Installed declarations: `@dimforge/rapier3d-compat/dist/dynamics/soft_body.d.ts` and `dist/pipeline/world.d.ts`; executable local evidence: `run.mjs` and `evidence.json`.
