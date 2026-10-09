'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { openCollaborationDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openProfileIdentity, markProfileIdentityReady } = require('../src/platform/persistence/profile-identity');
const { openCollaborationStorageAt } = require('../src/bootstrap/collaboration-storage');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');

const OWNER = 'synthetic-owner-retention';
const DAY = 86400000;
function fixture({ maxCached = 3 } = {}) {
  const db = openCollaborationDatabase({ filePath: ':memory:', ownerId: OWNER });
  let at = 1000, sequence = 0, timerId = 0, failSave = false, failPrune = false, saves = 0;
  const timers = new Map();
  const repository = { ...db.repository,
    saveSnapshot(request) { saves += 1; return failSave ? { ok: false, reason: 'synthetic-save-failed' } : db.repository.saveSnapshot(request); },
    pruneRetention(request) { return failPrune ? { ok: false, reason: 'synthetic-prune-failed' } : db.repository.pruneRetention(request); }
  };
  function createSessions() {
    return createCollaborationSessions({ ownerId: OWNER, repository, now: () => at, maxCached,
      idFactory: () => `retention-${++sequence}`, schedule: (callback, delay) => {
        const id = ++timerId; timers.set(id, { callback, delay }); return id;
      }, cancelSchedule: id => timers.delete(id) });
  }
  const sessions = createSessions();
  function saved(pinned = false) {
    const opened = sessions.start(); assert.equal(opened.ok, true, opened.reason);
    const id = opened.conversation.id;
    assert.equal(sessions.setRetention({ conversationId: id, mode: 'saved', retentionDays: 1, pinned }).ok, true);
    return id;
  }
  return { db, repository, sessions, saved, createSessions, timers,
    setTime: value => { at = value; }, failSave: value => { failSave = value; }, failPrune: value => { failPrune = value; },
    saveCount: () => saves, fire: () => { const timer = [...timers.values()][0]; assert.ok(timer); timers.clear(); timer.callback(); } };
}

test('retention expiry removes cached history and denies get, list, begin, pause, pin and dispose writeback', () => {
  const f = fixture();
  const id = f.saved();
  f.setTime(1000 + 2 * DAY);
  const expired = f.sessions.get({ conversationId: id });
  assert.equal(expired.reason, 'conversation-expired');
  assert.equal(expired.deletion, 'confirmed');
  assert.equal(expired.conversation, undefined);
  assert.deepEqual(f.sessions.list().items, []);
  assert.equal(f.sessions.beginTurn({ conversationId: id, message: 'too late', providerId: 'provider', authorizationGeneration: 0 }).ok, false);
  assert.equal(f.sessions.pause({ conversationId: id, inputDraft: 'do not revive' }).ok, false);
  assert.equal(f.sessions.setRetention({ conversationId: id, mode: 'saved', pinned: true }).ok, false);
  const saves = f.saveCount();
  assert.equal(f.sessions.dispose().ok, true);
  assert.equal(f.saveCount(), saves);
  assert.equal(f.db.repository.load({ ownerId: OWNER, conversationId: id }).reason, 'conversation-not-found');
  f.db.close();
});

test('expired saved sessions are denied after restart or cache eviction; pinned records remain available', () => {
  const f = fixture({ maxCached: 1 });
  const expiredId = f.saved();
  const pinnedId = f.saved(true); // releases the clean first snapshot from the bounded cache
  f.setTime(1000 + 2 * DAY);
  assert.equal(f.sessions.get({ conversationId: pinnedId }).ok, true);
  assert.deepEqual(f.sessions.list().items.map(item => item.id), [pinnedId]);
  assert.equal(f.sessions.get({ conversationId: expiredId }).ok, false);
  const restarted = f.createSessions();
  assert.equal(restarted.get({ conversationId: expiredId }).ok, false);
  assert.equal(restarted.get({ conversationId: pinnedId }).ok, true);
  f.sessions.dispose(); restarted.dispose(); f.db.close();
});

test('a failed save cannot extend expiry; timer aborts an in-flight request without waiting for its reply', () => {
  const f = fixture();
  const id = f.saved();
  f.setTime(1000 + DAY / 2); f.failSave(true);
  const begun = f.sessions.beginTurn({ conversationId: id, message: 'unsaved turn', providerId: 'provider', authorizationGeneration: 0 });
  assert.equal(begun.ok, true); assert.equal(begun.conversation.saveState, 'unsaved');
  f.setTime(1000 + DAY); f.fire();
  assert.equal(begun.signal.aborted, true);
  assert.equal(begun.signal.reason, 'conversation-expired');
  assert.equal(f.sessions.completeTurn({ token: begun.token, providerId: 'provider', content: 'late answer' }).ok, false);
  const saves = f.saveCount();
  f.failSave(false); f.sessions.dispose();
  assert.equal(f.saveCount(), saves);
  assert.equal(f.db.repository.load({ ownerId: OWNER, conversationId: id }).ok, false);
  f.db.close();
});

test('failed pin persistence does not exempt the stored retention deadline', () => {
  const f = fixture();
  const id = f.saved();
  f.failSave(true); f.setTime(1000 + DAY / 2);
  assert.equal(f.sessions.setRetention({ conversationId: id, mode: 'saved', retentionDays: 3650, pinned: true }).ok, false);
  f.setTime(1000 + 2 * DAY);
  assert.equal(f.sessions.get({ conversationId: id }).reason, 'conversation-expired');
  assert.equal(f.db.repository.load({ ownerId: OWNER, conversationId: id }).ok, false);
  f.sessions.dispose(); f.db.close();
});

test('prune failure denies expired content and reports pending deletion, with no false deletion or resurrection', () => {
  const f = fixture();
  const id = f.saved();
  const before = f.db.repository.load({ ownerId: OWNER, conversationId: id }).conversation;
  f.failPrune(true); f.setTime(1000 + 2 * DAY);
  const denied = f.sessions.get({ conversationId: id });
  assert.equal(denied.reason, 'conversation-expired'); assert.equal(denied.deletion, 'pending');
  assert.equal(denied.cleanupReason, 'synthetic-prune-failed'); assert.equal(denied.conversation, undefined);
  const list = f.sessions.list(); assert.equal(list.ok, true); assert.deepEqual(list.items, []);
  assert.equal(list.availability, 'unavailable'); assert.equal(list.reason, 'synthetic-prune-failed');
  assert.deepEqual(f.db.repository.load({ ownerId: OWNER, conversationId: id }).conversation, before);
  const restarted = f.createSessions();
  assert.equal(restarted.get({ conversationId: id }).reason, 'conversation-expired');
  assert.equal(restarted.get({ conversationId: id }).deletion, 'pending');
  assert.equal(f.sessions.dispose().retentionError, 'synthetic-prune-failed');
  assert.deepEqual(f.db.repository.load({ ownerId: OWNER, conversationId: id }).conversation, before);
  f.failPrune(false);
  assert.equal(restarted.get({ conversationId: id }).deletion, 'confirmed');
  assert.equal(f.db.repository.load({ ownerId: OWNER, conversationId: id }).ok, false);
  restarted.dispose(); f.db.close();
});

test('repository clock guards deny expired loads/pages and stale CAS updates even before pruning', () => {
  const f = fixture();
  const id = f.saved();
  const before = f.db.repository.load({ ownerId: OWNER, conversationId: id }).conversation;
  const now = 1000 + 2 * DAY;
  assert.equal(f.db.repository.load({ ownerId: OWNER, conversationId: id, now }).reason, 'conversation-expired');
  assert.deepEqual(f.db.repository.listPage({ ownerId: OWNER, now }).items, []);
  assert.equal(f.db.repository.saveSnapshot({ ownerId: OWNER, expectedRevision: before.revision, now,
    snapshot: { ...before, revision: before.revision + 1, updatedAt: now, retention: { ...before.retention, pinned: true } } }).reason, 'conversation-expired');
  assert.deepEqual(f.db.repository.load({ ownerId: OWNER, conversationId: id }).conversation, before);
  f.sessions.dispose(); f.db.close();
});

test('actual-context references preserve new drafts through four turns after a manual task version change', async () => {
  let sequence = 0;
  const now = () => 1000;
  const sessions = createCollaborationSessions({ ownerId: OWNER, now, idFactory: () => `source-${++sequence}` });
  const conversationId = sessions.start({ purpose: 'stuck', mode: 'small-step', relatedEntity: { kind: 'task', id: 'task-1', version: null } }).conversation.id;
  const grants = createContextGrants({ ownerId: OWNER, now, idFactory: () => `grant-${++sequence}` });
  const task = { id: 'task-1', title: 'old title', steps: [], done: false };
  const reads = createContextReads({ grants, readSnapshot: () => ({ tasks: [task], settings: { aiMemoryEnabled: false } }) });
  const sent = [];
  const provider = { enabled: true, configured: true, fingerprint: 'provider', client: { async run(_kind, payload, controls) {
    controls.beforeRequest(); sent.push(structuredClone(payload));
    return { type: 'changeProposal', answer: `draft answer ${sent.length}`, readRequest: null,
      changeProposal: { title: `draft ${sent.length}`, steps: [{ title: '打开文件', dependsOn: null, safeStopAfter: true }], estimateMinutes: 2, energy: null, notes: null } };
  } } };
  const scope = grants.issue({ conversationId, purpose: 'stuck', providerId: 'provider', authorizationGeneration: 0,
    selection: { tools: ['task.read'], taskIds: ['task-1'], fromDay: '2026-10-04', toDay: '2026-10-04' } }).grant.id;
  const turns = createCollaborationTurns({ sessions, grants, reads, getProvider: () => provider, now,
    validateContextVersions: refs => refs.every(ref => ref.kind !== 'task' || ref.revision === entityFingerprint(task)) });
  assert.equal((await turns.run({ conversationId, scopeGrantId: scope, message: 'first' })).ok, true);
  const oldRevision = entityFingerprint(task); task.title = 'manually revised title';
  const newRevision = entityFingerprint(task);
  for (const message of ['second', 'third', 'fourth']) assert.equal((await turns.run({ conversationId, scopeGrantId: scope, message })).ok, true);
  const messages = sessions.get({ conversationId }).conversation.messages;
  for (const message of messages.filter(item => item.role === 'assistant').slice(1)) {
    assert.ok(message.sourceRefs.some(ref => ref.revision === newRevision));
    assert.equal(message.sourceRefs.some(ref => ref.revision === oldRevision), false);
  }
  assert.ok(sent[2].context.messages.some(message => message.proposal && JSON.parse(message.proposal.body).title === 'draft 2'));
  assert.ok(sent[3].context.messages.some(message => message.proposal && JSON.parse(message.proposal.body).title === 'draft 3'));
  sessions.dispose();
});

const directories = [];
function profile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-init-regression-')); directories.push(directory);
  return { directory, identityPath: path.join(directory, 'profile-identity.sqlite'), databasePath: path.join(directory, 'collaboration.sqlite') };
}
test.after(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }); });

test('READY identity with a missing main authority and no sidecars fails closed instead of recreating empty history', () => {
  const p = profile();
  const store = openCollaborationStorageAt({ userDataPath: p.directory }); assert.equal(store.status, 'available');
  const sessions = createCollaborationSessions({ ownerId: store.ownerId, repository: store.repository, now: () => 1000, idFactory: n => `lost-${n}` });
  const id = sessions.start().conversation.id;
  assert.equal(sessions.setRetention({ conversationId: id, mode: 'saved', inputDraft: 'synthetic recoverable draft' }).ok, true);
  sessions.dispose(); store.close();
  const identity = openProfileIdentity({ filePath: p.identityPath, databasePath: p.databasePath, lockAcquired: true });
  assert.equal(identity.phase, 'READY');
  assert.equal(fs.existsSync(`${p.databasePath}-wal`), false); assert.equal(fs.existsSync(`${p.databasePath}-shm`), false);
  fs.renameSync(p.databasePath, `${p.databasePath}.lost`);
  const reopened = openCollaborationStorageAt({ userDataPath: p.directory });
  assert.equal(reopened.status, 'recovery-required'); assert.equal(reopened.reason, 'collaboration-database-missing');
  assert.equal(reopened.ownerId, store.ownerId); assert.equal(reopened.repository, null);
  assert.equal(fs.existsSync(p.databasePath), false);
});

test('INITIALIZING may finish before or after conversation DB creation; READY marking is owner-scoped and idempotent', () => {
  for (const createDatabaseFirst of [false, true]) {
    const p = profile();
    const identity = openProfileIdentity({ filePath: p.identityPath, databasePath: p.databasePath, lockAcquired: true });
    assert.equal(identity.phase, 'INITIALIZING');
    if (createDatabaseFirst) openCollaborationDatabase({ filePath: p.databasePath, ownerId: identity.ownerId }).close();
    const opened = openCollaborationStorageAt({ userDataPath: p.directory });
    assert.equal(opened.status, 'available'); assert.equal(opened.ownerId, identity.ownerId); opened.close();
    assert.equal(openProfileIdentity({ filePath: p.identityPath, databasePath: p.databasePath, lockAcquired: true }).phase, 'READY');
    assert.equal(markProfileIdentityReady({ filePath: p.identityPath, ownerId: identity.ownerId, lockAcquired: true }).phase, 'READY');
    assert.equal(markProfileIdentityReady({ filePath: p.identityPath, ownerId: 'wrong-synthetic-owner', lockAcquired: true }).reason, 'profile-identity-owner-mismatch');
  }
});

test('INITIALIZING with a wrong-owner conversation DB never becomes READY or replaces that DB', () => {
  const p = profile();
  const identity = openProfileIdentity({ filePath: p.identityPath, databasePath: p.databasePath, lockAcquired: true });
  openCollaborationDatabase({ filePath: p.databasePath, ownerId: 'wrong-owner' }).close();
  const before = fs.readFileSync(p.databasePath);
  const opened = openCollaborationStorageAt({ userDataPath: p.directory });
  assert.equal(opened.status, 'recovery-required'); assert.equal(opened.reason, 'collaboration-owner-mismatch');
  assert.equal(openProfileIdentity({ filePath: p.identityPath, databasePath: p.databasePath, lockAcquired: true }).phase, 'INITIALIZING');
  assert.deepEqual(fs.readFileSync(p.databasePath), before); assert.ok(identity.ownerId);
});


test('production composition keeps multiple temporary sessions browsable when the authority is unavailable', () => {
  const { createAiCollaboration } = require('../src/bootstrap/ai-collaboration');
  let sequence = 0;
  const app = createAiCollaboration({
    storage: { status: 'unavailable', reason: 'sqlite-unavailable', ownerId: OWNER, repository: null, close() {} },
    readSnapshot: () => ({ tasks: [], settings: {} }), factStore: null,
    credentialStore: { status: () => ({ configured: false }) }, getSettings: () => ({ aiBreakdownEnabled: false }),
    now: () => 1000, idFactory: kind => `${kind}-${++sequence}`
  });
  const first = app.sessions.start().conversation.id;
  const second = app.sessions.start({ purpose: 'stuck' }).conversation.id;
  const page = app.sessions.list();
  assert.equal(page.ok, true); assert.equal(page.availability, 'unavailable');
  assert.equal(page.reason, 'sqlite-unavailable');
  assert.deepEqual(new Set(page.items.map(item => item.id)), new Set([first, second]));
  assert.equal(page.items.every(item => item.retention.mode === 'ephemeral'), true);
  assert.equal(app.sessions.get({ conversationId: first }).ok, true);
  assert.equal(app.sessions.get({ conversationId: second }).ok, true);
  app.dispose();
});

test('cleanup failure shows only verified unexpired cached entries and no expired saved metadata', () => {
  const f = fixture();
  const expiredId = f.saved();
  const pinnedId = f.saved(true);
  const localId = f.sessions.start().conversation.id;
  f.failPrune(true); f.setTime(1000 + 2 * DAY);
  const page = f.sessions.list();
  assert.equal(page.ok, true); assert.equal(page.availability, 'unavailable');
  assert.equal(page.reason, 'synthetic-prune-failed'); assert.equal(page.deletion, 'pending');
  assert.deepEqual(new Set(page.items.map(item => item.id)), new Set([pinnedId, localId]));
  assert.equal(page.items.some(item => item.id === expiredId), false);
  assert.equal(page.items.find(item => item.id === pinnedId).saveState, 'saved');
  assert.equal(f.sessions.get({ conversationId: expiredId }).deletion, 'pending');
  f.sessions.dispose(); f.db.close();
});


test('READY identity refuses zero-byte and schema-zero authority truncation instead of initializing empty history', () => {
  const { DatabaseSync } = require('node:sqlite');
  for (const kind of ['zero-byte', 'schema-zero']) {
    const p = profile();
    openCollaborationStorageAt({ userDataPath: p.directory }).close();
    fs.renameSync(p.databasePath, `${p.databasePath}.original`);
    if (kind === 'zero-byte') fs.writeFileSync(p.databasePath, '');
    else { const raw = new DatabaseSync(p.databasePath); raw.exec('PRAGMA user_version=0'); raw.close(); }
    const before = fs.readFileSync(p.databasePath);
    const rejected = openCollaborationStorageAt({ userDataPath: p.directory });
    assert.equal(rejected.status, 'recovery-required');
    assert.equal(rejected.reason, 'collaboration-schema-uninitialized');
    assert.equal(rejected.repository, null);
    assert.deepEqual(fs.readFileSync(p.databasePath), before);
    assert.equal(fs.existsSync(`${p.databasePath}.schema-0-to-1.backup`), false);
  }
});
