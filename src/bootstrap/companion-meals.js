'use strict';
const { createAdvanceMealCareCommand } = require('../application/workflows/advance-meal-care');
const { createResolveMealDecisionCommand } = require('../application/workflows/resolve-meal-decision');
const { createRunExecution } = require('../application/ai/run-execution');
const { companion, execution } = require('../capabilities');
const { createApiClient } = require('../core/llm');
const { localDayKey } = require('../core/calendar');
const { runPostCommitEffect } = require('../shared/post-commit-effects');
const { SAMPLE_MS, MEAL_SETTING_KEYS } = companion.mealRhythm;
const DEADLINE_MS = 5000;
const SETUP_STAGES = new Set(['controller', 'lease', 'signal', 'observation', 'execution',
  'ports', 'freshness', 'budget', 'listener', 'clock', 'schedule']);
const RESOURCE_STATES = new Set(['not-acquired', 'released', 'unconfirmed']);
function ownData(value, key) {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch (_) { return undefined; }
}
function executionCleanup(value, missing = 'unconfirmed') {
  const timer = ownData(value, 'timer'), listener = ownData(value, 'listener');
  const boundedTimer = RESOURCE_STATES.has(timer) ? timer : missing;
  const boundedListener = RESOURCE_STATES.has(listener) ? listener : missing;
  return Object.freeze({ ok: boundedTimer !== 'unconfirmed' && boundedListener !== 'unconfirmed',
    timer: boundedTimer, listener: boundedListener });
}
function mealCalendar(now) {
  const date = new Date(now);
  return { dayKey: localDayKey(now), minuteOfDay: date.getHours() * 60 + date.getMinutes() };
}
function mealContext(snapshot, now, visible) {
  const session = snapshot.focusSession;
  const kind = execution.focusSession.sessionKind(session);
  const work = ['focus', 'quick-start'].includes(kind) ? execution.focusSession.elapsedMs(session, now) : 0;
  const total = Math.max(0, Math.floor(Number(snapshot.stats.totalFocusMs) || 0));
  return { workTotalMs: Math.min(Number.MAX_SAFE_INTEGER, total + work),
    canRemind: visible && !snapshot.settings.dnd && !['off', 'quiet'].includes(snapshot.settings.petActivityMode) && (!session || session.status === 'idle'),
    hasPlan: snapshot.tasks.some(task => !task.done && !task.skippedAt && task.plannedFor === localDayKey(now)) };
}

function createCompanionMeals({ unitOfWork, readSnapshot, clock, foods, credentialStore, lifecycle, requestScope,
  isLocked = () => false, isVisible = () => false, publishState, present, reportError = () => {},
  makeClient = createApiClient, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  for (const port of [readSnapshot, publishState, present, isLocked, isVisible, reportError]) {
    if (typeof port !== 'function') throw new TypeError('companion meal runtime requires scoped ports');
  }
  if (!requestScope?.begin || !lifecycle?.interval || !credentialStore?.status) throw new TypeError('meal runtime dependencies required');
  let working = false, stopped = false, active = null, started = false, epoch = 0, suspended = false;
  let resetPending = true, resetObservation = true, lastConfig = null;
  // Provider errors may contain response text or credentials. Only local codes leave this runtime.
  const report = () => { try { reportError(new Error('companion-meal-runtime-failed')); } catch (_) {} };
  const context = () => mealContext(readSnapshot(), clock.now(), isVisible() && !blocked());
  const blocked = () => stopped || suspended || isLocked() || !readSnapshot().settings.petEnabled;
  function publish(fact) {
    runPostCommitEffect(publishState, fact, report);
    if (!(fact.meal || fact.reminder) || !context().canRemind) return;
    runPostCommitEffect(present, fact.meal
      ? { selfMeal: { ...fact.meal, reaction: fact.reminder || fact.meal.reaction } }
      : { message: fact.reminder }, report);
  }
  const ports = { unitOfWork, clock, foods, publish, reportEffectError: report };
  const advance = createAdvanceMealCareCommand({ ...ports, calendar: mealCalendar });
  const resolve = createResolveMealDecisionCommand(ports);
  const invalidate = companion.invalidateMealCare.createInvalidateMealCareCommand(ports);
  function config() {
    const snapshot = readSnapshot(), settings = snapshot.settings;
    return JSON.stringify({ epoch, skin: snapshot.currentSkin,
      settings: MEAL_SETTING_KEYS.map(key => settings[key]), configured: credentialStore.status().configured === true });
  }
  function clearCaptured() {
    const result = invalidate.execute({ resetObservation });
    if (!result.ok) return false;
    resetPending = false; resetObservation = false;
    return true;
  }
  function revoke({ observation = false } = {}) {
    epoch += 1;
    resetPending = true;
    resetObservation ||= observation;
    active?.abort();
    try { clearCaptured(); } catch (_) { report(); }
    lastConfig = null;
  }
  function settingsChanged(keys) {
    if (keys.some(key => MEAL_SETTING_KEYS.includes(key)) && lastConfig !== config()) revoke({ observation: keys.includes('petEnabled') });
  }
  function interrupt() { revoke({ observation: true }); }

  async function decide(intent, captured) {
    let controller, request, signal, run, outcome;
    let terminal = false, setupComplete = false, setupStage = 'controller';
    let observation = 'not-acquired', lease = 'not-acquired', controllerState = 'not-acquired';
    let executionState = executionCleanup(null, 'not-acquired');
    const current = () => !resetPending && !blocked() && captured === config()
      && readSnapshot().pet.care.decision?.id === intent.id;
    function assertOwner() {
      request.assertCurrent();
      if (!current() || controller.signal.aborted || signal.aborted) throw new Error('meal-request-invalidated');
    }
    try {
      controllerState = 'unconfirmed';
      controller = new AbortController();
      active = controller;
      // Keep this lease until after synchronous apply. Releasing inside a provider
      // helper would allow an off/on microtask to resurrect an already-returned answer.
      setupStage = 'lease';
      lease = 'unconfirmed';
      request = requestScope.begin({ checkCurrent: current });
      setupStage = 'signal';
      signal = AbortSignal.any([controller.signal, request.signal]);
      setupStage = 'observation';
      observation = 'unconfirmed';
      lifecycle.interval('timer:companion-meal-ai-guard', () => {
        // A retained/reentrant callback must not even inspect a replacement owner.
        if (terminal) return;
        try { request.assertCurrent(); } catch (_) { controller.abort(); }
      }, 250);
      setupStage = 'execution';
      executionState = executionCleanup(null);
      run = createRunExecution({ now: () => clock.now(), schedule: setTimer, cancelSchedule: clearTimer, signal,
        limits: { maxReadCalls: 0, maxProviderCalls: 1, maxRepairAttempts: 0,
          deadlineMs: DEADLINE_MS, maxOutputChars: 1024 },
        assertCurrent() { assertOwner(); run.check(); }
      });
      setupComplete = true;
      let advice = null;
      try {
        let authorizedAttempt = false;
        const candidate = await run.wait(controls => {
          controls.assertOpen();
          assertOwner();
          controls.assertOpen();
          const settings = readSnapshot().settings;
          const client = makeClient({ baseUrl: settings.aiBaseUrl, model: settings.aiModel, timeoutMs: DEADLINE_MS,
            getCredential: () => credentialStore.get(), maxRepairAttempts: 0 });
          return client.run('pet-meal', intent.payload, {
            signal: controls.signal, maxOutputChars: 1024, maxRepairAttempts: 0,
            beforeRequest() {
              controls.beforeProviderAttempt();
              // Charging can synchronously revoke the owner. Recheck without
              // spending a second attempt; operation liveness fences both checks.
              controls.assertOpen();
              assertOwner();
              controls.assertOpen();
              authorizedAttempt = true;
            }
          });
        });
        if (authorizedAttempt) advice = candidate;
      } catch (_) { /* Ordinary provider failure has the same bounded local fallback. */ }
      const applyContext = context();
      // The remote deadline permits rule fallback. Only the original owner/lease
      // fences apply, after context ports and immediately before synchronous resolve.
      assertOwner();
      outcome = resolve.execute({ decisionId: intent.id, advice, ...applyContext });
    } catch (error) {
      if (setupComplete) outcome = { ok: false, reason: 'meal-request-invalidated' };
      else {
        if (setupStage === 'execution') {
          executionState = executionCleanup(ownData(error, 'cleanup'));
          const primitiveStage = ownData(error, 'setupStage');
          setupStage = SETUP_STAGES.has(primitiveStage) ? primitiveStage : 'execution';
        }
        outcome = { ok: false, reason: 'run-setup-failed', setupStage };
      }
    }
    finally {
      terminal = true;
      if (run) {
        try { executionState = executionCleanup(run.dispose()); }
        catch (_) { executionState = executionCleanup(null); }
      }
      if (observation !== 'not-acquired') {
        try { lifecycle.clear('timer:companion-meal-ai-guard'); observation = 'released'; }
        catch (_) { observation = 'unconfirmed'; }
      }
      if (request) {
        try { request.release(); lease = 'released'; }
        catch (_) { lease = 'unconfirmed'; }
      }
      if (controller) {
        try { controller.abort(); } catch (_) { /* Still attempt every independent release. */ }
        try { controllerState = controller.signal.aborted ? 'aborted' : 'unconfirmed'; }
        catch (_) { controllerState = 'unconfirmed'; }
      }
      if (active === controller) active = null;
    }
    // Controller status describes logical abortion, not native AbortSignal.any
    // bridge/listener disposal. Cleanup uncertainty never retries an accepted meal.
    const cleanup = Object.freeze({ ok: executionState.ok && observation !== 'unconfirmed'
      && lease !== 'unconfirmed' && controllerState !== 'unconfirmed', execution: executionState,
      observation, lease, controller: controllerState });
    return { ...outcome, cleanup };
  }
  async function tick() {
    if (working || stopped) return;
    working = true;
    try {
      if (blocked()) { interrupt(); return; }
      const nextConfig = config();
      if (lastConfig !== null && lastConfig !== nextConfig) revoke();
      if (resetPending && !clearCaptured()) return;
      const captured = config();
      lastConfig = captured;
      const snapshot = readSnapshot(), settings = snapshot.settings;
      const aiAvailable = settings.aiBreakdownEnabled && settings.aiPetMealsEnabled
        && Boolean(settings.aiModel?.trim()) && credentialStore.status().configured === true;
      const result = advance.execute({ ...context(), aiAvailable });
      if (!result.ok || !result.intent) return result;
      return await decide(result.intent, captured);
    } catch (_) { report(); return { ok: false, reason: 'meal-runtime-unavailable' }; }
    finally { working = false; }
  }
  function start() {
    if (stopped || started) return;
    started = true;
    lifecycle.interval('timer:companion-meals', () => { void tick(); }, SAMPLE_MS);
    void tick();
  }
  function dispose() {
    if (stopped) return;
    stopped = true; active?.abort();
    lifecycle.clear('timer:companion-meals');
    lifecycle.clear('timer:companion-meal-ai-guard');
  }
  lifecycle.register('companion:meals', dispose);
  return Object.freeze({ start, tick, dispose, settingsChanged, interrupt,
    suspend: () => { suspended = true; interrupt(); }, resume: () => { suspended = false; interrupt(); },
    invalidateAdvice: () => revoke() });
}
module.exports = { createCompanionMeals, mealCalendar, mealContext, DEADLINE_MS };
