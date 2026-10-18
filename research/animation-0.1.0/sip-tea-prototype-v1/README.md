# Sip-tea prop prototype v1

Isolated research asset, not a migrated action or runtime-admitted capability.

`src/cup-model.mjs` constructs a hollow rounded ceramic cup with a C handle and tea surface. Origin is bottom center, +Y up, dimensions in approved05 model units. Default radius .27, height .33; named rim/handle/support points are candidate contact frames, not a verified grasp.

Resource ownership is local: `dispose()` is idempotent and releases all geometries/materials. No imported character assets, external textures, owner, clock, animation timer, body mutation, face mutation or host changes.

Run `node --test tests/*.test.mjs` after restoring the baseline Three dependency. Tests cover bounded inputs, finite vertices, geometry bounds and cleanup.

The corresponding V1 semantic ID is `sip-tea` (#27 catalog entry); food rituals map coffee/milk to that action. This prototype prioritizes a reusable cup/contact capability. Earlier #1 workout and #2 chase-butterfly remain unmigrated. V1 timing and face labels are not accepted V2 choreography.

Current actual-model reach probe shows that the existing admitted short-fin rig cannot grasp this normal-sized cup while its near rim touches the mouth. A separate action-rig proposal is under review. No production-ready or complete-animation claim is made.

## Local dependency

The private package pins Three.js 0.186.1. Run `npm ci --ignore-scripts` in this directory before importing `src/cup-model.mjs`. For the sibling full-chain resource tests, also run `npm ci --ignore-scripts` in `../surface-hand-prototype-v1/full-chain`, then run `npm test` there. Each package resolves its own declared dependency; no parent-workspace install or production dependency change is required.
