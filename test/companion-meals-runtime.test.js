'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeFixture, deferred, START } = require('../test-support/meal-runtime-fixture');
const waiting = () => ({ foodId: 'milk', waitMinutes: 10, reactionIndex: 2 });
const readyClient = answer => ({ run: async (_name, _payload, request) => { request.beforeRequest(); return answer; } });
const GUARD = 'timer:companion-meal-ai-guard';
function assertClean(result) {
  assert.deepEqual(result.cleanup, { ok: true, execution: { ok: true, timer: 'released', listener: 'released' },
    observation: 'released', lease: 'released', controller: 'aborted' });
}
test('real runtime: fractional hunger overrides accepted future plan without another request', async () => {
  let calls = 0, sentSatiation;
  const f = runtimeFixture({ makeClient: () => ({ run: async (_name, payload, options) => {
    calls++; options.beforeRequest(); sentSatiation = payload.satiation; return waiting();
  } }) });
  f.edit(s => { s.pet.satiation = 45.5; s.pet.foodInventory.milk = 1; });
  assert.equal((await f.runtime.tick()).meal, null);
  assert.equal(sentSatiation, 45.5);
  assert.equal(f.read().pet.care.plan.foodId, 'milk');
  f.time(START + 300000);
  assert.equal((await f.runtime.tick()).meal.satiation, 56.9);
  assert.equal(calls, 1); assert.equal(f.read().pet.care.aiCalls, 1);
  assert.equal(f.presentations.length, 1); assert.equal(f.presentations[0].selfMeal.foodId, 'milk');
});
test('local rules work with optional AI disabled or missing credentials', async () => {
  for (const options of [{ enabled: false }, { configured: false }]) {
    const f = runtimeFixture(options); const result = await f.runtime.tick();
    assert.equal(result.meal.foodId, 'berry'); assert.equal(f.read().pet.care.aiCalls, 0);
    assert.equal(f.read().pet.totalFeeds, 0); assert.equal(f.read().xp, 0);
  }
});

test('no available food means no reservation, no provider and no empty presentation', async () => {
  const f = runtimeFixture(); f.edit(s => { s.pet.foodInventory.berry = 0; });
  const result = await f.runtime.tick();
  assert.equal(result.meal, null); assert.equal(f.read().pet.care.aiCalls, 0); assert.deepEqual(f.presentations, []);
});
test('provider failure is one reserved decision with bounded closed payload and no secret logs', async () => {
  let calls = 0, construction, invocation, secondAttempt;
  const f = runtimeFixture({ makeClient: options => {
    construction = options;
    return { run: async (name, payload, request) => {
      calls++; invocation = { name, payload, request };
      request.beforeRequest();
      try { request.beforeRequest(); secondAttempt = 'allowed'; } catch (error) { secondAttempt = error.message; }
      throw new Error('synthetic-secret private task raw model output');
    } };
  } });
  assert.equal((await f.runtime.tick()).meal.foodId, 'berry'); assert.equal(calls, 1);
  assert.equal(construction.timeoutMs, 5000); assert.equal(construction.maxRepairAttempts, 0);
  assert.equal(invocation.name, 'pet-meal');
  assert.deepEqual(Object.keys(invocation.payload), ['character', 'satiation', 'meal', 'foods', 'favorite']);
  assert.equal(invocation.request.maxOutputChars, 1024); assert.equal(invocation.request.maxRepairAttempts, 0);
  assert.deepEqual(Object.keys(invocation.request), ['signal', 'maxOutputChars', 'maxRepairAttempts', 'beforeRequest']);
  assert.match(secondAttempt, /budget/);
  assert.equal(f.read().pet.care.aiCalls, 1); assert.deepEqual(f.errors, []);
});

test('a successful fake client without beforeRequest cannot install its chosen future plan', async () => {
  // Deliberately violates the fake-client contract to test the owner's fail-closed check.
  const f = runtimeFixture({ makeClient: () => ({ run: async () => waiting() }) });
  f.edit(s => { s.pet.foodInventory.milk = 1; });
  const result = await f.runtime.tick(); assert.equal(result.meal.foodId, 'berry');
  assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.foodInventory.milk, 1);
  assert.equal(f.read().pet.care.aiCalls, 1); assertClean(result);
});

test('provider construction failure remains ordinary local-rule unavailability', async () => {
  const f = runtimeFixture({ makeClient: () => { throw new Error('synthetic-secret private construction error'); } });
  const result = await f.runtime.tick(); assert.equal(result.meal.foodId, 'berry');
  assert.equal(f.calls.provider, 0); assert.equal(f.read().pet.care.aiCalls, 1);
  assert.deepEqual(f.errors, []); assertClean(result);
});

for (const kind of ['scope', 'lock', 'dispose', 'suspend']) {
  test(`${kind} before execution microtask prevents provider entry altogether`, async () => {
    const f = runtimeFixture({ makeClient: () => readyClient(waiting()) });
    const pending = f.runtime.tick();
    if (kind === 'scope') f.requestScope.invalidate();
    else if (kind === 'lock') f.lock(true);
    else f.runtime[kind]();
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(f.calls.provider, 0);
    assert.equal(f.read().pet.care.aiCalls, 1); assert.equal(f.read().pet.foodInventory.berry, 2);
    assert.equal(f.presentations.length, 0); assertClean(result);
  });
}

for (const order of ['deadline-first', 'invalidation-first']) {
  test(`caller invalidation wins a simultaneous ${order} deadline`, async () => {
    const response = deferred();
    const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, request) => {
      request.beforeRequest(); return response.promise;
    } }) });
    const pending = f.runtime.tick(); await f.waitForProviderStarted();
    if (order === 'deadline-first') { f.fireDeadline(); f.requestScope.invalidate(); }
    else { f.requestScope.invalidate(); f.fireDeadline(); }
    const result = await pending; assert.equal(result.ok, false);
    assert.equal(f.read().pet.foodInventory.berry, 2); assert.equal(f.presentations.length, 0);
    response.resolve(waiting()); await f.waitForProviderSettled(); assertClean(result);
  });
}

for (const settlement of ['resolve', 'reject']) {
  test(`late ${settlement} and retained attempt callback cannot revive a deadline result`, async () => {
    const response = deferred(); let request;
    const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, options) => {
      request = options; request.beforeRequest(); return response.promise;
    } }) });
    const pending = f.runtime.tick(); await f.waitForProviderStarted(); f.fireDeadline();
    const result = await pending, before = f.read(), checks = { ...f.calls };
    assert.equal(result.meal.foodId, 'berry');
    assert.throws(() => request.beforeRequest(), /turn-deadline|run-closed|operation-closed/);
    assert.deepEqual(f.calls, checks, 'a closed operation does not consult owner or clock ports');
    response[settlement](settlement === 'resolve' ? waiting() : new Error('synthetic late failure'));
    await f.waitForProviderSettled();
    assert.deepEqual(f.read(), before); assert.equal(f.presentations.length, 1);
    assert.equal((await f.runtime.tick()).meal, null); assert.equal(f.read().pet.care.aiCalls, 1);
  });
}

test('final apply checks follow context preparation and retain the lease through resolve', async () => {
  let f, armed = false, activeDuringMeal = false;
  f = runtimeFixture({ makeClient: () => ({ run: async (_name, _payload, request) => {
    request.beforeRequest(); armed = true; return waiting();
  } }), hooks: { beforeVisible() {
    if (armed) { armed = false; f.requestScope.invalidate(); }
  } } });
  f.edit(s => { s.pet.foodInventory.milk = 1; });
  const result = await f.runtime.tick();
  assert.equal(result.ok, false); assert.equal(f.read().pet.care.plan, null);
  assert.equal(f.read().pet.foodInventory.berry, 2); assert.equal(f.calls.release, 1);
  let g;
  g = runtimeFixture({ makeClient: () => readyClient({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }),
    publishState: fact => {
      if (fact.meal) activeDuringMeal = g.calls.release === 0;
    } });
  assert.equal((await g.runtime.tick()).meal.foodId, 'berry');
  assert.equal(activeDuringMeal, true);
  assert.equal(g.events.lastIndexOf('transaction:end') < g.events.indexOf('lease:release'), true);
});

test('single-flight remains in force while an ignored-abort provider is pending', async () => {
  const response = deferred();
  const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, request) => {
    request.beforeRequest(); return response.promise;
  } }) });
  const pending = f.runtime.tick(); await f.waitForProviderStarted();
  assert.equal(await f.runtime.tick(), undefined); assert.equal(await f.runtime.tick(), undefined);
  assert.equal(f.calls.provider, 1); assert.equal(f.read().pet.care.aiCalls, 1);
  response.resolve({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }); assertClean(await pending);
});

test('timer handle zero is released once and later ticks preserve the local-only result shape', async () => {
  const f = runtimeFixture({ firstTimerId: 0, makeClient: () => readyClient({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }) });
  const pending = f.runtime.tick(); await f.waitForProviderStarted();
  assert.equal(f.timeouts.has(0), true); const result = await pending; assertClean(result);
  assert.equal(f.calls.schedule, 1); assert.equal(f.calls.cancelSchedule, 1);
  const next = await f.runtime.tick(); assert.equal(Object.hasOwn(next, 'cleanup'), false);
  f.runtime.dispose(); f.runtime.dispose(); assert.equal(f.calls.cancelSchedule, 1);
});

for (const stage of ['lease', 'observation', 'budget', 'clock', 'schedule']) {
  test(`setup ${stage} failure retains the committed reservation without provider or resolve`, async () => {
    let f, clockSamples = 0;
    const fail = () => { throw new Error('synthetic-secret setup failure'); };
    f = runtimeFixture({ hooks: {
      beforeBegin: stage === 'lease' ? fail : undefined,
      afterInterval: stage === 'observation' ? fail : undefined,
      beforeClock() {
        if (!f.intervals.has(GUARD)) return;
        clockSamples++;
        if ((stage === 'budget' && clockSamples === 1) || (stage === 'clock' && clockSamples === 2)) fail();
      },
      beforeSchedule: stage === 'schedule' ? fail : undefined
    } });
    const result = await f.runtime.tick(), state = f.read();
    assert.equal(result.ok, false); assert.equal(result.reason, 'run-setup-failed'); assert.equal(result.setupStage, stage);
    assert.equal(f.calls.provider, 0); assert.equal(f.calls.transaction, 2);
    assert.equal(state.pet.care.aiCalls, 1); assert.notEqual(state.pet.care.decision, null);
    assert.equal(state.pet.foodInventory.berry, 2); assert.equal(state.pet.care.plan, null);
    assert.equal(f.presentations.length, 0); assert.deepEqual(f.errors, []);
    assert.deepEqual(result.cleanup, {
      ok: stage !== 'lease',
      execution: { ok: true, timer: 'not-acquired', listener: ['clock', 'schedule'].includes(stage) ? 'released' : 'not-acquired' },
      observation: stage === 'lease' ? 'not-acquired' : 'released',
      lease: stage === 'lease' ? 'unconfirmed' : 'released', controller: 'aborted'
    });
    assert.equal(f.calls.release, stage === 'lease' ? 0 : 1); assert.equal(f.intervals.size, 0);
  });
}

test('a begin-then-throw acquisition is honestly unconfirmed and leaves the reservation intact', async () => {
  const f = runtimeFixture({ hooks: { afterBegin() { throw new Error('synthetic lease acquisition failure'); } } });
  const result = await f.runtime.tick();
  assert.equal(result.reason, 'run-setup-failed'); assert.equal(result.setupStage, 'lease');
  assert.equal(result.cleanup.lease, 'unconfirmed'); assert.equal(result.cleanup.ok, false);
  assert.equal(f.leases.length, 1); assert.equal(f.calls.release, 0); assert.equal(f.calls.provider, 0);
  assert.equal(f.read().pet.care.aiCalls, 1); assert.notEqual(f.read().pet.care.decision, null);
  f.requestScope.close();
});

test('pre-aborted combined signal rejects before provider entry and still cleans acquired resources', async () => {
  let f;
  f = runtimeFixture({ hooks: { afterBegin: () => f.requestScope.invalidate() } });
  const result = await f.runtime.tick();
  assert.equal(result.ok, false); assert.equal(result.reason, 'meal-request-invalidated');
  assert.equal(f.calls.provider, 0); assert.equal(f.read().pet.foodInventory.berry, 2);
  assert.equal(f.calls.schedule, 1); assertClean(result);
});

test('observation registration then throw still attempts independent lease and controller cleanup', async () => {
  let f, retained;
  f = runtimeFixture({ hooks: {
    afterInterval(_id, callback) { retained = callback; throw new Error('synthetic observer registration failure'); },
    beforeClear() { throw new Error('synthetic observer release failure'); }
  } });
  const result = await f.runtime.tick();
  assert.equal(result.reason, 'run-setup-failed'); assert.equal(result.setupStage, 'observation');
  assert.deepEqual(result.cleanup, { ok: false,
    execution: { ok: true, timer: 'not-acquired', listener: 'not-acquired' },
    observation: 'unconfirmed', lease: 'released', controller: 'aborted' });
  assert.equal(f.calls.clear, 1); assert.equal(f.calls.release, 1); assert.equal(f.calls.provider, 0);
  const checks = { ...f.calls }; retained(); assert.deepEqual(f.calls, checks);
  assert.equal(f.read().pet.care.aiCalls, 1); assert.notEqual(f.read().pet.care.decision, null);
});

for (const kind of ['skin', 'manual-feed']) {
  test(`successful ${kind} post-commit notification cancels pending provider without observation polling`, async () => {
    const response = deferred(); let signal;
    const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, request) => {
      request.beforeRequest(); signal = request.signal; return response.promise;
    } }) });
    const pending = f.runtime.tick(); await f.waitForProviderStarted();
    if (kind === 'skin') {
      const command = require('../src/capabilities').companion.selectSkin.createSelectSkinCommand({
        unitOfWork: f.unitOfWork, availableSkinIds: ['pink', 'usagi'], publish: f.runtime.invalidateAdvice });
      f.edit(s => { s.unlockedSkins.push('usagi'); }); assert.equal(command.execute({ skinId: 'usagi' }).ok, true);
    } else {
      const workflow = require('../src/application/workflows/feed-companion').createFeedCompanionWorkflow({
        unitOfWork: f.unitOfWork, clock: f.clock, foods: f.foods, publish: f.runtime.invalidateAdvice });
      assert.equal(workflow.execute(f.request('berry')).ok, true);
    }
    assert.equal(signal.aborted, true);
    assert.equal((await pending).ok, false);
    response.resolve(waiting()); await f.waitForProviderSettled();
    assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.read().pet.foodInventory.berry, kind === 'manual-feed' ? 1 : 2);
    assert.equal(f.read().pet.care.autoFeeds, 0); assert.equal(f.presentations.length, 0);
  });
}

for (const failures of [['timer'], ['observation'], ['lease'], ['timer', 'observation', 'lease']]) {
  test(`successful resolve survives ${failures.join('/')} cleanup uncertainty without retry`, async () => {
    const fail = () => { throw new Error('synthetic-secret cleanup failure'); };
    const f = runtimeFixture({ makeClient: () => readyClient({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }),
      hooks: { beforeCancelSchedule: failures.includes('timer') ? fail : undefined,
        beforeClear: failures.includes('observation') ? fail : undefined,
        beforeRelease: failures.includes('lease') ? fail : undefined } });
    const result = await f.runtime.tick();
    assert.equal(result.ok, true); assert.equal(result.meal.foodId, 'berry');
    assert.deepEqual(result.cleanup, { ok: false,
      execution: { ok: !failures.includes('timer'), timer: failures.includes('timer') ? 'unconfirmed' : 'released', listener: 'released' },
      observation: failures.includes('observation') ? 'unconfirmed' : 'released',
      lease: failures.includes('lease') ? 'unconfirmed' : 'released', controller: 'aborted' });
    assert.equal(f.calls.cancelSchedule, 1); assert.equal(f.calls.clear, 1); assert.equal(f.calls.release, 1);
    assert.equal(f.read().pet.foodInventory.berry, 1); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.presentations.length, 1); assert.deepEqual(f.errors, []);
    assert.equal((await f.runtime.tick()).meal, null);
    assert.equal(f.calls.provider, 1); assert.equal(f.read().pet.foodInventory.berry, 1);
    f.requestScope.close();
  });
}

test('retained and cleanup-reentrant observation callbacks do not inspect an old or replacement owner', async () => {
  let f, retained, reentrantChecks;
  const responses = [deferred(), deferred()]; let invocation = 0;
  f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, request) => {
    request.beforeRequest(); return responses[invocation++].promise;
  } }), hooks: {
    afterInterval(_id, fn) { retained ||= fn; },
    beforeClear() {
      const before = { read: f.calls.read, assert: f.calls.assertCurrent, clock: f.calls.clock };
      retained(); reentrantChecks = { before, after: { read: f.calls.read, assert: f.calls.assertCurrent, clock: f.calls.clock } };
    }
  } });
  const first = f.runtime.tick(); await f.waitForProviderStarted(); f.fireDeadline(); await first;
  assert.deepEqual(reentrantChecks.after, reentrantChecks.before);
  f.time(START + 3600000); f.edit(s => { s.pet.satiation = 40; });
  const second = f.runtime.tick(); await f.waitForProviderStarted(2);
  const checks = { ...f.calls }, before = f.read(); retained();
  assert.deepEqual(f.calls, checks); assert.deepEqual(f.read(), before);
  responses[1].resolve({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }); assert.equal((await second).ok, true);
  responses[0].reject(new Error('late ignored provider')); await f.waitForProviderSettled(1);
});

test('post-commit presentation failure keeps a successful remote decision successful', async () => {
  const f = runtimeFixture({ makeClient: () => readyClient({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }),
    present() { throw new Error('synthetic private presentation failure'); } });
  const result = await f.runtime.tick(); assert.equal(result.ok, true); assertClean(result);
  assert.equal(f.read().pet.foodInventory.berry, 1); assert.equal(f.read().pet.care.aiCalls, 1);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].message, 'companion-meal-runtime-failed');
  assert.equal((await f.runtime.tick()).meal, null); assert.equal(f.calls.provider, 1);
});
test('five-second deadline falls back once even when provider ignores abort and responds late', async () => {
  let finish, signal;
  const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, options) => {
    options.beforeRequest(); signal = options.signal; return new Promise(resolve => { finish = resolve; });
  } }) });
  const pending = f.runtime.tick(); await f.waitForProviderStarted();
  assert.deepEqual([...f.timeouts.values()].map(t => t.ms), [5000]);
  f.time(START + 5000);
  f.fireDeadline(); const result = await pending; assert.equal(result.meal.foodId, 'berry');
  const before = f.read(); assert.equal(signal.aborted, true); finish(waiting()); await f.waitForProviderSettled();
  assert.deepEqual(f.read(), before); assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
  assertClean(result);
});
for (const kind of ['meal', 'master', 'model', 'endpoint', 'pet', 'credential', 'skin', 'scope', 'scope-close', 'lock', 'dispose', 'suspend']) {
  test(`${kind} invalidation settles ignored-abort provider without any fallback meal`, async () => {
    let finish, signal;
    const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, options) => {
      options.beforeRequest(); signal = options.signal; return new Promise(resolve => { finish = resolve; });
    } }) });
    const pending = f.runtime.tick(); await f.waitForProviderStarted(); const before = f.read();
    const changes = { meal: { aiPetMealsEnabled: false }, master: { aiBreakdownEnabled: false }, model: { aiModel: 'different' },
      endpoint: { aiBaseUrl: 'https://other.test/v1' }, pet: { petEnabled: false } };
    if (changes[kind]) {
      const patch = changes[kind]; assert.equal(f.preferences.execute({ patch }).ok, true);
      assert.equal(f.preferences.execute({ patch: Object.fromEntries(Object.keys(patch).map(k => [k, before.settings[k]])) }).ok, true);
    } else if (kind === 'credential') f.credentials(true);
    else if (kind === 'skin') {
      const command = require('../src/capabilities').companion.selectSkin.createSelectSkinCommand({ unitOfWork: f.unitOfWork, availableSkinIds: ['pink', 'usagi'] });
      f.edit(s => { s.unlockedSkins.push('usagi'); });
      assert.equal(command.execute({ skinId: 'usagi' }).ok, true); command.execute({ skinId: 'pink' });
      f.intervals.get('timer:companion-meal-ai-guard').fn();
    } else if (kind === 'scope') f.requestScope.invalidate();
    else if (kind === 'scope-close') f.requestScope.close();
    else if (kind === 'lock') f.lock(true);
    else if (kind === 'suspend') f.runtime.suspend();
    else f.runtime.dispose();
    const result = await pending; assert.equal(result.ok, false); assert.equal(signal.aborted, true);
    finish(waiting()); await f.waitForProviderSettled();
    assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.deepEqual(f.read().pet.foodInventory, before.pet.foodInventory);
    assert.equal(f.read().pet.satiation, before.pet.satiation); assert.equal(f.presentations.length, 0);
    assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
    assertClean(result);
  });
}
test('a failed preferences commit preserves authorized work and its accepted answer', async () => {
  let finish;
  const f = runtimeFixture({ makeClient: () => ({ run: (_name, _payload, options) => {
    options.beforeRequest(); return new Promise(resolve => { finish = resolve; });
  } }) });
  f.edit(s => { s.pet.foodInventory.milk = 1; });
  const pending = f.runtime.tick(); await f.waitForProviderStarted(); f.fail(true);
  assert.throws(() => f.preferences.execute({ patch: { aiPetMealsEnabled: false } }), /synthetic commit refusal/);
  f.fail(false); finish(waiting()); assert.equal((await pending).ok, true);
  assert.equal(f.read().pet.care.plan.foodId, 'milk'); assert.equal(f.read().pet.care.aiCalls, 1);
});
for (const kind of ['model', 'endpoint', 'pet', 'credential', 'skin']) {
  test(`${kind} change clears accepted future plan without refunding the reserved decision`, async () => {
    const f = runtimeFixture({ makeClient: () => readyClient(waiting()) });
    f.edit(s => { s.pet.foodInventory.milk = 1; }); await f.runtime.tick(); const before = f.read();
    if (kind === 'credential') f.credentials(true);
    else if (kind === 'skin') {
      const command = require('../src/capabilities').companion.selectSkin.createSelectSkinCommand({ unitOfWork: f.unitOfWork, availableSkinIds: ['pink', 'usagi'] });
      f.edit(s => { s.unlockedSkins.push('usagi'); }); command.execute({ skinId: 'usagi' });
    } else f.preferences.execute({ patch: kind === 'model' ? { aiModel: 'new' } : kind === 'endpoint' ? { aiBaseUrl: 'https://new.test/v1' } : { petEnabled: false } });
    const after = f.read(); assert.equal(after.pet.care.plan, null); assert.equal(after.pet.care.nextMealAt, null);
    assert.equal(after.pet.care.aiCalls, 1); assert.deepEqual(after.pet.foodInventory, before.pet.foodInventory);
    assert.equal(after.pet.satiation, before.pet.satiation); assert.deepEqual(after.rewardLedger, before.rewardLedger);
  });
}
for (const kind of ['startup', 'lock', 'disabled', 'suspend', 'long-gap']) {
  test(`${kind} interval has no offline hunger, then continuous samples resume`, async () => {
    const f = runtimeFixture({ enabled: false }); f.edit(s => { s.pet.satiation = 90; });
    if (kind === 'startup') f.edit(s => { s.pet.care.lastObservedAt = START - 120000; });
    await f.runtime.tick(); assert.equal(f.read().pet.satiation, 90);
    if (kind === 'lock') { f.lock(true); f.lock(false); }
    if (kind === 'disabled') { f.preferences.execute({ patch: { petEnabled: false } }); f.preferences.execute({ patch: { petEnabled: true } }); }
    if (kind === 'suspend') { f.runtime.suspend(); f.runtime.resume(); }
    f.time(START + (kind === 'long-gap' ? 3600000 : 300000));
    await f.runtime.tick(); const satiation = f.read().pet.satiation;
    assert.equal(satiation, kind === 'startup' ? 89.4 : 90);
    f.time(f.now() + 300000); await f.runtime.tick(); assert.equal(f.read().pet.satiation, Math.round((satiation - .6) * 1000) / 1000);
  });
}
test('publish failure cannot suppress committed meal presentation or turn success into a retry', async () => {
  const f = runtimeFixture({ enabled: false, publishState: () => { throw new Error('closed window'); } });
  assert.equal((await f.runtime.tick()).meal.foodId, 'berry'); assert.equal(f.presentations.length, 1);
  assert.equal((await f.runtime.tick()).meal, null); assert.equal(f.read().pet.foodInventory.berry, 1);
});
for (const policy of ['hidden', 'dnd', 'quiet', 'focus']) {
  test(`${policy} suppresses optional presentation without disabling local rules`, async () => {
    const f = runtimeFixture({ enabled: false });
    if (policy === 'hidden') f.visible(false);
    if (policy === 'dnd') f.edit(s => { s.settings.dnd = true; });
    if (policy === 'quiet') f.edit(s => { s.settings.petActivityMode = 'quiet'; });
    if (policy === 'focus') f.edit(s => { s.focusSession = require('../src/capabilities').execution.focusSession.startFocus(s.focusSession, { sessionId: 'synthetic-focus', durationMs: 25 * 60000 }, { now: START }).session; });
    assert.equal((await f.runtime.tick()).meal.foodId, 'berry'); assert.equal(f.presentations.length, 0);
  });
}
test('startup, polling, disposal are idempotent and pending requests are single-flight', async () => {
  const f = runtimeFixture({ enabled: false }); f.runtime.start(); f.runtime.start();
  assert.equal(f.intervals.size, 1); assert.equal([...f.intervals.values()][0].ms, 300000);
  await f.runtime.tick(); f.runtime.dispose(); f.runtime.dispose(); assert.equal(f.intervals.size, 0);
  assert.equal(await f.runtime.tick(), undefined);
});

test('actual runtime keeps three reserved AI decisions and six automatic meals across the day', async () => {
  let calls = 0;
  const f = runtimeFixture({ makeClient: () => ({ run: async (_kind, _input, request) => {
    request.beforeRequest(); calls++; return { foodId: 'berry', waitMinutes: 0, reactionIndex: 0 };
  } }) });
  f.edit(s => { s.pet.foodInventory.berry = 10; });
  for (let i = 0; i < 7; i++) {
    f.time(START + i * 3600000); f.edit(s => { s.pet.satiation = 40; });
    const result = await f.runtime.tick(); assert.equal(Boolean(result.meal), i < 6);
  }
  assert.equal(calls, 3); assert.equal(f.read().pet.care.aiCalls, 3); assert.equal(f.read().pet.care.autoFeeds, 6);
  assert.equal(f.read().pet.foodInventory.berry, 4); assert.equal(f.read().pet.totalFeeds, 0);
});
test('basic automatic meals use the independent allowance and never reserve AI after it is exhausted', async () => {
  let calls = 0;
  const f = runtimeFixture({ makeClient: () => ({ run: async (_kind, _input, request) => {
    request.beforeRequest(); calls++; return { foodId: 'basic', waitMinutes: 0, reactionIndex: 0 };
  } }) });
  f.edit(s => { s.pet.foodInventory.berry = 0; });
  for (let i = 0; i < 4; i++) {
    f.time(START + i * 3600000); f.edit(s => { s.pet.satiation = 40; });
    const result = await f.runtime.tick(); assert.equal(result.meal?.foodId || null, i < 3 ? 'basic' : null);
  }
  assert.equal(calls, 3); assert.equal(f.read().pet.care.aiCalls, 3); assert.equal(f.view().basicMeal.remaining, 0);
  assert.equal(f.read().pet.foodTickets, 6); assert.equal(f.read().pet.totalFeeds, 0); assert.equal(f.read().xp, 0);
});
test('same-value meal config in an unrelated valid settings patch preserves enabled advice', async () => {
  const f = runtimeFixture({ makeClient: () => readyClient({ foodId: 'berry', waitMinutes: 10, reactionIndex: 0 }) });
  await f.runtime.tick(); const care = f.read().pet.care;
  assert.equal(f.preferences.execute({ patch: { aiModel: 'synthetic-model', dnd: true } }).ok, true);
  assert.deepEqual(f.read().pet.care, care);
});
test('failed sample and failed decision apply never publish a meal or partially consume inventory', async () => {
  const f = runtimeFixture({ enabled: false }); f.fail(true); const before = f.read();
  assert.equal((await f.runtime.tick()).ok, false); assert.deepEqual(f.read(), before); assert.equal(f.presentations.length, 0);
  f.fail(false); assert.equal((await f.runtime.tick()).meal.foodId, 'berry');
  let g;
  g = runtimeFixture({ makeClient: () => ({ run: async (_name, _payload, request) => {
    request.beforeRequest(); g.fail(true); return { foodId: 'berry', waitMinutes: 0, reactionIndex: 0 };
  } }) });
  assert.equal((await g.runtime.tick()).ok, false); assert.equal(g.read().pet.foodInventory.berry, 2);
  assert.equal(g.read().pet.care.aiCalls, 1); assert.equal(g.presentations.length, 0);
});
