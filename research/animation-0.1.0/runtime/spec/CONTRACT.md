# Runtime 0.1.0 — first implementation contract

Status: fourth foundation checkpoint adds fixed-hash static05/r6 neutral-only art loading to the mechanical clip/measurement/admission foundation. Art expression/motion activation and drag/pet product behavior remain gated. No V1 runtime imports, aliases, compatibility branches, or silent fallback. The original archives stay unchanged; only bundled static05/r6 neutral sources are loaded by the distinct adapter.

## First vertical slice

An explicitly labeled mechanical fixture is loaded from a hash-locked, self-contained GLB pack. A strict profile binds typed semantic slots to actual nodes; normalized, bounded skeletal segments and a single-path expression fixture share canonical event time. A fitted rigid fixture accessory follows its slot and supports its own local track. An interrupt starts from the evaluated current state. A demand scheduler and reference-counted assets cover lifecycle. This proves foundations, not bubu acting, contact physics, or GPU performance.

## Three separate capability levels

1. Engine support registry: what code exists in this version.
2. Character bindings: compatible nodes, rest frames, reviewed limits, expression paths and fit profiles.
3. Verification records: numerical / visual / browser / user-approval scopes, each separately versioned. Engine support is never artistic approval.

Supported in this foundation: authored STEP/LINEAR quaternion clips with per-track key times, skeletal quaternion-delta segments, one morph path via neutral, rigid sockets, accessory-local rotation, canonical events, C0 interruption, owned-resource lifecycle, demand scheduling.

Explicitly unsupported: knee/elbow/wrist/neck synthesis, gaze, dual-foot or two-hand IK, cloth simulation, collision guarantee, general contact/landing solver, arbitrary additive face blend, unrestricted material animation, arbitrary script plugins, production drag/pet input. The new engine must return a typed unsupported error. A future explicitly reviewed fallback is a named, hashed data binding with its own requirements; 0.1.0 never invents one.

## Pack boundary

Manifest format `bubu-suite`, version exactly `0.1.0`, no unknown properties or extensions. Pack paths use a conservative ASCII relative-path grammar: no absolute URI, `..`, `.`, backslash, percent encoding, query, or fragment. Each file declares exact bytes and SHA256. First implementation accepts self-contained GLB only: no buffer/image URI, no required or optional glTF extensions. Hard limits bound manifest/dependency/JSON depth, node, mesh, primitive, vertex, morph target and byte counts; package budgets can only lower limits. Reject before GLTFLoader parses a violating asset. Validate glTF resource ranges and layout; hash alone is not enough.

Dependency parsing is atomic: no actor is exposed until all integrity, profile and channel ownership checks pass. Failed acquisition releases exactly the resources acquired by that instance. Shared pending loads are deduplicated and failed loads are evicted. An instance release is idempotent; shared geometry/material resources are disposed only after final ownership release.

## Profile

Declared coordinates: +Y up, +Z front, explicit units. Every slot has semantic ID, node name and kind (`joint`, `socket`). Joint rest transforms are captured from the actual loaded asset; delta rotations are parent-space quaternion multiplied before rest. Profile lists combined-angle caps. No animated joint translation/scale and no root-motion track in this slice.

Face binding lists semantic path IDs, target knot names/weights and approval scope. At most one semantic path is nonzero. Crossing paths goes through exact neutral. Gaze is a separate unsupported capability; highlight points are not pupils. Art assets awaiting the full expression-library gate are not activated. Only mechanical fixture face paths run in initial tests.

Equipment items are explicit resolved snapshots. Rigid item binding = character socket × fitted local transform × item-local animation. Skinned garments, arbitrary fits, live swapping and physical collisions remain unsupported and must be rejected. Supported visibility/depth inheritance does not mean collision-free equipment.

## Timeline / ownership

One monotonic clock, timestamped ordered events, bounded queue. At an event, evaluate all affected channels to that exact time once, then apply it; later paint cadence must not change state. Scheduled events carry a generation token. Cancellation invalidates old future events. Same-time ordering is deterministic and explicit.

Joint and accessory channels use quaternion delta segments; expression uses the path adapter. Normalized authored phase is 0..1, duration is seconds. Masks and target ownership are resolved at validation, not discovered during rendering. No channel has two independent writers. Interruption guarantees C0 pose/intensity continuity in this first slice; angular-velocity C1 continuity is not claimed and must be a distinct future capability.

Root placement belongs to external constraints. A mechanical fixture may be positioned directly for testing, but there is no claimed surface-grab/contact solver until separately implemented and reviewed. Later drag must preserve distinct raw input, accepted target and final deformed anchor, and ground contact must use the captured original baseline. The old controller is not imported to supply these capabilities.

## Lifecycle and performance claims

Mutable channel arrays, node maps, quaternion scratch values and morph paths are preallocated. Normal animation ticks do no binding-discovery traversal or full skinned-vertex scan. When state changes, `updateMatrixWorld(true)` still propagates matrices through the scene hierarchy in O(nodes) work; this bounded hierarchy work remains part of the CPU cost. Loading, validation and event enqueue may allocate. Rendering is requested on dirty state or active motion, and a future event schedules a timer instead of continuous idle RAF. Input/explicit invalidation wakes immediately. Hidden-state behavior and large gaps are deterministic; no catch-up physics is implied.

Visual LOD, stable interaction-surface remapping and browser GPU timings are not yet supported/verified. First slice measures CPU-only sampling, allocation proxies and cache lifecycle, and labels results accurately. Geometry/material/skeleton ownership remains explicit on disposal.

## Review round 2: exact boundary decisions

- Same timestamp: cancel before play/playClip; both playback types share priority and use increasing enqueue sequence. Cancel invalidates all events queued in the old generation, including same-time play. A new event enqueued after cancellation belongs to the new generation. Enqueue in the past is rejected, never silently shifted or replayed.
- Face bridge timing is separate from skeletal segment duration. A cross-path request retains its current withdrawal when already withdrawing, updates only the destination, then spends the declared `fadeInSec` entering it. `FaceLane.arrival` is the actual target-arrival time. Cancellation withdraws from the evaluated current amount. A face hold is static and permits sleep; pending bridge transitions do not.
- At most 16 assets, 8 MiB each, 32 MiB total; JSON depth 20/entries 20,000; 128 nodes, 32 meshes, 64 primitives, 100,000 unique or rendered vertices, 300,000 indices, 16 morph targets/primitive, 500,000 morph-expanded vertices, 512 accessors/views and 2,000,000 accessor scalars. Budgets apply to definitions and resolved rendered instances, including repeated equipment, before loader creation. Images/textures, sparse accessors, nonunit node scales and multi-primitive meshes are intentionally unsupported in this first slice.
- GLB names must be safe unique identifiers. Profile joint and socket bindings cannot alias a node. Every body mesh with morph targets must be included in the expression roster, every knot must cover every roster mesh, every target must exist. One path can interpolate its adjacent knot targets; two semantic paths cannot overlap. Rigid equipment with a skin is rejected before acquisition and again at binding.
- Aborted cache acquisition releases only that waiter's lease. A shared pending load can still complete for another waiter. If all waiters cancel, late completion disposes once. Failed loads are evicted. All cloned skeletons use one instance-wide disposal set; shared source geometry/materials survive until the final lease release.
- Local file loading resolves symlinks and enforces the resolved package root. Browser loading rejects redirects and bounds streamed bytes; package URIs cannot name another origin or filesystem parent.
- Pausing demand scheduling cancels RAF/timer handles without changing suite state. Resume evaluates canonical queued events at the new time and displays their final current state. Disposal inside draw must not schedule a trailing frame.

## Measurement checkpoint 02 additions

The application uses one ActorPool. It reserves active plus pending actor/vertex/node/morph-expanded costs before asynchronous creation; unique encoded GLB source bytes and a separate conservative decoded geometry backing reservation count once across shared actors. Uncancellable late parses keep their source reservations after actor cancellation until disposal/eviction. See MEASUREMENT02.md for limits and exclusions.

Prepared metadata/assembly is immutable, asset bytes are owned before the hash await, and public byte reads are copies. Admission and instantiation therefore use the same accepted geometry and assembly. Actor disposal rolls back its reservation idempotently.

ContextLifecycle combines hidden/lost/disposed state and explicitly invalidates restoration. Canonical time continues while paused. Actual browser shader re-upload, context restoration and transparent output remain unverified; only EventTarget and VM policy tests ran.

## Authored clip checkpoint 03 additions

An optional hash-locked clip-library asset describes independent bounded joint/accessory quaternion tracks. At most16 clips,72 tracks each,128 keys per track,2048 keys total. A clip lasts0.02..10sec, has exact phase0/1 endpoints and at least0.0001sec between keys. Unknown properties, interpolation modes, targets, duplicate target owners and invalid normalized rotations reject before activation. See AUTHORED-CLIP03.md and the fourth wire-schema shape.

A playClip event has explicit entrySec, preserving C0 from the actual interrupted pose before the authored clock starts. Internal STEP/LINEAR timing is not replaced by the older target primitive's smoothstep. STEP edges are intentional discontinuities. Final values hold without active-clip references or perpetual demand animation. Existing target quaternions are normalized before planning and cap-checked after normalization to keep the bridge source unit length.

Per actor clipKeyScalars cost is5 per authored key (quaternion plus time), default application budget100000 and hard maximum500000. Unique encoded clip-library bytes join sourceBytes admission. These bounds constrain work, not exact decoded heap or GPU memory. Event entry, active sampling, large jumps and release use the existing single-clock and ownership model.
