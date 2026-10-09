'use strict';
const { fixture, START, FOODS } = require('./growth-food-fixture');
const { createCompanionMeals } = require('../src/bootstrap/companion-meals');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { createUpdatePreferencesWorkflow } = require('../src/application/workflows/update-preferences');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function runtimeFixture({ makeClient = () => { throw new Error('unexpected provider'); }, enabled = true,
  configured = true, publishState, present, hooks = {}, firstTimerId = 1 } = {}) {
  const f = fixture();
  f.edit(s => { s.settings.aiBreakdownEnabled = s.settings.aiPetMealsEnabled = enabled; s.settings.aiModel = 'synthetic-model'; });
  const intervals = new Map(), timeouts = new Map(), resources = new Map(), publications = [], presentations = [], errors = [];
  const calls = { clock: 0, read: 0, provider: 0, begin: 0, assertCurrent: 0, release: 0,
    schedule: 0, cancelSchedule: 0, interval: 0, clear: 0, transaction: 0 };
  const events = [], leases = [], providerStarts = [], providerSettlements = [];
  let locked = false, visible = true, credentials = configured, timerId = firstTimerId;
  const scope = createProviderRequestScope();
  const requestScope = {
    begin(options) {
      calls.begin++; events.push('lease:begin'); hooks.beforeBegin?.();
      const lease = scope.begin(options);
      leases.push(lease); hooks.afterBegin?.(lease);
      return {
        signal: lease.signal,
        assertCurrent() {
          calls.assertCurrent++; hooks.beforeAssert?.();
          lease.assertCurrent(); hooks.afterAssert?.();
        },
        release() {
          calls.release++; events.push('lease:release'); hooks.beforeRelease?.();
          lease.release(); hooks.afterRelease?.();
        }
      };
    },
    invalidate: scope.invalidate, close: scope.close
  };
  const readSnapshot = () => { calls.read++; hooks.beforeRead?.(); return f.read(); };
  const clock = { now() { calls.clock++; hooks.beforeClock?.(); return f.clock.now(); } };
  const unitOfWork = { run(options) {
    calls.transaction++; events.push('transaction:begin'); hooks.beforeTransaction?.(options);
    const result = f.unitOfWork.run(options);
    events.push('transaction:end'); hooks.afterTransaction?.(result);
    return result;
  } };
  const milestone = (list, index) => (list[index - 1] ||= deferred());
  const runtime = createCompanionMeals({ unitOfWork, readSnapshot, clock, foods: FOODS,
    credentialStore: { status: () => ({ configured: credentials }), get: () => credentials ? 'synthetic-secret' : null },
    requestScope, isLocked: () => { hooks.beforeLocked?.(); return locked; },
    isVisible: () => { hooks.beforeVisible?.(); return visible; },
    makeClient(options) {
      const client = makeClient(options);
      return { run(...args) {
        const index = ++calls.provider;
        events.push('provider:start'); milestone(providerStarts, index).resolve(args);
        let result;
        try { result = client.run(...args); }
        catch (error) { milestone(providerSettlements, index).resolve(); throw error; }
        return Promise.resolve(result).then(value => {
          milestone(providerSettlements, index).resolve(); return value;
        }, error => { milestone(providerSettlements, index).resolve(); throw error; });
      } };
    },
    lifecycle: {
      register: (id, fn) => resources.set(id, fn),
      interval(id, fn, ms) {
        calls.interval++; hooks.beforeInterval?.(id, fn, ms);
        intervals.set(id, { fn, ms }); hooks.afterInterval?.(id, fn, ms);
      },
      clear(id) {
        calls.clear++; events.push(`observation:clear:${id}`); hooks.beforeClear?.(id);
        intervals.delete(id); hooks.afterClear?.(id);
      }
    },
    setTimer(fn, ms) {
      calls.schedule++; hooks.beforeSchedule?.(fn, ms);
      const id = timerId++; timeouts.set(id, { fn, ms }); hooks.afterSchedule?.(id, fn, ms); return id;
    },
    clearTimer(id) {
      calls.cancelSchedule++; events.push('execution:clear'); hooks.beforeCancelSchedule?.(id);
      timeouts.delete(id); hooks.afterCancelSchedule?.(id);
    },
    publishState: fact => { publications.push(fact); publishState?.(fact); },
    present: fact => { presentations.push(fact); present?.(fact); }, reportError: error => errors.push(error) });
  const preferences = createUpdatePreferencesWorkflow({ unitOfWork, clock,
    publish: fact => runtime.settingsChanged(fact.changedKeys) });
  return { ...f, runtime, requestScope, preferences, intervals, timeouts, resources, publications, presentations, errors,
    calls, events, leases,
    waitForProviderStarted: (index = 1) => milestone(providerStarts, index).promise,
    waitForProviderSettled: (index = 1) => milestone(providerSettlements, index).promise,
    visible: value => { visible = value; }, credentials: value => { credentials = value; runtime.invalidateAdvice(); },
    lock: value => { locked = value; runtime.interrupt(); },
    fireDeadline: () => { for (const [id, timer] of timeouts) { timeouts.delete(id); timer.fn(); } } };
}
module.exports = { runtimeFixture, deferred, START };
