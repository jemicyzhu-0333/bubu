'use strict';

// The popover is allowed to know only this scoped client.  Keeping the bridge
// lookup here makes it impossible for a feature module to grow a second IPC
// surface by reaching into window.focuspix on its own.
function createPopoverSurfaceClient(bridge = typeof window !== 'undefined' ? window.focuspix : null) {
  if (!bridge || typeof bridge !== 'object') {
    throw new TypeError('popover surface bridge is required');
  }

  const methods = [
    'getState',
    'onStateDiff', 'onPopoverHidden',
    'addTask',
    'completeTask',
    'completeStep',
    'skipOccurrence',
    'duplicateTask',
    'deleteTask',
    'archiveTask',
    'restoreTask',
    'updateTask',
    'updateSeries',
    'renewTask',
    'setNowTask',
    'clarifyNowTask',
    'pickOneTask',
    'previewBreakdown',
    'addWithBreakdown',
    'previewAiBreakdown',
    'dismissBreakdownProposal',
    'previewEnrich', 'cancelAiRequests',
    'applyBreakdownProposal',
    'getAiCredentialStatus',
    'importAiCredential',
    'saveAiCredential',
    'clearAiCredential',
    'requestStrategy',
    'sendStrategyFeedback',
    'openReview',
    'resolveReview',
    'listHistory',
    'dismissNotice',
    'startPomodoro',
    'kickstart',
    'stopPomodoro',
    'pausePomodoro',
    'resumePomodoro',
    'adjustPomodoroDuration',
    'resolveQuickStart',
    'resolveFocusLanding',
    'addImpulse',
    'openImpulse',
    'promoteImpulse',
    'deleteImpulse',
    'reviewImpulse',
    'organizeImpulse', 'getInboxHistory', 'keepAllImpulses', 'copyAgentPluginCommand',
    'updateEnergyCheckIn', 'setWakeTime', 'keepMoodNote', 'deleteMoodNote', 'undoComplete',
    'adjustEnergy',
    'resetEnergyCalibration',
    'getPlanningGuidance', 'cancelPlanningPreview', 'previewPlanningProposal', 'previewPlanningPreference', 'confirmPlanningPreference', 'undoPlanningPreference',
    'previewEnergyHistoryConsent', 'confirmEnergyHistoryConsent',
    'previewEnergyCurveTrial', 'confirmEnergyCurveTrial', 'undoEnergyCurveTrial',
    'updateSettings',
    'describeQuickPanelShortcut',
    'listMemories',
    'previewMemoryChange', 'confirmMemoryChange', 'previewMemoryUndo', 'getMemoryReceipt', 'cancelMemoryChange', 'previewMemoryProposal',
    'forgetMemory',
    'clearMemories',
    'rememberMemory',
    'getTimelineDay',
    'addRoutine',
    'updateRoutine',
    'removeRoutine',
    'logRoutine',
    'undoRoutineLog',
    'switchSkin',
    'equipAppearance',
    'resetAppearance',
    'buyFood',
    'suggestUnstick',
    'startConversation', 'listConversations', 'getConversation', 'setConversationScope', 'setConversationMode', 'conversationTurn', 'pauseConversation', 'cancelConversation', 'setConversationRetention', 'deleteConversation',
    'getConversationContextChoices', 'previewConversationChanges', 'confirmConversationChanges', 'cancelConversationChanges',
    'getChangeReceipt', 'getConversationReceipts', 'getConversationProposalStatus', 'previewChangeUndo',
    'draftTurn',
    'discardDraft',
    'testNudge',
    'hidePopover',
    'getUpdateStatus', 'checkForUpdates', 'downloadUpdate', 'cancelUpdate', 'installUpdate'
  ];

  for (const method of methods) {
    if (typeof bridge[method] !== 'function') {
      throw new TypeError(`popover bridge is missing ${method}`);
    }
  }

  return Object.freeze(Object.fromEntries(methods.map(method => [
    method,
    (...args) => bridge[method](...args)
  ])));
}



export { createPopoverSurfaceClient };
