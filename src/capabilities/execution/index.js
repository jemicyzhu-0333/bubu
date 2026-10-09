'use strict';

const pauseSession = require('./application/pause-session');
const pauseForInterruption = require('./application/pause-for-interruption');
const recoverSession = require('./application/recover-session');
const { ipcRoutes } = require('./contract/ipc-codec');
const sessionDurationModule = require('./contract/session-duration.mjs');
const sessionDuration = sessionDurationModule.default || sessionDurationModule;
const sessionProjection = require('./contract/session-projection');
const sessionState = require('./domain/session-state');
const sessionTransitions = require('./domain/session-transitions');
const sessionRecovery = require('./domain/session-recovery');
const healthyShutdown = require('./domain/healthy-shutdown');
const sessionSettlement = require('./domain/session-settlement');
const runtimeClock = require('./domain/runtime-session-clock');
const focusLanding = require('./domain/focus-landing');
const nowSelection = require('./domain/now-selection');
const taskCompletion = require('./domain/task-completion');
const taskLinkage = require('./domain/task-linkage');
const quickStartDecision = require('./domain/quick-start-decision');
const sessionStart = require('./domain/session-start');

const focusSession = Object.freeze({
  STATUS: sessionState.STATUS,
  createIdleSession: sessionState.createIdleSession,
  normalizeFocusSession: sessionState.normalizeFocusSession,
  isActiveSession: sessionState.isActiveSession,
  isPausedSession: sessionState.isPausedSession,
  sessionKind: sessionState.sessionKind,
  isActiveFocusSession: sessionState.isActiveFocusSession,
  isTimingSession: sessionState.isTimingSession,
  elapsedMs: sessionState.elapsedMs,
  remainingMs: sessionState.remainingMs,
  ...sessionTransitions,
  recoverSession: sessionRecovery.recoverSession,
  settleForHealthyShutdown: healthyShutdown.settleForHealthyShutdown,
  pauseForOfflineConfirmation: sessionRecovery.pauseForOfflineConfirmation
});

module.exports = Object.freeze({
  quickStartInput: Object.freeze({ ...require('./contract/quick-start-input') }),
  ipcRoutes,
  focusSession,
  pauseForInterruption: Object.freeze({ ...pauseForInterruption }),
  pauseSession: Object.freeze({ ...pauseSession }),
  recoverSession: Object.freeze({ ...recoverSession }),
  healthyShutdown: Object.freeze({ ...healthyShutdown }),
  focusLanding: Object.freeze({ ...focusLanding }),
  nowSelection: Object.freeze({ ...nowSelection }),
  quickStartDecision: Object.freeze({ ...quickStartDecision }),
  runtimeClock: Object.freeze({ ...runtimeClock }),
  sessionStart: Object.freeze({ ...sessionStart }),
  sessionSettlement: Object.freeze({ ...sessionSettlement }),
  taskCompletion: Object.freeze({ ...taskCompletion }),
  taskLinkage: Object.freeze({ ...taskLinkage }),
  sessionProjection: Object.freeze({ ...sessionProjection }),
  sessionDuration
});
