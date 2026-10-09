'use strict';

const { guidance, preferences } = require('../capabilities');
const {
  createAnalyzeImpulseEnergyWorkflow,
  createInboxTimelineEffects,
  createTriageCaptureWorkflow,
  createSetWakeTimeCommand,
  currentEnergyLevelAt
} = require('../application');
const {
  createApiClient,
  DEFAULT_AI_BASE_URL,
  failureReason
} = require('../core/llm');
const { createOneShotProviderRun } = require('../application/ai/one-shot-provider-run');
const { localDayKey } = require('../core/calendar');

function createEnergyAssistance({
  unitOfWork,
  readSnapshot,
  clock,
  getSettings,
  requestScope,
  credentialStore,
  timeoutMs,
  trace,
  negotiation,
  readEstimate,
  capturePlanningEstimate = () => null,
  publishEnergy,
  publishChange,
  notify,
  reportEffectError,
  timelineRecorder
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function'
      || typeof readSnapshot !== 'function' || !clock || typeof clock.now !== 'function') {
    throw new TypeError('energy assistance requires state and clock ports');
  }
  for (const [name, port] of Object.entries({
    getSettings, readEstimate, publishEnergy, publishChange, notify, reportEffectError
  })) {
    if (typeof port !== 'function') throw new TypeError(`energy assistance requires ${name}`);
  }

  const adjustCommand = guidance.adjustEnergy.createAdjustEnergyCommand({
    unitOfWork,
    clock,
    capturePlanningEstimate,
    currentLevelFor: (snapshot, at) => {
      const settings = preferences.normalizeSettings(snapshot.settings);
      return currentEnergyLevelAt({
        snapshot,
        settings,
        at,
        dayKey: localDayKey(at),
        workStartHour: preferences.workSchedule.getWorkHours(settings).start
      });
    },
    publish: publishEnergy,
    reportEffectError: error => reportEffectError(error, 'energy:adjust')
  });

  const classifier = guidance.impulseEnergyClassifier.createImpulseEnergyClassifier({
    requestScope,
    getSettings,
    credentialStore,
    createApiClient,
    defaultBaseUrl: DEFAULT_AI_BASE_URL,
    failureReason,
    timeoutMs,
    negotiation,
    runWithFallback: createOneShotProviderRun({
      now: () => clock.now(), schedule: setTimeout, cancelSchedule: clearTimeout
    }),
    trace
  });
  const impulseWorkflow = createAnalyzeImpulseEnergyWorkflow({
    requestScope,
    unitOfWork,
    readSnapshot,
    clock,
    classify: classifier.analyze,
    publish: () => publishChange({ energy: true, recommendations: true }),
    reportEffectError: error => reportEffectError(error, 'impulse-energy')
  });

  const triageWorkflow = createTriageCaptureWorkflow({
    requestScope,
    unitOfWork,
    readSnapshot,
    clock,
    triage: classifier.triage,
    publish: () => publishChange({ impulses: true }),
    reportEffectError: error => reportEffectError(error, 'capture-triage')
  });

  const timelineEffects = createInboxTimelineEffects({ timelineRecorder, reportEffectError });
  function publishCapturedImpulse(fact) {
    const recorded = timelineEffects.captured(fact);
    publishChange({ impulses: true, ...(recorded ? { timeline: true } : {}) });
    notify({
      title: '已记下',
      body: '它安全地待在收件箱里，现在可以回到眼前这一步。'
    });
    void impulseWorkflow.handleCaptured(fact).catch(error => {
      reportEffectError(error, 'impulse-energy');
    });
    void triageWorkflow.handleCaptured(fact).catch(error => {
      reportEffectError(error, 'capture-triage');
    });
  }

  // 起床时间（schema 11）。情绪记录来自收件箱，由 inbox-organization 组装。
  const setWakeTime = createSetWakeTimeCommand({
    unitOfWork, clock,
    publish: fact => publishChange(fact.dirty),
    reportEffectError: error => reportEffectError(error, 'wellbeing')
  });

  function register(registerIpc) {
    if (typeof registerIpc !== 'function') throw new TypeError('energy assistance requires an IPC registrar');
    registerIpc('energy:set-wake', (_event, payload) => {
      const result = setWakeTime.execute(payload);
      return result.ok ? { ok: true, changed: result.changed, estimate: readEstimate() } : result;
    });
    registerIpc('energy:adjust', (_event, adjustment) => {
      const result = adjustCommand.execute(adjustment);
      if (!result.ok) return result;
      return { ok: true, changed: result.changed, estimate: readEstimate() };
    });
  }

  return Object.freeze({ publishCapturedImpulse, register });
}

module.exports = { createEnergyAssistance };
