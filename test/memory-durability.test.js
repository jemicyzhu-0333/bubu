'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, openForgettingLedger } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openVersionedMemoryAuthority } = require('../src/platform/persistence/sqlite/versioned-memory-repository');
const { openSqliteForgettingLedger } = require('../src/platform/persistence/sqlite/forgetting-ledger');
const { createMemoryService } = require('../src/application/ai/memory-service');
const OWNER = 'durability-owner', NOW = 1_800_000_000_000;
const ticket = preview => ({ previewId: preview.previewId, previewHash: preview.previewHash, expectedVersion: preview.expectedVersion });
const input = subject => ({ kind: 'preference', subject, body: 'Synthetic memory body' });
function handleFor(raw, fault = {}) {
  return {
    exec(sql) {
      if (sql === 'COMMIT' && fault.mode === 'commit-before') { fault.mode = null; throw new Error('synthetic pre-COMMIT failure'); }
      const result = raw.exec(sql);
      if (sql === 'COMMIT') {
        fault.commits = (fault.commits || 0) + 1;
        if (fault.mode === 'once' || fault.mode === 'always') {
          if (fault.mode === 'once') fault.mode = null;
          throw new Error('synthetic landed COMMIT error');
        }
      }
      return result;
    },
    run(sql, params = []) {
      if (/SET verification_count=/.test(sql)) fault.proofs = (fault.proofs || 0) + 1;
      if (fault.failInsert && sql.startsWith(fault.failInsert)) throw new Error('synthetic write failure');
      return raw.prepare(sql).run(...params);
    },
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    all: (sql, params = []) => raw.prepare(sql).all(...params),
    userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
    setUserVersion: value => raw.exec(`PRAGMA user_version=${value}`),
    close() { try { raw.close(); } catch (_) {} }
  };
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-proof-'));
  const filePath = path.join(directory, 'facts.sqlite'), ledgerPath = path.join(directory, 'ledger.sqlite');
  const ledgerOptions = { filePath: ledgerPath, ownerId: OWNER, create: true, restoreState: 'current-local', lockAcquired: true };
  let store = openDatabase({ filePath, driver: 'node:sqlite', now: () => NOW });
  let ledger = openForgettingLedger(ledgerOptions), raw, sequence = 0;
  const idFactory = kind => `${kind}-${++sequence}`;
  const initial = store.openMemoryAuthority({ ownerId: OWNER, forgettingLedger: ledger.ledger, now: () => NOW });
  assert.equal(initial.ok, true, initial.reason);
  t.after(() => { raw?.close(); store?.close(); ledger.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  function openMemory(fault = {}, { onInvalidate } = {}) {
    store?.close(); store = null; raw?.close(); raw = new DatabaseSync(filePath);
    const readFresh = action => {
      fault.reads = (fault.reads || 0) + 1;
      const reader = handleFor(new DatabaseSync(filePath, { readOnly: true }));
      try { return action(reader); } finally { reader.close(); }
    };
    const opened = openVersionedMemoryAuthority({ handle: handleFor(raw, fault), readFresh,
      ownerId: OWNER, forgettingLedger: ledger.ledger, now: () => NOW });
    return { ...opened, service: opened.ok ? createMemoryService({ repository: opened.repository, now: () => NOW, idFactory, onInvalidate }) : null };
  }
  function openLedger(fault = {}) {
    ledger.close();
    ledger = openSqliteForgettingLedger(ledgerOptions, {
      selectDriver: () => ({ open: (file, options = {}) => new DatabaseSync(file, options) }),
      makeHandle: raw => handleFor(raw, fault)
    });
    return ledger;
  }
  return { openMemory, openLedger, ledger: () => ledger, raw: () => raw,
    count: table => raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    business: () => ['memory_records', 'memory_sources', 'memory_undo', 'memory_receipts', 'memory_outbox'].map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()) };
}
function prepare(service, request = { operation: 'add', input: input('fixture') }) {
  const result = service.preview(request); assert.equal(result.ok, true, result.reason); return result.preview;
}
function add(service) {
  const preview = prepare(service), result = service.confirm(ticket(preview));
  assert.equal(result.ok, true, result.reason); return result.receipt;
}
function assertUnknown(result) {
  assert.equal(result.ok, false); assert.equal(result.reason, 'memory-commit-outcome-unknown');
  assert.equal(result.retrySameIdentity, true); assert.equal(result.outcome, 'unknown');
  assert.equal(Object.hasOwn(result, 'committed'), false);
}

test('pre-COMMIT failure keeps zero business writes and a failed COMMIT requires a real metadata proof', t => {
  const f = fixture(t), fault = {}, opened = f.openMemory(fault), preview = prepare(opened.service);
  const beforeProofs = fault.proofs;
  fault.failInsert = 'INSERT INTO memory_outbox';
  assert.equal(opened.service.confirm(ticket(preview)).reason, 'memory-commit-failed');
  assert.equal(f.count('memory_records'), 0); assert.equal(f.count('memory_receipts'), 0); assert.equal(f.count('memory_outbox'), 0);
  assert.equal(fault.proofs, beforeProofs);
  fault.failInsert = null; fault.mode = 'commit-before';
  assert.equal(opened.service.confirm(ticket(preview)).reason, 'memory-commit-failed');
  assert.equal(f.count('memory_records'), 0); assert.equal(fault.proofs, beforeProofs + 1);
  assert.equal(opened.service.confirm(ticket(preview)).ok, true); assert.equal(f.count('memory_records'), 1);
});

test('landed COMMIT error is successful only after dirty FULL proof and fresh readback', t => {
  const f = fixture(t), fault = {}, opened = f.openMemory(fault), preview = prepare(opened.service);
  const before = { proofs: fault.proofs, reads: fault.reads, commits: fault.commits };
  fault.mode = 'once';
  const saved = opened.service.confirm(ticket(preview)); assert.equal(saved.ok, true, saved.reason);
  assert.equal(fault.proofs, before.proofs + 1); assert.equal(fault.commits, before.commits + 2); assert.ok(fault.reads > before.reads);
  assert.equal(opened.service.confirm(ticket(preview)).replayed, true);
  assert.equal(f.count('memory_records'), 1); assert.equal(f.count('memory_receipts'), 1); assert.equal(f.count('memory_outbox'), 1);
  assert.equal(f.raw().prepare('SELECT version FROM memory_records').get().version, 1);
});

test('repeated landed proof errors stay unknown and block other identities, reads and outbox', t => {
  const f = fixture(t), fault = {}, opened = f.openMemory(fault), first = prepare(opened.service);
  const other = prepare(opened.service, { operation: 'add', input: input('other') });
  fault.mode = 'always'; assertUnknown(opened.service.confirm(ticket(first)));
  const business = f.business(), firstCount = f.raw().prepare('SELECT verification_count FROM memory_authority').get().verification_count;
  const proofs = fault.proofs;
  assertUnknown(opened.service.confirm(ticket(other))); assert.equal(fault.proofs, proofs);
  assertUnknown(opened.service.confirm({ ...ticket(first), previewHash: '0'.repeat(64) })); assert.equal(fault.proofs, proofs);
  const unavailable = opened.service.contextReader.readContextSnapshot({ ids: null });
  assertUnknown(unavailable); assert.equal(unavailable.availability, 'unavailable');
  assert.equal(Object.hasOwn(unavailable, 'items'), false); assert.equal(fault.proofs, proofs);
  assertUnknown(opened.service.outbox()); assertUnknown(opened.service.list());
  assertUnknown(opened.service.preview({ operation: 'add', input: input('blocked') }));
  assertUnknown(opened.service.confirm(ticket(first))); assert.equal(fault.proofs, proofs + 1);
  assert.equal(f.raw().prepare('SELECT verification_count FROM memory_authority').get().verification_count, firstCount + 1);
  assert.deepEqual(f.business(), business);
  fault.mode = null;
  const replay = opened.service.confirm(ticket(first)); assert.equal(replay.ok, true, replay.reason); assert.equal(replay.replayed, true);
  assert.equal(fault.proofs, proofs + 2); assert.deepEqual(f.business(), business);
  assert.equal(opened.service.confirm(ticket(other)).ok, true); assert.equal(f.count('memory_records'), 2);
});

test('unknown committed memory defers invalidation until exact receipt recovery and delivers it once', t => {
  const f = fixture(t), fault = {}, effects = [];
  const opened = f.openMemory(fault, { onInvalidate: fact => effects.push(structuredClone(fact)) });
  const preview = prepare(opened.service);
  fault.mode = 'always'; assertUnknown(opened.service.confirm(ticket(preview)));
  assert.equal(effects.length, 0, 'unverified writes cannot publish commit effects');
  assertUnknown(opened.service.confirm(ticket(preview))); assert.equal(effects.length, 0);
  fault.mode = null;
  const recovered = opened.service.confirm(ticket(preview));
  assert.equal(recovered.ok, true); assert.equal(recovered.replayed, true);
  assert.equal(effects.length, 1); assert.deepEqual(effects[0].memoryIds, preview.affectedIds);
  assert.equal(opened.service.receipt({ receiptId: recovered.receipt.receiptId }).ok, true);
  assert.equal(opened.service.confirm(ticket(preview)).replayed, true);
  assert.equal(effects.length, 1); assert.equal(f.count('memory_records'), 1); assert.equal(f.count('memory_outbox'), 1);
});

test('reopen requires a new successful proof and preserves landed receipt identity without duplicate writes', t => {
  const f = fixture(t), fault = {}, opened = f.openMemory(fault), preview = prepare(opened.service);
  fault.mode = 'always'; assertUnknown(opened.service.confirm(ticket(preview)));
  const business = f.business();
  const failedReopen = f.openMemory({ mode: 'always' }); assertUnknown(failedReopen);
  const afterFailedProof = f.raw().prepare('SELECT verification_count FROM memory_authority').get().verification_count;
  const restartFault = {}, restarted = f.openMemory(restartFault); assert.equal(restarted.ok, true, restarted.reason);
  assert.equal(restartFault.proofs, 1);
  assert.equal(f.raw().prepare('SELECT verification_count FROM memory_authority').get().verification_count, afterFailedProof + 1);
  const replay = restarted.service.confirm(ticket(preview)); assert.equal(replay.replayed, true); assert.deepEqual(f.business(), business);
});

test('forgetting landed error needs proof; repeated proof failures cannot clean content or reinject old data', t => {
  const f = fixture(t), seed = add(f.openMemory().service), ledgerFault = {};
  assert.equal(f.openLedger(ledgerFault).status, 'available');
  const opened = f.openMemory(), preview = prepare(opened.service,
    { operation: 'permanent-remove', targetId: seed.memoryId, expectedVersion: 1 });
  const other = prepare(opened.service, { operation: 'add', input: input('other') });
  ledgerFault.mode = 'always'; assertUnknown(opened.service.confirm(ticket(preview)));
  assert.equal(f.count('memory_records'), 1); assert.equal(f.count('memory_receipts'), 1);
  assert.equal(f.ledger().ledger.state().outcome, 'unknown');
  const proofs = ledgerFault.proofs;
  const unavailable = opened.service.contextReader.readContextSnapshot({ ids: [seed.memoryId] });
  assertUnknown(unavailable); assert.equal(unavailable.availability, 'unavailable');
  assert.equal(Object.hasOwn(unavailable, 'items'), false); assert.equal(ledgerFault.proofs, proofs);
  assertUnknown(opened.service.outbox()); assertUnknown(opened.service.confirm(ticket(other)));
  assert.equal(ledgerFault.proofs, proofs); assert.equal(f.count('memory_records'), 1);
  assertUnknown(opened.service.confirm(ticket(preview))); assert.equal(ledgerFault.proofs, proofs + 1);
  ledgerFault.mode = null;
  const recovered = opened.service.confirm(ticket(preview)); assert.equal(recovered.ok, true, recovered.reason); assert.equal(recovered.replayed, true);
  assert.equal(ledgerFault.proofs, proofs + 2); assert.equal(f.count('memory_records'), 0);
  assert.equal(f.ledger().ledger.state().sequence, 1); assert.equal(f.count('memory_receipts'), 2); assert.equal(f.count('memory_outbox'), 2);
});

test('forgetting reopen refuses an inconclusive proof and later resolves the original removal once', t => {
  const f = fixture(t), seed = add(f.openMemory().service), fault = {};
  f.openLedger(fault);
  const opened = f.openMemory(), preview = prepare(opened.service,
    { operation: 'permanent-remove', targetId: seed.memoryId, expectedVersion: 1 });
  fault.mode = 'always'; assertUnknown(opened.service.confirm(ticket(preview)));
  const unavailable = f.openLedger({ mode: 'always' });
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.reason, 'forgetting-commit-outcome-unknown');
  assert.equal(f.count('memory_records'), 1);
  assert.equal(f.openLedger().status, 'available');
  const restarted = f.openMemory(); assert.equal(restarted.ok, true, restarted.reason);
  assert.equal(restarted.service.confirm(ticket(preview)).replayed, true);
  assert.equal(f.count('memory_records'), 0); assert.equal(f.ledger().ledger.state().sequence, 1);
  assert.equal(f.count('memory_receipts'), 2); assert.equal(f.count('memory_outbox'), 2);
});

test('durably known ledger-first partial result remains explicit while memory proof is unknown', t => {
  const f = fixture(t), fault = {}, opened = f.openMemory(fault), seed = add(opened.service);
  const preview = prepare(opened.service, { operation: 'permanent-remove', targetId: seed.memoryId, expectedVersion: 1 });
  fault.mode = 'always'; const partial = opened.service.confirm(ticket(preview)); assertUnknown(partial);
  assert.equal(partial.forgettingCommitted, true); assert.equal(partial.cleanupPending, true); assert.ok(partial.receiptId);
  assert.equal(f.ledger().ledger.state().sequence, 1); assertUnknown(opened.service.outbox());
  const business = f.business(); fault.mode = null;
  const replay = opened.service.confirm(ticket(preview)); assert.equal(replay.ok, true, replay.reason);
  assert.equal(replay.receipt.receiptId, partial.receiptId); assert.deepEqual(f.business(), business);
});

test('forgetting precommit failure is definite and a landed error is acknowledged only after successful proof', t => {
  const f = fixture(t), seed = add(f.openMemory().service), fault = {};
  assert.equal(f.openLedger(fault).status, 'available');
  const opened = f.openMemory(), preview = prepare(opened.service,
    { operation: 'permanent-remove', targetId: seed.memoryId, expectedVersion: 1 });
  const proofs = fault.proofs;
  fault.failInsert = 'INSERT INTO forgetting_entries';
  const failed = opened.service.confirm(ticket(preview)); assert.equal(failed.reason, 'forgetting-ledger-write-failed');
  assert.equal(Object.hasOwn(failed, 'outcome'), false); assert.equal(fault.proofs, proofs);
  assert.equal(f.ledger().ledger.state().sequence, 0); assert.equal(f.count('memory_records'), 1);
  fault.failInsert = null; fault.mode = 'once';
  const saved = opened.service.confirm(ticket(preview)); assert.equal(saved.ok, true, saved.reason);
  assert.equal(fault.proofs, proofs + 1); assert.equal(f.ledger().ledger.state().sequence, 1);
  assert.equal(f.count('memory_records'), 0); assert.equal(f.count('memory_receipts'), 2);
});

test('exhausted verification counter fails closed without changing business state', t => {
  const f = fixture(t), opened = f.openMemory(); add(opened.service);
  f.raw().prepare('UPDATE memory_authority SET verification_count=?').run(Number.MAX_SAFE_INTEGER);
  const business = f.business(), failed = f.openMemory(); assertUnknown(failed);
  assert.deepEqual(f.business(), business);
  assert.equal(f.raw().prepare('SELECT verification_count FROM memory_authority').get().verification_count, Number.MAX_SAFE_INTEGER);
});

test('startup proof uncertainty survives unavailable service confirmation without enabling reads or writes', () => {
  for (const unavailableReason of ['memory-commit-outcome-unknown', 'forgetting-commit-outcome-unknown']) {
    const service = createMemoryService({ repository: null, now: () => NOW, idFactory: () => 'unused', unavailableReason });
    const request = { previewId: 'pending-preview', previewHash: 'a'.repeat(64), expectedVersion: null };
    assertUnknown(service.confirmReviewed(request)); assertUnknown(service.list());
    assert.deepEqual(service.contextReader.readContextSnapshot({ ids: null }), {
      ok: false, availability: 'unavailable', reason: 'memory-authority-unavailable'
    });
    assertUnknown(service.outbox()); assert.equal(service.available, false);
  }
});
