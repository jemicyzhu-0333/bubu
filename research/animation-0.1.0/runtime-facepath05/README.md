# owner08: admitted expression ownership integration

Independent integration snapshot, 2026-10-17. No changes to frozen facepath06,
observer01 or preparse07. No drag/long-press implementation. No real WebGL claim.

## Sources

- facepath06 supplies the admitted real seven-path/eight-layer asset and baseline runtime.
- preparse07 supplies pre-parse allocation admission in geometry-accounting,
  pack-loader, glb-preflight, art-glb-preflight. Its actor-pool documentation is
  merged without overwriting ownership changes.
- observer01 supplies the observer-isolated ExpressionDirector. Its only local
  changes are imports, shared strict data-validator exports with enumerable-field rejection, and a read-only hasInteraction predicate used by lifecycle
  invalidation (active enter/hold/exit/gap and queued interaction requests).
- src/face-timeline.mjs is the exact canonical facepath06 implementation,
  materialized once in this production Git layout. Both legacy and directed
  actors import it locally. A directed actor never constructs a legacy clock.
- This production layout has no sibling snapshot dependencies or symlinks.
  The older expression-director-p0 directory may remain as a historical archive;
  it is not in this runtime's import graph. No node_modules are distributed.
  Install the exact locked dependency with npm ci --ignore-scripts before testing.

## Run

From this directory: npm test

This runs the original runtime tests, preparse07 tests, new owner integration
checks on the real admitted GLB, and observer01/director regressions against the
integrated implementation. Tests use CPU geometry and EventTarget/scheduler
fixtures. They do not create a WebGL context, certify GPU recovery, or measure
real input latency.

The intended host API is ExpressionOwner in src/expression-owner.mjs. See
spec/OWNER08.md for clocks, same-time input, fail-stop, and visibility rules.
ActorPool remains the one application admission domain; createDirected is a
trusted low-level adapter entry point, not an interaction-facing writer API.

## Inherited completed facepath06 offline visual evidence

The unchanged canonical face clock already has all five scenarios reviewed:
623 regular 30 Hz frames plus 74 exact diagnostic instants in four views
(296 diagnostic images), totaling 919 hash-verified PNG records. All regular
frames were inspected in 23 fixed-99px contact sheets and all diagnostic rows
in 17 sheets. Source Basis RGBA calibration matches the approved reference.
No isolated wrong-face flash or residual brow/tongue was found in that offline
frame review; the cross-semantic neutral beat remains visibly present.

Normal-speed MP4s were generated and timing-verified, but real-time normal-speed
viewing was not performed by those tools. This is offline Blender replay of the
canonical controller weights, not an owner08 browser/GPU capture. It does not
certify interactive timing, input latency, WebGL or final drag/long-press. The
owner integration retains that exact clock and approved asset unchanged.
See spec/FACEPATH06.md and evidence/FACEPATH06-COMPLETE-REVIEW.md in the Git
checkpoint for the completed review and its precise boundaries.

## Still gated

Real browser/GPU rendering, context recovery, first-frame behavior, actual draw
calls/VRAM/GPU time and input latency require an authorized browser route. No
socket restriction was bypassed. Full 18-slot art, drag/pet/long-press, bodies,
clothing, contact physics, random P1 policy and gaze remain outside this patch.

## Explicit full18 candidate

The seven-slot default is unchanged. See [FULL18](spec/FULL18.md) for the separate `prepareFullFacePack` opt-in, exact resource budgets, CPU tests and GPU evidence limits.
