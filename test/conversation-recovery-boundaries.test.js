'use strict';
// Exact identity and lifecycle faults use only isolated synthetic databases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const { openAuthoritativeCollaborationDatabase } = require(path.join(ROOT, 'src/platform/persistence/sqlite/collaboration-database'));
const { createCollaborationSessions } = require(path.join(ROOT, 'src/application/ai/conversation-sessions'));
const OWNER = 'synthetic-independent-review-owner';
const DAY = 86400000;
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t, { memory = false, maxCached = 3 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-independent-review-'));
  const filePath = memory ? ':memory:' : path.join(directory, 'conversation.sqlite');
  const faults = { business: null, marker: null, rollback: false, reread: false, afterWriterBegin: null };
  const counts = { business: 0, businessAttempts: 0, markers: 0, markerAttempts: 0, opens: [], deletes: 0 };
  const stores = [];
  let at = 1000;
  let mainRaw;
  let markerJustCommitted = false;
  const rawModes = new WeakMap();
  const driver = { name: 'synthetic-independent-node-sqlite', open(file, options = {}) {
    const raw = new DatabaseSync(file, options);
    rawModes.set(raw, { readOnly: options.readOnly === true, file });
    counts.opens.push({ file, readOnly: options.readOnly === true });
    return raw;
  } };
  function makeHandle(raw) {
    let business = false, marker = false;
    if (!mainRaw && rawModes.get(raw).file === filePath && !rawModes.get(raw).readOnly) mainRaw = raw;
    return {
      exec(sql) {
        if (sql === 'ROLLBACK' && (typeof faults.rollback === 'function' ? faults.rollback({ business, marker }) : faults.rollback)) {
          throw new Error('synthetic rollback unavailable');
        }
        if (sql === 'COMMIT') {
          if (business) counts.businessAttempts++;
          if (marker) counts.markerAttempts++;
          if (business && faults.business) {
            const phase = faults.business; faults.business = null;
            if (phase === 'after') { raw.exec(sql); counts.business++; business = false; }
            throw new Error('synthetic business commit exception');
          }
          if (marker && faults.marker) {
            if (faults.marker === 'after') { raw.exec(sql); counts.markers++; markerJustCommitted = true; marker = false; }
            throw new Error('synthetic marker commit exception');
          }
        }
        const result = raw.exec(sql);
        if (sql === 'COMMIT') {
          if (business) counts.business++;
          if (marker) { counts.markers++; markerJustCommitted = true; }
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { business = false; marker = false; }
        if (sql === 'BEGIN IMMEDIATE' && faults.afterWriterBegin && raw !== mainRaw) {
          const hook = faults.afterWriterBegin; faults.afterWriterBegin = null; hook(raw);
        }
        return result;
      },
      run(sql, params = []) {
        if (/^INSERT INTO conversations\b/.test(sql)) business = true;
        if (/^UPDATE collaboration_durability\b/.test(sql)) marker = true;
        if (/^DELETE FROM conversations\b/.test(sql)) counts.deletes++;
        return raw.prepare(sql).run(...params);
      },
      get(sql, params = []) {
        if (faults.reread && markerJustCommitted && rawModes.get(raw).readOnly && /verification_count/.test(sql)) {
          throw new Error('synthetic independent marker reread failure');
        }
        return raw.prepare(sql).get(...params);
      },
      all: (sql, params = []) => raw.prepare(sql).all(...params),
      userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: value => raw.exec(`PRAGMA user_version=${value}`),
      close: () => { try { raw.close(); } catch (_) {} }
    };
  }
  function open() {
    const store = openAuthoritativeCollaborationDatabase({ filePath, ownerId: OWNER }, { selectDriver: () => driver, makeHandle });
    stores.push(store);
    return store;
  }
  const store = open();
  assert.equal(store.status, 'available', store.reason);
  markerJustCommitted = false;
  const newSessions = repository => createCollaborationSessions({ ownerId: OWNER, repository, now: () => at,
    idFactory: (n, kind) => `review-${kind}-${n}`, maxCached,
    schedule: () => ({ unref() {} }), cancelSchedule() {} });
  const sessions = newSessions(store.repository);
  const conversationId = sessions.start().conversation.id;
  function row() {
    const raw = memory ? mainRaw : new DatabaseSync(filePath, { readOnly: true });
    try { const row = raw.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); return row ? { ...row } : null; }
    finally { if (!memory) raw.close(); }
  }
  function mutate(mutator) {
    const raw = new DatabaseSync(filePath);
    try { mutator(raw); } finally { raw.close(); }
  }
  t.after(() => { for (const store of stores) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { filePath, store, sessions, conversationId, counts, faults, row, mutate, open, newSessions,
    now(value) { at = value; }, save: options => sessions.setRetention({ conversationId, mode: 'saved', ...options }) };
}

for (const mutation of ['same-revision-text', 'serialization-only', 'created-at', 'updated-at', 'expiry', 'higher-revision', 'owner']) {
  test(`exact recovery rejects ${mutation} drift and leaves all business state untouched`, t => {
    const f = fixture(t);
    f.faults.business = 'after'; f.faults.marker = 'before';
    assert.equal(f.save({ inputDraft: 'original attempt' }).ok, false);
    const attempted = f.row();
    assert.ok(attempted);
    f.mutate(raw => {
      const value = JSON.parse(attempted.snapshot);
      if (mutation === 'same-revision-text') value.inputDraft = 'different text at identical revision';
      if (mutation === 'created-at') value.createdAt -= 1;
      if (mutation === 'updated-at') value.updatedAt += 1;
      if (mutation === 'expiry') value.retention.days = 7;
      if (mutation === 'higher-revision') value.revision += 4;
      if (mutation === 'owner') {
        raw.exec('PRAGMA foreign_keys=OFF'); // Synthetic corruption injection only.
        raw.prepare('UPDATE conversations SET owner_id=? WHERE id=?').run('different-synthetic-owner', f.conversationId);
        return;
      }
      const serialized = mutation === 'serialization-only' ? JSON.stringify(value, null, 1) : JSON.stringify(value);
      raw.prepare('UPDATE conversations SET revision=?, created_at=?, updated_at=?, expires_at=?, snapshot=? WHERE id=?')
        .run(value.revision, value.createdAt, value.updatedAt, value.retention.pinned ? null : value.updatedAt + value.retention.days * DAY, serialized, f.conversationId);
    });
    const drifted = f.row();
    const attempts = f.counts.businessAttempts;
    f.faults.marker = null;
    const retry = f.save({ inputDraft: 'new local draft awaiting exact proof' });
    assert.equal(retry.ok, false, 'must not adopt divergent durable revision');
    assert.equal(retry.conversation.savedRevision, 0);
    assert.equal(retry.conversation.inputDraft, 'new local draft awaiting exact proof');
    assert.equal(f.counts.businessAttempts, attempts, 'proof never replays a business save');
    assert.deepEqual(f.row(), drifted, 'conflict must not overwrite drifted row');
    assert.equal(f.store.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).ok, false);
    assert.equal(f.store.repository.listPage({ ownerId: OWNER }).ok, false);
  });
}

for (const phase of ['before', 'after', 'reread']) {
  test(`marker ${phase} failure keeps duplicate retries exact; recovery saves newest local state once`, t => {
    const f = fixture(t, { maxCached: 1 });
    f.faults.business = 'after';
    if (phase === 'reread') f.faults.reread = true;
    else f.faults.marker = phase;
    const failed = f.save({ inputDraft: 'first attempted draft' });
    assert.equal(failed.ok, false);
    const original = JSON.parse(f.row().snapshot);
    for (const draft of ['edit one', 'edit two', 'final local draft']) {
      const value = f.sessions.pause({ conversationId: f.conversationId, inputDraft: draft }).conversation;
      assert.equal(value.inputDraft, draft);
      assert.equal(value.savedRevision, 0);
      assert.equal(value.saveState, 'unsaved');
      assert.equal(f.counts.businessAttempts, 1);
      assert.deepEqual(JSON.parse(f.row().snapshot), original);
    }
    assert.equal(f.sessions.start().reason, 'conversation-cache-full');
    assert.equal(f.store.repository.delete({ ownerId: OWNER, conversationId: f.conversationId }).ok, false);
    assert.equal(f.store.repository.pruneRetention({ ownerId: OWNER, now: 1000 }).ok, false);
    f.faults.marker = null; f.faults.reread = false;
    const recovered = f.save();
    assert.equal(recovered.ok, true, recovered.reason);
    assert.equal(recovered.conversation.inputDraft, 'final local draft');
    assert.equal(recovered.conversation.savedRevision, recovered.conversation.revision);
    assert.equal(f.counts.businessAttempts, 2);
    assert.equal(f.counts.business, 2);
    const beforeDuplicate = f.row();
    const markerCount = f.counts.markers;
    const duplicate = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: original, expectedRevision: 0 });
    assert.equal(f.counts.businessAttempts, 2, 'settled retry never executes INSERT');
    assert.deepEqual(f.row(), beforeDuplicate);
    assert.equal(f.counts.markers, markerCount, 'stale receipt must not issue another proof');
    assert.ok(duplicate && typeof duplicate.ok === 'boolean');
  });
}

test('proof rechecks exact outcome inside writer transaction before updating marker', t => {
  const f = fixture(t);
  f.faults.business = 'after'; f.faults.marker = 'before';
  assert.equal(f.save({ inputDraft: 'exact original' }).ok, false);
  const original = f.row();
  f.faults.marker = null;
  f.faults.afterWriterBegin = raw => {
    const value = JSON.parse(original.snapshot); value.inputDraft = 'changed between proof reads';
    raw.prepare('UPDATE conversations SET snapshot=? WHERE id=?').run(JSON.stringify(value), f.conversationId);
  };
  const beforeMarkers = f.counts.markers;
  const result = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: JSON.parse(original.snapshot), expectedRevision: 0 });
  assert.equal(result.ok, false);
  assert.equal(f.counts.markers, beforeMarkers);
  assert.deepEqual(f.row(), original, 'failed writer revalidation rolls back its test perturbation');
});

test('failed rollback on memory handle remains unknown until transaction settlement is confirmed', t => {
  const f = fixture(t, { memory: true });
  f.faults.business = 'before'; f.faults.rollback = true;
  const failed = f.save({ inputDraft: 'uncommitted memory text' });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'conversation-save-unknown');
  assert.equal(failed.conversation.savedRevision, 0);
  const attempted = JSON.parse(f.row().snapshot); // Deliberately connection-local, not a durability assertion.
  assert.equal(f.counts.business, 0);
  const repeated = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: attempted, expectedRevision: 0 });
  assert.equal(repeated.ok, false);
  assert.equal(f.store.repository.load({ ownerId: OWNER, conversationId: f.conversationId }).ok, false);
  assert.equal(f.store.repository.listPage({ ownerId: OWNER }).ok, false);
  assert.equal(f.counts.business, 0);
  f.faults.rollback = false;
  const settled = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: attempted, expectedRevision: 0 });
  assert.deepEqual(settled, { ok: true, outcome: 'rolled-back', revision: 0 });
  assert.equal(f.row(), null);
  assert.equal(f.counts.business, 0);
});

for (const action of ['delete', 'ephemeral']) {
  test(`failed first save keeps ${action} blocked until exact proof and durable cleanup`, t => {
    const f = fixture(t);
    f.faults.business = 'after'; f.faults.marker = 'before';
    assert.equal(f.save({ inputDraft: 'first-save cleanup text' }).ok, false);
    const invoke = () => action === 'delete' ? f.sessions.delete({ conversationId: f.conversationId })
      : f.sessions.setRetention({ conversationId: f.conversationId, mode: 'ephemeral' });
    const deletesBefore = f.counts.deletes;
    assert.equal(invoke().ok, false);
    assert.ok(f.row());
    assert.equal(f.counts.deletes, deletesBefore);
    f.faults.marker = null;
    assert.equal(invoke().ok, true);
    assert.equal(f.row(), null);
    assert.equal(f.counts.business, 1, 'cleanup never resaves text');
  });
}

for (const commit of ['before', 'after']) {
  test(`expiry after ${commit}-COMMIT ambiguity hides immediately and never replays pinned text`, t => {
    const f = fixture(t);
    assert.equal(f.save({ retentionDays: 1, inputDraft: 'original verified text' }).ok, true);
    f.now(1000 + DAY / 2);
    f.faults.business = commit; f.faults.marker = 'before';
    assert.equal(f.save({ retentionDays: 1, pinned: true, inputDraft: 'unverified pinned text' }).ok, false);
    const businessAttempts = f.counts.businessAttempts;
    f.now(1000 + DAY);
    const hidden = f.sessions.get({ conversationId: f.conversationId });
    assert.equal(hidden.reason, 'conversation-expired');
    assert.equal(hidden.deletion, 'pending');
    assert.equal('conversation' in hidden, false);
    const catalog = f.sessions.list();
    assert.equal(catalog.items.some(item => item.id === f.conversationId), false);
    f.faults.marker = null;
    const cleaned = f.sessions.get({ conversationId: f.conversationId });
    assert.equal(cleaned.reason, 'conversation-expired');
    assert.equal(cleaned.deletion, 'confirmed');
    assert.equal(f.row(), null);
    assert.equal(f.counts.businessAttempts, businessAttempts);
  });
}

test('unrelated blocked conversation does not manufacture another pending save receipt', () => {
  const writes = [], reconciles = [];
  let blocked = true, at = 1000;
  const repository = {
    load: () => ({ ok: false, reason: 'conversation-not-found' }),
    pruneRetention: () => ({ ok: true }), listPage: () => ({ ok: true, items: [], nextCursor: null }),
    saveSnapshot(request) {
      writes.push(clone(request));
      if (request.snapshot.id.endsWith('-1')) return { ok: false, reason: 'conversation-save-unknown', durability: 'unknown' };
      return blocked ? { ok: false, reason: 'conversation-save-blocked' } : { ok: true, revision: request.snapshot.revision };
    },
    reconcileSave(request) { reconciles.push(clone(request)); return { ok: false, reason: 'conversation-save-unknown', durability: 'unknown' }; }
  };
  const sessions = createCollaborationSessions({ ownerId: OWNER, repository, now: () => at,
    idFactory: n => `conversation-${n}`, schedule: () => 1, cancelSchedule() {} });
  const a = sessions.start().conversation.id, b = sessions.start().conversation.id;
  sessions.setRetention({ conversationId: a, mode: 'saved', inputDraft: 'unknown A' });
  sessions.setRetention({ conversationId: b, mode: 'saved', inputDraft: 'blocked B' });
  blocked = false; at++;
  const result = sessions.setRetention({ conversationId: b, mode: 'saved', inputDraft: 'latest B' });
  assert.equal(result.ok, true);
  assert.equal(reconciles.some(request => request.snapshot.id === b), false);
  assert.equal(writes.at(-1).expectedRevision, 0);
  assert.equal(writes.at(-1).snapshot.inputDraft, 'latest B');
});

test('dispose result is stable and reflects successful final reconciliation rather than stale pruning error', t => {
  const f = fixture(t);
  f.faults.business = 'after'; f.faults.marker = 'before';
  assert.equal(f.save({ inputDraft: 'pending before disposal' }).ok, false);
  f.faults.marker = null;
  const first = f.sessions.dispose();
  assert.deepEqual(first, { ok: true, unsaved: [] });
  const row = f.row(), business = f.counts.business;
  assert.deepEqual(f.sessions.dispose(), first);
  assert.deepEqual(f.row(), row);
  assert.equal(f.counts.business, business);
});

test('failed dispose cannot later claim success on repeated disposal', t => {
  const f = fixture(t);
  f.faults.business = 'after'; f.faults.marker = 'before';
  f.save({ inputDraft: 'still unknown at shutdown' });
  const first = f.sessions.dispose();
  assert.equal(first.ok, false);
  assert.deepEqual(first.unsaved, [f.conversationId]);
  const counts = { ...f.counts };
  assert.deepEqual(f.sessions.dispose(), first);
  assert.equal(f.counts.businessAttempts, counts.businessAttempts);
  assert.equal(f.counts.markerAttempts, counts.markerAttempts);
});

for (const phase of ['before', 'after']) {
  test(`memory marker ${phase}-COMMIT with rollback failure stays unknown until safely settled`, t => {
    const f = fixture(t, { memory: true });
    f.faults.business = 'after'; f.faults.marker = phase;
    f.faults.rollback = ({ marker }) => marker;
    const failed = f.save({ inputDraft: 'original memory commit' });
    assert.equal(failed.ok, false);
    assert.equal(failed.conversation.savedRevision, 0);
    assert.equal(f.counts.business, 1);
    const attempted = JSON.parse(f.row().snapshot);
    const proofAttempts = f.counts.markerAttempts;
    const stillUnknown = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: attempted, expectedRevision: 0 });
    assert.equal(stillUnknown.ok, false);
    if (phase === 'before') assert.equal(f.counts.markerAttempts, proofAttempts, 'unsettled marker must not be read as fresh proof');
    assert.equal(f.counts.business, 1);
    f.faults.rollback = false; f.faults.marker = null;
    const proved = f.store.repository.reconcileSave({ ownerId: OWNER, snapshot: attempted, expectedRevision: 0 });
    assert.deepEqual(proved, { ok: true, outcome: 'committed', revision: attempted.revision });
    assert.equal(f.counts.business, 1);
    assert.deepEqual(JSON.parse(f.row().snapshot), attempted);
  });
}

test('restart proves only canonical saved row, never restores newer unsaved edits or authorization', t => {
  const f = fixture(t);
  f.faults.business = 'after'; f.faults.marker = 'before';
  assert.equal(f.save({ inputDraft: 'canonical attempted draft' }).ok, false);
  const local = f.sessions.pause({ conversationId: f.conversationId, inputDraft: 'newer unsaved draft' }).conversation;
  assert.equal(local.inputDraft, 'newer unsaved draft');
  const canonical = JSON.parse(f.row().snapshot), commits = f.counts.business;
  f.store.close(); f.faults.marker = null;
  const reopened = f.open();
  assert.equal(reopened.status, 'available', reopened.reason);
  const fresh = f.newSessions(reopened.repository);
  const restored = fresh.get({ conversationId: f.conversationId }).conversation;
  assert.equal(restored.inputDraft, 'canonical attempted draft');
  assert.equal(restored.savedRevision, canonical.revision);
  assert.equal(restored.recoverable, true);
  assert.equal(restored.requiresAuthorization, true);
  assert.equal(f.counts.business, commits, 'startup proof cannot replay pending business work');
  assert.equal(fresh.beginTurn({ conversationId: f.conversationId, message: 'new synthetic turn',
    providerId: 'synthetic-provider', authorizationGeneration: 0 }).reason, 'conversation-authorization-required');
});

test('malformed successful save acknowledgement cannot advance revision or cause another save before exact reconciliation', () => {
  const writes = [], reconciles = [];
  let exact = false;
  const repository = {
    load: () => ({ ok: false, reason: 'conversation-not-found' }), pruneRetention: () => ({ ok: true }),
    saveSnapshot(request) { writes.push(clone(request)); return writes.length === 1 ? { ok: true, revision: request.snapshot.revision + 100 }
      : { ok: true, revision: request.snapshot.revision }; },
    reconcileSave(request) { reconciles.push(clone(request)); return exact ? { ok: true, outcome: 'committed', revision: request.snapshot.revision }
      : { ok: false, durability: 'unknown' }; }
  };
  const sessions = createCollaborationSessions({ ownerId: OWNER, repository, now: () => 1000,
    idFactory: n => `synthetic-ack-${n}`, schedule: () => 1, cancelSchedule() {} });
  const conversationId = sessions.start().conversation.id;
  const failed = sessions.setRetention({ conversationId, mode: 'saved', inputDraft: 'first immutable attempt' });
  assert.equal(failed.ok, false);
  assert.equal(failed.conversation.savedRevision, 0);
  sessions.pause({ conversationId, inputDraft: 'latest unsaved draft' });
  assert.equal(writes.length, 1);
  assert.equal(reconciles[0].snapshot.inputDraft, 'first immutable attempt');
  assert.equal(reconciles[0].expectedRevision, 0);
  exact = true;
  const recovered = sessions.setRetention({ conversationId, mode: 'saved' });
  assert.equal(recovered.ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedRevision, writes[0].snapshot.revision);
  assert.equal(writes[1].snapshot.inputDraft, 'latest unsaved draft');
});

test('exact proof comparator checks all seven row fields, including id and exact serialization', () => {
  const { sameRow } = require(path.join(ROOT, 'src/platform/persistence/sqlite/conversation-commit-proof'));
  const row = { id: 'synthetic-id', owner_id: OWNER, revision: 2, created_at: 1000,
    updated_at: 1001, expires_at: null, snapshot: '{"synthetic":"body"}' };
  assert.equal(sameRow(row, { ...row }), true);
  for (const field of Object.keys(row)) {
    const other = { ...row, [field]: typeof row[field] === 'number' ? row[field] + 1 : `${row[field]}-different` };
    assert.equal(sameRow(row, other), false, field);
  }
  assert.equal(sameRow(null, undefined), true);
  assert.equal(sameRow(row, null), false);
});
