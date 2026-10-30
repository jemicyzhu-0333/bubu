# Foundation integration research fixture

This is a standalone CPU research harness, not production admission. It imports the
unchanged approved D2 source and hybrid GLBs, the extracted V2 DOM-pointer owner, and
revised accessory assets by path. No full actor assets are copied. One
application-owned `FoundationPool` is the aggregate owner; constructing more
pools is not an application-global budget enforcement mechanism.

## Running

From `research/animation-0.1.0`, run:

- `npm ci --ignore-scripts`
- `npm run foundation:prepare` (hash-checked local D2 archive; no download)
- `npm run foundation:preflight`
- `npm run foundation:test`
- `npm run foundation:integration`
- `node animation-foundation-v1/integration/verify-contract.mjs`
- `node animation-foundation-v1/integration/verify-release.mjs`
- `node animation-foundation-v1/integration/verify-authored.mjs`

For the complete current CPU/replay gate, use Node 24+ and run
`npm run foundation:verify -- --output /tmp/bubu-foundation-new-run`.
Python 3, NumPy and SciPy are required for the isolated contact replay. The output
directory must not exist. Individual verification scripts write to a fresh
temporary directory by default; `BUBU_FOUNDATION_EVIDENCE_DIR` selects an external
output directory. These runs never replace checked-in historical measurements.

Install at this shared research root, not separately inside sibling snapshots:
the runtime, fixture, accessory adapters and spring-bone package must resolve one
physical Three.js 0.186.1 instance. The preflight rejects duplicate installations.
All model/runtime imports use repository-relative paths. Historical body-pose
projections for floor/anchor regression live in `body-runtime/replay`, with source
and projection hashes; these are synthetic CPU fixtures, not native-input proof.

`effects/export-prototypes.mjs <scene-directory>` is an optional offline export.
It requires caller-provided `forest.json`, `sakura.json`, `halo.json` scene snapshots;
those art-preview inputs are not required by the reproducible foundation tests.
Geometry export uses `integration/export-evidence.mjs`; Blender CPU renders do not
certify native input, GPU timing, appearance or contact acceptance.

## Ownership

Surface picking uses pinned three-mesh-bvh 0.9.16 over a private, source-derived
Float64 posed-position buffer. Bone matrices are prepared once per pose; shared
triangles reuse those vertices. Single-bone rigid triangles use separate upstream
BVHs in their bone-local frames; only blended vertices are re-skinned/refitted.
Morph and grouped-material meshes retain the general posed-buffer strategy.
Every source face remains present exactly once; this is not a lower-detail mesh.
The rendered skin and its methods/topology are not
patched. Queries compare the complete skeleton/bind/morph snapshot before reusing
the tree, and versioned geometry or layout changes require readmission. This is
full-resolution picking, not a coarse collider substituted for the actual surface.
Direct raw buffer writes must use Three.js's `needsUpdate` contract.

Each actor reserves an additional bounded 32 MiB query/build envelope before
construction, then commits a conservative resident bound for the posed buffer,
BVH nodes, primitive bounds and indirect indices. Disposal releases that claim
and drops the private tree/buffer. This is CPU accounting, not GPU measurement.
Source imports use the repository layout. The shared preflight verifies dependency
identity and restored model hashes. Install the research-root pinned dependencies
before running; native/browser execution remains a separate gate.

Each frame advances the real pointer host once, updates the hybrid and matrices,
samples anatomical anchors with a fresh revision, updates secondary motion from
copied/interpolated anchor snapshots, commits accessory transforms, advances
effects, then exposes the final scene. Secondary substeps never advance body or
sample the live registry. No body/face/foot geometry is mutated by new modules.
The round tail is the revised actor-owned lower-back skinned restoration.

A rest calibration relates actual authored asset coordinates to its anatomical
anchor. Satchel geometry is baked from the corrected static adapter; ear accents
are baked from the accepted placement adapter. Both remain private accessory
geometry. Cape and halo use actual revised GLBs. The book grip is a research
lifecycle attachment, not an accepted hand choreography or palm contact fit.

Configuration compilation does not itself admit a runtime. Explicit asset-binding
providers admit the research fixtures; unsupported assets and modes fail closed.
The authored strategy uses the existing scene coordinator and quaternion lane,
with finite enter/loop/exit phases, contact events and bounded effect events.
Authored face intents enter the pointer owner's single expression batch through
its composition port. Skipped face keys coalesce at the current observed frame;
they are not backdated into an already sealed batch. Configurable tracks and
timings are checked by `verify-authored.mjs`, separately from gesture sweeps.

Spring modes remain experimental. Unsafe solver candidates retain the last
accepted local pose and retry with rebased history; this is not a hard joint-limit
or whole-cloth collision solver. See the secondary-motion recovery contract.

## Budgets and cleanup

One pool admits at most two active/pending actors. Each actor admits at most five
mounts, two in-flight equips, four effect emitters, 24 particles per emitter, and
fixed bounded secondary substeps. Generation tokens invalidate late equip results;
an older failure cannot tear down a newer equipped configuration. Configurations
are compiled to frozen snapshots before asynchronous work.

The pool's scene ledger reserves conservative decoded/staging byte claims before
accessory loading and accounts for resident claims until release. This CPU-owned
ledger excludes the separately admitted resident body baseline and does not
measure GPU allocation. Independent pools are still not an application-global cap.

GLB encoded files are capped at 16 MB before reading/parse. GLB preflight rejects
external buffers/images, more than 128 nodes, more than four textures, or oversized
accessor counts/buffers. Post-parse admission counts geometry indices, attributes,
morph arrays, and known texture image dimensions, with 16 MB decoded-array budget
and 100,000 vertices per asset. CPU texture metadata placeholders do not prove
real GPU texture memory. Known assets are bounded; this is not a hostile arbitrary
asset ingestion service. Shared immutable source templates remain a bounded cache;
zero live actor/effect/physics handles is distinct from freeing that cache.
Post-parse admission rejects non-finite attributes/transforms and out-of-range
indices. Geometry byte accounting charges each retained backing buffer once;
short or overlapping typed-array views cannot understate retained allocation.

The original hybrid parts now have a pool-owned source lease, rather than a
module-global promise cache. Concurrent actors share geometry but keep private
skeletons. Parse staging is reserved before loading; the decoded source is counted
once in the scene ledger. The last actor releases the actual source resources and
the claim. Failed loads can retry. Closing during a load retains reservations
until that load settles and cleans up. The separately admitted full face/body
baseline and upstream BVH module cache still have their documented boundaries.

## Validation boundaries

CPU DOM-event harness input is not native OS input. Blender images show exported
actual final geometry, not WebGL/GPU rendering. Timing includes CPU body, anchors,
secondary and effects; no GPU inference is made. Heap deltas are noisy measurements,
not OOM guarantees. Exact owned resources and pending handles are tested separately.

Book release uses the actual book mesh with a synthetic cuboid, floor, and a
Rapier world. It tests ownership transfer/reset/disposal and rate replay. It does
not establish detailed mesh contact, authored grasp/release choreography, or a
fast thin-edge CCD acceptance sweep. Cloth proxies and rest fallback are research
mechanisms, not production cloth/contact acceptance.


## Equipment ownership and cancellation

Replacement loading and decoded-asset admission finish before retiring the old
outfit. A failed or stale load preserves the current outfit and its configuration.
Loaded candidates remain off-scene during I/O. Attachment, effect and strategy
construction now finishes while the old outfit remains owned. A construction
failure releases only the candidate. Each replacement stages its own bounded
four-emitter runtime, so a full old outfit cannot consume the new outfit's slots.
The actor transfers the complete equipment snapshot before retiring old resources.
A retirement exception is returned as `cleanupError` on the applied result, not
as a retryable equip rejection. Reentrant explicit removal/disposal can still
invalidate the request; `stale` reports that cancellation.

An equip request owns its staged mounts, secondary instances, effect handles and
strategy locally until construction finishes and its generation still matches.
The live SceneBudget lease is then committed and ownership transfers synchronously
to the actor without external callbacks. Stale requests release only their staged
resources; an older request cannot remove a replacement request's equipment.
Roots are registered before attachment callbacks. Cleanup attempts independent
geometry, material and texture releases even if a disposal observer throws,
aggregating cleanup failures alongside the original operation error.

The binding provider's default loader clones owned resources for each instance.
An override loader must transfer independently owned geometry/material/texture
snapshots to one equip request, never borrowed source objects or resources shared
with another actor/request. Release-time deduplication covers resources shared
within that disposal batch only. It is not general cross-actor reference counting.
Rendered rigid clones may borrow their owning asset's resources; only the owning
asset is passed to asset disposal.

Pool disposal closes admission immediately but in-flight reservations remain
visible until pending construction settles and releases them. A zero SceneBudget
ledger alone is not proof of resource disposal: regression tests also count each
geometry/material/texture release and verify scene detachment. These CPU tests do
not establish GPU allocation release or native behavior.

The browser demo and Node fixture instantiate the same `foundation-runtime.mjs`
coordinator and `binding-provider.mjs`. Filesystem/hash/texture-loading adapters
stay at their composition boundaries. The browser uses actual GLTF textures;
Node's metadata-only texture reader remains a CPU fixture. Neither composition
writes canonical state or creates application IPC.

## Flower/body rest fit

`sakura-part-fit.mjs` corrects three measured flower/body intersections on the
private baked binding asset. Two petals rotate 30 and 25 degrees around their
authored centre vertices; the inward small leaf rotates 10 degrees around its
original proximal tip. Only child mesh transforms change. Source GLBs, position,
normal and index buffers, materials, mount offsets and action controllers remain
unchanged. Rigid part shape and fixed connection points have behavior checks.
The binding provider validates all three parts before applying the fit, clones
the prepared frames with owned instance resources, and includes the fit module
hash in the flower contact identity. There is no new per-frame writer or solver.

The full 481-frame idle/pending/petting/drag/landing replay clears all three
target pairs, retaining the original satchel/cape swing. Minimum actual triangle
gaps are 0.00481819, 0.00336543 and 0.00768002. Fourteen default-browser frames
match the reviewed candidate exactly at 1x/2x, including light/dark and action
views. The remaining two satchel intersections and whole-outfit continuous
contact/native/GPU gates stay open; this fit does not admit cape plus tea.
See [flower-fit evidence](../verification/flower-fit-20261024/audit.json).
