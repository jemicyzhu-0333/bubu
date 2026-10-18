# bubu separated-parts experiment

Original-source body, hands and feet with a shared per-actor rig. This is an experimental integration for the animation V2 branch, not a main-branch release.

- `geometry/`: compact five-part asset, binding manifest, provenance and reproducible source-only generator
- `runtime/`: guarded hybrid adapter; native body/foot skinning and rigid original hands
- `tea/`: clockless nine-second tea scene, prop lifecycle and contact evidence

The source actor retains the approved face library. Each actor owns its existing Skeleton; shared asset geometry never shares an actor's skeleton. The adapter borrows geometry/materials and restores source visibility on disposal. The caller owns the additional parts-pack lifetime; its lease and CPU/GPU budget accounting are not yet integrated into ActorPool. A zero source-pool count is not a claim that all cached geometry or GPU allocations are zero. Cup resources are owned and disposed separately.

## Local checks

Node.js24 and Three0.186.1 are the verified JavaScript environment.

```
npm ci --ignore-scripts
npm test
```

This command runs focused unit tests, not the actual pointer-host integration or native desktop acceptance. Geometry reconstruction instructions and exact input hash are in `geometry/README.md`; the existing approved source GLB is not duplicated here.

Before creating the adapter, compute the candidate hash from actual bytes and use the source SHA already admitted by SourceOwner. `createContractCheckedMixedBindingAdapter` checks the binding manifest, bone order and current actor ownership. Do not infer asset compatibility merely from an equal bone count.

## Verification boundaries

Actual pointer-host integration, recorded-pose replay, contact sampling, offscreen rendering and static/selected-motion visual review are separate evidence stages. Original reference hashes remain on their reports; the compact file is linked through exact array-equivalence and independent cold-load checks.

The experimental host still uses the hidden original skin for hit testing, drag anchors and ground placement. Head-area drag/petting has been exercised; relocated hands can differ from this temporary hit proxy. A production hit/anchor/ground provider and native Windows/macOS/WebGL checks remain necessary. CPU export speed is not runtime rendering FPS.

No publication, main merge or release is implied by this package. Generated preview videos, per-frame binaries, installed dependencies and rejected model variants are intentionally excluded from the repository payload.
