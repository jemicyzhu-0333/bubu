'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createFeedCompanionWorkflow, createAdvanceMealCareCommand,
  createResolveMealDecisionCommand, projectCompanionFeedState } = require('../src/application');
const { progress } = require('../src/capabilities');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { normalizeRewardLedger, recordReward, createRewardEvent } = require('../src/core/reward-ledger');
const { localDayKey } = require('../src/core/calendar');
const { FOODS } = require('../src/content/legacy-pet-content');
const { foodRequest } = require('../test-support/food-request-fixture');
const START = new Date(2026, 9, 6, 9).getTime();
function fixture() {
  let at = START, state = normalizePersistedState({}, { now: at }), revision = 0, fail = false;
  state.pet.satiation = 40; state.pet.foodInventory = Object.fromEntries(Object.keys(state.pet.foodInventory).map(id => [id, 0]));
  const effects = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) { if (fail) throw new Error('synthetic commit refusal');
      state = normalizePersistedState(candidate, { now: at }); revision++; return structuredClone(state); } };
  const ports = { unitOfWork: createUnitOfWork({ repository }), clock: { now: () => at }, foods: FOODS, publish: fact => effects.push(fact) };
  const feed = createFeedCompanionWorkflow(ports);
  const advance = createAdvanceMealCareCommand({ ...ports, calendar: now => ({ dayKey: localDayKey(now), minuteOfDay: 540 }) });
  const resolve = createResolveMealDecisionCommand(ports);
  return { feed, advance, resolve, effects, read: () => structuredClone(state), revision: () => revision,
    edit: fn => { fn(state); state = normalizePersistedState(state, { now: at }); },
    time: value => { at = value; }, fail: value => { fail = value; }, request: id => foodRequest(id, at),
    view: () => projectCompanionFeedState(state, at) };
}

test('three zero-XP daily facts survive display trimming without changing progress', () => {
  const state = normalizePersistedState({}, { now: START }), dayKey = localDayKey(START);
  const initial = { xp: state.xp, stats: structuredClone(state.stats), companion: structuredClone(state.companion) };
  for (let i = 0; i < 3; i++) assert.equal(progress.basicMeals.claimBasicMeal(state, { dayKey, at: START + i }).ok, true);
  assert.equal(progress.basicMeals.claimBasicMeal(state, { dayKey, at: START + 4 }).reason, 'basic-meal-limit');
  state.rewardLedger = recordReward(state.rewardLedger, createRewardEvent({ eventId: 'unrelated', source: 'test',
    baseReward: 0, dateKey: dayKey, createdAt: START + 5 }), { maxEvents: 1 }).ledger;
  assert.equal(state.rewardLedger.events.length, 1);
  state.rewardLedger = normalizeRewardLedger(state.rewardLedger);
  assert.equal(progress.basicMeals.basicMealAllowance(state.rewardLedger, dayKey).remaining, 0);
  assert.deepEqual({ xp: state.xp, stats: state.stats, companion: state.companion }, initial);
});

test('manual and automatic meals share one profile budget, preserve baseline and replay the third receipt', () => {
  const f = fixture(); assert.equal(f.advance.execute().meal.foodId, 'basic');
  assert.equal(f.read().pet.satiation, 55); assert.equal(f.view().basicMeal.remaining, 2);
  f.edit(state => { state.pet.satiation = 45; state.currentSkin = 'usagi'; });
  assert.equal(f.feed.execute(f.request('basic')).ok, true); assert.equal(f.view().basicMeal.remaining, 1);
  f.edit(state => { state.pet.satiation = 25; });
  const third = f.request('basic'); assert.equal(f.feed.execute(third).satiation, 55);
  const before = f.read(), effectCount = f.effects.length;
  assert.equal(f.feed.execute(third).replayed, true); assert.deepEqual(f.read(), before); assert.equal(f.effects.length, effectCount);
  assert.equal(f.feed.execute(f.request('basic')).reason, 'basic-meal-limit');
  assert.equal(f.read().pet.totalFeeds, 0); assert.equal(f.read().xp, 0); assert.equal(f.read().pet.foodTickets, 6);
  assert.equal(f.read().companion.relationships.dango.bondPoints, 0); assert.equal(f.read().companion.relationships.usagi.bondPoints, 0);
});

test('ineligible or failed manual meals do not consume allowance or mutate canonical state', () => {
  const f = fixture(); f.edit(state => { state.pet.satiation = 45.001; });
  const full = f.read(); assert.equal(f.feed.execute(f.request('basic')).reason, 'basic-meal-not-needed'); assert.deepEqual(f.read(), full);
  f.edit(state => { state.pet.satiation = 40; }); const hungry = f.read(); f.fail(true);
  assert.throws(() => f.feed.execute(f.request('basic')), /commit refusal/); assert.deepEqual(f.read(), hungry);
  assert.equal(f.view().basicMeal.remaining, 3); assert.equal(f.effects.length, 0);
});

test('manual midnight reset and backward clock changes cannot create extra free slots', () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) { f.edit(state => { state.pet.satiation = 40; }); assert.equal(f.feed.execute(f.request('basic')).ok, true); }
  f.time(new Date(2026, 9, 7, 0).getTime()); f.edit(state => { state.pet.satiation = 40; });
  assert.equal(f.feed.execute(f.request('basic')).ok, true);
  assert.equal(f.read().pet.care.mealDay, '2026-10-07'); assert.equal(f.view().basicMeal.remaining, 2);
  f.time(START + 1000); assert.equal(f.view().basicMeal.remaining, 2); assert.equal(f.view().basicMeal.dayKey, '2026-10-07');
});

test('an exhausted empty pantry still samples appetite without AI reservation, meal or reminder', () => {
  const f = fixture(); f.edit(state => {
    state.settings.aiBreakdownEnabled = state.settings.aiPetMealsEnabled = true;
    for (let i = 0; i < 3; i++) progress.basicMeals.claimBasicMeal(state, { dayKey: localDayKey(START), at: START });
  });
  const result = f.advance.execute({ aiAvailable: true, canRemind: true });
  assert.equal(result.ok, true); assert.equal(result.intent, null); assert.equal(result.meal, null); assert.equal(result.reminder, null);
  assert.equal(f.read().pet.care.aiCalls, 0); assert.equal(f.read().pet.care.autoFeeds, 0); assert.equal(f.read().pet.care.lastObservedAt, START);
  f.edit(state => { state.pet.foodInventory.milk = 1; }); f.time(START + 300000);
  assert.equal(f.advance.execute().meal.foodId, 'milk'); assert.equal(f.view().basicMeal.remaining, 0);
});

test('AI selection includes free food only when currently hungry and allowance remains', () => {
  const f = fixture(); f.edit(state => { state.settings.aiBreakdownEnabled = state.settings.aiPetMealsEnabled = true; });
  const intent = f.advance.execute({ aiAvailable: true }).intent;
  assert.deepEqual(intent.payload.foods, ['basic']);
  const result = f.resolve.execute({ decisionId: intent.id, advice: { foodId: 'basic', waitMinutes: 5, reactionIndex: 2 } });
  assert.equal(result.meal.foodId, 'basic'); assert.equal(f.read().pet.satiation, 55);
  assert.equal(f.read().pet.care.plan, null); assert.equal(f.view().basicMeal.remaining, 2);
});

test('SQLite reopen and expired command-receipt pruning never replenish daily food entitlement', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
  const { PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basic-meal-sql-'));
  let now = START, repository;
  const open = () => createSqliteStateAdapter({ userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION,
    normalize: normalizePersistedState, now: () => now });
  try {
    repository = open();
    const feed = createFeedCompanionWorkflow({ unitOfWork: createUnitOfWork({ repository }), clock: { now: () => now }, foods: FOODS });
    for (let i = 0; i < 3; i++) {
      repository.update(state => { state.pet.satiation = 40; }, { now });
      assert.equal(feed.execute(foodRequest('basic', now)).ok, true);
    }
    now += 11 * 60000;
    repository.update(state => { state.pet.foodInventory.berry = 1; }, { now });
    assert.equal(feed.execute(foodRequest('berry', now)).ok, true);
    repository.close(); repository = open();
    repository.update(state => { state.pet.satiation = 40; }, { now });
    const restored = createFeedCompanionWorkflow({ unitOfWork: createUnitOfWork({ repository }), clock: { now: () => now }, foods: FOODS });
    assert.equal(projectCompanionFeedState(repository.snapshot(), now).basicMeal.remaining, 0);
    assert.equal(restored.execute(foodRequest('basic', now)).reason, 'basic-meal-limit');
    assert.equal(repository.snapshot().schemaVersion, PERSISTED_SCHEMA_VERSION);
  } finally { repository?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a lost successful commit response replays the exact meal without taking another slot', () => {
  let state = normalizePersistedState({}, { now: START }), revision = 0, lose = true;
  state.pet.satiation = 40;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(next) { state = normalizePersistedState(next, { now: START }); revision++;
      if (lose) { lose = false; throw new Error('response lost after canonical commit'); } return structuredClone(state); } };
  const feed = createFeedCompanionWorkflow({ unitOfWork: createUnitOfWork({ repository }), clock: { now: () => START }, foods: FOODS });
  const request = foodRequest('basic', START);
  assert.throws(() => feed.execute(request), /response lost/);
  assert.equal(feed.execute(request).replayed, true);
  assert.equal(revision, 1); assert.equal(projectCompanionFeedState(state, START).basicMeal.remaining, 2);
});

test('landed but unverified SQLite food commit blocks retries until exact authority recovery', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
  const { PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
  const { faultFactory } = require('../test-support/sqlite-authority-faults');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basic-meal-unknown-')), database = path.join(directory, 'config.sqlite');
  let repository, armed = false, blocked = false;
  const options = { userDataPath: directory, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => START };
  try {
    repository = createSqliteStateAdapter({ ...options, authorityFactory: faultFactory(event => {
      if (armed && event.filePath === database && event.type === 'after' && event.sql === 'COMMIT') {
        armed = false; blocked = true; throw new Error('landed acknowledgement lost');
      }
      if (blocked && event.filePath === database && event.type === 'open' && event.readOnly) throw new Error('readback unavailable');
    }) });
    repository.update(state => { state.pet.satiation = 40; }, { now: START });
    const effects = [], request = foodRequest('basic', START);
    const makeFeed = () => createFeedCompanionWorkflow({ unitOfWork: createUnitOfWork({ repository }),
      clock: { now: () => START }, foods: FOODS, publish: fact => effects.push(fact) });
    const first = makeFeed(); armed = true;
    assert.throws(() => first.execute(request), /outcome-unknown/);
    assert.throws(() => first.execute(request), /outcome-unknown/);
    assert.equal(effects.length, 0); repository.close();
    repository = createSqliteStateAdapter(options);
    assert.equal(projectCompanionFeedState(repository.snapshot(), START).basicMeal.remaining, 2);
    assert.equal(repository.snapshot().pet.satiation, 55);
    assert.equal(makeFeed().execute(request).replayed, true);
    assert.equal(effects.length, 0);
  } finally { repository?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('three basic claims survive the actual five-thousand display-event cap and two-hundred receipt churn', () => {
  const f = fixture();
  const initialCompanion = f.read().companion;
  for (let index = 0; index < 3; index++) {
    f.edit(state => { state.pet.satiation = 40; }); assert.equal(f.feed.execute(f.request('basic')).ok, true);
  }
  f.edit(state => {
    state.rewardLedger = normalizeRewardLedger({ ...state.rewardLedger, events: [...state.rewardLedger.events,
      ...Array.from({ length: 5000 }, (_, index) => createRewardEvent({ eventId: `display-only:${index}`,
        source: 'test', baseReward: 0, dateKey: localDayKey(START), createdAt: START + index + 1 }))] }, { maxEvents: 5000 });
    state.pet.foodCommands = Array.from({ length: 200 }, (_, index) => ({ commandId: `${START}-receipt${index}`, issuedAt: START,
      kind: 'buy', foodId: 'berry', result: { ok: true, foodId: 'berry', price: 1, foodTickets: 5, inventory: 1 } }));
    state.pet.foodInventory.berry = 1;
  });
  assert.equal(f.read().rewardLedger.events.length, 5000);
  assert.equal(f.read().rewardLedger.events.some(event => event.source === 'basic-meal'), false);
  assert.equal(f.view().basicMeal.remaining, 0); assert.deepEqual(f.read().companion, initialCompanion);
  f.time(START + 11 * 60000); assert.equal(f.feed.execute(f.request('berry')).ok, true);
  assert.equal(f.read().pet.foodCommands.length, 1);
  f.edit(state => { state.pet.satiation = 40; state.currentSkin = 'usagi'; });
  assert.equal(f.feed.execute(f.request('basic')).reason, 'basic-meal-limit'); assert.equal(f.view().basicMeal.remaining, 0);
  assert.equal(f.read().rewardLedger.version, 3);
});
