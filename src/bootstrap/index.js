'use strict';

const { SurpriseDirector } = require('../core/surprise-director');
const { createApplication } = require('./create-application');
const { createAiCollaboration } = require('./ai-collaboration');
const { createCompanionFoodShop } = require('./companion-food-shop');
const { createEnergyAssistance } = require('./energy-assistance');
const { createInboxOrganization } = require('./inbox-organization');
const { createActivityMirror } = require('./activity-mirror');
const { createPrivateTaskNotifications } = require('./task-notifications');
const { energyCurveLevelNow, createCurrentEnergyReader } = require('./energy-reading');
const { registerAiCancellation } = require('./ai-cancellation');
const { createTaskUndo } = require('./task-undo');
const { createLifecycleRegistry } = require('./lifecycle');
const { registerProcessLifecycle } = require('./process-lifecycle');
const { createSittingReminderTimer } = require('./sitting-reminder-timer');
const { createWorkBoundaryReminder } = require('./work-boundary-reminder');

function createBootstrapRuntime({ surpriseDirector: surpriseOptions, onLifecycleError }) {
  const lifecycle = createLifecycleRegistry({ onError: onLifecycleError });
  const surpriseDirector = new SurpriseDirector(surpriseOptions);
  lifecycle.register('companion:surprise-director', () => surpriseDirector.dispose());
  return Object.freeze({ lifecycle, surpriseDirector });
}

module.exports = {
  ...require('./companion-wardrobe'),
  createApplication,
  ...require('./app-maintenance'),
  ...require('./domain-id'),
  createAiCollaboration,
  ...require('./proposal-assistance'),
  ...require('./nudge-actions'),
  ...require('./session-resume'),
  ...require('./session-start-publication'),
  ...require('./surface-publication'),
  ...require('./pet-queries'),
  ...require('./companion-feeding'),
  ...require('./companion-meals'),
  ...require('./renderer-ipc'),
  ...require('./growth-publication'),
  ...require('./preferences-publication'),
  ...require('./planning-preferences'),
  createBootstrapRuntime,
  createCompanionFoodShop,
  createEnergyAssistance,
  createInboxOrganization,
  createActivityMirror,
  createPrivateTaskNotifications,
  energyCurveLevelNow,
  createCurrentEnergyReader,
  registerAiCancellation,
  createTaskUndo,
  registerProcessLifecycle,
  createSittingReminderTimer,
  createWorkBoundaryReminder
};
