# Theme state ledger v2: bounded eligibility window

Pure CPU state module. V1 is frozen separately. V2 removes completionOrdinal, ordinal indexes, permanent sealing and history accumulation; it does not change the approved product durations or authorize visual playback.

## Product policy

Routine duration defaults to 600 seconds, explicit preset values 600..900. Feed duration is exactly30 seconds. Same-theme sources retain independent deadlines, aggregate by union/max, never sum. A semantic completion can be revoked and resumed only within its original eligibility cap; edits never extend deadlines. Historical completions/imports do not create eligibility. Exact approved mapping+capability gates remain mandatory. The module never executes feeding, inventory, routine completion, rendering or background switching.

## Event contract (schemaVersion=2)

Every object is strict plain data. Unknown fields, getters, proxies, unusual prototypes, array holes, nonfinite/noninteger times and invalid enums reject the whole batch without mutation. IDs are bounded nonempty strings <=128 UTF-16 code units; counts/timestamps are safe integers.

Required event fields:
- schemaVersion=2, namespace, eventId, transactionId
- sourceKind=routine|feed, entityId, completionGeneration, revision>0
- operation=complete|correct|edit|revoke
- completionState=completed|revoked; complete requires completed, revoke requires revoked
- origin=live_completion|historical_backfill|history_edit|recovery_sync
- postCommit=true, replayed=false, timeDomain=trusted_utc_ms
- occurredAt, committedAt, receivedAt (integer UTC milliseconds)
- original={occurredAt,committedAt,origin,definitionId,mappingVersion}
- deadlineOccurredAt
- revokeReason: nonempty string while revoked, otherwise null

`(namespace,sourceKind,entityId,completionGeneration)` is the semantic identity. Namespace is a stable business account/producer, never a reconnect epoch. Raw occurrence slots may be reused; upstream distinguishes genuine new completion generations from retries, edits and undo/recomplete of the same semantic completion. Feed entityId is the durable command/transaction identity. eventId identifies delivery diagnostics and is NOT the permanent business key. Duplicate revision with different delivery id/receivedAt remains idempotent; different semantic content at equal revision rejects. Global delivery-ID uniqueness is a producer invariant, not an unbounded Set in this module.

Revision is a full authoritative state snapshot, not an increment delta. Gaps can therefore be reconciled without guessing intermediate state. original is immutable across the semantic completion, including kind/identity. original.occurredAt<=original.committedAt<=committedAt; occurredAt<=committedAt<=receivedAt<=now. No future tolerance or received-time recency heuristic. deadlineOccurredAt<=original.occurredAt and <=occurredAt and is nonincreasing across revisions: it carries the earliest completion time ever applied, so missing an earlier correction cannot extend eligibility.

Trust boundary: postCommit/origin/full-state fields are assertions supplied by an authenticated future adapter, not authentication implemented here. `replayed:true` successful business response is rejected as a receipt, not treated as a new source event. Genuine durable re-delivery uses the original canonical event, with optional changed delivery ID/receivedAt.

## Two different deadlines

currentDeadline = deadlineOccurredAt + pinned duration. It is the eligibility deadline, and may be shortened.

safeForgetAfter = original.occurredAt + fixed kind hard maximum:
- routine: 900000ms, even when actual configured duration is600s or mapping is unknown
- feed:30000ms

For any legitimate version of one identity, safeForgetAfter is invariant and currentDeadline cannot exceed it. Every input is strictly validated, then checked against this safe horizon before admission. At now>=safeForgetAfter it returns `expired` and creates no record, regardless of registry contents. Queries/commits remove existing records only at this horizon, never just because currentDeadline elapsed, a source was revoked, a mapping was unsupported, or an action was suppressed.

This preserves window-local revision tombstones, shortening watermarks and first admission outcomes. It also prevents cumulative historic capacity exhaustion. Every legal old replay remains expired after its diagnostic record has been forgotten. This proof depends on immutable original facts and nonrewinding trusted time; a producer that assigns a new original time/generation to an old completion violates the source contract. The module cannot authenticate that claim.

## Admission and ordering

Only first accepted live complete + live original + exact approved/ready mapping gains eligibility. Unknown mapping and unready capability outcomes remain pinned for that identity until safe expiry, even if a later system configuration would support them. Registry migration is not implemented.

First-seen edit/correct/revoke with live original returns admissionReason=needs_reconciliation and needsReconciliation=true. Later ordinary notifications cannot manufacture the missing initial admission evidence. A previously accepted authoritative ledger snapshot can resolve it through restoreLedger. Historical or recovery-sync records remain nonlive_or_noncompletion rather than implying a request to replay old history.

Arrival conditions are intentionally not universally commutative:
- complete v1 then revoke v2: eligible then revoked; same-generation complete v3 may regain only original remaining eligibility.
- revoke/edit v2 first then complete v1: needs reconciliation; v1 is stale, not proof to resurrect.
- complete v1 and revoke/edit v2 in one atomic batch: complete evidence is present; events sort by identity/revision and emit one final state.
- edit/correct full snapshots after known admitted success may reflect missed revoke/recomplete revisions, but cannot extend time or create a formerly rejected qualification.

## Capacity and atomicity

Limits remain explicit:4096 retained identities,32 namespaces,256 mappings,256 capabilities,64 references per mapping,128-character IDs. They are prototype resource bounds, not measured production throughput promises. State size depends on the current <=15-minute safety window rather than all history.

applyBatch validates the entire batch, builds a private pruned candidate, applies all events, then commits records and lastNow together. Invalid final events or capacity conflicts do not partially clear old records or advance time. Window capacity failure is WINDOW_CAPACITY_EXCEEDED; no unexpired tombstone is evicted. project(now) advances time/prunes safely. There is no seal API.

The coupled maximum config+records remains below the1000000-node validation budget and96MiB conservative serialized-size bound. A maximum-shape recovery regression remains, without claiming a performance target.

## API and output

createLedger(config), ledger.applyBatch(events,now), ledger.project(now), ledger.snapshot(sourceCursor), restoreLedger(snapshot,now,expected), validateSnapshot(snapshot).

Config schemaVersion=2; fields namespaces/maxRecords/mappings/capabilities. Mapping fields: sourceKind,definitionId,mappingVersion,themeId,recipeVersion,approved,presentationMode(overlay_only|overlay_and_actions),overlayPolicyId,actionPolicyId(null for overlay_only),requiredCapabilities,assetPolicyDigest, optional durationSec. Capability fields:id,approved,runtimeReady,channel(environment.overlay|body.action|face.semantic|prop). Required channel/mode declarations are checked, but real resource arbitration and art certification are not implemented. Empty production registry has no active mappings.

project returns {now,sources,themes}. A source exposes opaque sourceId,namespace,sourceKind,entityId,completionGeneration,revision,themeId,expiresAt,originalDeadline,safeForgetAfter,active,status,admissionReason,needsReconciliation. Themes expose themeId,expiresAt,sourceIds,factActive=true. Both always report selected/visible/performing=false. Inactive/revoked sources and later absent cleaned sources cease to grant qualification; consumers must not turn a stale sourceId/revision into a lasting lease.

## Time and recovery trust

Caller now must be trusted UTC anchored to monotonic elapsed time and never rewind, including after cleanup. Animation hidden/freeze does not pause facts. A false future jump followed by clock repair is not silently accepted; time uncertainty needs host reconciliation.

snapshot(sourceCursor) binds the host's reliable source cursor to {schemaVersion:2,config,lastNow,sourceCursor,records:[{first,latest}]}. Cursor must identify its stream/epoch and corresponding state. One ledger requires a single authoritative checkpoint covering ALL its configured namespaces. If sources have unrelated cursors without such a joint checkpoint, use separate ledgers; one source cursor must not silently claim recovery coverage for another. V2 does not implement a cursor-vector authority. Binding the right cursor and atomically persisting it with the snapshot before acknowledging delivery are adapter responsibilities.

restoreLedger requires `expected={sourceCursor,minLastNow}` obtained independently from the current source/storage authority. It rejects a different stored cursor, a stored lastNow below the authority floor, and now below snapshot.lastNow. It validates the whole snapshot, then prunes at current now and returns remaining eligibility only. expected values copied from the same untrusted/possibly rolled-back snapshot provide NO rollback protection. The pure module can compare evidence, not authenticate the authority. A forged matching expected context cannot be detected here. validateSnapshot is serialization-only validation and does not expose recovered eligibility.

If the authority has advanced beyond the stored cursor, recovery blocks until the host reconciles missing current states and original admission evidence, builds the consistent snapshot and obtains the current authority context. A missing snapshot must not be replaced with an empty ledger that blindly replays window-local history. Data loss or rollback within the safety window can otherwise lose revoke/unsupported/shortening state. Beyond the immutable horizon all lawful old events are expired regardless of retained history.

Reference checkpoint file writer binds snapshot+upstreamCursor in one checksummed payload, temp-file fsync/rename/directory fsync. Reader requires the same independent expected context, pre-stats regular-file size<=128MiB, reads<=64KiB chunks with cumulative hard cap plus one sentinel byte, and checks final size/mtime. This is single-writer trusted-directory reference storage, not a certified production outbox. Checksum is accidental-corruption detection, not authentication. No power-failure/rename-after-fsync fault certification is claimed.

Node package minimum20; executed here on24.19.0. No third-party packages. Frozen v1 and production main/runtime are untouched.
