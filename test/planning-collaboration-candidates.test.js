'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlanningPreferenceCandidate, planningPreferenceCandidateSchema } = require('../src/core/ai-personalization-protocol');
const { COLLABORATION_TASK, validateCollaborationResult } = require('../src/core/llm');
const { createCollaborationSessions } = require('../src/application/ai/conversation-sessions');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { proposalValid, validateConversationSnapshot } = require('../src/application/ai/conversation-record');
const { serializedBytes } = require('../src/application/ai/run-budget');
const { openCollaborationDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');

const AT = Date.UTC(2026, 9, 4, 12);
const candidate = (overrides = {}) => ({ id: null, startMinute: 540, endMinute: 660,
  demand: 'low', scope: 'today', ...overrides });
const envelope = (overrides = {}) => ({ type: 'changeProposal', answer: 'Here is a time band to review.',
  readRequest: null, changeProposal: { planningPreference: candidate(overrides) } });
const answer = () => ({ type: 'answer', answer: 'We can keep discussing it.', readRequest: null, changeProposal: null });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }

function harness({ planning = false, tasks = false, reply = () => envelope(), repository = null } = {}) {
  let sequence = 0, at = AT;
  const now = () => at;
  const state = { settings: { aiMemoryEnabled: false },
    tasks: [{ id: 'preference-1', title: 'Synthetic task with the same ID', done: false, steps: [] }],
    planningPreferences: { version: 1, items: [{ id: 'preference-1', version: 1,
      startMinute: 540, endMinute: 660, demand: 'low', scope: 'saved',
      createdAt: AT - 1, updatedAt: AT - 1, expiresAt: null, source: 'user-confirmed' }], undo: null },
    energySelfReports: { events: [] }, energyCurveTrials: { active: null } };
  const sessions = createCollaborationSessions({ ownerId: 'owner-planning', now, repository,
    idFactory: (index, kind) => `${kind}-${index}` });
  const started = sessions.start({ purpose: 'planning', mode: 'talk' });
  const conversationId = started.conversation.id;
  const grants = createContextGrants({ ownerId: 'owner-planning', now, idFactory: () => `grant-${++sequence}` });
  const reads = createContextReads({ grants, readSnapshot: () => state, now });
  const sent = [], accepted = [], contextSent = [];
  const provider = { fingerprint: 'provider-planning', enabled: true, configured: true,
    model: 'synthetic', endpoint: 'https://provider.example/v1',
    client: { async run(_name, payload, controls) {
      controls.beforeRequest(); sent.push(structuredClone(payload)); return reply(sent.length, payload, controls);
    } } };
  const issued = grants.issue({ conversationId, purpose: 'planning', providerId: provider.fingerprint,
    authorizationGeneration: started.conversation.authGeneration,
    selection: { tools: [...(planning ? ['planning.preferences.read'] : []), ...(tasks ? ['task.read'] : [])],
      taskIds: tasks ? ['preference-1'] : [], planningPreferences: planning, fromDay: '2026-10-04', toDay: '2026-10-04' } });
  assert.equal(issued.ok, true, issued.reason);
  const turns = createCollaborationTurns({ sessions, grants, reads, now, getProvider: () => provider,
    validateContextVersions: reads.validateContextVersions,
    onMessageAccepted: value => accepted.push(value), onContextSent: refs => contextSent.push(structuredClone(refs)) });
  return { state, sessions, grants, reads, sent, accepted, contextSent, conversationId,
    run: (extra = {}) => turns.run({ conversationId, message: 'I want a lighter morning time band.', scopeGrantId: issued.grant.id, ...extra }),
    get: () => sessions.get({ conversationId }).conversation, setTime: value => { at = value; } };
}

test('planning candidate grammar returns a detached exact clone with bounded minute, demand and scope variants', () => {
  for (const scope of ['today', '7days', 'saved']) for (const demand of ['low', 'medium', 'high']) {
    const input = candidate({ scope, demand, id: 'existing:preference_1', startMinute: 0, endMinute: 1440 });
    const copy = validatePlanningPreferenceCandidate(input);
    assert.deepEqual(copy, input); assert.notEqual(copy, input);
    copy.startMinute = 1; assert.equal(input.startMinute, 0);
    assert.deepEqual(validateCollaborationResult(JSON.stringify(envelope({ scope, demand }))), envelope({ scope, demand }));
  }
  assert.deepEqual(validatePlanningPreferenceCandidate(candidate({ startMinute: 1439, endMinute: 1440 })),
    candidate({ startMinute: 1439, endMinute: 1440 }));
  const variants = COLLABORATION_TASK.buildSchema().properties.changeProposal.anyOf[1].anyOf;
  assert.ok(variants.includes(planningPreferenceCandidateSchema));
  assert.equal(planningPreferenceCandidateSchema.additionalProperties, false);
  const inner = planningPreferenceCandidateSchema.properties.planningPreference;
  assert.equal(inner.additionalProperties, false);
  assert.deepEqual(inner.required, ['id', 'startMinute', 'endMinute', 'demand', 'scope']);
});

test('planning candidates reject missing fields, metadata, invalid bands and model-measurement fields', () => {
  for (const patch of [{ id: '' }, { id: 'not an ID' }, { id: 'a'.repeat(201) }, { id: 1 },
    { startMinute: -1 }, { startMinute: -0 }, { startMinute: 1440 }, { startMinute: 540.5 }, { startMinute: '540' },
    { endMinute: 0 }, { endMinute: 1441 }, { endMinute: 540 }, { endMinute: 539 }, { endMinute: Infinity },
    { demand: 'measured-low' }, { scope: 'forever' }, { scope: null }]) {
    assert.throws(() => validatePlanningPreferenceCandidate(candidate(patch)), /planning-preference-candidate-invalid/);
    assert.throws(() => validateCollaborationResult(envelope(patch)));
  }
  for (const key of ['source', 'sourceRefs', 'version', 'confirmedAt', 'confirmed', 'opId', 'receiptId',
    'expiresAt', 'baseline', 'energyCurve', 'measuredAbility', 'consent', 'status']) {
    assert.throws(() => validatePlanningPreferenceCandidate(candidate({ [key]: true })));
    assert.throws(() => validateCollaborationResult(envelope({ [key]: true })));
  }
  for (const key of Object.keys(candidate())) {
    const input = candidate(); delete input[key];
    assert.throws(() => validatePlanningPreferenceCandidate(input));
  }
  for (const input of [null, [], new Date(0), { planningPreference: candidate() }]) {
    assert.throws(() => validatePlanningPreferenceCandidate(input));
  }
  let getterReads = 0;
  const accessor = candidate(); Object.defineProperty(accessor, 'id', { get() { getterReads++; return null; } });
  assert.throws(() => validatePlanningPreferenceCandidate(accessor)); assert.equal(getterReads, 0);
  const hidden = candidate(); Object.defineProperty(hidden, 'confirmed', { value: true });
  const symbol = candidate(); symbol[Symbol('confirmed')] = true;
  assert.throws(() => validatePlanningPreferenceCandidate(hidden));
  assert.throws(() => validatePlanningPreferenceCandidate(symbol));
});

test('planning is an exclusive changeProposal variant and preserves existing memory candidates', () => {
  for (const extra of [{ operations: [] }, { memoryCandidate: {} }, { confirmed: true }, { sourceRefs: [] }]) {
    const mixed = envelope(); Object.assign(mixed.changeProposal, extra);
    assert.throws(() => validateCollaborationResult(mixed));
  }
  const memory = { ...envelope(), changeProposal: { memoryCandidate: { kind: 'preference',
    subject: 'Morning planning', body: 'Start with a small task.', scope: 'work', expiresAt: null } } };
  assert.deepEqual(validateCollaborationResult(memory), memory);
  assert.match(COLLABORATION_TASK.instruction, /existing id must exactly match a planning-preference source actually returned this turn/);
  assert.match(COLLABORATION_TASK.instruction, /never the person’s measured ability, health, or energy curve/);
});

test('a new planning preference is canonical inert history with only actual sent-message provenance', async () => {
  let saves = 0;
  const f = harness({ repository: { load: () => ({ ok: false }), saveSnapshot: () => { saves++; return { ok: true }; } } });
  const before = structuredClone(f.state), result = await f.run();
  assert.equal(result.ok, true, result.reason); assert.equal(result.source, 'provider');
  assert.equal(result.proposalKind, 'planning-preference-candidate');
  const user = result.conversation.messages[0], message = result.conversation.messages[1];
  assert.equal(message.proposal.kind, 'planning-preference-candidate');
  assert.deepEqual(JSON.parse(message.proposal.body), envelope().changeProposal);
  assert.deepEqual(message.provenance, { source: 'provider', reason: null, providerId: 'provider-planning' });
  assert.deepEqual(message.sourceRefs, [{ kind: 'message', id: user.id, revision: null }]);
  assert.deepEqual(result.disclosure.sourceRefs, []); assert.deepEqual(f.state, before); assert.equal(saves, 0);
  assert.deepEqual(f.accepted, [{ conversationId: f.conversationId, messageId: user.id },
    { conversationId: f.conversationId, messageId: message.id }]);
  assert.deepEqual(f.contextSent, [[]]);
});

test('existing planning target requires exactly the actually read planning-preference ID and kind', async () => {
  for (const options of [{}, { tasks: true }, { planning: true, target: 'unread-preference' }]) {
    const f = harness({ ...options, reply: () => envelope({ id: options.target || 'preference-1' }) });
    const before = structuredClone(f.state), result = await f.run();
    assert.equal(result.ok, true); assert.equal(result.source, 'local'); assert.equal(result.reason, 'provider-invalid-output');
    assert.equal(result.proposal, null); assert.equal(f.get().messages.at(-1).proposal, null);
    assert.deepEqual(f.state, before);
  }
  for (const change of [f => { delete f.state.planningPreferences; }, f => { f.state.planningPreferences.items = []; }]) {
    const f = harness({ planning: true, reply: () => envelope({ id: 'preference-1' }) });
    change(f); const result = await f.run();
    assert.equal(result.source, 'local'); assert.equal(result.reason, 'provider-invalid-output');
    assert.deepEqual(result.disclosure.sourceRefs, []);
  }
  const f = harness({ planning: true, reply: () => envelope({ id: 'preference-1', scope: '7days' }) });
  const before = structuredClone(f.state), result = await f.run();
  assert.equal(result.source, 'provider'); assert.equal(result.proposalKind, 'planning-preference-candidate');
  const [ref] = result.disclosure.sourceRefs;
  assert.equal(ref.kind, 'planning-preference'); assert.equal(ref.id, 'preference-1'); assert.equal(typeof ref.revision, 'string');
  assert.deepEqual(f.contextSent, [[ref]]);
  assert.deepEqual(result.conversation.messages.at(-1).sourceRefs[0], ref);
  assert.deepEqual(f.state, before);
});

test('existing planning target is rejected when its version, lifetime or availability changes during the response', async () => {
  for (const mutate of [f => { f.state.planningPreferences.items[0].version++; },
    f => { f.state.planningPreferences.items[0].expiresAt = AT + 1; f.setTime(AT + 2); },
    f => { f.state.planningPreferences.items = []; }, f => { delete f.state.planningPreferences; }]) {
    const late = deferred(), f = harness({ planning: true, reply: () => late.promise });
    const pending = f.run(); await tick(); mutate(f); late.resolve(envelope({ id: 'preference-1' }));
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
    assert.equal(f.get().messages.length, 1);
  }
});

test('planning source is revalidated before each real provider attempt', async () => {
  const f = harness({ planning: true, reply: (_count, _payload, controls) => {
    f.state.planningPreferences.items[0].version++; controls.beforeRequest(); return envelope({ id: 'preference-1' });
  } });
  const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.reason, 'target-changed');
  assert.equal(result.disclosure.usage.providerCalls, 1); assert.equal(f.get().messages.length, 1);
});

test('an older selected planning candidate remains available for discussion without applying or rewriting it', async () => {
  const f = harness({ reply: count => count === 1 ? envelope() : answer() });
  const first = await f.run(), proposal = first.conversation.messages[1].proposal, before = structuredClone(f.state);
  for (let count = 0; count < 8; count++) assert.equal((await f.run()).ok, true);
  assert.equal((await f.run({ selectedProposalId: proposal.id })).ok, true);
  assert.deepEqual(f.sent.at(-1).context.summary.selectedDraft, proposal);
  assert.deepEqual(f.get().messages[1].proposal, proposal); assert.deepEqual(f.state, before);
});

test('saved planning candidates round-trip with canonical kind and strict bodies; malformed snapshots fail closed', async () => {
  const db = openCollaborationDatabase({ filePath: ':memory:', ownerId: 'owner-planning' });
  assert.equal(db.status, 'available');
  try {
    const f = harness({ repository: db.repository, planning: true, reply: () => envelope({ id: 'preference-1' }) });
    const result = await f.run(), proposal = result.conversation.messages.at(-1).proposal;
    assert.equal(f.sessions.setRetention({ conversationId: f.conversationId, mode: 'saved', selectedProposalId: proposal.id }).ok, true);
    const snapshot = db.repository.load({ ownerId: 'owner-planning', conversationId: f.conversationId }).conversation;
    assert.equal(validateConversationSnapshot(snapshot), true);
    const restarted = createCollaborationSessions({ ownerId: 'owner-planning', repository: db.repository,
      now: () => AT, idFactory: (index, kind) => `restarted-${kind}-${index}` });
    const restored = restarted.get({ conversationId: f.conversationId }).conversation;
    assert.deepEqual(restored.messages, snapshot.messages.map(message => ({ ...message,
      contextAllowed: message.role === 'assistant' ? false : message.contextAllowed })));
    assert.equal(restored.selectedProposalId, proposal.id);
    assert.equal(restored.requiresAuthorization, true);
    for (const body of [{ planningPreference: candidate({ endMinute: 1 }) }, { planningPreference: candidate(), confirmed: true },
      { memoryCandidate: candidate() }, { planningPreference: candidate({ source: 'user-confirmed' }) }]) {
      const corrupt = structuredClone(snapshot); corrupt.messages.at(-1).proposal.body = JSON.stringify(body);
      corrupt.segment.bytes = corrupt.messages.reduce((sum, message) => sum + serializedBytes(message), 0);
      assert.equal(proposalValid(corrupt.messages.at(-1).proposal), false);
      assert.equal(validateConversationSnapshot(corrupt), false);
    }
    f.sessions.dispose(); restarted.dispose();
  } finally { db.close(); }
});
