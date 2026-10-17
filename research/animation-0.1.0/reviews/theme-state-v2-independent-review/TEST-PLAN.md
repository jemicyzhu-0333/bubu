# v2 finite-window independent acceptance

Baseline v1 remains frozen. This review tests the simpler implementation against the short-lived eligibility requirements, not against v1's stronger permanent-history diagnostic contract.

Equivalence domain: valid immutable business identities/original times, trusted monotonic UTC, same fixed mapping configuration, no v1 capacity/seal divergence, retained reliable state or authenticated recovery. Compare active fact set and original/nonextending deadlines. Do not compare perpetual historical record counts or sealed-history status. After routine original+900s or feed original+30s, v2 may forget a source because every legal version is expired. Before that hard horizon, it must retain revoked/shortened/unsupported/highest-version/first-admission state even when currentDeadline has passed.

Required regressions: shortened source at original+301s replays original revision and stays inactive until hard horizon; revoked source retained; unsupported mapping outcome retained across config/input mutation; hard horizon H−1/H/H+1; old delivery not inserted; repeated history across many windows does not exhaust capacity; true overload inside window fails atomically without losing tombstones; invalid batch cannot perform pre-cleanup as a partial mutation; genuine new generation remains distinct; delivery IDs and epochs cannot renew.

Recovery: old complete snapshot versus newer revoke authority must reject mismatched recovery evidence. Matching evidence is trusted host input, not cryptographic proof manufactured by a checksum. Original TTL remains on restore; expired hard-horizon entries may drop; time rollback after clearing is forbidden. First-seen edit/correct/revoke remains diagnosable needs-reconciliation, never silently grants eligibility from a late original event.

Also rerun strict descriptors/prototypes/symbols/nonenumerables/proxies, safe integers/clock boundaries, max configuration recoverability, bounded file reads and growth/truncation/corruption behavior. No renderer, production source adapter or power-loss certification.
