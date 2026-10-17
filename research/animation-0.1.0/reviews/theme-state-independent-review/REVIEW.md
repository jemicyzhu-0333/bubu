# Independent theme-state boundary review

Date: 2026-10-17. Scope: pure CPU fact ledger and its public API. Synthetic fixture IDs only. Reviewer did not edit implementation. Source/policy evidence read: r3 DESIGN/CONTRACT, final 39-case source-independent review, current-main event-source audit. User-confirmed 600s default/600..900s overrides, feed30s, history-no-activation and edit-no-extension supersede r3 pending proposals.

## Result

**Pure ledger boundary verification passes for the exact source hash recorded in REVIEWED-SHA256SUMS.** 106/106 executable tests (92 core-ledger + 14 reference-file/reader tests); 0 failed/skipped/cancelled. The suite includes 40 deterministic seeds × 150 transitions (6000 independent oracle comparisons), 200 explicit expiry/seal/restore/replay cycles, and a maximum legal configuration/record count restoration. Node v24.19.0; measured complete run ~2.88 seconds. Counts are supporting coverage, not a claim that all possible histories were proved.

Run from the common workspace:

    node --test --test-reporter=tap bubu-theme-state-independent-review-20261017/*.test.mjs

Evidence: independent.test.mjs, checkpoint-independent.test.mjs, test-output.tap, TEST-PLAN.md and REVIEWED-SHA256SUMS. Tests import the implementation as a black-box API. The randomized oracle independently stores eligibility, revocation, deadline and revision; it calculates an active source set and maximum deadline without importing implementation helpers for those decisions. Fixture constructors only format source events.

## Real defect found and repaired

Initial implementation allowed maxRecords up to100000 while strict data traversal allowed1000000 nodes. Independent reproduction admitted20000 records (500 per batch), exported a ~27.7MB snapshot, then failed restore with DATA_LIMIT. This was a recoverability blocker, despite the earlier82 passing tests.

Implementation now exports and enforces limits of4096 records,32 namespaces,256 mappings,256 capabilities,64 required capability references per mapping and128 characters per identifier. The independent regression constructs all those collection maxima simultaneously, fills4096 records, restores losslessly and compares projections. Record4097 is explicitly rejected. No successful oversized admission is silently dropped to make recovery pass. This suite checks worst legal structural counts; it does not separately certify every possible serialized byte-size bound or production file-storage limit.

## Executed coverage

- Routine default600s; explicit600/601/750/899/900s; feed30s; invalid/fractional/nonfinite/out-of-policy duration rejection.
- Long and short same-theme sources both arrival orders, true separate successes, independent revocation, simultaneous expiry, exact half-open endpoint (deadline−1 active, deadline expired). Theme expiry is maximum, never a sum.
- Same event/new delivery ID duplicates, equal revision conflicts, stale revision, revoke arriving first, first-seen edit/correction ineligibility, same-generation recompletion ceiling, reusable occurrence ID with genuinely new generation. Ordinal collisions and identity→ordinal changes reject atomically.
- Later edits never extend; earlier correction shortens; later revisions cannot raise deadline watermark; out-of-order edits do not undo shortening. Immutable original mapping/version/time cannot be rewritten.
- Historical backfill, history edit and new recovery-sync events do not activate and cannot be promoted by later origin changes. Delayed live events get remaining time or are recorded expired.
- Failed/cancelled/pending operation, uncommitted and replayed feed receipts rejected with no partial writes; genuine second feed differs from replay and gets its own original deadline.
- Unknown mapping, unapproved mapping, unready/missing capability and fuzzy title identity fail eligibility. Input-registry mutation and later revisions do not turn prior ineligible records into new eligible facts.
- Hidden elapsed time is represented by advancing fact time; deadlines expire normally. Restoring accepted facts keeps exact original remaining deadline. UTC rollback is rejected; forward jumps expire. Trusted clock-adapter behavior itself is outside this module.
- Safe integer/time ordering/overflow checks, zero time, unsafe/fractional/negative/nonfinite values, future timestamps and unknown source namespaces.
- Fixed namespaces isolate same raw identity; matching revocation does not hit another namespace. Detection/focus/visibility mutation fields are rejected. All projections report selected/visible/performing=false.
- Capacity exhaustion is atomic. Seal refuses live original eligibility, including revoked sources; monotonic namespace watermarks reject both old known and previously unseen lower-ordinal identities.200 cycles verify bounded retained state and no old replay resurrection across restore.
- Batches with invalid last element and semantic conflicts do not partially mutate or advance lastNow. Invalid checkpoint entries, duplicated identities, inconsistent first/latest identity/original/ordinal/revision/time and sealed retained ranges reject. Input events, config, snapshots and projections are defensive copies.
- Programmatic strictness: getters (including nested getters), custom/null prototypes, symbol keys, non-enumerable keys, toJSON functions, unsafe prototype property names, sparse arrays, extra array fields, and proxy objects/arrays are rejected. Getter/proxy trap counters remain zero. Snapshot and config nested boundaries are separately covered.

## Important protocol interpretation

A revision is a complete authoritative state snapshot, not a delta. An edit/correct arriving after missed source operations may carry completed state for an instance that this ledger last saw revoked. For an already admitted instance this can restore only its original, possibly shortened, remaining eligibility; it cannot create an initial admission or extend TTL. An explicit test covers this case. An ordinary text/time edit must preserve truthful completionState supplied by the eventual adapter. Claiming that every edit can never change active state would misdescribe this protocol.

Batch input is sorted by business identity/revision before initial admission; this is intentionally not identical to delivering first-seen corrections individually before the original completion. Tests cover the declared batched behavior.

Global eventId uniqueness is an adapter invariant, not an unbounded ledger audit. Replay protection is based on stable business namespace/identity/generation/ordinal plus monotonic revision, not delivery IDs. A malicious or incorrect adapter inventing new identities/generations can manufacture a new fact; this module cannot authenticate business truth.

## Not covered, not claimed, and remaining integration gates

1. No visual effect or rendering verification. No screenshots, GPU, overlay selection/layout, body/hand/prop animation, sparse scheduler, arbitration, late asset release or owner lifecycle validation. All visible/selected/performing flags are false by design.
2. Focus base preservation and detection-toggle behavior are only structurally isolated here: no write interfaces exist. No real application focus session or detection integration was exercised. Namespace separation is tested; a production account/source-switch adapter and stale connection callback disposal remain unimplemented.
3. No production preset registry, user-approved artwork or actual asset readiness certification. Capability booleans and recipe/policy IDs are synthetic declarations.
4. No authenticated source adapter or real postcommit feed/routine event wiring. Current-main source audit still identifies missing stable preset/operation/origin/transaction identity fields. No source authenticity can be inferred from postCommit=true alone.
5. No wall-to-monotonic clock implementation, OS clock-jump experiment, multi-process ordering or production restart anchor. Tests exercise this module's explicit trusted-now protocol.
6. In-memory snapshots/restore are tested. Reference-file tests additionally verify ordinary roundtrip/cursor pairing, corrupt checksum/malformed JSON rejection, invalid replacement preserving the old file, strict getter rejection, clock rollback, prepublication missing-directory failure, and a fresh child process restoring remaining TTL. Independent review did not certify power-loss durability, arbitrary filesystem faults, production cursor acknowledgement atomicity, production outbox, archive retention or storage rollback. Lost acknowledged state requires authoritative reconstruction, not a fresh empty ledger.
7. Seal requires an authoritative irreversible completionOrdinal checkpoint. It cannot be safely inferred from elapsed TTL or largest seen ordinal. Without an upstream sealing protocol capacity exhaustion is an explicit operational blocker, not permission to evict old dedup state.
8. Config and snapshot are trusted unsigned data. Modifying config inside a checkpoint is not an authenticated migration. No adversarial snapshot authenticity or registry migration scheme is provided.
9. Product priorities, sparse action frequencies, automatic visual reappearance, conflict handling and new asset choices were not decided by these tests.

No open defect remains in the exercised pure-ledger scope at this hash. This statement must not be used as a production or visual activation sign-off.

## Reference checkpoint helper increment

The added checkpoint-file.mjs was independently read and exercised in fourteen file/reader tests included above. All passed. The helper uses exclusive temporary creation, file fsync, rename and directory fsync, and explicitly reports ambiguous publication after rename errors. We did not inject a post-rename directory-fsync failure, kill a writer at every boundary, test multiple writers, or simulate filesystem rollback. Its SHA256 is an integrity checksum, not authentication.

The initial whole-file read followed by a size check was replaced at the parent reviewer’s request. The final reader uses one opened handle, an initial regular-file/size check, chunks of at most64KiB, and a cumulative128MiB byte limit plus a one-byte growth sentinel. Post-read size/mtime consistency is checked. readCheckpoint closes the handle in finally.

Independent increment: a real sparse128MiB+1 file rejects; a real truncated checkpoint rejects without modifying either its bytes or a separate valid checkpoint. Deterministic injected read-only handles additionally exercise pre-stat oversize with zero read calls, growth beyond the limit stopping at exactly limit+1 bytes (request lengths65536/65536/1 for a131072-byte bound), growth within the limit, truncation, same-size mtime change, exact-limit UTF-8 bytes, invalid limits and nonregular input. Injected handles are test models, not a claim to have generated every real filesystem race. These checks close the previously noted unbounded-read limitation. Concurrent writers, same-size modifications that preserve timestamps, authenticated storage and power-loss behavior remain outside this reference helper’s guarantee.

## Reconciliation diagnostic increment

A first live-origin edit/correct/revoke without prior admission now explicitly projects admissionReason=needs_reconciliation and needsReconciliation=true, even when status itself is revoked. Independent tests verify that later arrival of the original event, newer completions and ordinary snapshot restoration cannot silently grant eligibility. An authoritative previously admitted checkpoint can reconstruct original remaining eligibility; no new full TTL is issued. The adapter must provide that authority; modifying an unsigned snapshot is not proof of authority. Batched original+later revisions and an individually delivered edit-first stream are deliberately not claimed to be equivalent.
