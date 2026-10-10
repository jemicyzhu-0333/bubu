'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { createCollaborationAuthorization } = require('../src/application/ai/collaboration-authorization');
const { createApiClient } = require('../src/core/llm');
const { entityFingerprint } = require('../src/application/ai/entity-fingerprint');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { prepareEmptyMemorySelection } = require('../test-support/memory-recall-fixture');

const answer = text => ({ type: 'answer', answer: text || '可以接着聊。', readRequest: null, changeProposal: null });
const draft = () => ({ type: 'changeProposal', answer: '先只打开文件，之后还可以继续聊。', readRequest: null,
  changeProposal: { title: '报告', steps: [{ title: '打开报告文件', dependsOn: null, safeStopAfter: true }],
    estimateMinutes: 2, energy: null, notes: null } });
const read = (name = 'task.read', args = { id: 'task-1', fields: ['id', 'title', 'steps'] }) => (
  { type: 'readRequest', answer: null, readRequest: { name, args }, changeProposal: null }
);
const nextTick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(options = {}) {
  let at = 1000, grantIndex = 0;
  const now = () => at;
  const admission = createCollaborationAuthorization({ capturePrivacyTargets: () => sessions.capturePrivacyTargets(),
    captureScopes: () => [], captureRunOwners: () => turns.captureRunOwners(), clearGrants: () => grants.clear(),
    revokeSession: conversationId => sessions.revoke({ conversationId }) });
  const sessions = createCollaborationSessions({ ownerId: 'owner', now, admission,
    idFactory: (sequence, kind) => `${kind}-${sequence}`, repository: options.repository || null });
  const started = sessions.start({ purpose: 'stuck', mode: options.mode || 'small-step',
    relatedEntity: options.noTarget ? null : { kind: 'task', id: 'task-1', version: null } });
  const conversationId = started.conversation.id;
  const grants = createContextGrants({ ownerId: 'owner', now, admission, idFactory: kind => `${kind}-${++grantIndex}` });
  const tasks = [{ id: 'task-1', title: '报告', steps: [], done: false },
    { id: 'private-task', title: '不得外发', steps: [], done: false }];
  const reads = createContextReads({ grants, readSnapshot: () => ({ tasks, settings: { aiMemoryEnabled: false }, routineLog: [{ secret: true }] }),
    timeline: options.timeline });
  const sent = [];
  const provider = { enabled: options.enabled !== false, configured: options.configured !== false,
    fingerprint: 'provider-1', model: 'test-model', endpoint: 'https://provider.example/v1',
    client: { async run(name, payload, controls) {
      controls.beforeRequest();
      assert.equal(name, 'collaborate');
      sent.push(structuredClone(payload));
      return options.reply ? options.reply(sent.length, payload, controls) : answer();
    } } };
  const selection = { tools: ['task.read'], taskIds: ['task-1'], fromDay: '2026-10-01', toDay: '2026-10-04', ...options.selection };
  const issued = grants.issue({ conversationId, purpose: 'stuck', providerId: provider.fingerprint,
    authorizationGeneration: started.conversation.authGeneration, selection });
  assert.equal(issued.ok, true);
  const turns = createCollaborationTurns({ sessions, grants,
    reads: options.reads ? { prepareMemorySelection: prepareEmptyMemorySelection, ...options.reads } : reads, admission,
    getProvider: () => ({ ...provider }), now,
    validateContextVersions: options.validateContextVersions || (refs => refs.every(ref => {
      if (ref.kind !== 'task') return true;
      const task = tasks.find(item => item.id === ref.id);
      return Boolean(task && entityFingerprint(task) === ref.revision);
    })), limits: options.limits, schedule: options.schedule, cancelSchedule: options.cancelSchedule });
  const run = message => turns.run({ conversationId, message: message || '报告不知道怎么开始', scopeGrantId: issued.grant.id });
  return { sessions, grants, reads, tasks, provider, turns, run, sent, conversationId, scopeGrantId: issued.grant.id,
    get: () => sessions.get({ conversationId }).conversation, advance: milliseconds => { at += milliseconds; } };
}

test('canonical history includes every answer and inert draft; conversations continue past 7 and 31', async () => {
  const f = fixture({ mode: 'talk', reply: count => count === 1 ? draft() : answer(`回答 ${count}`) });
  for (let index = 0; index < 35; index++) {
    const result = await f.run(`消息 ${index}`);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'provider');
  }
  const history = f.get().messages;
  assert.equal(history.length, 70);
  assert.deepEqual(JSON.parse(history[1].proposal.body), draft().changeProposal);
  assert.equal(history[1].proposal.kind, 'task-draft');
  assert.deepEqual(history[1].provenance, { source: 'provider', reason: null, providerId: 'provider-1' });
  assert.equal(history.filter(message => message.role === 'assistant').length, 35);
  assert.equal(f.sent.at(-1).context.messages.length, 12);
  assert.ok(f.sent.at(-1).context.summary.selectedDraft);
  assert.equal(f.sent.at(-1).context.messages.at(-1).content, '消息 34');
});

test('selected reads are bounded and disclosure records real payload fields and references', async () => {
  const f = fixture({ reply: count => count === 1 ? read() : draft() });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.disclosure.usage.reads, 2);
  assert.equal(result.disclosure.usage.providerCalls, 2);
  assert.equal(result.disclosure.tokenUsage, null);
  assert.deepEqual(result.disclosure.reads[1].fields, ['id', 'title', 'steps']);
  assert.equal(f.sent[0].context.data[0].items[0].title, '报告');
  assert.equal(result.disclosure.sourceRefs[0].id, 'task-1');
  assert.equal(result.conversation.messages.at(-1).sourceRefs[0].id, 'task-1');
  assert.equal(f.sent[1].context.data[0].trust, 'untrusted-data');
  assert.doesNotMatch(JSON.stringify(f.sent), /不得外发|routineLog|secret/);
});

test('activity unavailable stays unavailable and does not masquerade as no activity', async () => {
  const f = fixture({ selection: { tools: ['activity.distribution'], taskIds: [] },
    reply: count => count === 1 ? read('activity.distribution', { fromDay: '2026-10-01', toDay: '2026-10-04' }) : answer() });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.sent[1].context.data[0].availability, 'unavailable');
  assert.equal(result.disclosure.reads[0].coverage.basis, 'unavailable');
});

test('unknown model write fields are rejected with useful local draft and no business writes', async () => {
  const f = fixture({ reply: () => ({ ...draft(), commit: true }) });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'local');
  assert.equal(result.reason, 'provider-invalid-output');
  assert.equal(result.providerReason, 'provider-invalid-output|collaboration envelope contains unknown or missing fields');
  assert.equal(result.conversation.messages.at(-1).provenance.reason, 'provider-invalid-output');
  assert.equal(Object.hasOwn(result.conversation.messages.at(-1), 'providerReason'), false);
  assert.equal(result.conversation.messages.at(-1).proposal.kind, 'task-draft');
  assert.doesNotMatch(result.answer, /已应用|已保存/);
});

test('native collaboration repair exposes safe structural detail only in the current response', async () => {
  const f = fixture();
  let posts = 0;
  f.provider.client = createApiClient({ baseUrl: 'https://synthetic-provider.example.test/v1', model: 'synthetic-model',
    getCredential: () => 'synthetic-credential', post: async (_endpoint, body) => {
      posts += 1;
      const value = draft();
      if (posts <= 2) value.changeProposal.steps[0].safeStopAfter = false;
      if (posts === 2) assert.match(body.messages.at(-1).content, /collaboration-step-final-stop-required/);
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    } });
  const result = structuredClone(await f.run('PRIVATE_USER_MESSAGE'));
  assert.equal(posts, 2);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'provider-invalid-output');
  assert.equal(result.providerReason, 'provider-invalid-output|collaboration-step-final-stop-required');
  assert.deepEqual(f.get().messages.at(-1).provenance, { source: 'local', reason: 'provider-invalid-output', providerId: null });
  assert.doesNotMatch(JSON.stringify(f.get()), /collaboration-step-final-stop-required|providerReason|synthetic-credential/);
  const next = await f.run('Next message');
  assert.equal(next.source, 'provider');
  assert.equal(Object.hasOwn(next, 'providerReason'), false);
});

test('collaboration does not trust forged validation stages or execute diagnostic getters', async () => {
  let getterCalls = 0;
  const getter = {};
  for (const key of ['message', 'stage']) Object.defineProperty(getter, key, { get() { getterCalls += 1; throw new Error('PRIVATE_GETTER'); } });
  for (const error of [
    Object.assign(new Error('PRIVATE_PROVIDER_BODY'), { stage: 'validate' }),
    Object.assign(new Error('collaboration-step-final-stop-required'), { stage: 'validate' }), getter
  ]) {
    const f = fixture({ mode: 'talk', reply: () => { throw error; } });
    const result = await f.run('A normal message');
    assert.equal(result.ok, true); assert.equal(result.source, 'local');
    assert.equal(Object.hasOwn(result, 'providerReason'), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|collaboration-step-final-stop-required/);
  }
  assert.equal(getterCalls, 0);
});

test('cancellation with a hostile diagnostic getter keeps cancellation priority and never evaluates it', async () => {
  let getterCalls = 0, f;
  const error = {};
  Object.defineProperty(error, 'message', { get() { getterCalls += 1; throw new Error('PRIVATE_GETTER'); } });
  f = fixture({ reply: () => {
    f.sessions.cancel({ conversationId: f.conversationId, inputDraft: 'Keep this draft' });
    throw error;
  } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'turn-canceled');
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(result, 'providerReason'), false);
  assert.equal(f.get().messages.filter(message => message.role === 'assistant').length, 0);
});

test('cross-target reads and ungranted registered tools never execute', async () => {
  for (const request of [read('task.read', { id: 'private-task', fields: ['title'] }), read('energy.read', {})]) {
    let count = 0;
    const f = fixture({ noTarget: true, selection: { taskIds: [] }, reply: () => request, reads: { execute() { count++; throw new Error('should not execute'); } } });
    const result = await f.run();
    assert.equal(count, 0);
    assert.equal(result.source, 'local');
    assert.match(result.reason, /tool-.*authorized/);
  }
});

test('four-read limit and five-provider limit bound one entire turn', async () => {
  const f = fixture({ limits: { maxReadCalls: 4 }, reply: () => read() });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'local');
  assert.equal(result.reason, 'read-budget');
  assert.equal(result.disclosure.usage.reads, 4);
  assert.equal(result.disclosure.usage.providerCalls, 4);
  assert.equal(f.sent.length, 4);
});

test('revoking grant during provider await rejects late answer without local accepted fallback', async () => {
  const late = deferred();
  const f = fixture({ reply: () => late.promise });
  const pending = f.run();
  await nextTick();
  f.grants.revoke(f.conversationId);
  late.resolve(draft());
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scope-grant-invalid');
  assert.equal(f.get().messages.length, 1);
  assert.equal(f.get().requiresAuthorization, true);
});

test('provider switch or settings disable during await rejects late result and invalidates authorization', async () => {
  for (const change of [f => { f.provider.fingerprint = 'provider-2'; }, f => { f.provider.enabled = false; }]) {
    const late = deferred();
    const f = fixture({ reply: () => late.promise });
    const pending = f.run();
    await nextTick();
    change(f);
    late.resolve(answer());
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.reason, /provider-changed|authorization-changed/);
    assert.equal(f.get().messages.length, 1);
  }
});

test('grant revocation during initial selected read await prevents every model call', async () => {
  const late = deferred();
  const f = fixture({ noTarget: true, reply: () => read(), reads: { execute: () => late.promise } });
  const pending = f.run();
  await nextTick();
  f.grants.revoke(f.conversationId);
  late.resolve({ ok: true, items: [{ private: true }] });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(f.sent.length, 0);
  assert.equal(f.get().messages.length, 1);
});

test('cancel settles even if provider ignores abort; canceled and late answers stay out of history', async () => {
  const late = deferred();
  const f = fixture({ reply: () => late.promise });
  const pending = f.run();
  await nextTick();
  f.sessions.cancel({ conversationId: f.conversationId, inputDraft: '还没说完' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'turn-canceled');
  late.resolve(draft());
  await nextTick();
  assert.equal(f.get().messages.length, 1);
  assert.equal(f.get().inputDraft, '还没说完');
});

test('single injected deadline settles uncooperative transport and blocks late completion', async () => {
  const late = deferred();
  let deadline, scheduledMs, canceled = false;
  const f = fixture({ reply: () => late.promise, schedule: (callback, milliseconds) => {
    deadline = callback; scheduledMs = milliseconds; return 1;
  }, cancelSchedule: () => { canceled = true; } });
  const pending = f.run();
  await nextTick();
  assert.equal(scheduledMs, 180000);
  f.advance(180000);
  deadline();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'turn-deadline');
  assert.equal(canceled, true);
  late.resolve(draft());
  await nextTick();
  assert.equal(f.get().messages.length, 1);
});

test('AI disabled or not configured retains useful local path without reading or transmitting', async () => {
  for (const configuration of [{ enabled: false }, { configured: false }]) {
    const f = fixture(configuration);
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(result.source, 'local');
    assert.ok(result.proposal);
    assert.equal(result.conversation.messages.at(-1).provenance.source, 'local');
    assert.equal(result.conversation.messages.at(-1).provenance.providerId, null);
    assert.equal(result.disclosure.provider, null);
    assert.deepEqual(result.disclosure.fields, []);
    assert.deepEqual(result.disclosure.sourceRefs, []);
    assert.equal(f.sent.length, 0);
  }
  const talking = fixture({ enabled: false, mode: 'talk' });
  assert.equal((await talking.run()).proposal, null);
});

test('ephemeral turns do not save transcript and input bounds count Unicode code points', async () => {
  let saved = 0;
  const f = fixture({ repository: { load: () => ({ ok: false }), saveSnapshot: () => { saved++; return { ok: true }; } } });
  assert.equal((await f.run('🙂'.repeat(8000))).ok, true);
  assert.equal(f.sent[0].context.messages.at(-1).content, '🙂'.repeat(8000));
  assert.equal((await f.run('🙂'.repeat(8001))).reason, 'message-too-long');
  assert.equal(f.get().messages.length, 2);
  assert.equal(saved, 0);
});

test('actual native provider negotiation and validation retries all consume same budget', async () => {
  const f = fixture({ limits: { maxProviderCalls: 2 } });
  let calls = 0;
  f.provider.client = createApiClient({ model: 'test', baseUrl: 'https://provider.example/v1', getCredential: () => 'test-only',
    post: async () => {
      calls++;
      if (calls === 1) throw new ProviderHttpError(400, 'response_format unsupported');
      return { choices: [{ message: { content: JSON.stringify({ ...answer(), evil: true }) } }] };
    } });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'local');
  assert.equal(result.reason, 'provider-budget');
  assert.equal(calls, 2);
  assert.equal(result.disclosure.usage.providerCalls, 2);
  assert.deepEqual(result.disclosure.fields, ['mode', 'context', 'availableReads']);
});

test('native raw provider output bound holds before parsing or repair retries', async () => {
  const f = fixture({ limits: { maxOutputChars: 100 } });
  let calls = 0;
  f.provider.client = createApiClient({ model: 'test', baseUrl: 'https://provider.example/v1', getCredential: () => 'test-only',
    post: async () => { calls++; return { choices: [{ message: { content: 'x'.repeat(101) } }] }; } });
  const result = await f.run();
  assert.equal(result.source, 'local');
  assert.equal(result.reason, 'provider-output-budget');
  assert.equal(calls, 1);
});


test('a changed source revision is re-read and earlier derived text is not reused as current evidence', async () => {
  const f = fixture({ reply: count => answer(`来自旧任务的回答 ${count}`) });
  assert.equal((await f.run()).ok, true);
  f.tasks[0].title = '人工改过的报告';
  const result = await f.run('接下来呢');
  assert.equal(result.ok, true);
  assert.equal(f.sent[1].context.data[0].items[0].title, '人工改过的报告');
  assert.equal(f.sent[1].context.messages.some(message => message.content === '来自旧任务的回答 1'), false);
  assert.equal(f.get().messages[1].content, '来自旧任务的回答 1');
});

test('internal history dependency edges do not exhaust source budget in a long granted conversation', async () => {
  const f = fixture({ mode: 'talk' });
  for (let index = 0; index < 65; index++) {
    const result = await f.run(`继续 ${index}`);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'provider');
    assert.equal(result.proposal, null);
    assert.equal(result.disclosure.sourceRefs.length, 1);
  }
  assert.equal(f.get().messages.length, 130);
});

test('selected focus summary and task are both present in the first provider payload', async () => {
  const f = fixture({ selection: { tools: ['task.read', 'activity.distribution'] },
    timeline: { available: true, readRange: () => ({ ok: true, items: [
      { id: 'segment-1', kind: 'session.segment', dayKey: '2026-10-04', durationMs: 120000, sessionId: 'focus-1' }
    ] }) } });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.disclosure.usage.reads, 2);
  assert.equal(result.disclosure.usage.providerCalls, 1);
  assert.deepEqual(f.sent[0].context.data.map(item => item.tool), ['task.read', 'activity.distribution']);
  assert.equal(f.sent[0].context.data[1].items.at(-1).focusMinutes, 2);
});


test('offline explicit safety concerns receive support without a productivity draft or risk labels', async () => {
  const f = fixture({ enabled: false });
  const result = await f.run('我现在想伤害自己');
  assert.equal(result.ok, true);
  assert.equal(result.proposal, null);
  assert.match(result.answer, /先把任务放下/);
  assert.equal(result.conversation.messages.at(-1).proposal, null);
  assert.deepEqual(result.disclosure.sourceRefs, []);
  assert.equal(Object.hasOwn(result.conversation, 'risk'), false);
});


test('explicit authorization invalidation promptly aborts credential changes even before a response arrives', async () => {
  const late = deferred();
  let signal;
  const f = fixture({ reply: (_count, _payload, controls) => { signal = controls.signal; return late.promise; } });
  const pending = f.run();
  await nextTick();
  const invalidated = f.turns.invalidateAll({ reason: 'credentials-changed' });
  assert.deepEqual(invalidated, { ok: true, canceled: 1, conversationIds: [f.conversationId], transitionReport: { attemptedConversationIds: [f.conversationId], appliedConversationIds: [f.conversationId], pendingConversationIds: [] } });
  assert.equal(signal.aborted, true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'credentials-changed');
  assert.equal(f.get().requiresAuthorization, true);
  assert.equal(f.get().messages.length, 1);
  late.resolve(draft());
  await nextTick();
  assert.equal(f.get().messages.length, 1);
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 0, conversationIds: [f.conversationId], transitionReport: { attemptedConversationIds: [f.conversationId], appliedConversationIds: [f.conversationId], pendingConversationIds: [] } });
});

test('only fully reported per-attempt token counts aggregate across a turn', async () => {
  for (const omitFirst of [false, true]) {
    const f = fixture();
    let count = 0;
    f.provider.client = createApiClient({ model: 'test', baseUrl: 'https://provider.example/v1', getCredential: () => 'test-only',
      post: async () => {
        count++;
        return { choices: [{ message: { content: JSON.stringify(count === 1 ? read() : answer()) } }],
          usage: omitFirst && count === 1 ? undefined : { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
      } });
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(count, 2);
    assert.deepEqual(result.disclosure.tokenUsage, omitFirst ? null : { inputTokens: 20, outputTokens: 4, totalTokens: 24 });
    assert.equal(result.disclosure.usage.tokens, omitFirst ? null : 24);
  }
});

test('responses protocol forwards usage without changing the structured result', async () => {
  const f = fixture();
  f.provider.client = createApiClient({ model: 'test', baseUrl: 'https://provider.example/v1', getCredential: () => 'test-only',
    negotiation: new Map([['https://provider.example/v1', 'responses']]),
    post: async () => ({ output_text: JSON.stringify(answer()), usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } }) });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.disclosure.tokenUsage, { inputTokens: 8, outputTokens: 3, totalTokens: 11 });
});

test('the explicitly selected historical draft is canonical before the next provider request', async () => {
  const f = fixture({ reply: count => count <= 2 ? { ...draft(),
    changeProposal: { ...draft().changeProposal, notes: `版本 ${count}` } } : answer() });
  const first = await f.run('第一版');
  const firstId = first.conversation.messages.at(-1).proposal.id;
  await f.run('第二版');
  const result = await f.turns.run({ conversationId: f.conversationId, scopeGrantId: f.scopeGrantId,
    message: '继续讨论第一版', selectedProposalId: firstId });
  assert.equal(result.ok, true);
  assert.equal(result.conversation.selectedProposalId, firstId);
  assert.equal(f.sent[2].context.summary.selectedDraft.id, firstId);
  assert.equal(JSON.parse(f.sent[2].context.summary.selectedDraft.body).notes, '版本 1');
  const before = f.get().messages.length;
  const unknown = await f.turns.run({ conversationId: f.conversationId, scopeGrantId: f.scopeGrantId,
    message: '不存在的提案', selectedProposalId: 'missing' });
  assert.equal(unknown.ok, false);
  assert.equal(f.get().messages.length, before);
});


test('same-ID same-millisecond manual edits reject pending provider drafts using source fingerprints', async () => {
  const late = deferred();
  const f = fixture({ reply: () => late.promise });
  const pending = f.run();
  await nextTick();
  f.tasks[0].title = '同一个任务已被人工修改';
  late.resolve(draft());
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'target-changed');
  assert.equal(f.get().messages.length, 1);
  assert.equal(f.get().messages[0].role, 'user');
  assert.equal(f.get().requiresAuthorization, true);
});

test('deleting the selected task while provider is pending rejects its late answer', async () => {
  const late = deferred();
  const f = fixture({ reply: () => late.promise });
  const pending = f.run();
  await nextTick();
  f.tasks.splice(0, 1);
  late.resolve(answer('旧任务的回答'));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'target-changed');
  assert.equal(f.get().messages.length, 1);
  assert.equal(f.get().status, 'paused');
});

test('a version-check port failure also fails closed and preserves readable history', async () => {
  const f = fixture({ validateContextVersions: () => { throw new Error('snapshot-unavailable'); } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'target-changed');
  assert.equal(f.get().messages[0].content, '报告不知道怎么开始');
  assert.equal(f.get().messages.length, 1);
});

for (const reason of ['provider-response-invalid-json', 'provider-response-html',
  'provider-response-event-stream', 'provider-response-empty']) {
  test(`HTTP envelope failure ${reason} remains visible in canonical local provenance`, async () => {
    const f = fixture({ reply: () => { throw new TypeError(reason); } });
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(result.source, 'local');
    assert.equal(result.reason, reason);
    assert.equal(f.get().messages.at(-1).provenance.reason, reason);
    assert.equal(f.get().messages.at(-1).provenance.source, 'local');
    assert.equal(f.sent.length, 1);
  });
}

test('simultaneous and completed retries of one message ID never duplicate provider calls', async () => {
  const pending = deferred();
  const f = fixture({ noTarget: true, selection: { tools: [], taskIds: [] }, reply: () => pending.promise });
  const request = { conversationId: f.conversationId, scopeGrantId: f.scopeGrantId, messageId: 'client-deduplicate', message: 'hello' };
  const first = f.turns.run(request);
  await nextTick();
  assert.equal(f.sent.length, 1);
  const simultaneous = await f.turns.run(request);
  assert.equal(simultaneous.reason, 'conversation-turn-active');
  assert.equal(f.sent.length, 1);
  pending.resolve(answer('one answer'));
  assert.equal((await first).ok, true);
  const completed = await f.turns.run(request);
  assert.equal(completed.replayed, true);
  assert.equal(completed.conversation.messages.length, 2);
  assert.equal(f.sent.length, 1);
  assert.equal(f.turns.captureRunOwners().length, 0);
});

test('retry retains cancellation and fresh-grant requirements without duplicating the user', async () => {
  const pending = deferred();
  const f = fixture({ noTarget: true, selection: { tools: [], taskIds: [] }, reply: () => pending.promise });
  const request = { conversationId: f.conversationId, scopeGrantId: f.scopeGrantId, messageId: 'client-canceled', message: 'hello' };
  const first = f.turns.run(request); await nextTick();
  f.sessions.cancel({ conversationId: f.conversationId });
  assert.equal((await first).ok, false);
  const stale = await f.turns.run(request);
  assert.equal(stale.ok, false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.get().messages.length, 1);
  pending.resolve(answer('too late')); await nextTick();
  assert.equal(f.get().messages.length, 1);
});
