# Facepath05: reviewed subset adapter API

This entrypoint consumes only the registered seven-slot slice and its complete eight-layer profile. The archived 18-slot master, historical r6 and arbitrary GLBs are not accepted here. The separate neutral04 and mechanical entrypoints retain their prior limits and APIs.

```js
const pack = await prepareFacePack(browserPackReader(packURL), {signal});
const actor = await applicationPool.create(pack, {signal});
scene.add(actor.root);
actor.enqueue({type:'face', time:now, id:'N3', amount:1,
               fadeOutSec:.28, fadeInSec:.42});
actor.advance(now);
const state = actor.state; // deliberate diagnostic allocation
actor.enqueue({type:'cancel', time:later, fadeOutSec:.3});
actor.dispose(); // idempotent; returns shared ownership only once
```

A host must use one ActorPool admission domain for mechanical, neutral and face actors. Active plus pending costs apply before parsing. The rendering root is a trusted host handle; external code must not alter geometry, materials, skeleton transforms, shape weights or hierarchy. The adapter is not a sandbox for hostile host JavaScript.

The initial state is original Basis, all target weights zero. `semanticDefault: R0` is descriptive host guidance, not an automatically activated expression. Only explicit semantic cues change the face. No joint movement, pose, gaze, independent brow/tongue, accessory, physics, pointer or petting API is provided by this actor.

`enqueue` validates the exact face/cancel cue object and returns the actor. `advance` uses absolute seconds and returns whether any facial binding write occurred. `isAnimating` is false during a settled nonzero hold. `nextDeadline` reports the next queued cue time; the demand scheduler can sleep until then. New input must invalidate the demand scheduler. See FACE-TIMELINE.md for canonical events, queue cancellation, finite bounds, intentional braking, re-entry policy and timing diagnostics.

`assertCurrent` is an explicit audit: it scans all facial weights and source-node transforms, so it is not a per-frame requirement. Normal facial sampling only writes pre-bound influence arrays; it does not find nodes, deform CPU vertices or traverse the skeletal hierarchy. Three's actual renderer can still propagate matrices in O(nodes), process skin/morph shaders, upload data and allocate renderer resources. None of those GPU/render costs is measured by the scalar sampler tests.

## Calibrated parser/admission boundary

The seven-slot source contains 51,036 vertices, 303,882 indices, 18 nodes, nine meshes and eight facial layers with 56 targets each. Source bytes and exact hash are in its manifest. Target geometry is immutable and shared across actors; each actor owns its influence arrays, skeleton clone and scalar clock.

The face-specific hard ceilings remain bounded: 12 MiB encoded GLB, 16 MiB total encoded package, nine meshes/primitives, 60,000 vertices, 310,000 indices, 1,024 accessors, 1,200 buffer views, 64 targets/mesh, four million decoded accessor scalars and 16,000,000 decoded accessor bytes. Package declarations may lower these ceilings, never raise them. The source reservation is encoded bytes plus unique accessor dense bytes; the separate face decoded-array admission ceiling is 24 MiB, and the included fixture lowers it to 20 MiB.

The default application morph-expanded budget is1,000,000, so it admits two of these actors; a third would require1,008,396 and is rejected unless the host explicitly declares a larger allowed application budget. The four-actor CPU harness raises vertices and morph-expanded limits within the existing hard ceilings. The actor-count ceiling alone is not an admission promise.

These reservations are not total heap or VRAM. Theoretical Three RGBA morph packing for this subset is 9,123,072 bytes before texture-size padding and driver allocation, in addition to source, base geometry and decoded morph arrays. A neutral weight does not mean that a resident geometry's morph targets cost no renderer memory. This first closure deliberately uses one immutable resident subset rather than introducing unmeasured bank swaps.

## Equality and readiness

The model composition audit compares source arrays byte for byte, including signed zero. Runtime GLTFLoader parity compares numeric values, with Three's documented normalization of 25 source body-weight scalars reproduced explicitly. Those are distinct claims. Materials, vertex-color binding, authored POSITION/NORMAL knots and all eight neutral-hidden layers are covered.

The adapter's scalar clock can be C1 through interruption. The authored facial path remains piecewise linear across knots, so vertex velocities can change at those knots. The visual gate must inspect the real trajectory, including shared small-O Basis crossings, brow/tongue appearance, exact arrivals and re-entry. Readiness does not imply full-library activation, approved acting, browser/GPU appearance or final drag/long-press behavior.
