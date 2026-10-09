'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, describeFields } = require('../src/core/llm');
const { PET_MEAL_TASK } = require('../src/core/llm/pet-meal-task');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { runtimeFixture, deferred } = require('../test-support/meal-runtime-fixture');
const input = { character: 'dango', satiation: 45.5, meal: 'breakfast', foods: ['milk', 'berry'], favorite: 'berry' };
const advice = { foodId: 'milk', waitMinutes: 10, reactionIndex: 2 };
const reply = content => ({ choices: [{ message: { content } }] });

test('repair enforces 1024 UTF-8 bytes independently of Unicode code points and semantics', () => {
  const json = JSON.stringify(advice);
  const atLimit = json + ' '.repeat(1024 - Buffer.byteLength(json, 'utf8'));
  assert.equal(Buffer.byteLength(atLimit, 'utf8'), 1024);
  assert.deepEqual(PET_MEAL_TASK.validate(PET_MEAL_TASK.repair(atLimit), input), advice);
  assert.throws(() => PET_MEAL_TASK.repair(atLimit + ' '), { message: 'invalid-pet-meal-output' });
  const multibyte = JSON.stringify({ ...advice, extra: 'é'.repeat(400) });
  const bytes1024 = multibyte + ' '.repeat(1024 - Buffer.byteLength(multibyte, 'utf8'));
  const bytes1025 = bytes1024 + ' ';
  assert.equal(Buffer.byteLength(bytes1024, 'utf8'), 1024);
  assert.equal(Buffer.byteLength(bytes1025, 'utf8'), 1025);
  assert.equal([...bytes1025].length <= 1024, true);
  assert.equal(JSON.parse(bytes1025).extra.length, 400, 'the over-byte-limit input is valid JSON');
  assert.throws(() => PET_MEAL_TASK.validate(PET_MEAL_TASK.repair(bytes1024), input), { message: 'invalid-pet-meal-advice' });
  assert.throws(() => PET_MEAL_TASK.repair(bytes1025), { message: 'invalid-pet-meal-output' });
});

for (const size of [1024, 1025]) {
  test(`actual client checks ${size} raw code points before descriptor parsing`, async () => {
    let posts = 0;
    const outputs = [], failures = [];
    const base = JSON.stringify(advice), raw = base + ' '.repeat(size - [...base].length);
    const f = runtimeFixture({ makeClient: options => createApiClient({ ...options,
      trace: { begin: () => ({ output: text => outputs.push([...text].length), note() {}, done() {},
        failed: error => failures.push(error.message) }) },
      post: async () => { posts++; return reply(raw); } }) });
    f.edit(s => { s.pet.foodInventory.milk = 1; });
    const result = await f.runtime.tick();
    assert.equal(posts, 1); assert.equal(f.calls.schedule, 1); assert.equal(f.calls.cancelSchedule, 1);
    assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(result.meal?.foodId || null, size === 1024 ? null : 'berry');
    assert.equal(f.read().pet.care.plan?.foodId || null, size === 1024 ? 'milk' : null);
    assert.deepEqual(outputs, size === 1024 ? [1024] : []);
    assert.deepEqual(failures, size === 1024 ? [] : ['provider-output-budget']);
  });
  test(`actual client distinguishes ${size} astral code points from the UTF-8 byte cap`, async () => {
    let posts = 0;
    const outputs = [], failures = [];
    const base = JSON.stringify({ ...advice, extra: '😀'.repeat(100) });
    const raw = base + ' '.repeat(size - [...base].length);
    assert.equal([...raw].length, size); assert.equal(raw.length > size, true);
    assert.equal(Buffer.byteLength(raw, 'utf8') > 1024, true);
    const f = runtimeFixture({ makeClient: options => createApiClient({ ...options,
      trace: { begin: () => ({ output: text => outputs.push([...text].length), note() {}, done() {},
        failed: error => failures.push(error.message) }) },
      post: async () => { posts++; return reply(raw); } }) });
    assert.equal((await f.runtime.tick()).meal.foodId, 'berry');
    assert.equal(posts, 1); assert.deepEqual(outputs, size === 1024 ? [1024] : []);
    assert.deepEqual(failures, [size === 1024 ? 'invalid-pet-meal-output' : 'provider-output-budget']);
  });
}

test('pet meal task has an exact bounded disclosure and preserves fractional satiation', () => {
  const sent = PET_MEAL_TASK.buildInput({ ...input, title: 'private task', mood: 'private', medication: 'private',
    impulseText: 'private capture', desktop: 'private screen', chat: 'private chat', apiKey: 'synthetic-secret' });
  assert.deepEqual(sent, input); assert.deepEqual(Object.keys(sent), [...describeFields('pet-meal')]);
  assert.deepEqual(PET_MEAL_TASK.buildSchema(input).properties.foodId.enum, input.foods);
  assert.deepEqual(PET_MEAL_TASK.validate(advice, { ...input, satiation: 45.1 }), advice);
  assert.equal(PET_MEAL_TASK.validate(advice, { ...input, satiation: 45 }).waitMinutes, 0);
  for (const raw of ['```json\n{}\n```', 'x'.repeat(1025), JSON.stringify({ ...advice, extra: 'secret' }),
    JSON.stringify({ ...advice, waitMinutes: '10' }), JSON.stringify({ ...advice, foodId: 'cake' })]) {
    assert.throws(() => PET_MEAL_TASK.validate(PET_MEAL_TASK.repair(raw), input));
  }
});
for (const outcome of ['schema', 'protocol', 'malformed', 'extra', 'oversized', 'endpoint']) {
  test(`actual client ${outcome} failure uses at most one transport attempt and never repairs`, async () => {
    let posts = 0, attempts = 0, allowed = 0;
    const payloads = [], failures = [];
    const f = runtimeFixture({ makeClient: options => {
      const client = createApiClient({ ...options,
      ...(outcome === 'endpoint' ? { baseUrl: 'not a url' } : {}),
      trace: { begin: () => ({ output() {}, note() {}, done() {}, failed: error => failures.push(error.message) }) },
      post: async (_endpoint, body) => {
        posts++; payloads.push(JSON.parse(body.messages[1].content));
        if (outcome === 'schema') throw new ProviderHttpError(400, 'Unsupported response_format');
        if (outcome === 'protocol') throw new ProviderHttpError(404, 'missing route');
        return reply(outcome === 'malformed' ? 'not-json' : outcome === 'oversized' ? 'x'.repeat(1025)
          : JSON.stringify({ ...advice, extra: 'private response' }));
      } });
      return { run: (name, payload, request) => client.run(name, payload, { ...request, beforeRequest() {
        attempts++; request.beforeRequest(); allowed++;
      } }) };
    } });
    assert.equal((await f.runtime.tick()).meal.foodId, 'berry');
    assert.equal(posts, outcome === 'endpoint' ? 0 : 1); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.read().pet.care.plan, null); assert.deepEqual(f.errors, []);
    assert.equal(f.calls.schedule, 1); assert.equal(f.calls.cancelSchedule, 1);
    for (const payload of payloads) assert.deepEqual(Object.keys(payload), ['character', 'satiation', 'meal', 'foods', 'favorite']);
    assert.equal(allowed, outcome === 'endpoint' ? 0 : 1);
    assert.equal(attempts, outcome === 'endpoint' ? 0 : ['schema', 'protocol'].includes(outcome) ? 2 : 1);
    if (['schema', 'protocol'].includes(outcome)) assert.match(failures[0], /budget/);
  });
}

for (const point of ['budget-clock', 'postcharge-owner-check']) {
  test(`real manual-feed invalidation at ${point} prevents even the first fake post`, async () => {
    let f, armed = false, clocks = 0, assertions = 0, posts = 0, feed, signal, abortedAtCommit;
    const invalidate = () => {
      armed = false;
      feed = f.feed.execute(f.request('berry'));
      abortedAtCommit = signal.aborted;
    };
    f = runtimeFixture({ hooks: {
      beforeClock() { if (armed && point === 'budget-clock' && ++clocks === 2) invalidate(); },
      afterAssert() { if (armed && point === 'postcharge-owner-check' && ++assertions === 2) invalidate(); }
    }, makeClient: options => {
      const client = createApiClient({ ...options, post: async () => {
        posts++; return reply(JSON.stringify({ foodId: 'berry', waitMinutes: 0, reactionIndex: 0 }));
      } });
      return { run(name, payload, request) {
        signal = request.signal; armed = true; return client.run(name, payload, request);
      } };
    } });
    const result = await f.runtime.tick();
    assert.equal(feed?.ok, true); assert.equal(abortedAtCommit, false, 'the command changed current identity without abort dispatch');
    assert.equal(posts, 0); assert.equal(result.ok, false); assert.equal(signal.aborted, true);
    assert.equal(f.read().pet.foodInventory.berry, 1); assert.equal(f.read().pet.totalFeeds, 1);
    assert.equal(f.read().pet.care.autoFeeds, 0); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.presentations.length, 0);
  });
}

test('late fake-post success after the deadline cannot report usage or install a plan', async () => {
  const response = deferred(), posted = deferred(), usage = [];
  let posts = 0, signal;
  const f = runtimeFixture({ makeClient: options => {
    const client = createApiClient({ ...options, post: (_endpoint, _body, request) => {
      posts++; signal = request.signal; posted.resolve(); return response.promise;
    } });
    return { run: (name, payload, request) => client.run(name, payload, { ...request, onUsage: value => usage.push(value) }) };
  } });
  const pending = f.runtime.tick(); await posted.promise; f.fireDeadline();
  const result = await pending, before = f.read(); assert.equal(result.meal.foodId, 'berry');
  response.resolve({ ...reply(JSON.stringify(advice)), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  await f.waitForProviderSettled();
  assert.equal(posts, 1); assert.equal(signal.aborted, true); assert.deepEqual(usage, []);
  assert.deepEqual(f.read(), before); assert.equal(f.presentations.length, 1);
});
for (const when of ['before-invocation', 'before-send', 'during-post', 'after-response', 'apply-gap']) {
  test(`actual meal client with fake post rejects cancellation ${when}`, async () => {
    let posts = 0, sentSignal;
    const posted = deferred(), response = deferred();
    const usage = [];
    let f;
    f = runtimeFixture({ makeClient: options => {
      const client = createApiClient({ ...options,
        post: async (_endpoint, _body, request) => {
          sentSignal = request.signal; posts++;
          posted.resolve();
          if (when === 'during-post') await response.promise;
          if (when === 'after-response') f.requestScope.invalidate();
          if (when === 'apply-gap') queueMicrotask(() => f.requestScope.invalidate());
          return reply(JSON.stringify({ foodId: 'berry', waitMinutes: 0, reactionIndex: 1 }));
        } });
      if (when === 'before-send') f.requestScope.invalidate();
      return { run: (name, payload, request) => client.run(name, payload, { ...request, onUsage: value => usage.push(value) }) };
    } });
    const pending = f.runtime.tick();
    if (when === 'before-invocation') f.requestScope.invalidate();
    if (when === 'during-post') { await posted.promise; f.requestScope.invalidate(); }
    const result = await pending; assert.equal(result.ok, false);
    response.resolve();
    if (f.calls.provider) await f.waitForProviderSettled();
    assert.equal(posts, ['during-post', 'after-response', 'apply-gap'].includes(when) ? 1 : 0);
    assert.equal(f.calls.provider, when === 'before-invocation' ? 0 : 1);
    assert.equal(f.read().pet.foodInventory.berry, 2); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.presentations.length, 0); assert.equal(f.timeouts.size, 0);
    assert.deepEqual(usage, []); if (sentSignal) assert.equal(sentSignal.aborted, true);
  });
}
