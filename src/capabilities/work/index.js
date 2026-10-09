'use strict';

const activateScheduledWork = require('./application/activate-scheduled-work');
const captureImpulse = require('./application/capture-impulse');
const discardImpulse = require('./application/discard-impulse');
const duplicateWorkItem = require('./application/duplicate-work-item');
const restoreWorkItem = require('./application/restore-work-item');
const { ipcRoutes } = require('./contract/ipc-codec');
const availability = require('./domain/task-availability');
const dailyTidy = require('./domain/daily-tidy');
const impulseInbox = require('./domain/impulse-inbox');
const occurrenceSkipping = require('./domain/occurrence-skipping');
const recurrence = require('./domain/recurrence');
const scheduleActivation = require('./domain/schedule-activation');
const seriesRefresh = require('./domain/series-refresh');
const seriesUpdating = require('./domain/series-updating');
const selection = require('./domain/task-selection');
const sessionEntry = require('./domain/session-entry');
const sessionInvestment = require('./domain/session-investment');
const stepCompletion = require('./domain/step-completion');
const taskArchiving = require('./domain/task-archiving');
const taskClarification = require('./domain/task-clarification');
const taskCompletion = require('./domain/task-completion');
const taskCreation = require('./domain/task-creation');
const taskDuplication = require('./domain/task-duplication');
const taskEditing = require('./domain/task-editing');
const taskExpiration = require('./domain/task-expiration');
const taskModel = require('./domain/task-model');
const taskPlanning = require('./domain/task-planning');
const taskAvoidance = require('./domain/task-avoidance');
const taskRestoration = require('./domain/task-restoration');
const taskState = require('./domain/task-state');
const updateRecurrenceSeries = require('./application/update-recurrence-series');

module.exports = Object.freeze({
  inboxRecords: Object.freeze({ ...require('./domain/inbox-records') }),
  activateScheduledWork: Object.freeze({ ...activateScheduledWork }),
  captureImpulse: Object.freeze({ ...captureImpulse }),
  discardImpulse: Object.freeze({ ...discardImpulse }),
  duplicateWorkItem: Object.freeze({ ...duplicateWorkItem }),
  ipcRoutes,
  availability: Object.freeze({ ...availability }),
  dailyTidy: Object.freeze({ ...dailyTidy }),
  impulseInbox: Object.freeze({ ...impulseInbox }),
  occurrenceSkipping: Object.freeze({ ...occurrenceSkipping }),
  recurrence: Object.freeze({ ...recurrence }),
  restoreWorkItem: Object.freeze({ ...restoreWorkItem }),
  scheduleActivation: Object.freeze({ ...scheduleActivation }),
  seriesRefresh: Object.freeze({ ...seriesRefresh }),
  seriesUpdating: Object.freeze({ ...seriesUpdating }),
  selection: Object.freeze({ ...selection }),
  sessionEntry: Object.freeze({ ...sessionEntry }),
  sessionInvestment: Object.freeze({ ...sessionInvestment }),
  stepCompletion: Object.freeze({ ...stepCompletion }),
  taskArchiving: Object.freeze({ ...taskArchiving }),
  taskClarification: Object.freeze({ ...taskClarification }),
  taskCompletion: Object.freeze({ ...taskCompletion }),
  taskCreation: Object.freeze({ ...taskCreation }),
  taskDuplication: Object.freeze({ ...taskDuplication }),
  taskEditing: Object.freeze({ ...taskEditing }),
  taskExpiration: Object.freeze({ ...taskExpiration }),
  taskState: Object.freeze({ ...taskState }),
  taskModel: Object.freeze({ ...taskModel }),
  taskPlanning: Object.freeze({ ...taskPlanning }),
  taskAvoidance: Object.freeze({ ...taskAvoidance }),
  taskRestoration: Object.freeze({ ...taskRestoration }),
  updateRecurrenceSeries: Object.freeze({ ...updateRecurrenceSeries })
});
