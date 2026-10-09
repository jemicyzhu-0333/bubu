'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborationTurns } = require('../src/application/ai/collaboration-turns');
const { answer, deferred, fixture } = require('./fixtures/collaboration-characterization');

const make = options => fixture(createCollaborationTurns, options);
const count = (f, event) => f.trace.filter(value => value === event).length;
const selectedTask = { tools: ['task.read'], taskIds: ['task-1'] };
function released(f) {
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
}

test('initial throwing and nonfinite clocks return bounded setup failure without fallback', async () => {
  for (const clock of [() => { throw new Error('SYNTHETIC_PRIVATE_INITIAL_CLOCK'); }, () => NaN]) {
    const f = make({ clock });
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'run-setup-failed');
    assert.equal(result.setupStage, 'budget');
    assert.equal(result.setupRecovery, 'canceled');
    assert.deepEqual(result.cleanup, { ok: true, timer: 'not-acquired', listener: 'not-acquired' });
    assert.deepEqual(result.disclosure.usage, { reads: null, providerCalls: null, elapsedMs: null, tokens: null });
    assert.equal(f.snapshot().messages.length, 1);
    assert.equal(count(f, 'sessions.cancel'), 1);
    assert.equal(count(f, 'provider.run'), 0);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_INITIAL_CLOCK/);
    released(f);
  }
});

test('setup cancel throw or refusal is unconfirmed and never retried', async () => {
  for (const cancel of [() => { throw new Error('SYNTHETIC_PRIVATE_CANCEL'); },
    () => ({ ok: false, reason: 'synthetic-cancel-refused' })]) {
    const f = make({ scheduleFailure: true, cancel });
    const result = await f.run();
    assert.equal(result.reason, 'run-setup-failed');
    assert.equal(result.setupRecovery, 'unconfirmed');
    assert.equal(count(f, 'sessions.cancel'), 1);
    assert.equal(f.hasActive(), true);
    assert.equal(f.completions.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_CANCEL/);
    assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 0, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
    assert.equal(count(f, 'sessions.cancel'), 1);
    released(f);
  }
});

test('reentrant accepted-user notification preserves newer pending owner registration', async () => {
  let newRun;
  const entered = deferred(), pending = deferred();
  const f = make({ onAccepted(value, api) {
    if (value.messageId === 'user-1') newRun = api.run('SYNTHETIC_NEW');
  }, reply({ attempt }) { attempt(); entered.resolve(); return pending.promise; } });
  const oldRun = f.run('SYNTHETIC_OLD');
  await entered.promise;
  assert.equal((await oldRun).reason, 'turn-canceled');
  assert.equal(f.hasActive(), true);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 1, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal((await newRun).ok, false);
  assert.equal(f.completions.length, 0);
  released(f);
});

test('registration compares map identity after a reentrant signal read', async () => {
  let fired = false, newRun;
  const entered = deferred(), pending = deferred();
  const f = make({ signalRead(api) {
    if (fired) return;
    fired = true;
    newRun = api.run('SYNTHETIC_NEW');
  }, reply({ attempt }) { attempt(); entered.resolve(); return pending.promise; } });
  const oldRun = f.run('SYNTHETIC_OLD');
  await entered.promise;
  assert.equal((await oldRun).reason, 'turn-canceled');
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 1, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal((await newRun).ok, false);
  assert.equal(count(f, 'sessions.cancel'), 0);
  released(f);
});

test('setup throw after reentrant new run cannot cancel or remove the newer owner', async () => {
  let fired = false, newRun;
  const entered = deferred(), pending = deferred();
  const f = make({ onSchedule(api) {
    if (fired) return;
    fired = true;
    newRun = api.run('SYNTHETIC_NEW');
    throw new Error('SYNTHETIC_PRIVATE_SETUP');
  }, reply({ attempt }) { attempt(); entered.resolve(); return pending.promise; } });
  const result = await f.run('SYNTHETIC_OLD');
  await entered.promise;
  assert.equal(result.reason, 'run-setup-failed');
  assert.equal(result.setupRecovery, 'not-current');
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 1, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal((await newRun).ok, false);
  assert.equal(f.completions.length, 0);
  released(f);
});

test('source callback supersession is fenced before run-owned grant or session revoke', async () => {
  let fired = false, newRun;
  const f = make({ selection: selectedTask, sourceCheck(_refs, api) {
    if (!fired) { fired = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW'); }
    return false;
  } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal((await newRun).source, 'local');
  assert.equal(count(f, 'grants.revoke'), 0);
  assert.equal(count(f, 'sessions.revoke'), 0);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(f.sent.length, 0);
  released(f);
});

test('message callback supersession is fenced before run-owned revoke or provider attempt', async () => {
  let fired = false, newRun;
  const f = make({ messages: [{ id: 'earlier', role: 'user', content: 'SYNTHETIC_EARLIER',
    proposal: null, sourceRefs: [], contextAllowed: true }], messageCheck(_message, api) {
    if (!fired) { fired = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW'); }
    return false;
  } });
  assert.equal((await f.run()).ok, false);
  assert.equal((await newRun).source, 'local');
  assert.equal(count(f, 'grants.revoke'), 0);
  assert.equal(count(f, 'sessions.revoke'), 0);
  assert.equal(f.sent.length, 0);
  released(f);
});

test('provider and grant callbacks cannot carry an old owner into run-owned effects', async () => {
  for (const hook of ['providerGet', 'grantResolve']) {
    let fired = false, newRun;
    const f = make({ [hook](_request, second) {
      const api = second || _request;
      if (fired || !api.hasActive()) return;
      fired = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW');
    } });
    assert.equal((await f.run()).ok, false);
    assert.equal((await newRun).source, 'local');
    assert.equal(count(f, 'grants.revoke'), 0);
    assert.equal(count(f, 'sessions.revoke'), 0);
    assert.equal(count(f, 'sessions.cancel'), 0);
    assert.equal(f.sent.length, 0);
    released(f);
  }
});

test('grant-revoke callback supersession fences the subsequent session revoke', async () => {
  let newRun;
  const f = make({ selection: selectedTask, sourceCheck: () => false,
    grantRevoke(_id, api) { api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW'); } });
  const result = await f.run();
  assert.equal(result.reason, 'target-changed');
  assert.equal((await newRun).source, 'local');
  assert.equal(count(f, 'grants.revoke'), 1);
  assert.equal(count(f, 'sessions.revoke'), 0);
  assert.equal(count(f, 'sessions.cancel'), 0);
  released(f);
});

test('onContextSent abort is rechecked even when its observer exception is caught', async () => {
  const f = make({ contextSent(_refs, api) {
    api.sessions.cancel({ conversationId: 'conversation-1' });
    throw new Error('SYNTHETIC_PRIVATE_OBSERVER');
  } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'turn-canceled');
  assert.equal(result.disclosure.usage.providerCalls, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.completions.length, 0);
  assert.equal(count(f, 'sessions.cancel'), 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_OBSERVER/);
  released(f);
});

test('attempt charge-clock supersession is fenced before disclosure observer and fake send', async () => {
  let fired = false, newRun;
  const f = make({ clock({ at, clockReads, api }) {
    // The tenth sample charges provider consume after the added selection check.
    if (!fired && clockReads === 10) {
      fired = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW');
    }
    return at;
  } });
  const result = await f.run();
  assert.equal(fired, true);
  assert.equal(result.ok, false);
  assert.equal((await newRun).source, 'local');
  assert.equal(result.disclosure.usage.providerCalls, 1); // Allowance was already charged.
  assert.deepEqual(result.disclosure.fields, []);
  assert.equal(count(f, 'context.sent'), 0);
  assert.equal(f.sent.length, 0);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(count(f, 'sessions.revoke'), 0);
  released(f);
});

test('stale completion result cannot cancel the owner established by its port callback', async () => {
  let fired = false, newRun;
  const f = make({ beforeComplete(_request, api) {
    if (fired) return;
    fired = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW');
  } });
  const result = await f.run();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'conversation-turn-stale');
  assert.equal((await newRun).source, 'local');
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(f.snapshot().messages.filter(item => item.role === 'assistant').length, 1);
  released(f);
});

test('accepted notification errors preserve success and sample final usage only once', async () => {
  const f = make({ onAccepted(value) {
    if (value.messageId.startsWith('assistant-')) throw new Error('SYNTHETIC_PRIVATE_ACCEPTED_OBSERVER');
  } });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(f.completions.length, 1);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(count(f, 'clock'), 17);
  assert.deepEqual(result.cleanup, { ok: true, timer: 'released', listener: 'released' });
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_ACCEPTED_OBSERVER/);
  released(f);
});

test('nonfinite final elapsed metadata is null with exact counts and one sample', async () => {
  for (const value of [NaN, Infinity]) {
    const f = make({ clock({ at, api }) {
      return api.snapshot().messages.some(item => item.role === 'assistant') ? value : at;
    } });
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.deepEqual(result.disclosure.usage, { reads: 0, providerCalls: 1, elapsedMs: null, tokens: null });
    assert.equal(count(f, 'clock'), 17);
    assert.equal(f.completions.length, 1);
    assert.equal(count(f, 'sessions.cancel'), 0);
    released(f);
  }
});

test('throwing observational usage fields remain unknown without losing accepted disclosure', async () => {
  const f = make({ reply({ attempt, callbacks }) {
    attempt();
    callbacks.onUsage({ get inputTokens() { throw new Error('SYNTHETIC_PRIVATE_USAGE'); }, outputTokens: 1, totalTokens: 2 });
    return answer();
  } });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.disclosure.tokenUsage, null);
  assert.deepEqual(result.disclosure.usage, { reads: 0, providerCalls: 1, elapsedMs: 0, tokens: null });
  assert.equal(count(f, 'clock'), 17);
  assert.equal(f.completions.length, 1);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_USAGE/);
  released(f);
});

test('uncertain timer cancellation preserves accepted result and independently removes listener', async () => {
  const f = make({ cancelScheduleFailure: true });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.cleanup, { ok: false, timer: 'unconfirmed', listener: 'released' });
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 1); // Unconfirmed is not an assertion of release.
  assert.equal(count(f, 'schedule.cancel'), 1);
  assert.equal(count(f, 'signal.remove'), 1);
  assert.equal(f.completions.length, 1);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 0, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal(count(f, 'schedule.cancel'), 1);
  assert.throws(() => f.controls[0].beforeRequest(), /run-closed/);
});

test('accepted run finality does not suppress existing global history-revocation callback', async () => {
  let invalidation;
  const f = make({ onAccepted(value, api) {
    if (value.messageId.startsWith('assistant-')) invalidation = api.turns.invalidateAll({ reason: 'credentials-changed' });
  } });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.deepEqual(invalidation, { ok: true, canceled: 0, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal(count(f, 'sessions.revoke'), 1);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(f.completions.length, 1);
  assert.equal(f.snapshot().status, 'paused');
  released(f);
});

test('residual: repeated operational clock throws may reject before session cancel while cleanup still runs', async () => {
  let failing = false;
  const f = make({ clock({ at }) { if (failing) throw new Error('operational-clock-fault'); return at; },
    reply({ attempt }) { attempt(); failing = true; return answer(); } });
  await assert.rejects(f.run(), /operational-clock-fault/);
  assert.equal(f.completions.length, 0);
  assert.equal(count(f, 'sessions.cancel'), 0);
  assert.equal(f.hasActive(), true); // Session-internal repair is outside A.
  assert.deepEqual(f.turns.invalidateAll(), { ok: true, canceled: 0, conversationIds: ['conversation-1'], transitionReport: { attemptedConversationIds: ['conversation-1'], appliedConversationIds: ['conversation-1'], pendingConversationIds: [] } });
  assert.equal(count(f, 'schedule.cancel'), 1);
  released(f);
});

test('onContextSent replacement is fenced even when its observer throws after replacing the owner', async () => {
  for (const throws of [false, true]) {
    let replaced = false, newRun;
    const f = make({ contextSent(_refs, api) {
      if (replaced) return;
      replaced = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW');
      if (throws) throw new Error('SYNTHETIC_PRIVATE_OBSERVER');
    } });
    const result = await f.run();
    assert.equal(result.ok, false); assert.equal((await newRun).source, 'local');
    assert.equal(result.disclosure.usage.providerCalls, 1);
    assert.equal(count(f, 'sessions.cancel'), 0); assert.equal(count(f, 'sessions.revoke'), 0);
    assert.equal(count(f, 'grants.revoke'), 0); assert.equal(f.sent.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_OBSERVER/); released(f);
  }
});

test('preparation callback replacement cannot invalidate the next owner', async () => {
  let replaced = false, newRun;
  const f = make({ prepareMemorySelection(_request, api) {
    // Deliberately fake empty-selection hook tests owner fencing, not memory qualification.
    assert.deepEqual(_request.grant.selection.memoryIds, []);
    if (!replaced) {
      replaced = true; api.provider.enabled = false; newRun = api.run('SYNTHETIC_NEW');
      return { ok: false, reason: 'memory-context-invalid' };
    }
    return { ok: true, validate: () => ({ ok: true }) };
  } });
  assert.equal((await f.run()).ok, false); assert.equal((await newRun).source, 'local');
  assert.equal(count(f, 'sessions.cancel'), 0); assert.equal(count(f, 'sessions.revoke'), 0);
  assert.equal(count(f, 'grants.revoke'), 0); assert.equal(f.sent.length, 0); released(f);
});
