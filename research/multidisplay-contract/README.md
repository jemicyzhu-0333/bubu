# Multi-display coordinate contract research (not a production capability)

## Evidence boundary
Windows Forms read-only enumeration on 2026-11-13 returned logical rectangles (0,0,2048,1152) and (2048,-252,2048,1152). Existing Electron capture measured the selected display scaleFactor=1.25 and 144Hz. The second display scale and correspondence of Windows logical bounds to Electron bounds have NOT been independently captured. Test IDs and assigning both displays scale=1.25 are synthetic hypotheses, not measured facts.

Production `pet-pointer-space.js` still rejects multiple displays. No screen configuration, DPI, system settings or renderer acceptance gates are changed. Oracle `accepted` means only the mathematical same-display segment fits synthetic data. `productionCapability` always remains false. No production code imports this research module.

## Proposed staged contract
1. Use explicit screen DIP coordinates from the same delivered event, never multiply screenX/screenY by scaleFactor or devicePixelRatio. Client CSS coordinates, backing pixels and physical desktop pixels are different spaces. Mapping requires independent native/Event observations before admission.
2. Main process owns a complete topology snapshot: display identity, logical DIP bounds, rotation and scale. Sort by identity for stable ordering. Topology changes increment revision and must revoke old contact/lease before new coordinates are admitted. Invalid topology also changes revision. Actual revocation integration is future work, not implemented by this oracle.
3. Phase A allows only synthetic segments whose endpoints lie in one unambiguous, half-open display rectangle. Reject cross-display movement, gaps, overlaps/mirroring, mixed DPI and rotation. Finite bounded coordinates only. Same-display rectangles are convex, so endpoint admission suffices for a straight synthetic segment, not an arbitrary unobserved path.
4. A future capability must separately bind document generation, event timestamp, native view revision and topology revision. Never reuse stale topology or reinterpret queued client events as screen events. Current production's activated/revoked state remains authoritative.
5. Cross-display continuity, mixed DPI, display hotplug during contact and wake/resume require separate evidence. Do not silently scale accumulated positions at the border. Cancel/rehydrate a fresh contact unless the exact event/native conversion contract is established.

## Next evidence needed
Read Electron getAllDisplays metadata without changing settings, then use isolated fixture event-owned screen/client values and native window/content readback across a controlled boundary. Compare identical-DPI first, mixed-DPI second. Require error bounds chosen before measurement, endpoint ownership, cancellation on topology revision, and old-epoch rejection. Injected Electron events are not OS provenance. OS input / visual / compositor gates stay separate.

## Reproduce
`node --test research/multidisplay-contract/oracle.test.mjs`
15 synthetic/production-gate regression tests; no Electron launch, GPU or native cross-screen acceptance.
