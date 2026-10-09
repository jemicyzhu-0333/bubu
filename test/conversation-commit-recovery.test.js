'use strict';
// Fault injection uses only fresh synthetic databases under os.tmpdir().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const { openAuthoritativeCollaborationDatabase } = require(path.join(ROOT, 'src/platform/persistence/sqlite/collaboration-database'));
const { createCollaborationSessions } = require(path.join(ROOT, 'src/application/ai/conversation-sessions'));
const OWNER = 'synthetic-storage-audit-owner';
const DAY = 86400000;
function fixture(t, { maxCached = 1 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-readonly-audit-'));
  const filePath = path.join(directory, 'collaboration.sqlite');
  const fault = { business: null, proof: null, proofRead: false, rollback: false };
  const counts = { businessAttempts: 0, businessCommits: 0, markerAttempts: 0, markerCommits: 0 };
  let at = 1000, markerCommitted = false;
  const stores = [];
  function makeHandle(raw) {
    let business = false, marker = false;
    return {
      exec(sql) {
        if (sql === 'ROLLBACK' && fault.rollback) throw new Error('synthetic rollback unavailable');
        if (sql === 'COMMIT') {
          if (business) counts.businessAttempts += 1;
          if (business && fault.business) {
            const timing = fault.business; fault.business = null;
            if (timing === 'after') { raw.exec(sql); counts.businessCommits += 1; business = false; }
            throw new Error('synthetic business commit receipt lost');
          }
          if (marker) counts.markerAttempts += 1;
          if (marker && fault.proof) {
            if (fault.proof === 'after') { raw.exec(sql); counts.markerCommits += 1; markerCommitted = true; marker = false; }
            throw new Error('synthetic proof commit receipt lost');
          }
          if (business) counts.businessCommits += 1;
          if (marker) { counts.markerCommits += 1; markerCommitted = true; }
        }
        const result = raw.exec(sql);
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { business = false; marker = false; }
        return result;
      },
      run(sql, params = []) {
        if (sql.startsWith('INSERT INTO conversations')) business = true;
        if (sql.startsWith('UPDATE collaboration_durability')) marker = true;
        return raw.prepare(sql).run(...params);
      },
      get(sql, params = []) {
        if (markerCommitted && fault.proofRead && sql.includes('verification_count')) throw new Error('synthetic proof reread unavailable');
        return raw.prepare(sql).get(...params);
      },
      all: (sql, params = []) => raw.prepare(sql).all(...params),
      userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: value => raw.exec(`PRAGMA user_version=${value}`),
      close: () => { try { raw.close(); } catch (_) {} }
    };
  }
  const driver = { name: 'synthetic-node-sqlite', open: (file, options = {}) => new DatabaseSync(file, options) };
  const open = () => { const result = openAuthoritativeCollaborationDatabase({ filePath, ownerId: OWNER }, { selectDriver: () => driver, makeHandle }); stores.push(result); return result; };
  const store = open(); assert.equal(store.status, 'available', store.reason); markerCommitted = false;
  const newSessions = repository => createCollaborationSessions({ ownerId: OWNER, repository, now: () => at,
    idFactory: (n, kind) => `${kind}-${n}`, maxCached, schedule: () => ({ unref() {} }), cancelSchedule() {} });
  const sessions = newSessions(store.repository);
  const conversationId = sessions.start().conversation.id;
  const inspect = () => {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try { const row = db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); return row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null; }
    finally { db.close(); }
  };
  t.after(() => { for (const instance of stores) instance.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, sessions, conversationId, fault, counts, inspect, filePath, open, newSessions,
    time(value) { at = value; }, save: input => sessions.setRetention({ conversationId, mode: 'saved', ...input }) };
}

test('lost COMMIT acknowledgement is exactly proved and the next local draft survives restart', t => {
  const f = fixture(t); f.fault.business = 'after';
  const first = f.save({ inputDraft: 'attempted synthetic draft' });
  const second = f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'newer synthetic draft' });
  const disk = f.inspect(); f.store.close();
  const reopened = f.open(); const restored = f.newSessions(reopened.repository).get({ conversationId: f.conversationId });
  assert.equal(first.ok, true);
  assert.equal(second.conversation.savedRevision, second.conversation.revision);
  assert.equal(restored.conversation.inputDraft, 'newer synthetic draft');
  assert.equal(f.counts.businessCommits, 2);
});

test('pre-COMMIT failure with successful rollback is retryable without duplicating a business row', t => {
  const f = fixture(t); f.fault.business = 'before';
  const failed = f.save({ inputDraft: 'synthetic draft' });
  assert.equal(failed.ok, false); assert.equal(failed.reason, 'conversation-save-failed'); assert.equal(f.inspect(), null);
  const saved = f.save(); assert.equal(saved.ok, true); assert.equal(f.inspect().revision, saved.conversation.revision);
  assert.equal(f.counts.businessCommits, 1);
});

for (const action of ['delete', 'ephemeral']) test(`lost first-save acknowledgement cannot bypass ${action} cleanup`, t => {
  const f = fixture(t); f.fault.business = 'after';
  const first = f.save({ inputDraft: 'synthetic retained text' });
  const result = action === 'delete' ? f.sessions.delete({ conversationId: f.conversationId })
    : f.sessions.setRetention({ conversationId: f.conversationId, mode: 'ephemeral' });
  const disk = f.inspect(); f.store.close();
  const reopened = f.open(); const restored = reopened.repository.load({ ownerId: OWNER, conversationId: f.conversationId });
  assert.equal(result.ok, true); assert.equal(disk, null); assert.equal(restored.reason, 'conversation-not-found');
});

for (const phase of ['before', 'after', 'read']) test(`unknown ${phase} proof retains the exact original attempt while newer local edits wait`, t => {
  const f = fixture(t); f.fault.business = 'after';
  if (phase === 'read') f.fault.proofRead = true; else f.fault.proof = phase;
  const first = f.save({ inputDraft: 'first attempted synthetic draft' });
  const next = f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'newer local synthetic draft' });
  const cache = f.sessions.start(); const diskBefore = f.inspect();
  f.fault.proof = null; f.fault.proofRead = false;
  const recovered = f.save(); const diskAfter = f.inspect();
  assert.equal(first.reason, 'conversation-save-unknown');
  assert.equal(next.conversation.savedRevision, 0); assert.equal(next.conversation.saveState, 'unsaved');
  assert.equal(cache.reason, 'conversation-cache-full'); assert.equal(recovered.ok, true);
  assert.equal(diskAfter.snapshot.inputDraft, 'newer local synthetic draft');
  assert.equal(f.counts.businessCommits, 2, 'proof must not replay the old business write');
});

test('unknown original save prevents an unrelated collaboration write', t => {
  const f = fixture(t, { maxCached: 2 }); f.fault.business = 'after'; f.fault.proof = 'before';
  const first = f.save({ inputDraft: 'uncertain first' });
  const otherId = f.sessions.start().conversation.id;
  const other = f.sessions.setRetention({ conversationId: otherId, mode: 'saved', inputDraft: 'unrelated second' });
  assert.equal(other.ok, false); assert.equal(other.reason, 'conversation-save-blocked');
  assert.equal(f.counts.businessCommits, 1);
});

test('failed rollback never exposes its uncommitted connection-local row as durable saved history', t => {
  const f = fixture(t); f.fault.business = 'before'; f.fault.rollback = true;
  const result = f.save({ inputDraft: 'not durably committed synthetic text' });
  const shared = f.store.repository.load({ ownerId: OWNER, conversationId: f.conversationId });
  const independent = f.inspect();
  assert.equal(independent, null); assert.equal(result.reason, 'conversation-save-unknown');
  assert.equal(shared.ok, false); assert.equal(shared.reason, 'conversation-save-unknown');
  f.fault.rollback = false; const recovered = f.save(); assert.equal(recovered.ok, true);
});

test('expired ambiguous save stays hidden and explicitly cleans a longer on-disk expiry', t => {
  const f = fixture(t); assert.equal(f.save({ retentionDays: 1 }).ok, true);
  f.time(1000 + DAY / 2); f.fault.business = 'after'; f.fault.proof = 'before';
  f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'ambiguous extension' });
  f.time(1000 + DAY);
  const expired = f.sessions.get({ conversationId: f.conversationId });
  f.fault.proof = null;
  const retried = f.sessions.get({ conversationId: f.conversationId }); const disk = f.inspect();
  assert.equal(expired.reason, 'conversation-expired'); assert.equal(expired.conversation, undefined);
  assert.equal(retried.deletion, 'confirmed'); assert.equal(disk, null);
});

test('repeated disposal preserves a failed-save result instead of reporting false success', t => {
  const f = fixture(t); f.fault.business = 'after'; f.fault.proof = 'before';
  f.save({ inputDraft: 'uncertain on exit' });
  const first = f.sessions.dispose(); const second = f.sessions.dispose();
  assert.equal(first.ok, false); assert.deepEqual(second, first);
});

test('startup requires a successful marker-only proof even when all business rows are readable', t => {
  const f = fixture(t); assert.equal(f.save({ inputDraft: 'readable synthetic row' }).ok, true); f.store.close();
  f.fault.proof = 'before'; const reopened = f.open();
  assert.notEqual(reopened.status, 'available');
});

test('schema v4 adds only the collaboration durability singleton, without changing snapshot v1', t => {
  const f = fixture(t); const saved = f.save();
  const db = new DatabaseSync(f.filePath, { readOnly: true });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const names = db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
    assert.equal(version, 4); assert.ok(names.includes('collaboration_durability')); assert.equal(saved.conversation.version, 1);
  } finally { db.close(); }
});

for (const outcome of ['committed', 'rolled-back']) test(`application reconciles the exact ambiguous attempt before ${outcome} recovery of newer edits`, () => {
  const saves = [], reconciliations = []; let allowProof = false;
  const repository = {
    load: () => ({ ok: false, reason: 'conversation-not-found' }),
    pruneRetention: () => ({ ok: true, removed: 0 }),
    saveSnapshot(request) {
      saves.push(structuredClone(request));
      return saves.length === 1 ? { ok: false, reason: 'conversation-save-unknown', durability: 'unknown' }
        : { ok: true, revision: request.snapshot.revision };
    },
    reconcileSave(request) {
      reconciliations.push(structuredClone(request));
      return allowProof ? { ok: true, outcome, revision: outcome === 'committed' ? request.snapshot.revision : request.expectedRevision }
        : { ok: false, reason: 'conversation-save-unknown', durability: 'unknown' };
    }
  };
  const sessions = createCollaborationSessions({ ownerId: OWNER, repository, now: () => 1000,
    idFactory: (n, kind) => `${kind}-${n}`, schedule: () => null, cancelSchedule() {} });
  const conversationId = sessions.start().conversation.id;
  sessions.setRetention({ conversationId, mode: 'saved', inputDraft: 'exact first attempt' });
  sessions.pause({ conversationId, inputDraft: 'newer edit one' });
  sessions.pause({ conversationId, inputDraft: 'newer edit two' });
  const writesBeforeProof = saves.length;
  allowProof = true;
  const final = sessions.setRetention({ conversationId, mode: 'saved' });
  assert.equal(writesBeforeProof, 1, 'pending proof must never re-save any version');
  assert.ok(reconciliations.length >= 3);
  for (const request of reconciliations) {
    assert.equal(request.expectedRevision, saves[0].expectedRevision);
    assert.deepEqual(request.snapshot, saves[0].snapshot, 'every duplicate retry uses the original exact snapshot');
  }
  assert.equal(saves.length, 2); assert.equal(saves[1].expectedRevision, outcome === 'committed' ? saves[0].snapshot.revision : 0);
  assert.equal(saves[1].snapshot.inputDraft, 'newer edit two'); assert.equal(final.ok, true);
});
