'use strict';

const { ipcRoutes } = require('./contract/ipc-codec');
const progressState = require('./domain/progress-state');
const healthyShutdown = require('./domain/healthy-shutdown');
const executionActivity = require('./domain/execution-activity');
const sessionSettlement = require('./domain/session-settlement');
const stepCompletion = require('./domain/step-completion');
const taskCompletion = require('./domain/task-completion');
const interactionReward = require('./domain/interaction-reward');
const timelineFacts = require('./domain/timeline-facts');
const aiChangeEvents = require('./domain/ai-change-events');
const timelineDay = require('./domain/timeline-day');
const recordTimeline = require('./application/record-timeline');

module.exports = Object.freeze({
  ipcRoutes,
  dailyGrowth: Object.freeze({ ...require('./domain/daily-growth') }),
  basicMeals: Object.freeze({ ...require('./domain/basic-meal-allowance') }),
  executionActivity: Object.freeze({ ...executionActivity }),
  healthyShutdown: Object.freeze({ ...healthyShutdown }),
  progressState: Object.freeze({ ...progressState }),
  sessionSettlement: Object.freeze({ ...sessionSettlement }),
  stepCompletion: Object.freeze({ ...stepCompletion }),
  taskCompletion: Object.freeze({ ...taskCompletion }),
  interactionReward: Object.freeze({ ...interactionReward }),
  timelineFacts: Object.freeze({ ...timelineFacts }),
  aiChangeEvents: Object.freeze({ ...aiChangeEvents }),
  timelineDay: Object.freeze({ ...timelineDay }),
  recordTimeline: Object.freeze({ ...recordTimeline })
});
