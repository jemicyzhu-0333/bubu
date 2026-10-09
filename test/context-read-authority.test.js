'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextGrants } = require('../src/application/ai/context-grants');
const { createContextReads } = require('../src/application/ai/context-reads');
const { createMemoryRecall } = require('../src/application/ai/memory-recall');
const { createMemoryRecallFixture } = require('../test-support/memory-recall-fixture');

const baseSelection = { tools: ['task.read', 'task.search'], taskIds: ['selected-task'], inboxIds: [],
  routineIds: [], memoryIds: [], planningPreferences: false, fromDay: '2026-10-08', toDay: '2026-10-08' };
const taskRequest = { name: 'task.search', args: {} };
const memoryRequest = { name: 'memory.search', args: {} };
const activityRequest = { name: 'activity.distribution', args: { fromDay: '2026-10-08', toDay: '2026-10-08' } };
const energyRequest = { name: 'energy.read', args: {} };
const memoryItem = id => ({ id, version: 1, kind: 'preference', subject: id, body: `SYNTHETIC_BODY_${id}`,
  source: 'user-confirmed', status: 'active', contextAllowed: true, scope: 'global', validFrom: 0, expiresAt: null });
function fixture(options = {}) {
  let at = 1000, sequence = 0, clockHook = null;
  const calls = [];
  const grants = createContextGrants({ ownerId: 'read-owner', now() {
    calls.push('authority.clock');
    if (clockHook) clockHook();
    return at;
  }, idFactory: () => options.reusedId || `grant-${++sequence}` });
  const context = { conversationId: 'conversation-1', purpose: 'stuck', providerId: 'provider-1', authorizationGeneration: 0 };
  const selection = { ...baseSelection, ...options.selection };
  function issue(overrides = {}, binding = {}) {
    const issued = grants.issue({ ...context, ...binding, selection: { ...selection, ...overrides } });
    assert.equal(issued.ok, true);
    return issued.grant;
  }
  const grant = issue();
  const snapshot = { settings: { aiMemoryEnabled: true }, tasks: [
    { id: 'selected-task', title: 'SYNTHETIC_SELECTED_TASK', steps: [], done: false },
    { id: 'private-task', title: 'SYNTHETIC_FORBIDDEN_TASK', steps: [], done: false }
  ], impulses: [{ id: 'private-inbox', text: 'SYNTHETIC_FORBIDDEN_INBOX' }],
  routines: [{ id: 'private-routine', title: 'SYNTHETIC_FORBIDDEN_ROUTINE', active: true, kind: 'meal', schedule: null }],
  planningPreferences: { items: [{ id: 'private-planning', version: 1, startMinute: 60, endMinute: 90,
    demand: 'low', scope: 'saved', createdAt: 0, updatedAt: 0, expiresAt: null, source: 'user-confirmed' }] } };
  const api = { grants, grant, calls, snapshot, issue, context,
    proof: value => ({ scopeGrantId: value.id, conversationId: value.conversationId,
      providerId: value.providerId, authorizationGeneration: value.authorizationGeneration }),
    clockHook: callback => { clockHook = callback; }, advance: value => { at += value; },
    revoke: () => grants.revoke(context.conversationId) };
  const memory = createMemoryRecallFixture({ records: () => options.memoryRecords || [],
    available: options.memoryAvailable, authority: options.memoryAuthority,
    onSnapshot(request, receiver) { calls.push('memory.snapshot'); options.memorySnapshot?.(request, receiver); },
    now() { calls.push('source.clock'); return options.sourceNow ? options.sourceNow(api) : at; } });
  const contextReader = options.contextReader || memory.contextReader;
  const reads = createContextReads({ grants,
    readSnapshot() { calls.push('snapshot'); return options.readSnapshot ? options.readSnapshot(api) : snapshot; },
    memoryRecall: createMemoryRecall({ contextReader }),
    timeline: options.timeline,
    readEstimate: options.readEstimate,
    now() { calls.push('source.clock'); return options.sourceNow ? options.sourceNow(api) : at; }
  });
  return { ...api, reads, contextReader,
    execute: (request = taskRequest, value = grant) => reads.execute({ grant: value, request }),
    prepare: (value = grant) => reads.prepareMemorySelection({ grant: value }) };
}
function refused(result) { assert.deepEqual(result, { ok: false, reason: 'scope-grant-invalid' }); }

test('actual resolver retains exact frozen membership with one clock sample', () => {
  const f = fixture();
  const before = f.calls.length;
  const one = f.grants.resolve(f.proof(f.grant));
  assert.equal(one.ok, true);
  assert.ok(Object.isFrozen(one.grant));
  assert.ok(Object.isFrozen(one.grant.selection));
  assert.deepEqual(f.calls.slice(before), ['authority.clock']);
  assert.equal(f.grants.resolve(f.proof(f.grant)).grant, one.grant);
});

test('resolve refuses revoke, clear and narrower replacement during its clock', () => {
  for (const change of [f => f.revoke(), f => f.grants.clear(), f => f.issue({ taskIds: [] })]) {
    const f = fixture();
    f.clockHook(() => { f.clockHook(null); change(f); });
    refused(f.grants.resolve(f.proof(f.grant)));
  }
});

test('resolve never adopts same-ID replacement or a previously absent grant issued by its clock', () => {
  const f = fixture({ reusedId: 'same-id' });
  f.clockHook(() => { f.clockHook(null); f.grants.clear(); f.issue({ taskIds: [] }); });
  refused(f.grants.resolve(f.proof(f.grant)));
  f.grants.clear();
  f.clockHook(() => { f.clockHook(null); f.issue(); });
  refused(f.grants.resolve(f.proof(f.grant)));
});

test('unrelated canonical membership mutation does not revoke a stable witness', () => {
  const f = fixture();
  f.clockHook(() => { f.clockHook(null); f.issue({}, { conversationId: 'other-conversation' }); });
  assert.equal(f.grants.resolve(f.proof(f.grant)).ok, true);
  assert.equal(f.execute().items[0].id, 'selected-task');
});

test('forged projection selection cannot widen canonical task, inbox, routine or date authorization', () => {
  const f = fixture({ selection: { tools: ['task.read', 'task.search', 'inbox.search', 'routine.search', 'activity.distribution'] } });
  const forged = structuredClone(f.grant);
  forged.selection.taskIds.push('private-task');
  forged.selection.inboxIds.push('private-inbox');
  forged.selection.routineIds.push('private-routine');
  forged.selection.fromDay = '2026-01-01';
  assert.deepEqual(f.execute(taskRequest, forged).items.map(item => item.id), ['selected-task']);
  assert.deepEqual(f.execute({ name: 'inbox.search', args: {} }, forged).items, []);
  assert.deepEqual(f.execute({ name: 'routine.search', args: {} }, forged).items, []);
  assert.equal(f.execute({ name: 'activity.distribution', args: { fromDay: '2026-01-01', toDay: '2026-10-08' } }, forged).ok, false);
  assert.doesNotMatch(JSON.stringify(f.execute(taskRequest, forged)), /SYNTHETIC_FORBIDDEN/);
});

test('forged tools or planning and memory selection cannot create authorization', () => {
  let memoryCalls = 0;
  const f = fixture({ memorySnapshot() { memoryCalls++; } });
  const forged = structuredClone(f.grant);
  forged.selection.tools.push('memory.search', 'planning.preferences.read');
  forged.selection.memoryIds.push('private-memory');
  forged.selection.planningPreferences = true;
  for (const request of [memoryRequest, { name: 'planning.preferences.read', args: {} }]) {
    assert.equal(f.execute(request, forged).reason, 'tool-not-authorized');
  }
  assert.equal(f.calls.filter(value => value === 'snapshot').length, 0);
  assert.equal(memoryCalls, 0);
});

test('authorized memory uses canonical IDs even if its issued clone is widened', () => {
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    memoryRecords: [memoryItem('selected-memory'), memoryItem('private-memory')] });
  const forged = structuredClone(f.grant);
  forged.selection.memoryIds.push('private-memory');
  const result = f.execute(memoryRequest, forged);
  assert.deepEqual(result.items.map(item => item.id), ['selected-memory']);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_BODY_private-memory/);
});

test('authorized planning still uses actual validator and existing selected scope', () => {
  const f = fixture({ selection: { tools: ['planning.preferences.read'], taskIds: [], planningPreferences: true } });
  const result = f.execute({ name: 'planning.preferences.read', args: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map(item => item.id), ['private-planning']);
  assert.equal(result.coverage.basis, 'user-confirmed-planning-preferences');
});

test('all identity bindings and revoked projections fail before snapshot access', () => {
  for (const key of ['id', 'ownerId', 'conversationId', 'purpose', 'providerId', 'authorizationGeneration']) {
    const f = fixture();
    const forged = { ...f.grant, [key]: key === 'authorizationGeneration' ? 1 : 'different' };
    refused(f.execute(taskRequest, forged));
    assert.equal(f.calls.includes('snapshot'), false);
  }
  for (const change of [f => f.revoke(), f => f.grants.clear(), f => f.advance(1800000)]) {
    const f = fixture(); change(f);
    refused(f.execute());
    assert.equal(f.calls.includes('snapshot'), false);
  }
});

test('missing and accessor-based identity is refused without evaluating supplied getters', () => {
  const f = fixture();
  for (const grant of [null, {}, { ...f.grant, id: '' }]) refused(f.execute(taskRequest, grant));
  let getterCalls = 0;
  const projected = { ...f.grant, get id() { getterCalls++; return f.grant.id; } };
  refused(f.execute(taskRequest, projected));
  assert.equal(getterCalls, 0);
  assert.equal(f.calls.includes('snapshot'), false);
});

test('grant authority is required and thrown or malformed authority cannot call a source', () => {
  assert.throws(() => createContextReads({ readSnapshot: () => ({}) }), /context-grant-authority-required/);
  const f = fixture();
  for (const resolve of [() => { throw new Error('SYNTHETIC_PRIVATE_AUTHORITY'); },
    () => null, () => ({ ok: true }), () => ({ ok: true, grant: {} })]) {
    let reads = 0;
    const actual = createContextReads({ grants: { resolve }, readSnapshot() { reads++; return f.snapshot; } });
    refused(actual.execute({ grant: f.grant, request: taskRequest }));
    assert.equal(reads, 0);
  }
});

test('snapshot revocation prevents subsequent memory, timeline and estimate source callbacks', () => {
  for (const request of [memoryRequest, activityRequest, energyRequest]) {
    let laterCalls = 0;
    const f = fixture({ selection: { tools: [request.name], taskIds: [], memoryIds: ['selected-memory'] },
      readSnapshot(api) { api.revoke(); return api.snapshot; },
      memoryRecords: [memoryItem('selected-memory')], memorySnapshot() { laterCalls++; },
      timeline: { available: true, readRange() { laterCalls++; return { ok: true, items: [] }; } },
      readEstimate() { laterCalls++; return { level: 50 }; }
    });
    refused(f.execute(request));
    assert.equal(laterCalls, 0);
  }
});

test('snapshot clock revocation suppresses memory data and prevents any later source access', () => {
  let snapshots = 0;
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    sourceNow(api) { api.revoke(); return 1000; },
    memoryRecords: [memoryItem('selected-memory')], memorySnapshot() { snapshots++; } });
  refused(f.execute(memoryRequest));
  assert.equal(snapshots, 1);
  refused(f.execute(memoryRequest));
  assert.equal(snapshots, 1);
});

test('memory snapshot revocation preserves receiver and selection but suppresses returned data', () => {
  let f, snapshots = 0;
  const args = [];
  const contextReader = { readContextSnapshot(request) {
    assert.equal(this, contextReader);
    args.push(structuredClone(request)); snapshots++;
    f.revoke();
    return { ok: true, items: [{ ...memoryItem('selected-memory'), updatedAt: 0 }], sampledAt: 1000,
      authority: { ownerId: 'read-owner', ledgerId: 'synthetic-ledger', sequence: 0 } };
  } };
  f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] }, contextReader });
  refused(f.execute(memoryRequest));
  refused(f.prepare());
  assert.equal(snapshots, 1);
  assert.deepEqual(args, [{ ids: ['selected-memory'] }]);
});

test('unrevoked memory snapshot preserves original receiver, arguments and canonical selected results', () => {
  let receiver;
  const args = [];
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    memoryRecords: [memoryItem('selected-memory'), memoryItem('private-memory')],
    memorySnapshot(request, actual) { receiver = actual; args.push(structuredClone(request)); } });
  assert.deepEqual(f.execute(memoryRequest).items.map(item => item.id), ['selected-memory']);
  assert.equal(receiver, f.contextReader);
  assert.deepEqual(args, [{ ids: ['selected-memory'] }]);
});

test('timeline and estimate revocation suppress returned data without a later source retry', () => {
  for (const kind of ['timeline', 'estimate']) {
    let f, calls = 0;
    const source = () => { calls++; f.revoke(); return kind === 'timeline'
      ? { ok: true, items: [{ id: 'event', kind: 'session.segment', dayKey: '2026-10-08', durationMs: 60000, sessionId: 'session' }] }
      : { level: 75 }; };
    f = fixture({ selection: { tools: [kind === 'timeline' ? 'activity.distribution' : 'energy.read'], taskIds: [] },
      timeline: { available: true, readRange: source }, readEstimate: source });
    refused(f.execute(kind === 'timeline' ? activityRequest : energyRequest));
    assert.equal(calls, 1);
  }
});

test('revocation followed by source throw wins over helper unavailable or original exception', () => {
  for (const kind of ['snapshot', 'memory', 'timeline', 'estimate']) {
    let f, calls = 0;
    const source = () => { calls++; f.revoke(); throw new Error('SYNTHETIC_PRIVATE_SOURCE_ERROR'); };
    const name = kind === 'memory' ? 'memory.search' : kind === 'timeline' ? 'activity.distribution'
      : kind === 'estimate' ? 'energy.read' : 'task.search';
    f = fixture({ selection: { tools: [name], taskIds: ['selected-task'], memoryIds: ['selected-memory'] },
      ...(kind === 'snapshot' ? { readSnapshot: source } : {}),
      memorySnapshot: source, timeline: { available: true, readRange: source }, readEstimate: source });
    refused(f.execute(name === 'memory.search' ? memoryRequest : name === 'activity.distribution' ? activityRequest
      : name === 'energy.read' ? energyRequest : taskRequest));
    assert.equal(calls, 1);
  }
});

test('source exceptions retain original semantics while canonical authority remains valid', () => {
  const failure = new Error('synthetic-source-failure');
  const snapshot = fixture({ readSnapshot() { throw failure; } });
  assert.equal(snapshot.execute().availability, 'unavailable');
  const memory = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    memorySnapshot() { throw failure; } });
  assert.equal(memory.execute(memoryRequest).availability, 'unavailable');
  const timeline = fixture({ selection: { tools: ['activity.distribution'], taskIds: [] },
    timeline: { available: true, readRange() { throw failure; } } });
  assert.throws(() => timeline.execute(activityRequest), error => error === failure);
  const estimate = fixture({ selection: { tools: ['energy.read'], taskIds: [] }, readEstimate() { throw failure; } });
  assert.throws(() => estimate.execute(energyRequest), error => error === failure);
});

test('same-ID replacement and expiry during a source cannot rescue an older read witness', () => {
  for (const mode of ['replace', 'expire']) {
    const f = fixture({ reusedId: 'same-id', readSnapshot(api) {
      if (mode === 'replace') { api.grants.clear(); api.issue({ taskIds: [] }); }
      else api.advance(1800000);
      return api.snapshot;
    } });
    refused(f.execute());
  }
});

test('final authority check covers unavailable, empty and structural error outcomes', () => {
  for (const mode of ['unavailable', 'empty', 'error']) {
    let samples = 0;
    const f = fixture({ ...(mode === 'unavailable' ? { readSnapshot: () => null }
      : mode === 'empty' ? { selection: { taskIds: [] } } : {}) });
    // Run-entry resolve, pre/post-snapshot, then final resolve. A structural
    // error has only run-entry/final resolution and no source read.
    f.clockHook(() => { samples++; if (samples === (mode === 'error' ? 2 : 4)) f.revoke(); });
    refused(f.execute(mode === 'error' ? { name: 'arbitrary.sql', args: {} } : taskRequest));
    assert.equal(samples, mode === 'error' ? 2 : 4);
  }
});

test('invalid tools, fields and unselected IDs are rejected before any source call', () => {
  for (const request of [{ name: 'arbitrary.sql', args: {} },
    { name: 'task.read', args: { id: 'selected-task', fields: ['credential'] } },
    { name: 'task.read', args: { id: 'private-task' } }]) {
    const f = fixture();
    assert.equal(f.execute(request).ok, false);
    assert.equal(f.calls.includes('snapshot'), false);
  }
});

test('snapshot property revocation prevents invocation during execute, preparation and validation', () => {
  for (const phase of ['execute', 'prepare', 'validate']) {
    let f, armed = false, getters = 0, snapshots = 0;
    const safe = createMemoryRecallFixture({ records: () => [memoryItem('selected-memory')] });
    const contextReader = { get readContextSnapshot() {
      getters++;
      if (armed) f.revoke();
      return function(request) { snapshots++; return safe.contextReader.readContextSnapshot(request); };
    } };
    f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] }, contextReader });
    const prepared = phase === 'validate' ? f.prepare() : null;
    if (prepared) assert.equal(prepared.ok, true);
    const before = snapshots;
    armed = true;
    refused(phase === 'execute' ? f.execute(memoryRequest) : phase === 'prepare' ? f.prepare() : prepared.validate());
    assert.equal(snapshots, before);
    assert.equal(getters, phase === 'validate' ? 2 : 1);
    refused(f.prepare());
    assert.equal(snapshots, before);
  }
});

test('private memory qualification captures canonical selection and never exposes its evidence', () => {
  const records = [memoryItem('selected-memory'), memoryItem('private-memory')], requests = [];
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    memoryRecords: records, memorySnapshot(request) { requests.push(structuredClone(request)); } });
  const forged = structuredClone(f.grant);
  forged.selection.memoryIds = ['private-memory'];
  const prepared = f.prepare(forged);
  assert.equal(prepared.ok, true);
  assert.deepEqual(Object.keys(prepared).sort(), ['ok', 'validate']);
  assert.deepEqual(prepared.validate(), { ok: true });
  assert.deepEqual(requests, [{ ids: ['selected-memory'] }, { ids: ['selected-memory'] }]);
  assert.equal(JSON.stringify(prepared), '{"ok":true}');
  records[0].version++;
  assert.equal(prepared.validate().ok, false);
  assert.equal(prepared.validate().ok, false);
  assert.equal(f.prepare().ok, true);
});

test('canonical empty qualification never discovers memory or requires its authority', () => {
  let snapshots = 0;
  const f = fixture({ memoryAvailable: () => false, memorySnapshot() { snapshots++; },
    readSnapshot: api => ({ ...api.snapshot, settings: { aiMemoryEnabled: false } }) });
  const forged = structuredClone(f.grant);
  forged.selection.memoryIds.push('private-memory');
  const prepared = f.prepare(forged);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.validate(), { ok: true });
  assert.equal(snapshots, 0);
  f.revoke();
  refused(prepared.validate());
  assert.equal(snapshots, 0);
});

test('qualification invalidates all selected semantic versions and authority tokens including query non-hits', () => {
  const changes = [
    records => { records[1].version++; records[1].body = 'Changed non-hit body'; },
    records => { records[1].status = 'paused'; },
    records => { records[1].contextAllowed = false; },
    records => { records[1].expiresAt = 1000; },
    records => { records[1].source = 'aggregated'; records[1].expiresAt = null; },
    records => { records.splice(1, 1); },
    (records, token) => { token.sequence++; },
    (records, token) => { token.ledgerId = 'replacement-ledger'; },
    (records, token) => { token.ownerId = 'replacement-owner'; }
  ];
  for (const change of changes) {
    const records = [memoryItem('hit'), memoryItem('non-hit')];
    records[0].body = 'MATCH_ONLY_THIS';
    const token = { ownerId: 'read-owner', ledgerId: 'synthetic-ledger', sequence: 0 };
    const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['hit', 'non-hit'] },
      memoryRecords: records, memoryAuthority: () => token });
    const prepared = f.prepare();
    assert.equal(prepared.ok, true);
    const result = f.execute({ name: 'memory.search', args: { query: 'MATCH_ONLY_THIS', limit: 1 } });
    assert.deepEqual(result.items.map(item => item.id), ['hit']);
    assert.deepEqual(result.sourceRefs.map(ref => ref.id), ['hit']);
    change(records, token);
    const validation = prepared.validate();
    assert.equal(validation.ok, false);
    assert.doesNotMatch(JSON.stringify(validation), /SYNTHETIC_BODY|MATCH_ONLY_THIS|synthetic-ledger|replacement-ledger/);
  }
});

test('usage-only counters do not change the captured semantic qualification', () => {
  const records = [memoryItem('selected-memory')];
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] }, memoryRecords: records });
  const prepared = f.prepare();
  assert.equal(prepared.ok, true);
  records[0].lastUsedAt = 1000;
  records[0].useCount = 2;
  assert.deepEqual(prepared.validate(), { ok: true });
});

test('same-ID replacement during private qualification cannot renew the old canonical owner', () => {
  for (const phase of ['prepare', 'validate']) {
    let f, armed = false, snapshots = 0;
    f = fixture({ reusedId: 'same-id', selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
      memoryRecords: [memoryItem('selected-memory')], memorySnapshot() {
        snapshots++;
        if (armed) { f.grants.clear(); f.issue(); }
      } });
    const prepared = phase === 'validate' ? f.prepare() : null;
    if (prepared) assert.equal(prepared.ok, true);
    armed = true;
    refused(prepared ? prepared.validate() : f.prepare());
    assert.equal(snapshots, phase === 'validate' ? 2 : 1);
  }
});

test('private qualification final authority fence covers empty, unavailable and invalid outcomes', () => {
  for (const phase of ['prepare', 'validate']) {
    for (const outcome of ['empty', 'unavailable', 'invalid']) {
      function setup() {
        const records = [memoryItem('selected-memory')];
        let available = true;
        const f = fixture({ selection: { tools: ['memory.search'], taskIds: [],
          memoryIds: outcome === 'empty' ? [] : ['selected-memory'] },
        memoryRecords: records, memoryAvailable: () => available });
        const prepared = phase === 'validate' ? f.prepare() : null;
        if (prepared) assert.equal(prepared.ok, true);
        if (outcome === 'unavailable') available = false;
        if (outcome === 'invalid') records[0].status = 'paused';
        return { f, run: () => prepared ? prepared.validate() : f.prepare() };
      }
      const baseline = setup();
      const start = baseline.f.calls.length;
      baseline.run();
      const clockCount = baseline.f.calls.slice(start).filter(call => call === 'authority.clock').length;
      assert.ok(clockCount >= 2);
      const active = setup();
      let sampled = 0;
      active.f.clockHook(() => { sampled++; if (sampled === clockCount) active.f.revoke(); });
      refused(active.run());
      assert.equal(sampled, clockCount);
    }
  }
});

test('private qualification source failures stay closed and grant revocation has precedence', () => {
  for (const phase of ['prepare', 'validate']) {
    for (const boundary of ['snapshot', 'memory']) {
      for (const revoke of [false, true]) {
        let f, armed = false, sourceCalls = 0;
        const fail = () => {
          if (!armed) return;
          sourceCalls++;
          if (revoke) f.revoke();
          throw new Error('SYNTHETIC_PRIVATE_QUALIFICATION_ERROR');
        };
        f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
          memoryRecords: [memoryItem('selected-memory')],
          readSnapshot(api) { if (boundary === 'snapshot') fail(); return api.snapshot; },
          memorySnapshot() { if (boundary === 'memory') fail(); } });
        const prepared = phase === 'validate' ? f.prepare() : null;
        if (prepared) assert.equal(prepared.ok, true);
        armed = true;
        assert.deepEqual(prepared ? prepared.validate() : f.prepare(),
          { ok: false, reason: revoke ? 'scope-grant-invalid' : 'memory-authority-unavailable' });
        assert.equal(sourceCalls, 1);
      }
    }
  }
});

test('nonempty private qualification rechecks the current memory setting', () => {
  const f = fixture({ selection: { tools: ['memory.search'], taskIds: [], memoryIds: ['selected-memory'] },
    memoryRecords: [memoryItem('selected-memory')] });
  const prepared = f.prepare();
  assert.equal(prepared.ok, true);
  const before = f.calls.filter(call => call === 'memory.snapshot').length;
  f.snapshot.settings.aiMemoryEnabled = false;
  assert.deepEqual(prepared.validate(), { ok: false, reason: 'memory-disabled' });
  assert.equal(f.calls.filter(call => call === 'memory.snapshot').length, before);
});
