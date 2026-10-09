'use strict';
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { FOODS } = require('../src/content/legacy-pet-content');
const { localDayKey } = require('../src/core/calendar');
const { createFoodRequest } = require('../src/capabilities/companion/contract/food-request.mjs');
const { createFeedCompanionWorkflow } = require('../src/application/workflows/feed-companion');
const { createBuyCompanionFoodWorkflow } = require('../src/application/workflows/buy-companion-food');
const { createAdvanceMealCareCommand } = require('../src/application/workflows/advance-meal-care');
const { createResolveMealDecisionCommand } = require('../src/application/workflows/resolve-meal-decision');
const { projectCompanionFeedState } = require('../src/application/queries/companion-feed-state');
const START = new Date(2026, 9, 6, 9).getTime();
function fixture({ initial = {}, publish = null } = {}) {
  let now = START, revision = 0, fail = false, nonce = 0;
  let state = normalizePersistedState(initial, { now });
  const effects = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) {
      if (fail) throw new Error('synthetic commit refusal');
      const canonical = normalizePersistedState(candidate, { now });
      assert.deepEqual(canonical, candidate, 'business draft is already canonical');
      state = canonical; revision++; return structuredClone(state);
    } };
  const ports = { unitOfWork: createUnitOfWork({ repository }), clock: { now: () => now }, foods: FOODS,
    publish: publish || (fact => effects.push(fact)) };
  return { ...ports, repository, effects,
    feed: createFeedCompanionWorkflow(ports), buy: createBuyCompanionFoodWorkflow(ports),
    advance: createAdvanceMealCareCommand({ ...ports, calendar: at => ({ dayKey: localDayKey(at),
      minuteOfDay: new Date(at).getHours() * 60 + new Date(at).getMinutes() }) }),
    resolve: createResolveMealDecisionCommand(ports),
    read: () => structuredClone(state), revision: () => revision,
    edit: fn => { fn(state); }, time: value => { now = value; }, now: () => now,
    fail: value => { fail = value; }, request: id => createFoodRequest(id, now, `test-${++nonce}`),
    view: () => projectCompanionFeedState(state, now) };
}
module.exports = { fixture, START, FOODS };
