'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryContextReader } = require('../src/platform/persistence/sqlite/versioned-memory-repository');

const AT = 1000000;
function record(id = 'memory.one', overrides = {}) {
  return { id, version: 1, kind: 'preference', subject: id, body: 'Synthetic preference', status: 'active',
    sourceType: 'user-statement', legacySource: null, sourceRefs: [], confirmedAt: 0, validFrom: 0,
    expiresAt: null, scope: 'global', privacyLevel: 'standard', createdAt: 0, updatedAt: 0,
    removedAt: null, recycleUntil: null, lastUsedAt: null, useCount: 0, ...overrides };
}
function fixture(records = [record()]) {
  const tables = { memory_authority: [{ singleton: 1, owner_id: 'owner', ledger_id: 'ledger', ledger_sequence: 0,
    cutover_at: 0, verification_count: 1 }], memory_records: [], memory_sources: [], memory_undo: [],
  memory_receipts: [], memory_outbox: [] };
  const state = { ok: true, ownerId: 'owner', ledgerId: 'ledger', sequence: 0, memoryIds: [], sourceRefs: [], removals: [] };
  const calls = [], forbidden = [];
  let hook = () => {}, pending = false;
  const poison = name => () => { forbidden.push(name); throw new Error(`Forbidden ${name}`); };
  const handle = {
    all(sql) { assert.equal(this, handle); calls.push(sql); hook(sql); return tables[sql.slice('SELECT * FROM '.length)]; },
    get() { assert.equal(this, handle); throw new Error('Unexpected get'); },
    run: poison('run'), exec: poison('exec'), transaction: poison('transaction'), delete: poison('delete'),
    recover: poison('recover'), proof: poison('proof')
  };
  const ledger = { state() { assert.equal(this, ledger); calls.push('state'); hook('state'); return state; },
    recover: poison('ledger.recover'), invalidate: poison('invalidate'), open: poison('ledger.open') };
  const durability = { isPending() { assert.equal(this, durability); calls.push('pending'); hook('pending'); return pending; },
    run: poison('durability.run'), proof: poison('durability.proof'), recover: poison('durability.recover') };
  const readHandle = Object.freeze({ all: (...args) => handle.all(...args), get: (...args) => handle.get(...args) });
  const reader = createMemoryContextReader({ ownerId: 'owner', readHandle,
    now: () => { calls.push('clock'); return AT; }, readLedgerState: () => ledger.state(), isPending: () => durability.isPending() });
  function setRecords(values) {
    tables.memory_records = values.map(value => ({ id: value.id, version: value.version, record: JSON.stringify(value) }));
    tables.memory_sources = values.map(value => ({ memory_id: value.id, source_refs: JSON.stringify(value.sourceRefs) }));
  }
  setRecords(records);
  return { reader, readHandle, tables, state, calls, forbidden, setRecords,
    hook(value) { hook = value; }, pending(value) { pending = value; } };
}
function addRemoval(f, index) {
  const suffix = String(index), targetId = `forgotten.${suffix}`;
  const removal = { commandId: `command.${suffix}`, receiptId: `receipt.${suffix}`, eventId: `event.${suffix}`,
    previewHash: 'a'.repeat(64), targetId, beforeVersion: 1, affectedIds: [targetId], committedAt: 0,
    candidateOrigin: null, eventTimeContext: { timezone: 'UTC', utcOffsetMinutes: 0, localDayKey: '1970-01-01' } };
  const receipt = { version: 1, receiptId: removal.receiptId, commandId: removal.commandId, ownerId: 'owner', store: 'memory',
    operation: 'permanent-remove', memoryId: targetId, beforeVersion: 1, afterVersion: null, affectedIds: [targetId],
    previewHash: removal.previewHash, committedAt: 0, undoExpiresAt: null, revertsReceiptId: null,
    permanent: true, eventId: removal.eventId, candidateOrigin: null };
  const event = { version: 1, id: removal.eventId, kind: 'memory.changed', ownerId: 'owner', receiptId: removal.receiptId,
    commandId: removal.commandId, occurredAt: 0, memoryId: targetId, operation: 'permanent-remove', entityVersion: null,
    affectedIds: [targetId], permanent: true, ...removal.eventTimeContext };
  f.state.sequence++;
  f.state.memoryIds.push(targetId);
  f.state.removals.push(removal);
  f.tables.memory_authority[0].ledger_sequence = f.state.sequence;
  f.tables.memory_receipts.push({ receipt_id: receipt.receiptId, command_id: receipt.commandId, memory_id: targetId,
    preview_hash: receipt.previewHash, receipt: JSON.stringify(receipt), origin_conversation_id: null, origin_proposal_id: null });
  f.tables.memory_outbox.push({ event_id: event.id, receipt_id: event.receiptId, event: JSON.stringify(event), delivered_at: null });
}
function addUndo(f) {
  const current = record('undo', { version: 2 });
  f.tables.memory_records.push({ id: current.id, version: current.version, record: JSON.stringify(current) });
  f.tables.memory_sources.push({ memory_id: current.id, source_refs: '[]' });
  const receipt = { version: 1, receiptId: 'undo.receipt', commandId: 'undo.command', ownerId: 'owner', store: 'memory',
    operation: 'update', memoryId: 'undo', beforeVersion: 1, afterVersion: 2, affectedIds: ['undo'], previewHash: 'b'.repeat(64),
    committedAt: 0, undoExpiresAt: 600000, revertsReceiptId: null, permanent: false, eventId: 'undo.event', candidateOrigin: null };
  const event = { version: 1, id: receipt.eventId, kind: 'memory.changed', ownerId: 'owner', receiptId: receipt.receiptId,
    commandId: receipt.commandId, occurredAt: 0, memoryId: 'undo', operation: 'update', entityVersion: 2,
    affectedIds: ['undo'], permanent: false, timezone: 'UTC', utcOffsetMinutes: 0, localDayKey: '1970-01-01' };
  f.tables.memory_receipts.push({ receipt_id: receipt.receiptId, command_id: receipt.commandId, memory_id: 'undo',
    preview_hash: receipt.previewHash, receipt: JSON.stringify(receipt), origin_conversation_id: null, origin_proposal_id: null });
  f.tables.memory_outbox.push({ event_id: event.id, receipt_id: receipt.receiptId, event: JSON.stringify(event), delivered_at: null });
  f.tables.memory_undo.push({ memory_id: 'undo', post_version: 2, expires_at: 600000, receipt_id: receipt.receiptId,
    record: JSON.stringify(record('undo')) });
}
function refused(result, reason) {
  assert.equal(result.ok, false);
  if (reason) assert.equal(result.reason, reason);
  assert.equal(Object.hasOwn(result, 'items'), false);
  assert.equal(JSON.stringify(result).includes('Synthetic preference'), false);
}

test('context requests require an explicit own data ids property before any port', () => {
  const f = fixture();
  let getters = 0;
  const accessor = Object.defineProperty({}, 'ids', { enumerable: true, get() { getters++; return null; } });
  const arrayAccessor = Object.defineProperty([], '0', { enumerable: true, get() { getters++; return 'memory.one'; } });
  for (const request of [undefined, null, {}, { ids: undefined }, { ids: null, extra: true }, accessor,
    Object.create({ ids: null }), { ids: ['memory.one', 'memory.one'] }, { ids: new Array(1) }, { ids: arrayAccessor },
    { ids: ['bad id'] }, { ids: Array.from({ length: 9 }, (_, i) => `m.${i}`) }, { ids: null, [Symbol('extra')]: 1 }]) {
    refused(f.reader.readContextSnapshot(request), 'memory-context-invalid-selection');
  }
  assert.equal(getters, 0);
  assert.deepEqual(f.calls, []);
});

test('frozen narrow reader returns detached closed items and [] keeps integrity validation', () => {
  const f = fixture();
  assert.equal(Object.isFrozen(f.reader), true);
  assert.deepEqual(Object.keys(f.readHandle), ['all', 'get']);
  const result = f.reader.readContextSnapshot({ ids: null });
  assert.equal(result.ok, true);
  assert.equal(result.sampledAt, AT);
  assert.deepEqual(result.authority, { ownerId: 'owner', ledgerId: 'ledger', sequence: 0 });
  assert.deepEqual(Object.keys(result.items[0]), ['id', 'version', 'status', 'kind', 'subject', 'body', 'source', 'scope',
    'validFrom', 'expiresAt', 'contextAllowed', 'updatedAt']);
  result.items[0].body = 'Caller change';
  assert.equal(f.reader.readContextSnapshot({ ids: ['memory.one'] }).items[0].body, 'Synthetic preference');
  assert.deepEqual(f.reader.readContextSnapshot({ ids: [] }).items, []);
  assert.ok(f.calls.includes('SELECT * FROM memory_records'));
  assert.deepEqual(f.forbidden, []);
  f.tables.memory_records[0].record = '{}';
  refused(f.reader.readContextSnapshot({ ids: [] }), 'memory-authority-invalid');
});

test('projection precedes eligibility and sees the complete conflict corpus', () => {
  const variants = [
    record('sensitive', { privacyLevel: 'sensitive' }), record('future', { validFrom: AT + 1 }),
    record('expired', { expiresAt: AT }), record('paused', { status: 'paused' }), record('candidate', { status: 'candidate' }),
    record('removed', { status: 'removed', removedAt: 0, recycleUntil: 30 * 24 * 60 * 60 * 1000 }),
    record('aggregate', { sourceType: 'deterministic', sourceRefs: [{ kind: 'task', id: 'task.one', revision: null }] }),
    record('legacy', { sourceType: 'legacy-import', legacySource: 'aggregated' }),
    record('model', { status: 'candidate', sourceType: 'model-proposed' })
  ];
  for (const variant of variants) {
    const f = fixture([record(), variant]);
    assert.deepEqual(f.reader.readContextSnapshot({ ids: null }).items.map(item => item.id), ['memory.one']);
    refused(f.reader.readContextSnapshot({ ids: ['memory.one', variant.id] }), 'memory-context-invalid-selection');
  }
  const f = fixture([record('selected', { subject: 'Same' }), record('unselected', { subject: ' same ', privacyLevel: 'sensitive' })]);
  refused(f.reader.readContextSnapshot({ ids: ['selected'] }), 'memory-context-invalid-selection');
  assert.deepEqual(f.reader.readContextSnapshot({ ids: null }).items, []);
  f.tables.memory_records[1].record = '{}';
  refused(f.reader.readContextSnapshot({ ids: ['selected'] }), 'memory-authority-invalid');
});

test('work, personal, legacy confirmation and expiring aggregation preserve existing eligibility', () => {
  const f = fixture([record('work', { scope: 'work' }), record('personal', { scope: 'personal' }),
    record('legacy', { sourceType: 'legacy-import', legacySource: 'user-confirmed', confirmedAt: null }),
    record('aggregate', { sourceType: 'deterministic', expiresAt: AT + 1,
      sourceRefs: [{ kind: 'task', id: 'task.one', revision: null }] })]);
  assert.equal(f.reader.readContextSnapshot({ ids: ['work', 'personal', 'legacy', 'aggregate'] }).items.length, 4);
  refused(f.reader.readContextSnapshot({ ids: ['work', 'missing'] }), 'memory-context-invalid-selection');
});

test('eight explicit IDs qualify together with no substitution or partial missing selection', () => {
  const records = Array.from({ length: 8 }, (_, index) => record(`memory.${index}`));
  const f = fixture(records), ids = records.map(value => value.id);
  assert.equal(f.reader.readContextSnapshot({ ids }).items.length, 8);
  ids[7] = 'missing';
  refused(f.reader.readContextSnapshot({ ids }), 'memory-context-invalid-selection');
});

test('unknown, mismatched and ahead authority fail closed without maintenance', () => {
  const cases = [
    f => f.pending(true), f => { f.state.ok = false; f.state.outcome = 'unknown'; },
    f => { f.tables.memory_authority = []; }, f => { f.state.ownerId = 'other'; },
    f => { f.state.ledgerId = 'other'; }, f => { f.tables.memory_authority[0].ledger_sequence = 1; },
    f => { addRemoval(f, 0); f.tables.memory_authority[0].ledger_sequence = 0; }
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    refused(f.reader.readContextSnapshot({ ids: null }));
    refused(f.reader.readContextForgettingState());
    assert.deepEqual(f.forbidden, []);
  }
});

test('unknown outcome and cleanup pending retain exact bounded failure status', () => {
  const f = fixture(); f.pending(true);
  assert.deepEqual(f.reader.readContextSnapshot({ ids: [] }), { ok: false, availability: 'unavailable',
    reason: 'memory-commit-outcome-unknown', outcome: 'unknown', retrySameIdentity: true });
  f.pending(false); addRemoval(f, 0); f.tables.memory_authority[0].ledger_sequence = 0;
  refused(f.reader.readContextSnapshot({ ids: [] }), 'memory-forgetting-cleanup-pending');
  f.tables.memory_authority[0].ledger_sequence = 1;
  f.setRecords([record('forgotten.0')]);
  refused(f.reader.readContextSnapshot({ ids: [] }), 'memory-forgetting-cleanup-pending');
  assert.deepEqual(f.forbidden, []);
});

test('blocked current lineage and blocked undo return cleanup-pending; expired unblocked undo stays intact', () => {
  const f = fixture(); addRemoval(f, 0);
  addUndo(f);
  const before = JSON.stringify(f.tables.memory_undo);
  assert.equal(f.reader.readContextSnapshot({ ids: null }).ok, true);
  assert.equal(JSON.stringify(f.tables.memory_undo), before);
  f.state.sourceRefs.push({ kind: 'task', id: 'blocked.source', revision: null });
  f.tables.memory_sources[0].source_refs = JSON.stringify(f.state.sourceRefs);
  refused(f.reader.readContextSnapshot({ ids: [] }), 'memory-forgetting-cleanup-pending');
  f.tables.memory_sources[0].source_refs = '[]';
  f.tables.memory_undo[0].record = JSON.stringify(record('undo', { sourceRefs: f.state.sourceRefs }));
  refused(f.reader.readContextForgettingState(), 'memory-forgetting-cleanup-pending');
  assert.deepEqual(f.forbidden, []);
});

test('writer-shaped undo remains readable before and after expiry; orphan or mismatched metadata is unavailable', () => {
  const changes = [
    f => { f.tables.memory_undo[0].post_version = 0; },
    f => { f.tables.memory_undo[0].post_version = 3; },
    f => { f.tables.memory_undo[0].receipt_id = 'missing.receipt'; },
    f => { f.tables.memory_undo[0].expires_at++; },
    f => { f.tables.memory_undo[0].record = JSON.stringify(record('undo', { version: 2 })); },
    f => { f.tables.memory_records.pop(); f.tables.memory_sources.pop(); },
    f => { const receipt = JSON.parse(f.tables.memory_receipts[0].receipt); receipt.beforeVersion = 2;
      f.tables.memory_receipts[0].receipt = JSON.stringify(receipt); },
    f => { const event = JSON.parse(f.tables.memory_outbox[0].event); event.kind = 'memory.reverted';
      f.tables.memory_outbox[0].event = JSON.stringify(event); }
  ];
  for (const change of changes) {
    const f = fixture(); addUndo(f);
    assert.equal(f.reader.readContextSnapshot({ ids: ['memory.one'] }).ok, true);
    change(f);
    refused(f.reader.readContextSnapshot({ ids: ['memory.one'] }), 'memory-authority-invalid');
    assert.deepEqual(f.forbidden, []);
  }
  const f = fixture(); addUndo(f);
  const receipt = JSON.parse(f.tables.memory_receipts[0].receipt);
  receipt.committedAt = AT - 1;
  receipt.undoExpiresAt = receipt.committedAt + 600000;
  f.tables.memory_receipts[0].receipt = JSON.stringify(receipt);
  f.tables.memory_undo[0].expires_at = receipt.undoExpiresAt;
  const event = JSON.parse(f.tables.memory_outbox[0].event); event.occurredAt = receipt.committedAt;
  f.tables.memory_outbox[0].event = JSON.stringify(event);
  f.tables.memory_records[1].record = JSON.stringify(record('undo', { version: 2, updatedAt: receipt.committedAt }));
  assert.equal(f.reader.readContextForgettingState().ok, true);
  assert.equal(f.tables.memory_undo.length, 1);
});

test('duplicate canonical identities are rejected rather than deduplicated', () => {
  for (const table of ['memory_records', 'memory_sources', 'memory_undo', 'memory_receipts', 'memory_outbox']) {
    const f = fixture(); addRemoval(f, 0);
    addUndo(f);
    f.tables[table].push(structuredClone(f.tables[table][0]));
    refused(f.reader.readContextSnapshot({ ids: null }), 'memory-authority-invalid');
  }
  const f = fixture(); addRemoval(f, 0); addRemoval(f, 1);
  f.state.removals[1].receiptId = f.state.removals[0].receiptId;
  refused(f.reader.readContextSnapshot({ ids: null }));
});

test('two detached captures reject ordinary edits, conflict, lineage, undo, receipt and outbox drift without retries', () => {
  const changes = [
    f => { f.tables.memory_records[0].record = JSON.stringify(record('memory.one', { body: 'Changed', version: 2 })); f.tables.memory_records[0].version = 2; },
    f => f.setRecords([record(), record('conflict', { subject: 'memory.one' })]),
    f => { f.tables.memory_sources[0].source_refs = JSON.stringify([{ kind: 'task', id: 'new.source', revision: null }]); },
    f => { f.tables.memory_undo[0].expires_at = 2; },
    f => { f.tables.memory_receipts[0].receipt = '{}'; },
    f => { f.tables.memory_outbox[0].delivered_at = 5; }
  ];
  for (const change of changes) {
    const f = fixture(); addRemoval(f, 0);
    addUndo(f);
    let captures = 0;
    f.hook(sql => { if (sql === 'SELECT * FROM memory_records' && ++captures === 2) change(f); });
    refused(f.reader.readContextSnapshot({ ids: ['memory.one'] }));
    assert.equal(captures, 2);
    assert.deepEqual(f.forbidden, []);
  }
});

test('final pending, ledger and owner drift after materialization refuse all bodies', () => {
  for (const change of [f => f.pending(true), f => { f.state.ledgerId = 'changed'; },
    f => { f.tables.memory_authority[0].owner_id = 'changed'; }]) {
    const f = fixture(); let reads = 0;
    f.hook(sql => { if (sql === 'SELECT * FROM memory_outbox' && ++reads === 2) change(f); });
    refused(f.reader.readContextSnapshot({ ids: ['memory.one'] }));
    assert.deepEqual(f.forbidden, []);
  }
});

test('500-record limit does not impose a history cap on valid removal receipts and outbox', () => {
  const f = fixture(Array.from({ length: 500 }, (_, index) => record(`memory.${index}`)));
  for (let index = 0; index < 2001; index++) addRemoval(f, index);
  const result = f.reader.readContextSnapshot({ ids: null });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 500);
  const forgetting = f.reader.readContextForgettingState();
  assert.equal(forgetting.ok, true);
  assert.equal(forgetting.memoryIds.length, 2001);
  forgetting.memoryIds.push('caller.change');
  assert.equal(f.state.memoryIds.length, 2001);
  f.setRecords(Array.from({ length: 501 }, (_, index) => record(`memory.${index}`)));
  refused(f.reader.readContextSnapshot({ ids: [] }), 'memory-authority-invalid');
  assert.deepEqual(f.forbidden, []);
});

test('arbitrary port exceptions, including throwing metadata, never escape or trigger recovery', () => {
  const f = fixture();
  f.hook(() => { throw Object.defineProperty({}, 'message', { get() { throw new Error('Private metadata'); } }); });
  refused(f.reader.readContextSnapshot({ ids: null }), 'memory-authority-unavailable');
  assert.deepEqual(f.forbidden, []);
});

test('invalid clocks and malformed read-only ports fail closed without data reads', () => {
  let calls = 0;
  const readHandle = Object.freeze({ all() { calls++; throw new Error('No read'); }, get() { calls++; throw new Error('No read'); } });
  const ports = { ownerId: 'owner', readHandle, now: () => AT,
    readLedgerState() { calls++; throw new Error('No ledger'); }, isPending() { calls++; return false; } };
  for (const now of [() => NaN, () => Infinity, () => -1, () => 8.64e15 + 1, () => { throw new Error('Clock failure'); }]) {
    refused(createMemoryContextReader({ ...ports, now }).readContextSnapshot({ ids: null }));
  }
  const accessor = Object.freeze(Object.defineProperty({ get() {} }, 'all', { get() { calls++; throw new Error('No getter'); } }));
  for (const handle of [null, {}, { all() {}, get() {} }, accessor,
    Object.freeze({ all() {}, get() {}, run() { calls++; } }), Object.freeze({ all() {} })]) {
    refused(createMemoryContextReader({ ...ports, readHandle: handle }).readContextSnapshot({ ids: null }));
  }
  assert.equal(calls, 0);
});
