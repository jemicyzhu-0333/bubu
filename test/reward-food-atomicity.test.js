'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const {
  startFocus,
  stopSession
} = require('../src/capabilities/execution').focusSession;
const {
  createUnitOfWork,
  createSettleFocusSessionWorkflow
} = require('../src/application');
const { SurpriseDirector } = require('../src/core/surprise-director');

const ROOT = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function baseState() {
  return normalizePersistedState({
    tasks: [{
      id: 'task-1', title: '完成这一小步', done: false,
      createdAt: 1, expiresAt: '2030-01-01T00:00:00.000Z'
    }]
  }, { now: 1_000 });
}

test('focus reward and bond commit once without distributing food', () => {
  let persisted = baseState();
  const active = startFocus(persisted.focusSession, {
    now: 1_000,
    durationMs: 5 * 60 * 1000,
    sessionId: 'focus-food-atomic',
    taskId: 'task-1'
  }).session;
  persisted.focusSession = active;
  const completed = stopSession(active, 301_000);
  const events = [];
  let commits = 0;
  const initialFish = persisted.pet.foodInventory.fish;
  let revision = 0;
  const repository = {
    snapshot: () => structuredClone(persisted),
    revision: () => revision,
    commit: (candidate, context) => {
      persisted = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      events.push(['commit', persisted.xp, persisted.pet.foodInventory.fish]);
      return structuredClone(persisted);
    }
  };
  const workflow = createSettleFocusSessionWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 301_000 },
    publish: () => events.push(['publish'])
  });

  const result = workflow.execute({
    nextSession: completed.session,
    completion: completed.completion,
    settledAt: 301_000
  });
  assert.equal(result.reward.recorded, true);
  assert.equal(result.foodDrop, null);
  assert.equal(commits, 1);
  assert.equal(persisted.xp, 0);
  assert.equal(persisted.pet.foodInventory.fish, initialFish);
  assert.ok(persisted.rewardLedger.seenEventIds.includes('session-settle:focus-food-atomic:v1'));
  assert.equal(persisted.companion.relationships.dango.bondPoints, 0, 'bond rides the same snapshot as XP and food');
  assert.deepEqual(events, [
    ['commit', 0, initialFish],
    ['publish']
  ]);

  const retry = workflow.execute({
    nextSession: completed.session,
    completion: completed.completion,
    settledAt: 301_000
  });
  assert.equal(retry.reward.recorded, false);
  assert.equal(retry.foodDrop, null);
  assert.equal(persisted.pet.foodInventory.fish, initialFish);
});

test('task completion IPC is a thin adapter over the atomic work-item workflow', () => {
  const handlers = new Map();
  const source = sourceBetween(
    mainSource,
    "registerIpc('tasks:complete',",
    '\n\n// 跳过一次重复'
  );
  const calls = [];
  const sandbox = {
    registerIpc: (channel, handler) => handlers.set(channel, handler),
    completeWorkItemWorkflow: {
      execute: input => {
        calls.push(input);
        return { ok: true, done: true, nextOccurrenceDate: null };
      }
    },
    petTellExpression: () => {}
  };
  const context = vm.createContext(sandbox);
  new vm.Script(source).runInContext(context);
  const complete = handlers.get('tasks:complete');

  assert.deepEqual({ ...complete(null, { id: 'task-1', confirmUnfinishedSteps: false }) }, {
    ok: true, done: true, nextOccurrenceDate: null
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { taskId: 'task-1', confirmUnfinishedSteps: false }
  ]);
  assert.doesNotMatch(source, /store\.(?:snapshot|set)|commitCanonicalState|Math\.random/);
  assert.doesNotMatch(source, /grantRandomFoodToState|applyBondToState|autoPauseSessionForCompletedTask/);
  assert.doesNotMatch(source, /react\.celebrate|publishFoodDrop|checkAndUnlockSkins/);
});

test('passive treasure discovery cannot mutate XP, food, or the reward ledger', () => {
  let persisted = baseState();
  const manifest = { version: 1, packId: 'builtin-core', assets: [], cues: [{
    id: 'egg.dig-treasure', familyId: 'attention.discovery', kind: 'attention',
    weight: 1, priority: 20, cost: 1, globalCooldownMs: 0,
    familyCooldownMs: 0, cooldownMs: 0, focusAllowed: false,
    discoveryId: 'builtin-core.dig-treasure',
    variants: [{
      id: 'default', animationId: 'dig-treasure', message: '发现收藏',
      durationMs: 1000, assetIds: [], static: false
    }]
  }] };
  const director = new SurpriseDirector({
    manifest,
    loadState: () => persisted.companion,
    saveState: companion => { persisted = { ...persisted, companion }; },
    clock: { now: () => 1000, dayKey: () => '2026-08-30' },
    monotonicClock: { now: () => 100 },
    rng: () => 0,
    idFactory: () => 'decision-treasure',
    deliver: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  });
  const before = {
    xp: persisted.xp,
    food: structuredClone(persisted.pet.foodInventory),
    ledger: structuredClone(persisted.rewardLedger)
  };
  assert.equal(director.tick({ visible: true, activityMode: 'balanced' }).issued, true);
  director.acknowledge({ decisionId: 'decision-treasure', status: 'received' });
  director.acknowledge({ decisionId: 'decision-treasure', status: 'started' });
  director.acknowledge({ decisionId: 'decision-treasure', status: 'completed' });

  assert.equal(persisted.companion.collection.discoveries['builtin-core.dig-treasure'], 1000);
  assert.equal(persisted.xp, before.xp);
  assert.deepEqual(persisted.pet.foodInventory, before.food);
  assert.deepEqual(persisted.rewardLedger, before.ledger);
});
