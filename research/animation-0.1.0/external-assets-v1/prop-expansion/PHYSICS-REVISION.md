# Prop support revision

Local revision only. No source actor mesh, original hand mesh, approved prop GLB, action timing, old staging or public repository was rewritten. Original rigid hand matrices for book/work remain unchanged. Existing renders/reports elsewhere are historical evidence; only `reports/physics-revision-audit.json` and `renders/physics-revision/` describe this revision.

## Changes

- Detached tissue uses its original rippled sheet, rotated about the same pinned corner so its free area hangs below the hand. No stiff upright tissue pose and no invented fingers.
- Keyboard and laptop retain their approved object placement and original rigid hands. Their former floating diagnostic slabs now have four floor-reaching research-stage legs. The laptop slab is shortened to eliminate its previously excluded body intersection. This plain support is a research fixture, not approved environment artwork.
- Ground props use actual transformed vertex minima against world Y=0.006. This corrects the play-group origin offset, floating lantern/hat/yarn bases and broom/shovel ground disagreement. Mat scenes use Y=-0.034 because the existing 0.04-thick mat top supports unchanged feet at 0.006. A solid floor at the mat top would bury the mat; no universal ground value is claimed for that scene.
- Book page normals now face upward toward the reader rather than downward. Book fit is evaluated with actual original hands, positive ground clearance and unchanged body/face. Uniform fit adjustment preserves design proportions; no page/cover mesh is rebuilt.
- World support utility handles nonidentity transformed stage parents exactly, including nonuniform scale, with one world-to-parent conversion. Ground props belong to a stage sibling of the actor; this is not a per-frame moving-parent anchoring system.

## Evidence and limits

Fresh audit covers 39 families plus two variants, input file and source hashes, actual triangle body/face crossings, finite near-contact triangle patch area and ground minimum. This patch is stronger evidence than a single nearest vertex but does not prove grasp force closure, friction or load-bearing torque. Original fin hands have not acquired fingers. Handheld cantilever poses remain static grip constraints; full dynamic grasp/cloth simulation and new action choreography are not certified.

Butterfly flight, star magic and ghost hover are intentional exceptions. The ground-hole needs a host cutout and cannot be rendered as a true hole over an opaque solid floor. Source cup uses the old tea pose, not new idle assembly. Paper/pencil retains its existing hand-boundary diagnostic limitation. Book/work original hand transforms are preserved, not reset to idle hands.

Neutral floor and contact shadows in review renders are lighting/stage evidence only. They do not establish geometry contact. Actual geometry audit is separate. CPU Blender renders are not native GPU or production application acceptance.

## Reproduce

Use a prepared, separately writable source cache as described in package README. Export group mounts, run garden shaft-depth repair and use the existing fixed watering-can export. Regenerate basic fit and render input; run work export-static. Then run Blender with `prop-expansion/src/audit-support-physics.py --cache-root CACHE --baseline-cache-root PRIOR_CACHE --output REPORT`, and Python with `prop-expansion/src/verify-support-physics.py --report REPORT`. Verification rejects stale inputs. Run `test-support-geometry.mjs`, comfort `test-install.mjs`, and basic `test-static-contract.mjs` with explicit repository/reference/cache arguments where required.
