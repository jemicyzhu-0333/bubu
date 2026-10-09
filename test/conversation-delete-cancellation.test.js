'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..');
const from = file => require(path.join(ROOT, file));
const { openAuthoritativeCollaborationDatabase } = from('src/platform/persistence/sqlite/collaboration-database');
const { createAiCollaboration } = from('src/bootstrap/ai-collaboration');
const { createUnitOfWork } = from('src/application/state/unit-of-work');
const { normalizePersistedState } = from('src/platform/persistence/persisted-schema');
const { createSqliteStateAdapter } = from('src/platform/persistence/sqlite-state-adapter');
const { createApiClient } = from('src/core/llm');
const { faultFactory } = from('test-support/sqlite-authority-faults');
const { createPopoverDraftConversation } = from('src/surfaces/popover/features/draft-conversation.mjs');
const { createCollaborationDom } = from('test-support/collaboration-dom');
const { validateIpcPayload } = from('src/application/ipc/route-catalog');
const OWNER = 'synthetic-delete-defense-owner', NOW = Date.UTC(2026, 9, 7, 12);
const answer = text => ({ type: 'answer', answer: text, readRequest: null, changeProposal: null });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function database(t, { sqlConfig = false } = {}) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'conversation-delete-defense-'));
  // Match production admission: establish the branded config before other stores.
  if (sqlConfig) createSqliteStateAdapter({ userDataPath: directory, now: () => NOW }).close();
  const filePath = path.join(directory, 'collaboration.sqlite');
  const faults = { business: null, marker: false }, counts = { business: 0, deletes: 0 }, stores = [];
  const driver = { name: 'node-sqlite-synthetic', open: (file, options = {}) => new DatabaseSync(file, options) };
  const makeHandle = raw => {
    let business = false, marker = false;
    const result = {
      exec(sql) {
        if (sql === 'COMMIT' && business && faults.business) {
          const phase = faults.business; faults.business = null;
          if (phase === 'after') { raw.exec(sql); counts.business++; business = false; }
          throw Error('synthetic unknown business acknowledgement');
        }
        if (sql === 'COMMIT' && marker && faults.marker) throw Error('synthetic proof unavailable');
        const out = raw.exec(sql);
        if (sql === 'COMMIT' && business) counts.business++;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { business = false; marker = false; }
        return out;
      },
      run(sql, parameters = []) {
        if (/^INSERT INTO conversations\b/.test(sql)) business = true;
        if (/^UPDATE collaboration_durability\b/.test(sql)) marker = true;
        if (/^DELETE FROM conversations WHERE owner_id = \? AND id = \?/.test(sql)) counts.deletes++;
        return raw.prepare(sql).run(...parameters);
      },
      get: (sql, parameters = []) => raw.prepare(sql).get(...parameters),
      all: (sql, parameters = []) => raw.prepare(sql).all(...parameters),
      userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => raw.exec(`PRAGMA user_version=${version}`),
      close() { try { raw.close(); } catch (_) {} }
    };
    return result;
  };
  function open() {
    const store = openAuthoritativeCollaborationDatabase({ filePath, ownerId: OWNER }, { selectDriver: () => driver, makeHandle });
    assert.equal(store.status, 'available', store.reason); stores.push(store); return store;
  }
  const store = open(), cleanup = [];
  t.after(() => { for (const close of cleanup.reverse()) close(); stores.forEach(store => store.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  function row(id) {
    const raw = new DatabaseSync(filePath, { readOnly: true });
    try { const value = raw.prepare('SELECT snapshot FROM conversations WHERE id=?').get(id); return value ? JSON.parse(value.snapshot) : null; }
    finally { raw.close(); }
  }
  return { directory, filePath, faults, counts, store, open, row, cleanup };
}
function composition(t, db, { nativeClient = false, sqlConfig = false } = {}) {
  let sequence = 0, revision = 0, configProven = true;
  let state = normalizePersistedState({ settings: { aiBreakdownEnabled: true, aiClarifyEnabled: true,
    aiModel: 'fixture', aiBaseUrl: 'https://example.invalid/v1' },
    tasks: [{ id: 'task-a', title: 'SYNTHETIC PRIVATE SOURCE', createdAt: NOW, steps: [] }] }, { now: NOW });
  const configFaults = { commit: null, readback: false, beforeCleanup: null };
  let configCommits = 0;
  const synthetic = { snapshot: () => structuredClone(state), revision: () => revision,
    authoritativeWrites: { verify: () => ({ ok: configProven }), status: () => ({ available: configProven }) },
    commit(value) {
      const hook = configFaults.beforeCleanup; configFaults.beforeCleanup = null; hook?.();
      if (configFaults.commit === 'before') throw Error('synthetic cleanup refusal');
      state = structuredClone(value); revision++; configCommits++;
      return structuredClone(state);
    } };
  let sqlRepository;
  const sqlOptions = { userDataPath: db.directory, now: () => NOW,

    authorityFactory: faultFactory(event => {
      if (event.filePath !== path.join(db.directory, 'config.sqlite')) return;
      if (configFaults.commit && event.sql === 'COMMIT' && event.type === configFaults.commit) {
        configFaults.commit = null; configFaults.readback = true;
        throw Error('synthetic receipt cleanup COMMIT exception');
      }
      if (configFaults.readback && event.type === 'open' && event.readOnly) throw Error('synthetic config proof unavailable');
    }) };
  if (sqlConfig) sqlRepository = createSqliteStateAdapter(sqlOptions);
  const repository = sqlConfig ? { snapshot: () => sqlRepository.snapshot(), revision: () => sqlRepository.revision(),
    commit: (...args) => sqlRepository.commit(...args), authoritativeWrites: {
      verify: () => sqlRepository.authoritativeWrites.verify(), status: () => sqlRepository.authoritativeWrites.status() } } : synthetic;
  if (sqlConfig) { repository.commit(state, { now: NOW }); db.cleanup.push(() => sqlRepository.close()); }
  const sent = []; let respond = async () => answer('SYNTHETIC SOURCE-DERIVED ANSWER');
  const service = createAiCollaboration({ storage: { ownerId: OWNER, identityAvailable: true,
      repository: db.store.repository, close: () => db.store.close() },
    readSnapshot: repository.snapshot, stateRepository: repository,
    factStore: { healthy: true, timeline: { queryRange: () => ({ ok: true, items: [] }) } },
    getSettings: () => repository.snapshot().settings,
    credentialStore: { status: () => ({ configured: true }), get: () => 'synthetic-not-a-key', clear: () => true },
    now: () => NOW, idFactory: kind => `${kind}-${++sequence}`,
    clientFactory: options => nativeClient ? createApiClient({ ...options, post: (_url, payload, controls) => {
      sent.push({ payload: structuredClone(payload), signal: controls.signal }); return respond(payload, controls);
    } }) : ({ endpoint: 'https://example.invalid/v1/chat/completions', run(_name, payload, controls) {
      controls.beforeRequest(); sent.push({ payload: structuredClone(payload), signal: controls.signal });
      return respond(payload, controls);
    } }),
    changePorts: { unitOfWork: createUnitOfWork({ repository }), readRevision: repository.revision,
      normalizeState: normalizePersistedState, taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25 } } });
  const routes = new Map();
  service.register((name, handler) => routes.set(name, handler), { updatePreferencesCommand: { execute({ patch }, { onSuccessBeforePublish } = {}) {
    state.settings = { ...state.settings, ...patch }; const result = { ok: true, settings: structuredClone(state.settings) };
    onSuccessBeforePublish?.(result); return result;
  } } });
  db.cleanup.push(() => service.dispose());
  const opened = service.start({ purpose: 'stuck', mode: 'talk', taskId: 'task-a', retentionMode: 'saved' });
  assert.equal(opened.ok, true, opened.reason);
  return { service, routes, sent, repository, opened, id: opened.conversation.id,
    configFaults, configCommits: () => configCommits, providerFingerprint: service.getProvider(opened.conversation).fingerprint,
    reopenConfig() { sqlRepository.close(); sqlRepository = createSqliteStateAdapter(sqlOptions); },
    configProven(value) { configProven = value; }, respond(callback) { respond = callback; },
    run(message, grant = opened.scopeGrantId) { return service.turns.run({ conversationId: opened.conversation.id, message, scopeGrantId: grant }); } };
}

async function receipt(h) {
  h.respond(() => ({ type: 'changeProposal', answer: 'Review synthetic task title', readRequest: null,
    changeProposal: { operations: [{ type: 'task.update', entityId: 'task-a', patch: { title: 'Synthetic revised source' }, scope: 'current' }] } }));
  const first = await h.run('Suggest title edit'); assert.equal(first.ok, true, first.reason);
  const proposalId = first.conversation.messages.at(-1).proposal.id;
  const preview = h.service.changes.preview({ conversationId: h.id, scopeGrantId: h.opened.scopeGrantId, proposalId });
  assert.equal(preview.ok, true, preview.reason);
  const identity = Object.fromEntries(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash']
    .map(key => [key, preview.changeSet[key]]));
  const applied = h.service.changes.confirm(identity); assert.equal(applied.ok, true, applied.reason);
  assert.notEqual(h.repository.snapshot().aiCollaboration.receipts[0].details, null);
  return h.service.open({ conversationId: h.id }).scopeGrantId;
}
function confirmation(h) {
  return { conversationId: h.id, expectedRevision: h.service.sessions.get({ conversationId: h.id }).conversation.revision };
}
function remove(h, intent = confirmation(h)) { return h.routes.get('ai:conversation-delete')({}, intent); }
function grant(h, scopeGrantId, generation) {
  return h.service.grants.resolve({ conversationId: h.id, scopeGrantId,
    providerId: h.providerFingerprint, authorizationGeneration: generation });
}

for (const phase of ['before', 'after']) for (const response of ['answer', 'read']) {
  test(`${phase}-COMMIT pending save and receipt proof failure cancels late ${response} before any follow-on attempt`, async t => {
    const db = database(t), h = composition(t, db), scope = await receipt(h), late = deferred();
    let calls = 0; h.respond(() => ++calls === 1 ? late.promise : answer('FORBIDDEN FOLLOW-ON ANSWER'));
    db.faults.business = phase; db.faults.marker = true;
    const pending = h.run('Accepted explicit input', scope); await tick();
    const current = h.service.sessions.get({ conversationId: h.id }).conversation;
    const intent = confirmation(h), disk = db.row(h.id), business = db.counts.business;
    h.configProven(false);
    const deletion = remove(h, intent);
    assert.deepEqual(deletion, { ok: false, reason: 'receipt-privacy-pending', receiptDetailsRedacted: true, durability: 'unconfirmed' });
    assert.equal(h.sent.at(-1).signal.aborted, true, 'cancel before fallible receipt proof');
    assert.equal(grant(h, scope, current.authGeneration).ok, false);
    const after = h.service.sessions.get({ conversationId: h.id }).conversation;
    assert.equal(after.revision, intent.expectedRevision, 'runtime cancellation preserves original confirmation identity');
    assert.ok(after.authGeneration > current.authGeneration); assert.equal(after.requiresAuthorization, true);
    assert.equal(h.repository.snapshot().aiCollaboration.receipts[0].details, null);
    assert.deepEqual(db.row(h.id), disk, 'no source delete or save before either proof');
    assert.equal(db.counts.deletes, 0);
    const attempts = h.sent.length;
    late.resolve(response === 'answer' ? answer('FORBIDDEN LATE ANSWER') : { type: 'readRequest', answer: null, changeProposal: null,
      readRequest: { name: 'task.read', args: { id: 'task-a', fields: ['id', 'title'] } } });
    assert.equal((await pending).ok, false); await tick(); assert.equal(h.sent.length, attempts);
    assert.deepEqual(h.service.sessions.get({ conversationId: h.id }).conversation.messages, current.messages);
    assert.equal(remove(h, intent).reason, 'receipt-privacy-pending', 'same confirmation can retry cleanup');
    h.configProven(true);
    assert.equal(remove(h, intent).reason, 'conversation-save-unknown', 'config proof does not bypass exact collaboration proof');
    assert.equal(db.counts.deletes, 0);
    db.faults.marker = false;
    assert.equal(remove(h, intent).ok, true); assert.equal(db.row(h.id), null);
    assert.equal(db.counts.business, business, 'cleanup never replays ambiguous or newer conversation save');
    assert.equal(db.counts.deletes, 1);
  });
}

for (const kind of ['stale', 'missing', 'wrong-session']) {
  test(`${kind} confirmation cannot cancel grants or redact a receipt`, async t => {
    const db = database(t), h = composition(t, db), scope = await receipt(h), late = deferred();
    h.respond(() => late.promise); const pending = h.run('Keep running', scope); await tick();
    const current = h.service.sessions.get({ conversationId: h.id }).conversation;
    const before = h.repository.snapshot(), intent = confirmation(h);
    if (kind === 'stale') intent.expectedRevision--;
    if (kind === 'missing') delete intent.expectedRevision;
    if (kind === 'wrong-session') intent.conversationId = 'unowned-session';
    assert.equal(remove(h, intent).ok, false);
    assert.equal(h.sent.at(-1).signal.aborted, false); assert.equal(grant(h, scope, current.authGeneration).ok, true);
    assert.deepEqual(h.repository.snapshot(), before); assert.equal(db.counts.deletes, 0);
    late.resolve(answer('STILL AUTHORIZED')); assert.equal((await pending).ok, true);
  });
}

for (const phase of ['before', 'after']) {
  test(`real config SQLite cleanup ${phase}-COMMIT failure withdraws provider authority and keeps source until proof`, async t => {
    const db = database(t, { sqlConfig: true }), h = composition(t, db, { sqlConfig: true }), scope = await receipt(h), late = deferred();
    h.respond(() => late.promise); const pending = h.run('Synthetic provider input', scope); await tick();
    const intent = confirmation(h), disk = db.row(h.id), current = h.service.sessions.get({ conversationId: h.id }).conversation;
    h.configFaults.commit = phase;
    const deletion = remove(h, intent);
    assert.equal(deletion.ok, false); assert.equal(deletion.reason, 'receipt-redaction-failed');
    assert.equal(h.sent.at(-1).signal.aborted, true); assert.equal(grant(h, scope, current.authGeneration).ok, false);
    assert.deepEqual(db.row(h.id), disk); assert.equal(db.counts.deletes, 0);
    const raw = new DatabaseSync(path.join(db.directory, 'config.sqlite'), { readOnly: true });
    const onDisk = JSON.parse(raw.prepare('SELECT payload_json FROM config_snapshot').get().payload_json); raw.close();
    assert.equal(onDisk.aiCollaboration.receipts[0].details === null, phase === 'after');
    late.resolve(answer('FORBIDDEN LATE ANSWER')); assert.equal((await pending).ok, false);
    h.configFaults.readback = false; h.reopenConfig();
    assert.equal(h.repository.authoritativeWrites.verify().ok, true);
    assert.equal(remove(h, intent).ok, true); assert.equal(db.row(h.id), null);
    assert.equal(h.repository.snapshot().aiCollaboration.receipts[0].details, null);
  });
}

for (const response of ['answer', 'repair']) {
  test(`actual API client ignores late ${response} after pending cleanup and performs no second transport`, async t => {
    const db = database(t), h = composition(t, db, { nativeClient: true }), late = deferred();
    h.respond(() => late.promise); const pending = h.run('Synthetic actual-client input'); await tick();
    assert.equal(h.sent.length, 1); h.configProven(false);
    assert.equal(remove(h).reason, 'receipt-privacy-pending');
    assert.equal(h.sent[0].signal.aborted, true);
    late.resolve({ choices: [{ message: { content: response === 'repair' ? 'malformed synthetic output' : JSON.stringify(answer('FORBIDDEN')) } }] });
    assert.equal((await pending).ok, false); await tick(); assert.equal(h.sent.length, 1);
    assert.equal(h.service.sessions.get({ conversationId: h.id }).conversation.messages.length, 1);
  });
}

test('newer draft after pending delete rejects the original identity and survives exact pending-save recovery', async t => {
  const db = database(t), h = composition(t, db), late = deferred(); h.respond(() => late.promise);
  db.faults.business = 'after'; db.faults.marker = true;
  const pending = h.run('Original accepted input'); await tick();
  const intent = confirmation(h); h.configProven(false); assert.equal(remove(h, intent).reason, 'receipt-privacy-pending');
  const edited = h.service.sessions.pause({ conversationId: h.id, inputDraft: 'NEWER UNSAVED EDIT' });
  assert.ok(edited.conversation.revision > intent.expectedRevision);
  h.configProven(true); assert.equal(remove(h, intent).reason, 'conversation-delete-conflict');
  assert.equal(db.counts.deletes, 0); db.faults.marker = false;
  const saved = h.service.sessions.setRetention({ conversationId: h.id, mode: 'saved' }); assert.equal(saved.ok, true);
  assert.equal(db.row(h.id).inputDraft, 'NEWER UNSAVED EDIT');
  late.resolve(answer('FORBIDDEN')); assert.equal((await pending).ok, false);
});

test('edit during receipt cleanup cannot be silently adopted as the delete confirmation revision', async t => {
  const db = database(t), h = composition(t, db); await receipt(h);
  const intent = confirmation(h); let newScope, newer;
  h.respond(() => answer('NEW AUTHORIZED ANSWER'));
  h.configFaults.beforeCleanup = () => {
    newScope = h.service.open({ conversationId: h.id }).scopeGrantId;
    newer = h.run('REENTRANT NEW INPUT', newScope);
  };
  assert.equal(remove(h, intent).reason, 'conversation-delete-conflict');
  assert.equal(db.counts.deletes, 0);
  const current = h.service.sessions.get({ conversationId: h.id }).conversation;
  assert.equal(grant(h, newScope, current.authGeneration).ok, true, 'stale final deletion must not revoke new authority');
  assert.equal((await newer).ok, true); assert.equal(db.row(h.id).messages.at(-1).content, 'NEW AUTHORIZED ANSWER');
});

test('abort listeners observe withdrawn authority and cannot have a newer turn erased by old cancellation', async t => {
  const db = database(t), h = composition(t, db), sessions = h.service.sessions;
  const old = sessions.beginTurn({ conversationId: h.id, message: 'old', providerId: h.providerFingerprint, authorizationGeneration: 0 });
  assert.equal(old.ok, true, old.reason);
  let next, nextScope, observed, providerAborted;
  h.respond((_payload, controls) => {
    providerAborted = controls.signal.aborted;
    return answer('new answer');
  });
  old.signal.addEventListener('abort', () => {
    const current = sessions.get({ conversationId: h.id }).conversation; observed = current;
    nextScope = h.service.open({ conversationId: h.id });
    next = h.run('new', nextScope.scopeGrantId);
  }, { once: true });
  const intent = confirmation(h);
  assert.equal(sessions.prepareDelete(intent).reason, 'conversation-delete-conflict');
  assert.equal(observed.requiresAuthorization, true); assert.equal(observed.authGeneration, 1);
  assert.equal(nextScope.ok, true, nextScope.reason);
  assert.equal(sessions.delete(intent).reason, 'conversation-delete-conflict');
  const completed = await next;
  assert.equal(completed.ok, true, completed.reason);
  assert.equal(providerAborted, false, 'old cancellation does not abort the replacement provider operation');
  assert.equal(completed.conversation.messages.at(-1).content, 'new answer');
  assert.equal(db.row(h.id).messages.at(-1).content, 'new answer');
});

for (const explicit of [true, false]) {
  test(`direct owner delete with ${explicit ? 'explicit' : 'implicit'} revision preserves a newer abort-callback draft`, t => {
    const db = database(t), h = composition(t, db), sessions = h.service.sessions;
    const begun = sessions.beginTurn({ conversationId: h.id, message: 'old input', providerId: 'provider', authorizationGeneration: 0 });
    const intent = explicit ? confirmation(h) : { conversationId: h.id };
    begun.signal.addEventListener('abort', () => sessions.pause({ conversationId: h.id, inputDraft: 'NEW ABORT-CALLBACK DRAFT' }), { once: true });
    assert.equal(sessions.delete(intent).reason, 'conversation-delete-conflict');
    assert.equal(begun.signal.aborted, true); assert.equal(db.counts.deletes, 0);
    assert.equal(sessions.get({ conversationId: h.id }).conversation.inputDraft, 'NEW ABORT-CALLBACK DRAFT');
    assert.equal(db.row(h.id).inputDraft, 'NEW ABORT-CALLBACK DRAFT');
  });
}

test('normal UI cancels busy work first and confirms its resulting revision through production routes', async t => {
  const db = database(t), h = composition(t, db), dom = createCollaborationDom(), late = deferred();
  const bindings = { startConversation: 'start', getConversation: 'open', listConversations: 'list', conversationTurn: 'turn',
    pauseConversation: 'pause', cancelConversation: 'cancel', setConversationScope: 'scope', setConversationMode: 'mode',
    setConversationRetention: 'retention', deleteConversation: 'delete' };
  const calls = [], client = Object.fromEntries(Object.entries(bindings).map(([name, action]) => [name, async payload => {
    const channel = `ai:conversation-${action}`; assert.equal(validateIpcPayload(channel, payload).ok, true);
    calls.push({ action, payload }); return h.routes.get(channel)({}, payload);
  }]));
  const feature = createPopoverDraftConversation({ document: dom.document, $: dom.$, escapeHTML: String, surfaceClient: client,
    fallbackReasonText: value => value, adoptProposal() {}, stageStuckProposal() {}, restoreModalFocus() {},
    isAiClarifyEnabled: () => true, showEntryStatus() {} });
  t.after(() => feature.dispose()); feature.mount();
  await feature.open({ purpose: 'stuck', mode: 'talk', taskId: 'task-a' });
  h.respond(() => late.promise); dom.$('#draftChatInput').value = 'UI synthetic input'; const pending = feature.send(); await tick();
  const id = calls.find(item => item.action === 'turn').payload.conversationId;
  const before = h.service.sessions.get({ conversationId: id }).conversation;
  await feature.requestDelete();
  const canceled = h.service.sessions.get({ conversationId: id }).conversation;
  assert.ok(canceled.revision > before.revision); assert.equal(h.sent.at(-1).signal.aborted, true);
  assert.equal(calls.filter(item => item.action === 'delete').length, 0);
  await feature.confirmDelete();
  assert.equal(calls.at(-1).action, 'delete'); assert.equal(calls.at(-1).payload.expectedRevision, canceled.revision);
  assert.ok(calls.findIndex(item => item.action === 'cancel') < calls.findIndex(item => item.action === 'delete'));
  assert.equal(h.service.sessions.get({ conversationId: id }).reason, 'conversation-not-found');
  late.resolve(answer('FORBIDDEN')); await pending;
});
