'use strict';

// Separate, unexecuted transport obligation. These deliberately reach postJson,
// its real timer and slow DNS, and monkeypatch HTTPS. The fake-post/no-network
// meal gate does not admit this suite or node:events listener inspection.
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { getEventListeners } = require('node:events');
const { createApiClient } = require('../src/core/llm');
const { runtimeFixture, deferred } = require('../test-support/meal-runtime-fixture');
const reply = content => ({ choices: [{ message: { content } }] });

for (const when of ['before-send', 'during-dns', 'after-response', 'apply-gap']) {
  test(`actual meal client rejects cancellation ${when} and ignores late work`, async t => {
    let finishDns, posts = 0, opens = 0, sentSignal;
    const dnsStarted = deferred();
    t.mock.method(https, 'request', () => { opens++; throw new Error('unexpected real HTTP boundary'); });
    let f;
    f = runtimeFixture({ makeClient: options => {
      const client = createApiClient({ ...options,
        lookup: () => new Promise(resolve => { finishDns = resolve; dnsStarted.resolve(); }),
        ...(when === 'during-dns' ? {} : { post: async (_endpoint, _body, request) => {
          sentSignal = request.signal; posts++;
          if (when === 'after-response') f.requestScope.invalidate();
          if (when === 'apply-gap') queueMicrotask(() => f.requestScope.invalidate());
          return reply(JSON.stringify({ foodId: 'berry', waitMinutes: 0, reactionIndex: 1 }));
        } }) });
      if (when === 'before-send') f.requestScope.invalidate();
      return client;
    } });
    const pending = f.runtime.tick();
    if (when === 'during-dns') {
      await dnsStarted.promise; assert.equal(typeof finishDns, 'function'); f.requestScope.invalidate();
    }
    const result = await pending; assert.equal(result.ok, false);
    if (finishDns) finishDns([{ address: '8.8.8.8', family: 4 }]); await new Promise(setImmediate);
    assert.equal(opens, 0); assert.equal(posts, ['after-response', 'apply-gap'].includes(when) ? 1 : 0);
    assert.equal(f.read().pet.foodInventory.berry, 2); assert.equal(f.read().pet.care.aiCalls, 1);
    assert.equal(f.presentations.length, 0); assert.equal(f.timeouts.size, 0);
    if (sentSignal) assert.equal(getEventListeners(sentSignal, 'abort').length, 0);
  });
}

for (const kind of ['skin', 'manual-feed']) test(`successful ${kind} aborts pending DNS immediately before its next microtask`, async t => {
  let finishDns, opens = 0;
  const dnsStarted = deferred();
  t.mock.method(https, 'request', () => { opens++; throw new Error('unexpected HTTP open'); });
  const f = runtimeFixture({ makeClient: options => createApiClient({ ...options,
    lookup: () => new Promise(resolve => { finishDns = resolve; dnsStarted.resolve(); }) }) });
  const pending = f.runtime.tick(); await dnsStarted.promise; assert.equal(typeof finishDns, 'function');
  if (kind === 'skin') {
    const command = require('../src/capabilities').companion.selectSkin.createSelectSkinCommand({ unitOfWork: f.unitOfWork,
      availableSkinIds: ['pink', 'usagi'], publish: f.runtime.invalidateAdvice });
    f.edit(s => { s.unlockedSkins.push('usagi'); }); assert.equal(command.execute({ skinId: 'usagi' }).ok, true);
  } else {
    const handlers = new Map();
    require('../src/bootstrap/companion-feeding').createCompanionFeeding({ unitOfWork: f.unitOfWork, clock: f.clock,
      foods: require('../src/content/legacy-pet-content').FOODS, announceBond() {}, publishChange() {},
      invalidateMealAdvice: f.runtime.invalidateAdvice }).register((name, handler) => handlers.set(name, handler));
    assert.equal(handlers.get('pet:feed')({}, f.request('berry')).ok, true);
  }
  // No polling callback is fired before the formerly pending DNS resolution.
  finishDns([{ address: '8.8.8.8', family: 4 }]); assert.equal((await pending).ok, false); await new Promise(setImmediate);
  assert.equal(opens, 0); assert.equal(f.read().pet.care.plan, null); assert.equal(f.read().pet.care.aiCalls, 1);
  assert.equal(f.read().pet.foodInventory.berry, kind === 'manual-feed' ? 1 : 2);
});
