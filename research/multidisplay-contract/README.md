# Multi-display coordinate contract research (not a production capability)

## Evidence boundary
Windows Forms read-only enumeration on 2026-11-13 returned logical rectangles (0,0,2048,1152) and (2048,-252,2048,1152). Existing Electron capture measured the selected display scaleFactor=1.25 and 144Hz. A subsequent isolated read-only Electron 44.10.1 probe independently returned these same two DIP bounds, both scaleFactor=1.25, rotation=0 and internal=false. WorkArea heights were 1104 DIP rather than bounds heights 1152. Test IDs remain synthetic. Eight corner-inset DIP-to-physical-to-DIP samples had maximum error 0.2001953125 DIP, below the predeclared 1 DIP threshold. Only the hidden blank diagnostic window zoomFactor=1 was measured; this does not prove pet-window zoom, delivered event coordinates, OS input or cross-screen dragging. Raw display IDs stay in private local evidence, not this repository.

Production `pet-pointer-space.js` still rejects multiple displays. No screen configuration, DPI, system settings or renderer acceptance gates are changed. Oracle `accepted` means only the mathematical same-display segment fits synthetic data. `productionCapability` always remains false. No production code imports this research module.

## Proposed staged contract
1. Use explicit screen DIP coordinates from the same delivered event, never multiply screenX/screenY by scaleFactor or devicePixelRatio. Client CSS coordinates, backing pixels and physical desktop pixels are different spaces. Mapping requires independent native/Event observations before admission.
2. Main process owns a complete topology snapshot: display identity, logical DIP bounds, rotation and scale. Sort by identity for stable ordering. Topology changes increment revision and must revoke old contact/lease before new coordinates are admitted. Invalid topology also changes revision. Actual revocation integration is future work, not implemented by this oracle.
3. Phase A allows only synthetic segments whose endpoints lie in one unambiguous, half-open display rectangle. Reject cross-display movement, overlaps/mirroring, mixed DPI and rotation. Gaps do not invalidate an entire topology: points inside a gap are rejected as outside. Finite bounded coordinates only. Same-display rectangles are convex, so endpoint admission suffices for a straight synthetic segment, not an arbitrary unobserved path.
4. A future capability must separately bind document generation, event timestamp, native view revision and topology revision. Never reuse stale topology or reinterpret queued client events as screen events. Current production's activated/revoked state remains authoritative.
5. Cross-display continuity, mixed DPI, display hotplug during contact and wake/resume require separate evidence. Do not silently scale accumulated positions at the border. Cancel/rehydrate a fresh contact unless the exact event/native conversion contract is established.

## Next evidence needed
Read Electron getAllDisplays metadata without changing settings, then use isolated fixture event-owned screen/client values and native window/content readback across a controlled boundary. Compare identical-DPI first, mixed-DPI second. Require error bounds chosen before measurement, endpoint ownership, cancellation on topology revision, and old-epoch rejection. Injected Electron events are not OS provenance. OS input / visual / compositor gates stay separate.

## Reproduce
`node --test research/multidisplay-contract/oracle.test.mjs`
35 synthetic/production-gate regression tests; no Electron launch, GPU or native cross-screen acceptance.

## Event epoch and commit boundary (research only)
Content-deduplicated revisions alone cannot see removal/re-addition returning identical content. invalidateEvent therefore synchronously discards the snapshot and increments both epoch and revision for every display-added, display-removed, display-metrics-changed, suspend, lock-screen, resume or unlock-screen notification, even repeated identical ones. Re-enumeration must happen after this revocation and before publication. commitSegment models main-process commit-time epoch plus revision revalidation; segment alone is only the geometry oracle. A new snapshot does not authorize recycling a contact: production integration must require a new contact and bind lease ownership separately. None of these APIs is wired to production or actual Electron event listeners yet.

Queued proposals must be rechecked at the final mutation, not only on admission. Fresh snapshot/bounds checks cannot eliminate the window where the OS has changed state but Electron has not delivered any event, particularly same-content ABA. Do not claim atomicity with the OS or close G2 from these tests. Main and renderer monotonic timestamps have different clock origins: raw timestamp comparisons across processes are invalid without an explicit calibrated clock mapping and uncertainty bound. Never compensate stale coordinates by scaling them.

Bounds establish coordinate ownership. workArea controls permitted placement/clamping and taskbar exclusion, a distinct policy not implemented by this coordinate oracle. Future placement policy needs its own version so workArea-only changes revoke affected placement actions even when screen-coordinate bounds remain unchanged.

## Enumeration ownership (research only)
Call beginEnumeration BEFORE invoking the real enumeration, then observe(result, ticket). A ticket is a frozen, per-oracle one-shot reference identity (not secret or structurally opaque: epoch and sequence are readable, but copying fields does not grant identity) bound to the current epoch and a monotonically increasing request sequence. Newer requests supersede older in-flight requests. Display/power/lock events invalidate pending tickets. Missing, copied, foreign, replayed and out-of-order tickets return stale-enumeration without publishing or disturbing a newer snapshot. Normalization is followed by a second ticket/epoch check to reject synchronous getter reentry that revokes or starts a newer enumeration. State is published only after consuming the ticket.

An adapter must not attach a newly issued ticket to cached old data; an in-process token cannot prove sensor freshness if the trusted adapter lies about when it read. No API can detect an OS transition that has not yet become observable. Production integration, actual Electron event wiring, OS provenance and G2 remain unimplemented/unverified.

Diagnostics distinguish revoked-awaiting-enumeration (no admitted snapshot), stale-topology (revision mismatch), stale-epoch (commit ownership mismatch) and stale-enumeration (response ownership mismatch). Invalid topology reason codes remain separate. suspend/lock revoke immediately without depending on a future wake/unlock notification.

## Enumeration failure semantics
An admitted ticket is consumed before any normalization attempt, including an exception. Epoch/sequence are checked again after normalization so a reentrant event or newer request cannot be overwritten. Getter exceptions become enumeration-failed with displays=null; invalid topology also stores no caller values. Failure-state cloning therefore cannot leak or serialize caller objects/functions. Clone the detached candidate before publishing state/revision/key. A stale failing operation leaves any newer published state untouched. These protections are synchronous research invariants, not OS guarantees.

Use one main-process enumeration owner, starting the ticket and real synchronous getAllDisplays in one block. Do not serialize, persist, recreate, compare only fields of, or send tickets over IPC. The authority is reference identity plus epoch/sequence freshness, not confidentiality.
