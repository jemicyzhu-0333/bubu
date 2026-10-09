'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants, authorizeRead, TOOL_NAMES } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createConversationAccess } = require('../src/application/ai/conversation-access');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { memoryContextVersion } = require('../src/application/ai/context-choices');
const { COLLABORATION_TASK, validateCollaborationResult } = require('../src/core/llm/collaboration-task');
const { createMemoryRecallFixture } = require('../test-support/memory-recall-fixture');
const { createMemoryRecall } = require('../src/application/ai/memory-recall');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const AT = Date.UTC(2026, 9, 4, 12);
const answer = text => ({ type: 'answer', answer: text || 'One small step is enough.', readRequest: null, changeProposal: null });
const candidate = () => ({ type: 'changeProposal', answer: 'Would you like to keep this preference?', readRequest: null,
  changeProposal: { memoryCandidate: { kind: 'preference', subject: 'Morning planning', body: 'Start with a small task.', scope: 'work', expiresAt: null } } });
const memoryRecord = (id, extras = {}) => ({ id, version: 1, status: 'active', contextAllowed: true,
  kind: 'preference', subject: `Subject ${id}`, body: `Body ${id}`, scope: 'global', validFrom: 0,
  expiresAt: null, source: 'user-confirmed', lastUsedAt: null, useCount: 0, ...extras });
const preference = (id, extras = {}) => ({ id, version: 1, startMinute: 540, endMinute: 660, demand: 'low',
  scope: 'saved', createdAt: 1, updatedAt: 1, expiresAt: null, source: 'user-confirmed', ...extras });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function harness({ reply, enabled = true, noHistoryPort = false, candidateMode = 'talk', contextSent, snapshotRead } = {}) {
  let at = AT, sequence = 0, snapshots = 0, versionReads = 0, writes = 0, ledgerAvailable = true, ledgerSequence = 0;
  const now = () => at, timers = new Map();
  const schedule = callback => { const id = ++sequence; timers.set(id, callback); return id; };
  const cancelSchedule = id => timers.delete(id);
  let providerEntry = deferred();
  const records = [memoryRecord('memory-a'), memoryRecord('memory-private')];
  const state = { settings: { aiMemoryEnabled: enabled }, tasks: [{ id: 'task-a', title: 'Open file', steps: [], done: false }],
    impulses: [{ id: 'inbox-a', text: 'A selected note', createdAt: 1 }],
    routines: [{ id: 'routine-a', kind: 'movement', active: true, title: 'Walk', schedule: null }],
    planningPreferences: { version: 1, items: [preference('plan-a')], undo: { secret: 'PRIVATE_UNDO' } },
    energySelfReports: { events: [{ secret: 'PRIVATE_REPORT_HISTORY' }] },
    energyCurveTrials: { active: { sourceVersion: 'PRIVATE_MODEL_VERSION', effectScaleIds: ['PRIVATE_EFFECT_ID'] } } };
  const { contextReader, memoryRecall } = createMemoryRecallFixture({ records: () => records, now,
    available: () => ledgerAvailable,
    authority: () => ({ ownerId: 'owner', ledgerId: 'SYNTHETIC_PRIVATE_LEDGER', sequence: ledgerSequence }),
    onSnapshot(request) { snapshots++; if (snapshotRead) snapshotRead(request, records); } });
  const memory = { contextReader, available: true,
    list() { throw new Error('Recall must not call management list'); },
    getVersion() { versionReads++; throw new Error('Recall must not call management getVersion'); },
    forgettingState() { throw new Error('Recall must not call management forgettingState'); },
    usage() { writes++; throw new Error('Readers never write memory'); } };
  const sessions = createCollaborationSessions({ ownerId: 'owner', now, schedule, cancelSchedule, idFactory: () => `id-${++sequence}` });
  const grants = createContextGrants({ ownerId: 'owner', now, idFactory: () => `grant-${++sequence}` });
  const reads = createContextReads({ grants, readSnapshot: () => state, memoryRecall, now,
    timeline: { available: true, readRange: () => ({ ok: true, items: [] }) } });
  const sent = [], tombstones = new Set();
  const provider = { fingerprint: 'provider', enabled: true, configured: true, purposeAllowed: true,
    model: 'synthetic', endpoint: 'https://example.com/v1', client: { async run(_name, payload, options) {
      options.beforeRequest(); sent.push(structuredClone(payload));
      const entered = providerEntry; providerEntry = deferred(); entered.resolve();
      return reply ? reply(sent.length, payload, options) : answer();
    } } };
  const access = createConversationAccess({ sessions, grants, reads, memoryRecall, now, getProvider: () => provider, readSnapshot: () => state });
  const opened = access.start({ purpose: 'task', mode: candidateMode, retentionMode: 'ephemeral' });
  assert.equal(opened.ok, true, opened.reason);
  const historyAllowed = (message, context) => {
    if (!ledgerAvailable || tombstones.has(message.id)) return false;
    const messages = sessions.get({ conversationId: context.conversationId }).conversation.messages;
    const walk = (item, seen = new Set()) => {
      if (seen.has(item.id) || tombstones.has(item.id)) return false;
      seen.add(item.id);
      return item.sourceRefs.filter(ref => ref.kind === 'message').every(ref => {
        const parent = messages.find(value => value.id === ref.id);
        return parent && walk(parent, new Set(seen));
      });
    };
    return walk(message);
  };
  const turns = createCollaborationTurns({ sessions, grants, reads, now, schedule, cancelSchedule, getProvider: () => provider,
    validateContextVersions: reads.validateContextVersions,
    onContextSent: refs => { if (contextSent) contextSent(refs, records); },
    ...(noHistoryPort ? {} : { isContextMessageAllowed: historyAllowed }) });
  let scope = opened;
  const setScope = input => { const result = access.setScope({ conversationId: opened.conversation.id, ...input }); if (result.ok) scope = result; return result; };
  const run = extra => turns.run({ conversationId: opened.conversation.id, scopeGrantId: scope.scopeGrantId,
    message: 'Help with today.', ...extra });
  return { state, memory, memoryRecall, records, sessions, grants, reads, access, provider, opened, sent, tombstones, setScope, run,
    nextProviderEntry: () => providerEntry.promise,
    get: () => sessions.get({ conversationId: opened.conversation.id }).conversation, setTime: value => { at = value; },
    advanceLedger: () => { ledgerSequence++; },
    setLedgerAvailable: value => { ledgerAvailable = value; }, counts: () => ({ snapshots, versionReads, writes }) };
}

function assertRetiredScopeNotIssued(f, input) {
  // Bind each failure to a freshly issued prior grant, not an already revoked one.
  const prior = f.setScope({ memoryIds: [] }); assert.equal(prior.ok, true, prior.reason);
  const before = f.get();
  const result = f.setScope(input);
  assert.deepEqual(Object.keys(result).sort(), ['conversation', 'ok', 'reason', 'scopeGrantId', 'transition']);
  assert.equal(result.ok, false); assert.equal(result.reason, 'scope-not-issued');
  assert.equal(result.scopeGrantId, null); assert.equal(result.transition.applied, true);
  assert.equal(result.transition.revision, result.conversation.revision);
  assert.ok(result.conversation.revision > before.revision);
  assert.deepEqual(result.conversation, f.get());
  assert.deepEqual(f.access.captureScopes(), []);
  assert.equal(f.grants.resolve({ conversationId: prior.conversation.id, scopeGrantId: prior.scopeGrantId,
    providerId: f.provider.fingerprint, authorizationGeneration: prior.conversation.authGeneration }).ok, false);
  assert.equal(f.sent.length, 0);
  return result;
}

test('memory and planning reads default off and memory choices honor the independent setting', async () => {
  const f = harness({ enabled: false });
  assert.deepEqual(f.opened.selection.memoryIds, []); assert.equal(f.opened.selection.planningPreferences, false);
  assert.equal(f.access.getConversationContextChoices({ conversationId: f.opened.conversation.id, kind: 'memory' }).availability, 'disabled');
  assertRetiredScopeNotIssued(f, { memoryIds: ['memory-a'] });
  const direct = f.grants.issue({ conversationId: 'disabled-tool-contract', purpose: 'task',
    providerId: f.provider.fingerprint, authorizationGeneration: 0,
    selection: { tools: ['memory.search'], taskIds: [], inboxIds: [], routineIds: [],
      memoryIds: ['memory-a'], planningPreferences: false,
      fromDay: f.opened.selection.fromDay, toDay: f.opened.selection.toDay } });
  assert.equal(direct.ok, true);
  assert.deepEqual(f.reads.execute({ grant: direct.grant, request: { name: 'memory.search', args: {} } }),
    { ok: false, reason: 'memory-disabled' });
  assert.equal(f.counts().snapshots, 0);
  const clean = f.setScope({ memoryIds: [], planningPreferences: false }); assert.equal(clean.ok, true);
  const result = await f.run();
  assert.equal(result.ok, true); assert.equal(result.disclosure.usage.reads, 0);
  assert.deepEqual(f.sent[0].context.data, []); assert.equal(f.counts().snapshots, 0);
});

test('memory choices only expose current active allowed records and selected memory scopes reject oversize atomically', () => {
  const f = harness();
  f.records.push(memoryRecord('paused', { status: 'paused' }), memoryRecord('expired', { expiresAt: AT - 1 }),
    memoryRecord('conflict', { contextAllowed: false }), memoryRecord('future', { validFrom: AT + 1 }),
    memoryRecord('candidate', { status: 'candidate', source: 'candidate' }), memoryRecord('withdrawn', { status: 'removed' }),
    memoryRecord('aggregate-no-expiry', { source: 'aggregated' }));
  const choices = f.access.getConversationContextChoices({ conversationId: f.opened.conversation.id, kind: 'memory' });
  assert.deepEqual(choices.items.map(item => item.id), ['memory-a', 'memory-private']);
  assert.equal(choices.items[0].version, entityFingerprint({ id: 'memory-a', version: 1 }));
  for (const id of ['paused', 'expired', 'conflict', 'future', 'candidate', 'withdrawn', 'aggregate-no-expiry', 'missing']) {
    assert.deepEqual(f.memoryRecall.selected([id]), { ok: false, reason: 'memory-context-invalid' }, id);
    assertRetiredScopeNotIssued(f, { memoryIds: [id] });
  }
  const prior = f.setScope({ memoryIds: [] }); assert.equal(prior.ok, true);
  const beforeInvalidIds = f.get();
  assert.deepEqual(f.setScope({ memoryIds: Array.from({ length: 9 }, (_, n) => `id-${n}`) }),
    { ok: false, reason: 'memory-selection-budget' });
  assert.deepEqual(f.get(), beforeInvalidIds, 'nine IDs are rejected before retirement');
  assert.equal(f.access.captureScopes().length, 1);
  assert.equal(f.grants.resolve({ conversationId: prior.conversation.id, scopeGrantId: prior.scopeGrantId,
    providerId: f.provider.fingerprint, authorizationGeneration: prior.conversation.authGeneration }).ok, true);
  f.records[0].body = '🙂'.repeat(500); f.records[1].body = 'x'.repeat(500);
  f.records.push(memoryRecord('memory-third', { body: 'x'.repeat(201) }));
  const overBudgetIds = ['memory-a', 'memory-private', 'memory-third'];
  assert.deepEqual(f.memoryRecall.selected(overBudgetIds), { ok: false, reason: 'memory-context-budget' });
  assertRetiredScopeNotIssued(f, { memoryIds: overBudgetIds });
  f.records.at(-1).body = 'x'.repeat(200);
  const accepted = f.setScope({ memoryIds: ['memory-a', 'memory-private', 'memory-third'] });
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(accepted.contextPreview[0].items[0].body, '🙂'.repeat(500));
  assert.equal(f.sent.length, 0);
});

test('selected memory and confirmed planning projections preload without local energy model identifiers or history', async () => {
  const f = harness();
  f.state.planningPreferences.items.push(preference('expired', { expiresAt: AT - 1, scope: 'today' }),
    preference('future', { updatedAt: AT + 1 }), preference('unconfirmed', { source: 'model-proposed' }));
  const opened = f.setScope({ memoryIds: ['memory-a'], planningPreferences: true }); assert.equal(opened.ok, true);
  const before = structuredClone(f.state), result = await f.run();
  assert.equal(result.ok, true, result.reason); assert.equal(result.disclosure.usage.reads, 2);
  assert.deepEqual(f.sent[0].context.data.map(read => read.tool), ['memory.search', 'planning.preferences.read']);
  const [memory, planning] = f.sent[0].context.data;
  assert.deepEqual(memory.items.map(item => item.id), ['memory-a']);
  assert.deepEqual(planning.items.map(item => item.id), ['plan-a']);
  assert.deepEqual(Object.keys(planning.items[0]), ['id', 'version', 'startMinute', 'endMinute', 'demand', 'scope', 'expiresAt', 'source']);
  assert.equal(planning.sourceRefs[0].kind, 'planning-preference');
  assert.equal(planning.coverage.basis, 'user-confirmed-planning-preferences');
  for (const text of ['memory-private', 'PRIVATE_UNDO', 'PRIVATE_REPORT_HISTORY', 'PRIVATE_MODEL_VERSION', 'PRIVATE_EFFECT_ID']) {
    assert.equal(JSON.stringify(f.sent).includes(text), false, text);
  }
  assert.deepEqual(f.state, before); assert.equal(f.counts().writes, 0);
});

test('all six categories fit the explicit six-read budget, and a seventh read is refused', async () => {
  const f = harness({ reply: () => ({ type: 'readRequest', answer: null, changeProposal: null,
    readRequest: { name: 'memory.search', args: { query: '', limit: 8, cursor: null } } }) });
  assert.equal(f.setScope({ taskIds: ['task-a'], inboxIds: ['inbox-a'], routineIds: ['routine-a'], memoryIds: ['memory-a'],
    planningPreferences: true, focusSummary: true }).ok, true);
  const result = await f.run();
  assert.equal(result.reason, 'read-budget'); assert.equal(result.disclosure.usage.reads, 6); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].context.data.length, 6);
});

test('memory version fingerprints ignore usage counters but reject edits, pause, expiry, conflict, deletion and unavailable authority', async () => {
  const stable = harness(); stable.setScope({ memoryIds: ['memory-a'] });
  const first = await stable.run(); const refs = first.disclosure.sourceRefs;
  stable.records[0].useCount++; stable.records[0].lastUsedAt = AT;
  assert.equal(stable.reads.validateContextVersions(refs), true);
  assert.equal(memoryContextVersion(stable.records[0]), refs[0].revision);
  const mutations = [f => { f.records[0].version++; }, f => { f.records[0].status = 'paused'; },
    f => { f.records[0].expiresAt = AT + 1; f.setTime(AT + 2); }, f => { f.records[0].contextAllowed = false; },
    f => { f.records.shift(); }, f => { f.setLedgerAvailable(false); }, f => { f.state.settings.aiMemoryEnabled = false; }];
  for (const mutate of mutations) {
    const late = deferred(), f = harness({ reply: () => late.promise }); f.setScope({ memoryIds: ['memory-a'] });
    const entered = f.nextProviderEntry(), pending = f.run(); await entered; mutate(f); late.resolve(candidate());
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
    assert.equal(f.get().messages.filter(message => message.role === 'assistant').length, 0);
  }
});

test('memory is revalidated for each actual provider retry and usage writes never invalidate legitimate responses', async () => {
  const f = harness({ reply: (_count, _payload, options) => {
    f.records[0].status = 'paused'; options.beforeRequest(); return answer('Must not be accepted');
  } });
  f.setScope({ memoryIds: ['memory-a'] }); const stale = await f.run();
  assert.equal(stale.ok, false); assert.equal(stale.reason, 'target-changed'); assert.equal(stale.disclosure.usage.providerCalls, 1);
  const stable = harness({ reply: () => {
    stable.records[0].useCount++; stable.records[0].lastUsedAt = AT; return answer();
  } });
  stable.setScope({ memoryIds: ['memory-a'] });
  assert.equal((await stable.run()).ok, true); assert.equal(stable.counts().writes, 0);
});

test('planning preferences expire or change during await without an accepted stale response', async () => {
  for (const mutate of [f => { f.state.planningPreferences.items[0].version++; },
    f => { f.state.planningPreferences.items[0].scope = 'today'; f.state.planningPreferences.items[0].expiresAt = AT + 1; f.setTime(AT + 2); },
    f => { f.state.planningPreferences.items = []; }]) {
    const late = deferred(), f = harness({ reply: () => late.promise }); f.setScope({ planningPreferences: true });
    const entered = f.nextProviderEntry(), pending = f.run(); await entered; mutate(f); late.resolve(answer());
    const result = await pending; assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
  }
});

test('inert memory candidates use the closed four-field envelope and canonical actual-message provenance', async () => {
  const f = harness({ reply: candidate });
  const before = structuredClone(f.records), result = await f.run({ message: 'I prefer a small task in the morning.' });
  assert.equal(result.ok, true, result.reason); assert.equal(result.proposalKind, 'memory-candidate');
  const message = result.conversation.messages.at(-1), user = result.conversation.messages[0];
  assert.equal(message.proposal.kind, 'memory-candidate'); assert.deepEqual(JSON.parse(message.proposal.body), candidate().changeProposal);
  assert.deepEqual(message.sourceRefs, [{ kind: 'message', id: user.id, revision: null }]);
  assert.deepEqual(f.records, before); assert.equal(f.counts().writes, 0);
  for (const key of ['source', 'sourceRefs', 'confirmedAt', 'status', 'operation', 'id', 'version', 'consent']) {
    const forged = candidate(); forged.changeProposal.memoryCandidate[key] = true;
    assert.throws(() => validateCollaborationResult(forged));
  }
  for (const input of [{ kind: 'diagnosis' }, { scope: 'all-data' }, { expiresAt: Infinity }, { body: 'x'.repeat(501) }]) {
    const forged = candidate(); Object.assign(forged.changeProposal.memoryCandidate, input);
    assert.throws(() => validateCollaborationResult(forged));
  }
  const merged = candidate(); merged.changeProposal.operations = [{ type: 'task.create', input: { title: 'No mixed branches' } }];
  assert.throws(() => validateCollaborationResult(merged));
});

test('forgetting old raw user sources excludes their proposals, replies and summary derivations', async () => {
  const f = harness({ reply: count => count === 1 ? candidate() : answer(`Derived reply ${count}`) });
  await f.run({ message: 'PRIVATE_OLD_SOURCE morning preference.' });
  const sourceId = f.get().messages[0].id, proposalId = f.get().messages[1].proposal.id;
  for (let i = 0; i < 10; i++) assert.equal((await f.run({ message: `Neutral later message ${i}` })).ok, true);
  f.tombstones.add(sourceId);
  const result = await f.run({ message: 'A fresh unrelated question.', selectedProposalId: proposalId });
  assert.equal(result.ok, true, result.reason);
  const input = JSON.stringify(f.sent.at(-1));
  assert.equal(input.includes('PRIVATE_OLD_SOURCE'), false);
  assert.equal(input.includes('Morning planning'), false);
  assert.equal(input.includes('Derived reply'), false);
  assert.equal(f.sent.at(-1).context.summary?.selectedDraft, undefined);
  assert.equal(f.get().messages[0].content, 'PRIVATE_OLD_SOURCE morning preference.');
});

test('unavailable forgetting state permits the exact fresh user entry but rejects all older unresolved history', async () => {
  const f = harness(); await f.run({ message: 'PRIVATE_OLD_SOURCE' }); f.setLedgerAvailable(false);
  const result = await f.run({ message: 'Fresh message from the current user.' });
  assert.equal(result.ok, true, result.reason);
  assert.equal(f.sent.at(-1).context.messages.length, 1);
  assert.equal(f.sent.at(-1).context.messages[0].content, 'Fresh message from the current user.');
  assert.equal(f.sent.at(-1).context.summary, null);
});

test('forgetting or ledger failure during await rejects a late answer sourced from old raw user history', async () => {
  for (const ledgerFailure of [false, true]) {
    const late = deferred(), f = harness({ reply: count => count === 1 ? answer() : late.promise });
    await f.run({ message: 'PRIVATE_SOURCE' });
    const entered = f.nextProviderEntry(), pending = f.run({ message: 'Explain that earlier point.' }); await entered;
    if (ledgerFailure) f.setLedgerAvailable(false); else f.tombstones.add(f.get().messages[0].id);
    late.resolve(candidate()); const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.reason, 'context-forgotten');
    assert.equal(f.get().messages.filter(message => message.role === 'assistant').length, 1);
  }
});

test('memory local retrieval fails closed on malformed snapshots and planning/read schemas remain closed', () => {
  const malformed = createMemoryRecall({ contextReader: { readContextSnapshot: () => ({ ok: true }) } });
  assert.equal(malformed.discovery().ok, false);
  const f = harness();
  const grant = { id: 'grant', selection: { tools: TOOL_NAMES, taskIds: [], inboxIds: [], routineIds: [], memoryIds: [],
    planningPreferences: true, fromDay: '2026-10-04', toDay: '2026-10-04' } };
  for (const args of [{ sql: '*' }, { fields: ['effectScaleIds'] }, { sourceVersion: true }, { history: true }, { consent: true }]) {
    assert.equal(authorizeRead(grant, { name: 'planning.preferences.read', args }).ok, false);
    assert.throws(() => COLLABORATION_TASK.validateReadRequest({ name: 'planning.preferences.read', args }));
  }
  assert.equal(authorizeRead(grant, { name: 'memory.search', args: { limit: 9 } }).ok, false);
  assert.equal(authorizeRead(grant, { name: 'planning.preferences.read', args: {} }).ok, true);
  delete f.state.planningPreferences;
  const issued = f.grants.issue({ conversationId: f.opened.conversation.id, purpose: f.opened.conversation.purpose,
    providerId: f.provider.fingerprint, authorizationGeneration: f.get().authGeneration, selection: grant.selection });
  assert.equal(issued.ok, true);
  assert.equal(f.reads.execute({ grant: issued.grant, request: { name: 'planning.preferences.read', args: {} } }).availability, 'unavailable');
});

test('final send requalifies after successful or throwing usage observers on every attempt', async () => {
  const changes = [
    f => { f.records[0].version++; }, f => { f.records[0].status = 'paused'; },
    f => { f.records[0].expiresAt = AT + 1; f.setTime(AT + 2); },
    f => { f.records[0].contextAllowed = false; }, f => f.advanceLedger()
  ];
  for (const change of changes) for (const throws of [false, true]) for (const attempt of [1, 2]) {
    let observed = 0;
    const f = harness({ contextSent() {
      if (++observed !== attempt) return;
      change(f);
      if (throws) throw new Error('SYNTHETIC_PRIVATE_OBSERVER');
    }, reply: (_count, payload, options) => {
      options.beforeRequest(); f.sent.push(structuredClone(payload)); return answer();
    } });
    assert.equal(f.setScope({ memoryIds: ['memory-a'] }).ok, true);
    const result = await f.run();
    assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
    assert.equal(result.disclosure.usage.providerCalls, attempt, 'attempt bookkeeping remains charged');
    assert.equal(f.sent.length, attempt - 1, 'failed final qualification never reaches fake POST');
    assert.equal(f.get().messages.filter(item => item.role === 'assistant').length, 0);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_OBSERVER|SYNTHETIC_PRIVATE_LEDGER/);
  }
});

test('usage counter changes inside the observation callback stay committed without invalidating recall', async () => {
  let observations = 0;
  const f = harness({ contextSent(_refs, records) {
    observations++; records[0].useCount++; records[0].lastUsedAt = AT;
    if (observations === 1) throw new Error('observation failed after committed usage');
  }, reply: (_count, payload, options) => {
    options.beforeRequest(); f.sent.push(structuredClone(payload)); return answer();
  } });
  f.setScope({ memoryIds: ['memory-a'] });
  const result = await f.run();
  assert.equal(result.ok, true); assert.equal(result.disclosure.usage.providerCalls, 2);
  assert.equal(result.disclosure.usage.reads, 1); assert.equal(f.sent.length, 2);
  assert.equal(f.records[0].useCount, 2); assert.equal(f.records[0].version, 1);
  assert.equal(f.counts().versionReads, 0); assert.equal(f.counts().writes, 0);
});
