# Equipment ownership review

Research checkpoint; not production acceptance.

## Reproduced root causes and fixes
- A throwing `childadded` observer could leave an attached root outside cleanup tracking. Register pending ownership before attachment.
- A failure after partial ownership transfer could dispose an asset twice. Keep mounts, effects and strategy local until one synchronous successful lease/ownership transfer.
- A throwing disposal observer skipped other resource types. Release geometry, material and texture independently with batch deduplication; preserve original and cleanup errors together.
- Reentrant remove/equip during synchronous observers could commit stale work or damage a replacement request. Recheck generation after callbacks and clean only the request-local pending resources.

## Verification
- 11 ownership regressions passed: attachment/effect failures, independent cleanup, successful transfer, two pending requests, partial load rejection, shared batch resources, real pool disposal, reentrant cancellation/replacement, repeated removal and frame-error preservation.
- Full foundation suite: 105 passed, zero failed.
- CPU integration: 900 frames passed; P95 4.254673 ms, maximum 18.022350 ms in this run. The accompanying integration report records the measured run and source identities.

## Ownership contract and remaining gates
Loaders must transfer independently owned per-instance assets. Borrowed render nodes do not dispose their source resources. Resource deduplication covers one release batch, not cross-actor reference counting. Pending reservations remain held until their asynchronous request settles. Ledger zero alone does not prove resource disposal or GPU reclamation.

Historical timing spikes, native/GPU validation, wearable contact and isolated cloth performance remain open. This run does not establish stable frame rate or complete production lifecycle acceptance. No new global cache or dynamic contact system is introduced.
