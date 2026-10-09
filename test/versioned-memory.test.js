'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, openForgettingLedger, readSqliteMigrationBackup } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openVersionedMemoryAuthority } = require('../src/platform/persistence/sqlite/versioned-memory-repository');
const { createMemoryService } = require('../src/application/ai/memory-service');
const { MIGRATIONS } = require('../src/platform/persistence/sqlite/migrations');
const { UNDO_TTL_MS } = require('../src/core/memory-protocol');
const ownerId = 'owner-memory-fixture';
const directories = [];
test.after(() => directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v4-')); directories.push(directory);
  const filePath = path.join(directory, 'facts.sqlite'), ledgerPath = path.join(directory, 'independent-ledger.sqlite');
  let at = 100000, sequence = 0;
  const now = () => at, idFactory = kind => `${kind}-${++sequence}`;
  const store = openDatabase({ filePath, driver: 'node:sqlite', now });
  const ledgerStore = openForgettingLedger({ filePath: ledgerPath, ownerId, create: true, restoreState: 'current-local', lockAcquired: true });
  assert.equal(ledgerStore.status, 'available');
  if (options.legacy) store.memories.upsert(options.legacy);
  const opened = store.openMemoryAuthority({ ownerId, forgettingLedger: ledgerStore.ledger, now });
  assert.equal(opened.ok, true, opened.reason);
  const service = createMemoryService({ repository: opened.repository, now, idFactory, onInvalidate: options.onInvalidate });
  return { directory, filePath, ledgerPath, store, ledgerStore, repository: opened.repository, service, now, idFactory,
    advance(ms) { at += ms; }, close() { store.close(); ledgerStore.close(); } };
}
const input = (subject = 'morning', body = 'Start with a small action') => ({ kind: 'preference', subject, body });
const requestFor = preview => ({ previewId: preview.previewId, previewHash: preview.previewHash, expectedVersion: preview.expectedVersion });
function apply(service, request) {
  const prepared = service.preview(request); assert.equal(prepared.ok, true, prepared.reason);
  const result = service.confirm(requestFor(prepared.preview)); assert.equal(result.ok, true, result.reason);
  return { ...result, preview: prepared.preview };
}
function add(f, data = input()) { return apply(f.service, { operation: 'add', input: data }); }
function handleFor(raw, failPort = () => false) {
  return { exec(sql) { if (failPort(sql)) throw new Error('injected disk failure'); return raw.exec(sql); },
    run(sql, params = []) { if (failPort(sql)) throw new Error('injected disk failure'); return raw.prepare(sql).run(...params); },
    get: (sql, params = []) => raw.prepare(sql).get(...params), all: (sql, params = []) => raw.prepare(sql).all(...params) };
}

test('manual preview is inert; confirmation binds exact hash and writes receipt/outbox with the versioned row', () => {
  const f = fixture();
  assert.equal('search' in f.repository, false); assert.equal('search' in f.service, false);
  const prepared = f.service.preview({ operation: 'add', input: input() });
  assert.equal(prepared.ok, true); assert.equal(f.service.list().items.length, 0);
  assert.equal(f.service.confirm({ ...requestFor(prepared.preview), previewHash: '0'.repeat(64) }).ok, false);
  const confirmed = f.service.confirm(requestFor(prepared.preview));
  assert.equal(confirmed.ok, true, confirmed.reason); assert.equal(confirmed.receipt.store, 'memory');
  const row = f.service.list().items[0];
  assert.equal(row.status, 'active'); assert.equal(row.sourceType, 'user-statement'); assert.equal(row.version, 1);
  assert.equal(row.confirmedAt, f.now()); assert.equal(f.service.outbox().items.length, 1);
  assert.equal(f.service.confirm(requestFor(prepared.preview)).replayed, true);
  const restarted = createMemoryService({ repository: f.repository, now: f.now, idFactory: f.idFactory });
  assert.equal(restarted.confirm(requestFor(prepared.preview)).replayed, true);
  assert.equal(restarted.outbox().items.length, 1);
  assert.equal(restarted.acknowledgeOutbox({ eventId: confirmed.receipt.eventId }).ok, true);
  assert.equal(restarted.confirm(requestFor(prepared.preview)).historyStatus, 'synced');
  f.close();
});

test('model candidates remain non-injectible and renderer cannot claim deterministic source', () => {
  const f = fixture();
  assert.equal(f.service.preview({ operation: 'add', input: { ...input(), sourceType: 'deterministic' } }).reason, 'memory-input-invalid');
  const p = f.service.proposeCandidate({ operation: 'add', input: { ...input(), status: 'active',
    sourceRefs: [{ kind: 'message', id: 'candidate-source', revision: 'v1' }] } });
  assert.equal(p.ok, true); assert.equal(p.preview.after.status, 'candidate');
  assert.equal(f.service.confirm(requestFor(p.preview)).ok, true);
  const candidates = f.service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(candidates.ok, true); assert.deepEqual(candidates.items, []);
  const row = f.service.list().items[0];
  const unconfirmed = f.service.contextReader.readContextSnapshot({ ids: [row.id] });
  assert.equal(unconfirmed.reason, 'memory-context-invalid-selection'); assert.equal(Object.hasOwn(unconfirmed, 'items'), false);
  apply(f.service, { operation: 'activate', targetId: row.id, expectedVersion: row.version });
  const activated = f.service.contextReader.readContextSnapshot({ ids: [row.id] });
  assert.equal(activated.ok, true); assert.equal(activated.items[0].id, row.id); assert.equal(activated.items[0].source, 'user-confirmed');
  assert.equal(f.service.list().items[0].sourceType, 'user-edit');
  f.close();
});

test('manual edits retain ID, stale preview refuses writes, and previous-version undo expires', () => {
  const f = fixture(), original = add(f).receipt;
  const target = { targetId: original.memoryId, expectedVersion: 1 };
  const stale = f.service.preview({ operation: 'update', ...target, input: input('morning', 'Stale') });
  const edited = apply(f.service, { operation: 'update', ...target, input: input('morning', 'New user statement') });
  assert.equal(edited.receipt.memoryId, original.memoryId); assert.equal(edited.receipt.afterVersion, 2);
  assert.equal(f.service.confirm(requestFor(stale.preview)).reason, 'memory-version-conflict');
  const undo = f.service.previewUndo({ receiptId: edited.receipt.receiptId }); assert.equal(undo.ok, true);
  assert.equal(f.service.confirm(requestFor(undo.preview)).ok, true);
  assert.equal(f.service.list().items[0].body, input().body); assert.equal(f.service.list().items[0].version, 3);
  const again = apply(f.service, { operation: 'update', targetId: original.memoryId, expectedVersion: 3, input: input('morning', 'Another') });
  f.advance(UNDO_TTL_MS + 1);
  assert.equal(f.service.previewUndo({ receiptId: again.receipt.receiptId }).reason, 'memory-undo-unavailable');
  f.close();
});

test('duplicates require explicit resolution; conflicts, pauses, expiry, sensitive scope do not inject', () => {
  const f = fixture(), original = add(f);
  const duplicate = f.service.preview({ operation: 'add', input: input(' MORNING ', 'Different') });
  assert.equal(duplicate.reason, 'memory-duplicate'); assert.deepEqual(duplicate.duplicateIds, [original.receipt.memoryId]);
  const conflicting = apply(f.service, { operation: 'add', resolution: 'keep-conflict', input: input('morning', 'Different') });
  const conflicts = f.service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(conflicts.ok, true); assert.deepEqual(conflicts.items, []);
  const selectedConflict = f.service.contextReader.readContextSnapshot({ ids: [original.receipt.memoryId, conflicting.receipt.memoryId] });
  assert.equal(selectedConflict.reason, 'memory-context-invalid-selection'); assert.equal(Object.hasOwn(selectedConflict, 'items'), false);
  assert.ok(f.service.list().items.every(item => item.conflictIds.length === 1));
  apply(f.service, { operation: 'pause', targetId: original.receipt.memoryId, expectedVersion: 1 });
  const resolved = f.service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(resolved.ok, true); assert.deepEqual(resolved.items.map(item => item.id), [conflicting.receipt.memoryId]);
  const work = add(f, { ...input('work'), scope: 'work' });
  const sensitive = add(f, { ...input('private'), privacyLevel: 'sensitive' });
  const temporary = add(f, { ...input('temporary'), expiresAt: f.now() + 1 });
  f.advance(2);
  const eligible = f.service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(eligible.ok, true);
  assert.deepEqual(eligible.items.map(item => item.id).sort(), [conflicting.receipt.memoryId, work.receipt.memoryId].sort());
  // The retired scope selector is replaced by the current explicit work-memory selection contract.
  const selectedWork = f.service.contextReader.readContextSnapshot({ ids: [work.receipt.memoryId] });
  assert.equal(selectedWork.ok, true); assert.deepEqual(selectedWork.items.map(item => item.id), [work.receipt.memoryId]);
  assert.equal(selectedWork.items[0].scope, 'work');
  for (const invalidId of [original.receipt.memoryId, sensitive.receipt.memoryId, temporary.receipt.memoryId]) {
    const rejected = f.service.contextReader.readContextSnapshot({ ids: [work.receipt.memoryId, invalidId] });
    assert.equal(rejected.ok, false); assert.equal(rejected.reason, 'memory-context-invalid-selection');
    assert.equal(Object.hasOwn(rejected, 'items'), false, 'one invalid selected record rejects the entire set');
  }
  f.close();
});

test('semantic version ignores usage counters and stale usage references are rejected', () => {
  const f = fixture(), saved = add(f, input('large', 'x'.repeat(500)));
  const before = f.service.getVersion({ id: saved.receipt.memoryId });
  assert.equal(f.service.usage({ references: [{ id: before.id, version: before.version }] }).ok, true);
  assert.equal(f.service.getVersion({ id: before.id }).version, before.version);
  assert.equal(f.service.list().items[0].useCount, 1);
  const selected = f.service.contextReader.readContextSnapshot({ ids: [before.id] });
  assert.equal(selected.ok, true); assert.equal(selected.items[0].version, before.version);
  assert.equal(f.service.usage({ references: [{ id: before.id, version: 99 }] }).ok, false);
  assert.equal(f.service.list().items[0].useCount, 1);
  f.close();
});

test('legacy cutover imports exactly once, preserves unknown confirmation time and disables old writers/injection', () => {
  const f = fixture({ legacy: { kind: 'preference', subject: 'legacy', body: 'Original user statement', source: 'user-confirmed', confidence: 1, createdAt: 5 } });
  const row = f.service.list().items[0];
  assert.equal(row.sourceType, 'legacy-import'); assert.equal(row.legacySource, 'user-confirmed'); assert.equal(row.confirmedAt, null);
  assert.equal(f.store.memories.upsert({}).reason, 'memory-authority-cutover');
  assert.equal(f.store.memories.clear().ok, false); assert.equal(f.store.memories.forget(row.id).ok, false);
  assert.equal(f.store.memories.pruneExpired(999999).ok, false); assert.equal(f.store.memories.recordUsage([row.id]).ok, false);
  assert.deepEqual(f.store.memories.selectMemories().memories, []);
  assert.equal(f.store.openMemoryAuthority({ ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now }).repository.list().items.length, 1);
  assert.equal(f.store.openMemoryAuthority({ ownerId: 'other', forgettingLedger: f.ledgerStore.ledger, now: f.now }).ok, false);
  f.close();
});

test('permanent removal expands shared source scope, erases undo and blocks re-extraction by source', () => {
  const invalidated = [], f = fixture({ onInvalidate: value => invalidated.push(value) });
  const sourceRefs = [{ kind: 'message', id: 'source-message', revision: 'v1' }];
  const one = add(f, { ...input('one', 'private-body-one'), sourceRefs });
  const two = add(f, { ...input('two', 'private-body-two'), sourceRefs });
  const updated = apply(f.service, { operation: 'update', targetId: one.receipt.memoryId, expectedVersion: 1,
    input: { ...input('one', 'replacement-body'), sourceRefs: [] } });
  const p = f.service.preview({ operation: 'permanent-remove', targetId: one.receipt.memoryId, expectedVersion: 2 });
  assert.deepEqual(p.preview.affectedIds.sort(), [one.receipt.memoryId, two.receipt.memoryId].sort());
  assert.equal(p.preview.permanent, true);
  const result = f.service.confirm(requestFor(p.preview)); assert.equal(result.ok, true, result.reason);
  assert.equal(f.service.list().items.length, 0); assert.equal(f.service.previewUndo({ receiptId: updated.receipt.receiptId }).ok, false);
  assert.equal(f.service.preview({ operation: 'add', input: { ...input('again'), sourceRefs } }).reason, 'memory-source-forgotten');
  assert.ok(invalidated.at(-1).permanent);
  const ledger = f.service.forgettingState(); assert.ok(ledger.memoryIds.includes(two.receipt.memoryId));
  const native = new DatabaseSync(f.ledgerPath);
  const values = JSON.stringify(native.prepare('SELECT * FROM forgetting_entries').all()); native.close();
  for (const content of ['private-body-one', 'private-body-two', 'replacement-body']) assert.equal(values.includes(content), false);
  f.close();
});

test('ledger write failure leaves the content unchanged; unavailable ledger denies context/list and mutations', () => {
  const f = fixture(), saved = add(f);
  const ledger = { state: f.ledgerStore.ledger.state, invalidate: () => ({ ok: false, reason: 'ledger-injected-failure' }) };
  const opened = f.store.openMemoryAuthority({ ownerId, forgettingLedger: ledger, now: f.now });
  const service = createMemoryService({ repository: opened.repository, now: f.now, idFactory: f.idFactory });
  const p = service.preview({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 });
  assert.equal(service.confirm(requestFor(p.preview)).reason, 'ledger-injected-failure');
  assert.equal(f.service.list().items.length, 1);
  f.ledgerStore.close();
  const unavailable = service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(unavailable.ok, false); assert.equal(unavailable.availability, 'unavailable');
  assert.equal(Object.hasOwn(unavailable, 'items'), false); assert.equal(service.list().ok, false);
  assert.equal(service.preview({ operation: 'pause', targetId: saved.receipt.memoryId, expectedVersion: 1 }).ok, false);
  f.store.close();
});

test('a failed memory commit rolls back row, receipt and outbox together', () => {
  const f = fixture(); f.store.close();
  const raw = new DatabaseSync(f.filePath); let reject = false;
  const opened = openVersionedMemoryAuthority({ handle: handleFor(raw, sql => reject && sql.startsWith('INSERT INTO memory_outbox')),
    ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  const service = createMemoryService({ repository: opened.repository, now: f.now, idFactory: f.idFactory });
  const p = service.preview({ operation: 'add', input: input() }); reject = true;
  assert.equal(service.confirm(requestFor(p.preview)).ok, false); reject = false;
  assert.equal(service.list().items.length, 0); assert.equal(service.outbox().items.length, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM memory_receipts').get().n, 0);
  assert.equal(service.confirm(requestFor(p.preview)).ok, true);
  raw.close(); f.ledgerStore.close();
});

test('permanent ledger-first failure blocks context without repair, then receipt lookup finishes crash recovery', () => {
  const f = fixture(), saved = add(f); f.store.close();
  const raw = new DatabaseSync(f.filePath); let reject = false;
  const opened = openVersionedMemoryAuthority({ handle: handleFor(raw, sql => reject && sql.startsWith('DELETE FROM memory_records')),
    ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  const service = createMemoryService({ repository: opened.repository, now: f.now, idFactory: f.idFactory });
  const p = service.preview({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 }); reject = true;
  const result = service.confirm(requestFor(p.preview));
  assert.equal(result.forgettingCommitted, true); assert.equal(result.cleanupPending, true); assert.ok(result.receiptId);
  assert.equal(service.list().ok, false);
  const blocked = service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, 'memory-forgetting-cleanup-pending');
  assert.equal(Object.hasOwn(blocked, 'items'), false);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM memory_records').get().n, 1);
  reject = false;
  assert.equal(service.contextReader.readContextSnapshot({ ids: [saved.receipt.memoryId] }).reason, 'memory-forgetting-cleanup-pending');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM memory_records').get().n, 1, 'context reads cannot finish pending cleanup');
  assert.equal(service.receipt({ receiptId: result.receiptId }).receipt.permanent, true);
  const recovered = service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(recovered.ok, true); assert.deepEqual(recovered.items, []);
  assert.equal(service.list().items.length, 0);
  assert.equal(service.confirm(requestFor(p.preview)).replayed, true);
  assert.equal(service.outbox().items.length, 2);
  raw.close(); f.ledgerStore.close();
});

test('startup restoration replays the current independent forgetting ledger before read-only context becomes available', () => {
  const f = fixture(), saved = add(f); f.store.close();
  const priorBytes = fs.readFileSync(f.filePath);
  const live = openDatabase({ filePath: f.filePath, now: f.now });
  const repo = live.openMemoryAuthority({ ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now }).repository;
  const service = createMemoryService({ repository: repo, now: f.now, idFactory: f.idFactory });
  apply(service, { operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 }); live.close();
  fs.writeFileSync(f.filePath, priorBytes);
  const restored = openDatabase({ filePath: f.filePath, now: f.now });
  const reopened = restored.openMemoryAuthority({ ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  assert.equal(reopened.ok, true, reopened.reason);
  const restoredService = createMemoryService({ repository: reopened.repository, now: f.now, idFactory: f.idFactory });
  // Authority startup already performs the existing repair before publishing its context reader.
  const snapshot = restoredService.contextReader.readContextSnapshot({ ids: null });
  assert.equal(snapshot.ok, true); assert.deepEqual(snapshot.items, []);
  assert.equal(restoredService.contextReader.readContextSnapshot({ ids: [saved.receipt.memoryId] }).reason, 'memory-context-invalid-selection');
  assert.equal(reopened.repository.outbox().items.length, 2);
  restored.close(); f.ledgerStore.close();
});

test('missing, mismatched, outdated and unknown-restored ledgers fail closed', () => {
  const f = fixture(), saved = add(f);
  const originalState = f.ledgerStore.ledger.state();
  apply(f.service, { operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 });
  const stale = f.store.openMemoryAuthority({ ownerId, forgettingLedger: { state: () => originalState, invalidate() {} }, now: f.now });
  assert.equal(stale.reason, 'forgetting-ledger-mismatch');
  const unknown = openForgettingLedger({ filePath: f.ledgerPath, ownerId, lockAcquired: true, restoreState: 'unknown' });
  assert.equal(unknown.reason, 'forgetting-review-required');
  const wrong = openForgettingLedger({ filePath: f.ledgerPath, ownerId, expectedLedgerId: 'wrong', lockAcquired: true, restoreState: 'current-local' });
  assert.equal(wrong.reason, 'forgetting-ledger-mismatch');
  const missing = openForgettingLedger({ filePath: path.join(f.directory, 'missing.sqlite'), ownerId, expectedLedgerId: originalState.ledgerId,
    create: true, lockAcquired: true, restoreState: 'current-local' });
  assert.equal(missing.reason, 'forgetting-ledger-missing'); assert.equal(fs.existsSync(path.join(f.directory, 'missing.sqlite')), false);
  f.close();
});

test('content-free source lineage survives expired undo and prevents later re-extraction after permanent removal', () => {
  const f = fixture(), sourceRefs = [{ kind: 'message', id: 'old-source', revision: 'v1' }];
  const saved = add(f, { ...input('lineage'), sourceRefs });
  apply(f.service, { operation: 'update', targetId: saved.receipt.memoryId, expectedVersion: 1, input: input('lineage', 'A manual replacement') });
  f.advance(UNDO_TTL_MS + 1);
  const other = add(f, input('other'));
  apply(f.service, { operation: 'pause', targetId: other.receipt.memoryId, expectedVersion: 1 });
  const p = f.service.preview({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 2 });
  assert.ok(p.preview.invalidatedSourceRefs.some(ref => ref.id === 'old-source'));
  assert.equal(f.service.confirm(requestFor(p.preview)).ok, true);
  const candidate = f.service.proposeCandidate({ operation: 'add', input: { ...input('model re-extraction'), sourceRefs } });
  assert.equal(candidate.reason, 'memory-source-forgotten');
  f.close();
});

test('v3 migration has exact backup and idempotent schema; malformed/future ledger never recreates identity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-migrate-')); directories.push(directory);
  const filePath = path.join(directory, 'v3.sqlite'); const raw = new DatabaseSync(filePath);
  for (const migration of MIGRATIONS.slice(0, 3)) for (const sql of migration.up) raw.exec(sql);
  raw.exec('PRAGMA user_version=3'); raw.close(); const bytes = fs.readFileSync(filePath);
  const store = openDatabase({ filePath }); assert.equal(store.userVersion, 4); store.close();
  assert.deepEqual(readSqliteMigrationBackup({ backupPath: `${filePath}.schema-3-to-4.backup.sqlite` }).files[0].bytes, bytes);
  const once = fs.readFileSync(filePath); openDatabase({ filePath }).close(); assert.deepEqual(fs.readFileSync(filePath), once);
  for (const corrupt of ['empty', 'future']) {
    const ledgerPath = path.join(directory, `${corrupt}.sqlite`);
    if (corrupt === 'empty') fs.writeFileSync(ledgerPath, '');
    else { const db = new DatabaseSync(ledgerPath); db.exec('PRAGMA user_version=99'); db.close(); }
    const original = fs.readFileSync(ledgerPath);
    const result = openForgettingLedger({ filePath: ledgerPath, ownerId, create: true, restoreState: 'current-local', lockAcquired: true,
      idFactory() { throw new Error('must not create'); } });
    assert.equal(result.status, 'unavailable'); assert.deepEqual(fs.readFileSync(ledgerPath), original);
  }
});

test('ID collisions cannot overwrite memory, and usage between preview and confirm does not alter semantic edits', () => {
  const f = fixture(), saved = add(f);
  let index = 0;
  const collided = createMemoryService({ repository: f.repository, now: f.now,
    idFactory: kind => kind === 'memory' ? saved.receipt.memoryId : `fresh-${++index}` });
  assert.equal(collided.preview({ operation: 'add', input: input('new subject') }).reason, 'memory-id-conflict');
  const p = f.service.preview({ operation: 'update', targetId: saved.receipt.memoryId, expectedVersion: 1,
    input: input('morning', 'Reviewed edit') });
  f.service.usage({ references: [{ id: saved.receipt.memoryId, version: 1 }] });
  const applied = f.service.confirm(requestFor(p.preview)); assert.equal(applied.ok, true, applied.reason);
  assert.equal(f.service.list().items[0].useCount, 1);
  const undo = f.service.previewUndo({ receiptId: applied.receipt.receiptId });
  f.service.usage({ references: [{ id: saved.receipt.memoryId, version: 2 }] });
  assert.equal(f.service.confirm(requestFor(undo.preview)).ok, true);
  assert.equal(f.service.list().items[0].useCount, 2);
  f.close();
});

test('malformed stored memory fails closed, list pagination is bounded, expired previews do not write', () => {
  const f = fixture();
  add(f, input('one')); add(f, input('two')); add(f, input('three'));
  const first = f.service.list({ limit: 2 }); assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
  const last = f.service.list({ limit: 2, cursor: first.nextCursor }); assert.equal(last.items.length, 1); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.items, ...last.items].map(row => row.id)).size, 3);
  const p = f.service.preview({ operation: 'add', input: input('expired') }); f.advance(5 * 60 * 1000);
  assert.equal(f.service.confirm(requestFor(p.preview)).reason, 'memory-preview-expired');
  const raw = new DatabaseSync(f.filePath); raw.prepare('UPDATE memory_records SET record=? WHERE id=?').run('{malformed', first.items[0].id); raw.close();
  const malformed = f.service.contextReader.readContextSnapshot({ ids: null });
  assert.equal(malformed.ok, false); assert.equal(Object.hasOwn(malformed, 'items'), false);
  assert.equal(f.service.list().ok, false);
  f.close();
});

test('post-commit invalidation failure never reports an atomic commit as retryable failure', () => {
  const f = fixture({ onInvalidate() { throw new Error('consumer unavailable'); } });
  const result = add(f); assert.equal(result.ok, true); assert.equal(result.invalidationPending, true);
  assert.equal(f.service.confirm(requestFor(result.preview)).replayed, true);
  assert.equal(f.service.list().items.length, 1); assert.equal(f.service.outbox().items.length, 1);
  f.close();
});

test('receipt refresh and exact replay retry pending invalidation without recommitting memory', () => {
  let unavailable = true, attempts = 0;
  const effects = [];
  const f = fixture({ onInvalidate(value) {
    attempts++; effects.push(structuredClone(value));
    if (unavailable) throw new Error('consumer unavailable');
  } });
  try {
    const saved = add(f);
    assert.equal(saved.invalidationPending, true);
    const pending = f.service.receipt({ receiptId: saved.receipt.receiptId });
    assert.equal(pending.ok, true);
    assert.equal(pending.invalidationPending, true);
    assert.equal(attempts, 2);
    unavailable = false;
    const replay = f.service.confirm(requestFor(saved.preview));
    assert.equal(replay.ok, true); assert.equal(replay.replayed, true);
    assert.notEqual(replay.invalidationPending, true); assert.equal(attempts, 3);
    assert.deepEqual(effects[0], effects[1]); assert.deepEqual(effects[1], effects[2]);
    assert.equal(replay.receipt.receiptId, saved.receipt.receiptId);
    assert.equal(f.service.list().items[0].version, 1); assert.equal(f.service.outbox().items.length, 1);
    assert.equal(f.service.receipt({ receiptId: saved.receipt.receiptId }).ok, true);
    assert.equal(attempts, 3, 'completed effects are not repeated on ordinary receipt reads');
  } finally { f.close(); }
});

test('receipt lookup reports actual pending and synchronized outbox state', () => {
  const f = fixture();
  try {
    const saved = add(f), request = { receiptId: saved.receipt.receiptId };
    assert.equal(f.service.receipt(request).historyStatus, 'pending');
    assert.equal(f.service.acknowledgeOutbox({ eventId: saved.receipt.eventId }).ok, true);
    assert.equal(f.service.receipt(request).historyStatus, 'synced');
    assert.equal(f.service.confirm(requestFor(saved.preview)).historyStatus, 'synced');
  } finally { f.close(); }
});

test('canonical candidate origin is durable and every indexed receipt column must agree with its JSON authority', () => {
  for (const column of ['receipt_id', 'command_id', 'memory_id', 'preview_hash', 'origin_conversation_id', 'origin_proposal_id']) {
    const f = fixture();
    const origin = { conversationId: 'c', proposalId: 'p', messageId: 'message' };
    const prepared = f.service.previewReviewedCandidate({ operation: 'add', input: input() }, origin);
    const committed = f.service.confirm(requestFor(prepared.preview)); assert.equal(committed.ok, true);
    assert.equal(f.service.candidateStatus(origin).receipt.receiptId, committed.receipt.receiptId);
    const raw = new DatabaseSync(f.filePath); raw.exec('PRAGMA foreign_keys=OFF');
    raw.prepare(`UPDATE memory_receipts SET ${column}=? WHERE receipt_id=?`).run('drifted', committed.receipt.receiptId); raw.close();
    assert.equal(f.service.candidateStatus(origin).reason, 'memory-authority-invalid', column);
    assert.equal(f.repository.list().reason, 'memory-authority-invalid', column);
    assert.equal(f.service.previewReviewedCandidate({ operation: 'add', input: input('new topic') }, origin).ok, false);
    f.close();
  }
});

test('a restore preview cannot cross the recycle deadline and expired single-row removal is cleaned by retention', () => {
  const { RECYCLE_TTL_MS } = require('../src/core/memory-protocol');
  const f = fixture(), added = add(f);
  apply(f.service, { operation: 'remove', targetId: added.receipt.memoryId, expectedVersion: 1 });
  f.advance(RECYCLE_TTL_MS - 1);
  const restored = f.service.preview({ operation: 'restore', targetId: added.receipt.memoryId, expectedVersion: 2 });
  assert.equal(restored.ok, true);
  f.advance(2);
  assert.equal(f.service.confirm(requestFor(restored.preview)).reason, 'memory-recycle-expired');
  assert.equal(f.repository.list().items[0].status, 'removed');
  assert.equal(f.service.pruneRecycle().ok, true);
  assert.equal(f.repository.list().items.length, 0);
  assert.ok(f.service.forgettingState().memoryIds.includes(added.receipt.memoryId));
  f.close();
});

test('recycle retention never silently expands permanent removal to another source-linked memory', () => {
  const { RECYCLE_TTL_MS } = require('../src/core/memory-protocol');
  const f = fixture(), ref = { kind: 'message', id: 'shared-source', revision: null };
  const one = add(f, { ...input('one'), sourceRefs: [ref] });
  add(f, { ...input('two'), sourceRefs: [ref] });
  apply(f.service, { operation: 'remove', targetId: one.receipt.memoryId, expectedVersion: 1 });
  f.advance(RECYCLE_TTL_MS);
  assert.deepEqual(f.service.pruneRecycle().pending, [one.receipt.memoryId]);
  const items = f.service.list().items;
  assert.equal(items.length, 2);
  assert.equal(items.find(row => row.id === one.receipt.memoryId).retentionCleanupPending, true);
  assert.deepEqual(f.service.forgettingState().memoryIds, []);
  f.close();
});

test('confirmation metadata and recycle duration start at actual commit, not preview time', () => {
  const { RECYCLE_TTL_MS } = require('../src/core/memory-protocol');
  const f = fixture();
  const prepared = f.service.preview({ operation: 'add', input: { ...input(), validFrom: 10, expiresAt: 500000 } });
  f.advance(1000); const committed = f.service.confirm(requestFor(prepared.preview)); assert.equal(committed.ok, true);
  let record = f.repository.list().items[0];
  assert.equal(record.createdAt, f.now()); assert.equal(record.updatedAt, f.now()); assert.equal(record.confirmedAt, f.now());
  assert.equal(record.validFrom, 10); assert.equal(record.expiresAt, 500000);
  const confirmedAt = record.confirmedAt;
  const remove = f.service.preview({ operation: 'remove', targetId: record.id, expectedVersion: record.version });
  f.advance(2000); assert.equal(f.service.confirm(requestFor(remove.preview)).ok, true);
  record = f.repository.list().items[0];
  assert.equal(record.confirmedAt, confirmedAt); assert.equal(record.updatedAt, f.now());
  assert.equal(record.removedAt, f.now()); assert.equal(record.recycleUntil, f.now() + RECYCLE_TTL_MS);
  f.close();
});

test('reviewed forget origin survives ledger-first partial failure, restart and restored ordinary memory bytes', () => {
  const f = fixture(), saved = add(f); f.store.close();
  const priorBytes = fs.readFileSync(f.filePath), origin = { conversationId: 'forget-conversation', proposalId: 'forget-proposal', messageId: 'forget-message' };
  const raw = new DatabaseSync(f.filePath); let reject = false;
  const opened = openVersionedMemoryAuthority({ handle: handleFor(raw, sql => reject && sql.startsWith('DELETE FROM memory_records')),
    ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  const service = createMemoryService({ repository: opened.repository, now: f.now, idFactory: f.idFactory });
  const prepared = service.previewReviewedCandidate({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 }, origin);
  assert.equal(prepared.ok, true, prepared.reason); reject = true;
  const partial = service.confirmReviewed({ ...requestFor(prepared.preview), permanentAcknowledged: true });
  assert.equal(partial.forgettingCommitted, true); assert.equal(partial.cleanupPending, true);
  assert.deepEqual(f.ledgerStore.ledger.state().removals[0].candidateOrigin, origin);
  assert.equal(service.candidateStatus(origin).ok, false, 'unclean second store is unavailable, never reusable');
  raw.close();
  const restarted = openDatabase({ filePath: f.filePath, now: f.now });
  const recovered = restarted.openMemoryAuthority({ ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  assert.equal(recovered.ok, true, recovered.reason);
  const durable = createMemoryService({ repository: recovered.repository, now: f.now, idFactory: f.idFactory });
  assert.equal(durable.confirmReviewed(requestFor(prepared.preview)).replayed, true);
  assert.deepEqual(durable.candidateStatus(origin).receipt.candidateOrigin, origin);
  assert.equal(durable.list().items.length, 0); restarted.close();
  fs.writeFileSync(f.filePath, priorBytes);
  const restored = openDatabase({ filePath: f.filePath, now: f.now });
  const final = restored.openMemoryAuthority({ ownerId, forgettingLedger: f.ledgerStore.ledger, now: f.now });
  assert.equal(final.ok, true, final.reason);
  assert.deepEqual(final.repository.candidateStatus(origin).receipt.candidateOrigin, origin);
  assert.equal(final.repository.list().items.length, 0);
  assert.equal(final.repository.lookupConfirmation(requestFor(prepared.preview)).receipt.receiptId, partial.receiptId);
  restored.close(); f.ledgerStore.close();
});

test('one canonical origin cannot permanently remove a second target after an update or competing forget consumes it', () => {
  for (const firstOperation of ['update', 'permanent-remove']) {
    const f = fixture(), one = add(f, input('one')), two = add(f, input('two'));
    const origin = { conversationId: 'same-conversation', proposalId: 'same-proposal', messageId: 'same-message' };
    const first = f.service.previewReviewedCandidate({ operation: firstOperation, targetId: one.receipt.memoryId, expectedVersion: 1,
      ...(firstOperation === 'update' ? { input: input('one', 'Reviewed update') } : {}) }, origin);
    const competing = f.service.previewReviewedCandidate({ operation: 'permanent-remove', targetId: two.receipt.memoryId, expectedVersion: 1 }, origin);
    assert.equal(first.ok, true); assert.equal(competing.ok, true);
    assert.equal(f.service.confirm(requestFor(first.preview)).ok, true);
    assert.equal(f.service.confirm(requestFor(competing.preview)).reason, 'memory-candidate-already-reviewed');
    assert.equal(f.service.forgettingState().memoryIds.includes(two.receipt.memoryId), false);
    assert.ok(f.service.list().items.some(record => record.id === two.receipt.memoryId)); f.close();
  }
});

test('forgetting ledger rejects malformed origins and changed origin replay without modifying deletion scope', () => {
  const f = fixture(), saved = add(f), origin = { conversationId: 'c', proposalId: 'p', messageId: 'm' };
  const prepared = f.service.previewReviewedCandidate({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 }, origin);
  const confirmed = f.service.confirm(requestFor(prepared.preview)); assert.equal(confirmed.ok, true);
  const receipt = confirmed.receipt;
  const replay = { commandId: receipt.commandId, receiptId: receipt.receiptId, eventId: receipt.eventId,
    previewHash: receipt.previewHash, targetId: receipt.memoryId, beforeVersion: receipt.beforeVersion,
    memoryIds: receipt.affectedIds, sourceRefs: prepared.preview.invalidatedSourceRefs, at: receipt.committedAt, candidateOrigin: origin, eventTimeContext: f.ledgerStore.ledger.state().removals[0].eventTimeContext };
  assert.equal(f.ledgerStore.ledger.invalidate(replay).replayed, true);
  assert.equal(f.ledgerStore.ledger.invalidate({ ...replay, candidateOrigin: { ...origin, messageId: 'other-message' } }).ok, false);
  assert.equal(f.ledgerStore.ledger.invalidate({ ...replay, candidateOrigin: { ...origin, confirmed: true } }).reason, 'forgetting-ledger-input-invalid');
  assert.equal(f.ledgerStore.ledger.state().sequence, 1);
  const raw = new DatabaseSync(f.ledgerPath);
  raw.prepare('UPDATE forgetting_entries SET candidate_origin=?').run(JSON.stringify({ ...origin, body: 'unauthorized content' })); raw.close();
  assert.equal(f.ledgerStore.ledger.state().ok, false); assert.equal(f.service.list().ok, false);
  f.close();
});

test('the unreleased ledger identity refuses an older incomplete table shape instead of silently widening it', () => {
  const { LEDGER_SCHEMA } = require('../src/platform/persistence/sqlite/forgetting-ledger');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-old-ledger-')); directories.push(directory);
  const filePath = path.join(directory, 'old.sqlite'), raw = new DatabaseSync(filePath);
  for (const sql of LEDGER_SCHEMA) raw.exec(sql.replace(', candidate_origin TEXT', ''));
  raw.prepare('INSERT INTO forgetting_identity VALUES(1,?,?,0,0)').run(ownerId, 'old-ledger');
  raw.exec('PRAGMA user_version=1'); raw.close();
  const original = fs.readFileSync(filePath);
  const opened = openForgettingLedger({ filePath, ownerId, create: true, restoreState: 'current-local', lockAcquired: true });
  assert.equal(opened.status, 'unavailable'); assert.equal(opened.reason, 'forgetting-ledger-invalid');
  assert.deepEqual(fs.readFileSync(filePath), original);
});

test('a synchronized ledger must still exactly match permanent receipt origin, identity and versions', () => {
  for (const [column, value] of [['candidate_origin', null], ['candidate_origin', JSON.stringify({ conversationId: 'other', proposalId: 'p', messageId: 'm' })],
    ['receipt_id', 'other-receipt'], ['event_id', 'other-event'], ['preview_hash', 'a'.repeat(64)], ['before_version', 2]]) {
    const f = fixture(), saved = add(f), origin = { conversationId: 'c', proposalId: 'p', messageId: 'm' };
    const prepared = f.service.previewReviewedCandidate({ operation: 'permanent-remove', targetId: saved.receipt.memoryId, expectedVersion: 1 }, origin);
    assert.equal(f.service.confirm(requestFor(prepared.preview)).ok, true);
    assert.equal(f.service.candidateStatus(origin).status, 'removed');
    const raw = new DatabaseSync(f.ledgerPath); raw.prepare(`UPDATE forgetting_entries SET ${column}=?`).run(value); raw.close();
    assert.equal(f.service.candidateStatus(origin).reason, 'memory-authority-invalid', column);
    assert.equal(f.service.list().ok, false, column); f.close();
  }
});
