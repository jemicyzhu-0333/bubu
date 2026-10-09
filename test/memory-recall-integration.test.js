'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createConversationAccess } = require('../src/application/ai/conversation-access');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { createMemoryManagement } = require('../src/bootstrap/memory-management');
const { createMemoryRecallFixture } = require('../test-support/memory-recall-fixture');
const { buildCollaborationContext } = require('../src/application/ai/collaboration-context');
const { normalizeRunBudget } = require('../src/application/ai/run-budget');
const record = (id, extras = {}) => ({ id, version: 1, status: 'active', kind: 'preference',
  subject: id === 'a' ? 'MATCH literal 中文' : 'different', body: `SYNTHETIC_BODY_${id}`,
  source: 'user-confirmed', scope: 'work', validFrom: 0, expiresAt: null,
  contextAllowed: true, updatedAt: 0, ...extras });
const answer = () => ({ type: 'answer', answer: 'A small next step.', readRequest: null, changeProposal: null });
function fixture(options = {}) {
  let at = 1000, serial = 0, sequence = 0, healthy = true, snapshotCalls = 0;
  let api;
  const records = [record('a'), record('b')], posts = [], timers = new Map(), effects = [];
  const now = () => at;
  const state = { settings: { aiMemoryEnabled: true }, tasks: [], impulses: [], routines: [] };
  const { contextReader, memoryRecall } = createMemoryRecallFixture({ records: () => records, now,
    available: () => healthy, authority: () => ({ ownerId: 'memory-owner', ledgerId: 'PRIVATE_LEDGER_TOKEN', sequence }),
    onSnapshot(request) { snapshotCalls++; if (options.snapshot) options.snapshot(request, api); },
    onForgetting() { if (options.forgetting) options.forgetting(api); } });
  const grants = createContextGrants({ ownerId: 'owner', now: () => {
    if (api && options.grantClock) options.grantClock(api); return at;
  }, idFactory: () => `grant-${++serial}` });
  const sessions = createCollaborationSessions({ ownerId: 'owner', now, idFactory: () => `session-${++serial}`,
    schedule(callback) { const id = ++serial; timers.set(id, callback); return id; },
    cancelSchedule: id => timers.delete(id) });
  const reads = createContextReads({ grants, memoryRecall, now, readSnapshot: () => {
    if (api && options.stateRead) options.stateRead(api); return state;
  } });
  const provider = { fingerprint: 'synthetic-provider', enabled: true, configured: true, purposeAllowed: true,
    model: 'synthetic', endpoint: 'https://synthetic.invalid', client: { async run(_task, payload, controls) {
      const post = () => { controls.beforeRequest(); posts.push(structuredClone(payload)); };
      post(); return options.reply ? options.reply({ post, payload, controls }, api) : answer();
    } } };
  const access = createConversationAccess({ sessions, grants, reads, memoryRecall, now,
    readSnapshot: () => state, getProvider: () => provider });
  const opened = access.start({ purpose: 'stuck', mode: 'talk', retentionMode: 'ephemeral' });
  assert.equal(opened.ok, true);
  let scope = opened;
  // Wrap only the completion hook; the actual registry and witness are always used.
  const turnReads = { ...reads, prepareMemorySelection(request, invokeOwnedSource) {
    if (options.enterPhase) options.enterPhase('prepare', api);
    const prepared = reads.prepareMemorySelection(request, invokeOwnedSource);
    return prepared.ok ? { ok: true, validate(owner) {
      if (options.enterPhase) options.enterPhase('validate', api);
      return prepared.validate(owner);
    } } : prepared;
  }, execute(request, invokeOwnedSource) {
    if (options.enterPhase) options.enterPhase('execute', api);
    const result = reads.execute(request, invokeOwnedSource);
    if (options.afterRead) options.afterRead(result, api);
    return result;
  } };
  const turns = createCollaborationTurns({ sessions, grants, reads: turnReads, now,
    schedule(callback) { const id = ++serial; timers.set(id, callback); return id; },
    cancelSchedule: id => timers.delete(id), getProvider: () => provider,
    validateContextVersions: reads.validateContextVersions,
    isContextMessageAllowed(message, context) { return options.messageAllowed ? options.messageAllowed(message, context, api) : true; },
    onContextSent(refs) { if (options.contextSent) options.contextSent(refs, api); } });
  const poison = name => () => { effects.push(name); throw new Error(`Forbidden management ${name}`); };
  const service = { contextReader, available: true, list: poison('list'), getVersion: poison('getVersion'),
    forgettingState: poison('forgettingState'), usage: poison('usage'), search: poison('search'),
    preview: poison('preview'), confirm: poison('confirm') };
  api = { records, posts, effects, timers, state, reads, grants, sessions, access, turns, provider,
    contextReader, memoryRecall, service, opened,
    setScope(ids) { const result = access.setScope({ conversationId: opened.conversation.id, memoryIds: ids });
      assert.equal(result.ok, true, result.reason); scope = result; return result; },
    grant() { return grants.resolve({ conversationId: opened.conversation.id, scopeGrantId: scope.scopeGrantId,
      providerId: provider.fingerprint, authorizationGeneration: this.conversation().authGeneration }).grant; },
    conversation: () => sessions.get({ conversationId: opened.conversation.id }).conversation,
    run: () => turns.run({ conversationId: opened.conversation.id, scopeGrantId: scope.scopeGrantId, message: 'Help me start.' }),
    advance: value => { at += value; }, advanceLedger: () => { sequence++; },
    unavailable: () => { healthy = false; }, snapshotCalls: () => snapshotCalls };
  return api;
}

test('full explicit selection witness rejects a non-hit drift without inventing read provenance', async () => {
  const f = fixture(); f.setScope(['a', 'b']);
  const grant = f.grant(), witness = f.reads.prepareMemorySelection({ grant });
  assert.deepEqual(Object.keys(witness).sort(), ['ok', 'validate']);
  const result = f.reads.execute({ grant, request: { name: 'memory.search', args: { query: 'MATCH', limit: 1 } } });
  assert.deepEqual(result.items.map(item => item.id), ['a']);
  assert.deepEqual(result.sourceRefs.map(item => item.id), ['a']);
  assert.deepEqual(result.disclosure.sourceIds, ['a']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_LEDGER_TOKEN|SYNTHETIC_BODY_b|authority|witness/);
  const built = buildCollaborationContext({ conversation: f.conversation(), grant, data: [result],
    limits: normalizeRunBudget() });
  assert.equal(built.ok, true);
  const fakePayloads = [];
  const fakeProvider = { async run(_task, payload, controls) {
    controls.beforeRequest(); fakePayloads.push(structuredClone(payload)); return answer();
  } };
  await fakeProvider.run('collaborate', built.payload, { beforeRequest() {
    assert.equal(witness.validate().ok, true);
  } });
  assert.deepEqual(fakePayloads[0].availableReads.memoryIds, ['a', 'b']);
  assert.deepEqual(fakePayloads[0].context.data[0].sourceRefs.map(ref => ref.id), ['a']);
  assert.deepEqual(built.sourceRefs.map(ref => ref.id), ['a']);
  assert.doesNotMatch(JSON.stringify(fakePayloads), /PRIVATE_LEDGER_TOKEN|SYNTHETIC_BODY_b|"authority"|"witness"/);
  f.records[1].version++;
  assert.equal(witness.validate().ok, false);
  assert.equal(witness.validate().ok, false, 'validation must not silently renew its baseline');
  assert.deepEqual(f.effects, []);
});

test('witness validates semantic eligibility and ledger identity, ignoring usage counters', () => {
  const changes = [f => { f.records[1].version++; }, f => { f.records[1].status = 'paused'; },
    f => { f.records[1].expiresAt = 1001; f.advance(2); }, f => { f.records[1].contextAllowed = false; },
    f => { f.records.pop(); }, f => f.advanceLedger(), f => f.unavailable(),
    f => { f.state.settings.aiMemoryEnabled = false; }];
  for (const change of changes) {
    const f = fixture(); f.setScope(['a', 'b']);
    const witness = f.reads.prepareMemorySelection({ grant: f.grant() }); assert.equal(witness.ok, true);
    f.records[1].useCount = 100; f.records[1].lastUsedAt = 1000;
    assert.deepEqual(witness.validate(), { ok: true });
    change(f); assert.equal(witness.validate().ok, false); assert.deepEqual(f.effects, []);
  }
});

test('empty selection avoids discovery and a forged selection cannot widen the private witness', () => {
  const empty = fixture(), before = empty.snapshotCalls();
  assert.equal(empty.reads.prepareMemorySelection({ grant: empty.grant() }).validate().ok, true);
  assert.equal(empty.snapshotCalls(), before);
  const f = fixture(); f.setScope(['a']);
  const forged = structuredClone(f.grant()); forged.selection.memoryIds.push('b');
  const witness = f.reads.prepareMemorySelection({ grant: forged });
  f.records[1].version++;
  assert.equal(witness.validate().ok, true);
  f.records[0].version++;
  assert.equal(witness.validate().ok, false);
});

test('full-set budget and eligibility cannot be hidden by Provider query, cursor or limit', () => {
  for (const change of [f => { f.records[1].status = 'paused'; }, f => {
    f.records[0].body = '🙂'.repeat(500); f.records[1].body = 'x'.repeat(500);
    f.records[2].body = 'x'.repeat(201);
  }]) {
    const f = fixture(); f.records.push(record('c', { body: 'x'.repeat(200) })); f.setScope(['a', 'b', 'c']);
    const grant = f.grant(); change(f);
    const result = f.reads.execute({ grant, request: { name: 'memory.search', args: { query: 'MATCH', cursor: 'offset:1', limit: 1 } } });
    assert.equal(result.ok, false);
    assert.ok(['memory-context-invalid', 'memory-context-budget'].includes(result.reason));
  }
});

test('read completion, retry and provider return recheck the original witness before acceptance', async () => {
  for (const stage of ['read', 'retry', 'return']) {
    let changed = false;
    const change = f => { if (!changed) { changed = true; f.records[1].version++; } };
    const f = fixture({ afterRead(_result, api) { if (stage === 'read') change(api); },
      reply({ post }, api) { change(api); if (stage === 'retry') post(); return answer(); } });
    f.setScope(['a', 'b']);
    const result = await f.run();
    assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
    assert.equal(f.posts.length, stage === 'read' ? 0 : 1);
    assert.equal(f.conversation().messages.filter(item => item.role === 'assistant').length, 0);
    assert.equal(f.timers.size, 0); assert.deepEqual(f.effects, []);
  }
});

test('successful fake transport and stored messages do not disclose private witness or unselected sources', async () => {
  const f = fixture(); f.setScope(['a']);
  const result = await f.run(); assert.equal(result.ok, true, result.reason);
  const serialized = JSON.stringify({ payloads: f.posts, result, stored: f.conversation() });
  assert.doesNotMatch(serialized, /PRIVATE_LEDGER_TOKEN|memory-owner|SYNTHETIC_BODY_b|"authority"|"validate"|"witness"/);
  assert.deepEqual(result.disclosure.sourceRefs.map(ref => ref.id), ['a']);
  assert.equal(result.disclosure.usage.reads, 1); assert.equal(result.disclosure.usage.providerCalls, 1);
  assert.deepEqual(f.effects, []); assert.equal(f.timers.size, 0);
});

function managementFixture(f, hooks = {}) {
  let previewCalls = 0, commits = 0, drains = 0;
  const lifecycleCalls = [], callbacks = new Map();
  const service = { ...f.service, candidateStatus: () => ({ ok: true }),
    previewReviewedCandidate(request, origin) {
      previewCalls++;
      return { ok: true, preview: { previewId: 'preview-1', candidateOrigin: origin, ...request } };
    },
    confirmReviewed(_payload, check) {
      const allowed = check({ candidateOrigin: { proposalId: 'proposal-1' } });
      if (!allowed.ok) return allowed;
      commits++; return { ok: true };
    } };
  const authority = { service, onInvalidate: () => () => {}, close() {},
    drain() { drains++; return { ok: true, delivered: 0 }; } };
  const management = createMemoryManagement({ authority,
    collaboration: { sessions: { ...f.sessions, get(request) {
      if (hooks.sessionGet) hooks.sessionGet(); return f.sessions.get(request);
    } }, reads: f.reads, invalidateScopes() {} }, now: () => 1000,
    lifecycle: { register(name) { lifecycleCalls.push(name); },
      interval(name, callback, delay) { lifecycleCalls.push([name, delay]); callbacks.set(name, callback); },
      timeout(name, callback, delay) { lifecycleCalls.push([name, delay]); callbacks.set(name, callback); } } });
  return { management, callbacks, lifecycleCalls, counts: () => ({ previewCalls, commits, drains }) };
}

test('historical messages and reviewed targets reject null-expiry aggregate projections', async () => {
  for (const sourceType of ['aggregated', 'legacy-aggregated']) {
    const f = fixture({ reply: () => ({ type: 'changeProposal', answer: 'Review this change.', readRequest: null,
      changeProposal: { memoryChange: { operation: 'update', id: 'a', input: {
        kind: 'preference', subject: 'Next step', body: 'Start with a fact.', scope: 'work', expiresAt: null } } } }) });
    f.setScope(['a']); const result = await f.run(); assert.equal(result.ok, true);
    const g = managementFixture(f), message = f.conversation().messages.at(-1);
    const request = { conversationId: f.opened.conversation.id, proposalId: message.proposal.id };
    assert.equal(g.management.isContextMessageAllowed(message, request), true);
    assert.equal(g.management.previewProposal(request).ok, true);
    // M1 projects legacy aggregated lineage as source='aggregated'; sourceType is management-only.
    f.records[0].source = 'aggregated'; f.records[0].sourceType = sourceType;
    assert.equal(f.records[0].expiresAt, null);
    assert.equal(f.memoryRecall.getVersion({ id: 'a' }).ok, false);
    assert.equal(g.management.isContextMessageAllowed(message, request), false);
    assert.equal(g.management.previewProposal(request).ok, false);
    assert.equal(g.management.confirm({ previewId: 'preview-1' }).ok, false);
    assert.deepEqual(g.counts(), { previewCalls: 1, commits: 0, drains: 0 });
    assert.deepEqual(f.effects, []);
  }
});

test('management startup and 30-second drains remain outside recall, with no implicit maintenance', () => {
  const f = fixture(), g = managementFixture(f);
  assert.deepEqual(g.lifecycleCalls, ['memory:authority', ['timer:memory-outbox', 30000], ['timer:memory-outbox-startup', 0]]);
  f.memoryRecall.discovery(); f.memoryRecall.selected(['a']);
  f.memoryRecall.getVersion({ id: 'a' }); f.memoryRecall.forgettingState();
  assert.equal(g.counts().drains, 0); assert.deepEqual(f.effects, []);
  g.callbacks.get('timer:memory-outbox-startup')(); g.callbacks.get('timer:memory-outbox')();
  assert.equal(g.counts().drains, 2);
});

test('memory snapshot callback replacement cannot revoke or cancel the newer run owner', async () => {
  let armed = false, replacement;
  const f = fixture({ snapshot(_request, api) {
    if (!armed) return;
    armed = false; api.provider.enabled = false; replacement = api.run();
  } });
  f.setScope(['a', 'b']); armed = true;
  const old = await f.run(), current = await replacement;
  assert.equal(old.ok, false); assert.equal(current.ok, true, current.reason);
  assert.equal(current.source, 'local'); assert.equal(f.posts.length, 0);
  assert.equal(f.conversation().messages.filter(item => item.role === 'assistant').length, 1);
  assert.notEqual(f.conversation().status, 'canceled'); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.effects, []);
});

test('final fake POST stays blocked after semantic observation changes, including swallowed exceptions and retries', async () => {
  for (const attempt of [1, 2]) for (const throws of [false, true]) {
    let observations = 0;
    const f = fixture({ contextSent(_refs, api) {
      if (++observations !== attempt) return;
      api.records[1].version++;
      if (throws) throw new Error('PRIVATE_OBSERVATION_ERROR');
    }, reply: ({ post }) => { post(); return answer(); } });
    f.setScope(['a', 'b']); const result = await f.run();
    assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
    assert.equal(result.disclosure.usage.providerCalls, attempt);
    assert.equal(f.posts.length, attempt - 1);
    assert.equal(f.conversation().messages.filter(item => item.role === 'assistant').length, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OBSERVATION_ERROR|PRIVATE_LEDGER_TOKEN/);
    assert.deepEqual(f.effects, []); assert.equal(f.timers.size, 0);
  }
});

test('committed usage-only observation remains harmless across every fake POST and thrown callback', async () => {
  const f = fixture({ contextSent(_refs, api) {
    api.records[0].useCount = (api.records[0].useCount || 0) + 1;
    api.records[0].lastUsedAt = 1000;
    throw new Error('PRIVATE_USAGE_OBSERVATION');
  }, reply: ({ post }) => { post(); return answer(); } });
  f.setScope(['a']); const result = await f.run();
  assert.equal(result.ok, true); assert.equal(f.posts.length, 2);
  assert.equal(f.records[0].useCount, 2); assert.equal(f.records[0].version, 1);
  assert.equal(result.disclosure.usage.reads, 1); assert.equal(result.disclosure.usage.providerCalls, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_USAGE_OBSERVATION|PRIVATE_LEDGER_TOKEN/);
  assert.deepEqual(f.effects, []); assert.equal(f.timers.size, 0);
});

test('target-version snapshot replacement suppresses the later memory reader and old-run effects', async () => {
  let armed = false, replaced = false, replacement, readsAtReplacement;
  const f = fixture({ contextSent() { if (!replaced) armed = true; }, stateRead(api) {
    if (!armed) return;
    armed = false; replaced = true; readsAtReplacement = api.snapshotCalls();
    api.provider.enabled = false; replacement = api.run();
  } });
  f.setScope(['a', 'b']); const old = await f.run(), current = await replacement;
  assert.equal(replaced, true); assert.equal(old.ok, false); assert.equal(current.ok, true);
  assert.equal(current.source, 'local'); assert.equal(f.posts.length, 0);
  assert.equal(f.snapshotCalls(), readsAtReplacement, 'old version lookup never reaches the later reader');
  assert.equal(f.conversation().messages.filter(item => item.role === 'assistant').length, 1);
  assert.notEqual(f.conversation().status, 'canceled'); assert.equal(f.timers.size, 0);
});

test('historical-message owner fencing stops after ledger or session callback replacement', async () => {
  for (const stage of ['ledger', 'session']) {
    let armed = false, replaced = false, replacement, readsAtReplacement, sessionReads = 0, sessionsAtReplacement;
    let management;
    const replace = api => {
      armed = false; replaced = true; readsAtReplacement = api.snapshotCalls(); sessionsAtReplacement = sessionReads;
      api.provider.enabled = false; replacement = api.run();
    };
    const f = fixture({ forgetting(api) { if (armed && stage === 'ledger') replace(api); },
      messageAllowed(message, context) {
        return management ? management.isContextMessageAllowed(message, context) : true;
      } });
    f.setScope(['a']); assert.equal((await f.run()).ok, true);
    const g = managementFixture(f, { sessionGet() { sessionReads++; if (armed && stage === 'session') replace(f); } });
    management = g.management;
    armed = true; const beforePosts = f.posts.length;
    const old = await f.run(), current = await replacement;
    assert.equal(replaced, true); assert.equal(old.ok, false); assert.equal(current.ok, true);
    assert.equal(current.source, 'local'); assert.equal(f.posts.length, beforePosts);
    assert.equal(f.snapshotCalls(), readsAtReplacement, 'no later recursive memory version read');
    assert.equal(sessionReads, sessionsAtReplacement, 'ledger callback cannot proceed to the session source');
    assert.notEqual(f.conversation().status, 'canceled'); assert.equal(f.timers.size, 0);
  }
});

test('same-grant owner replacement inside recall authority or snapshot stops before later M1 access', async () => {
  for (const phase of ['prepare', 'validate', 'execute']) for (const boundary of ['grant', 'snapshot']) {
    let armed = false, replaced = false, replacement, readsAtReplacement;
    const replace = api => {
      if (!armed || replaced) return;
      armed = false; replaced = true; readsAtReplacement = api.snapshotCalls();
      api.provider.enabled = false; replacement = api.run();
    };
    const f = fixture({ enterPhase(value) { if (!replaced && value === phase) armed = true; },
      grantClock(api) { if (boundary === 'grant') replace(api); },
      stateRead(api) { if (boundary === 'snapshot') replace(api); } });
    f.setScope(['a', 'b']); const old = await f.run(), current = await replacement;
    assert.equal(replaced, true, `${phase}/${boundary}`);
    assert.equal(old.ok, false); assert.equal(current.ok, true, current.reason);
    assert.equal(current.source, 'local'); assert.equal(f.posts.length, 0);
    assert.equal(f.snapshotCalls(), readsAtReplacement, `${phase}/${boundary}: no later M1 access`);
    assert.equal(f.conversation().messages.filter(item => item.role === 'assistant').length, 1);
    assert.notEqual(f.conversation().status, 'canceled'); assert.equal(f.timers.size, 0);
  }
});
