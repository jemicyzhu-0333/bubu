# v2 functional checkpoint — 2026-10-17

Scope: bounded-window pure theme eligibility, ready for explicit event/coordinator integration. No production source or renderer connection is included in this directory.

- Local tests150/150 passed, Node v24.19.0.
- Isolated copy without sibling imports/node_modules: same150/150 passed.
- New-process file recovery preserved original10000ms remainder, duplicate did not renew, original deadline expired.
- Independent v2 review33/33 passed, including2400 seeded oracle/v1-equivalence checkpoints and1000 successive windows. Independent artifacts: bubu-theme-state-v2-independent-review-20261017.
- V1-equivalence comparison is scoped to lawful identity/original facts, fixed mapping and trusted time, comparing active/deadline output. It does not claim equal diagnostic retention or universal event-order equivalence.

V2 eliminates theme-specific completionOrdinal, permanent seal and cumulative history storage. Routine records persist to original+900s; feed to original+30s. Old replay beyond that bound returns expired without allocation. Within-window unsupported/revoke/shortening state remains retained. Active-window capacity still rejects atomically.

Recovery explicitly compares the stored cursor with independently acquired expected sourceCursor and minLastNow. Matching data copied from a rolled-back snapshot is not external evidence. Checksums cannot authenticate rollback. Current source/restore authority adapter remains to be wired.

Integration handoff: consume ledger.project(now), especially opaque sourceId,completionGeneration,revision,active,expiresAt and theme union. No projected source claims selected/visible/performing. Empty production mapping registry prevents fake theme readiness.

No graphics performance tuning, benchmark expansion or new feature scope was added. This checkpoint prioritizes correct function and necessary failure boundaries. Production main, frozen runtime and v1 remain untouched.
