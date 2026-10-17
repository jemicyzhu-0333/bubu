# Full18 body-enabled drag prototype

Independent 0.1.0 candidate. Baseline: weighted owner commit `9d987939db2d0b2d20264803ab26b8c39aa8c251`, copied from its frozen publication restore. No V1 runtime compatibility and no production/default policy change.

## Scope

- ActorPool opt-in `bodyProfile: BODY_PROFILE_ID` permits exactly Shoulder_L/R and Hip_L/R quaternions, with .20/.14-radian combined limits. All other authored pose channels remain immutable. Face-only callers retain the old contract. A malformed or over-cap quaternion fails closed.
- BodyRigAdapter owns those four rotation channels and independent host wrappers. It never writes geometry, material, face morphs, bone positions or scales. Body leaning is a rigid external .9-height pivot, not a new neck. The same approved full18 GLB and static rest shape are retained.
- DragSession queues input. Call begin/move/release to enqueue, then advance(t) once after ALL events at a timestamp. Same-time move/release is one sealed face-owner batch. Events arriving after a timestamp was sealed fail before mutation. Repeat advance(t) is a read of the existing frame.
- All clocks are monotonic seconds. Pointer coordinates are DIP, with explicit prototype calibration 55.2 DIP/world unit and world-up positive y. Browser clientY must be converted by a host, never inferred from DPR.
- Actual barycentric skin grip follows position immediately (except floor clamp). Pickup starts at 1 DIP and has 1.075s protected slow acting. The inherited classifier uses an 80ms velocity window and <=42 DIP/s protected band. These are traceable historical experimental parameters, not new product/art approval.
- Hover has bounded asymmetric shoulder/hip motion. Fast/reversing input uses bounded damped lag, not frame-by-frame linear resets. Body and face use the existing single owner clock. N3 / 01 / T05 are explicit testfixture intent choices; their timing remains visually unapproved.
- Release captures current horizontal root location and keeps it fixed. Sole clearance smoothly falls to the original pre-grab ground. The entire actual deformed body mesh supplies the floor minimum. A regrab retains the original ground. Cancel also lands; hidden revokes interaction and resets body to that ground. Resume does not recommit the sealed frozen logical timestamp.

## Shared interface

`src/body-adapter.mjs`: BodyRigAdapter(actorRoot), applyPose({body:{x,y,z},joints:{Shoulder_L:{x,y,z},...}}), place({x,y,z}), minimumFoot() -> world y, constrainGround(y), restore(), dispose(). Whole-body quaternion cap .10 rad; joint caps are the fixed capability limits. `dispose` releases only wrapper ownership; face owner owns model resources.

`src/export-scene-frame.mjs`: exportSceneFrame(body.root,{time,label}) exports actual CPU-morphed/skinned world positions, indices and source vertex colors. It does not reconstruct expressions. render/render_actual.py imports materials from the SAME GLB and renders the exported final geometry. Color attribute preservation is required; the initial black render was invalid and has been replaced.

## Verification / limits

Run `node --test tests/*.test.mjs`, then `npm test` in vendor/runtime-facepath05. Run `node replay/generate.mjs` for keyframes; `--video` produces private local full-rate frame inputs. Blender command is in render/render_actual.py's docstring; use `--input evidence/keyframes.json --out evidence/keyframes-render`.

Offline evidence is CPU Three.js deformation + Blender rendering, with fixed 5-unit camera span. It is NOT proof of WebGL, GPU frame rate, browser pointer latency, Electron/native OS capture, window dragging, production art acceptance, or zero-slip dual-foot IK. No window geometry or OS permission changes are made. Full-mesh minimum sampling is intentionally correctness-first, not a production performance claim.

Video, raw frame JSON/binaries and PNG render batches are private delivery artifacts and must NOT be pushed to Git. The source overlay, tests, small metrics and provenance may be backed up independently.
