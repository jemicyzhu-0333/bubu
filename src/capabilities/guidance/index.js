'use strict';

const { ipcRoutes } = require('./contract/ipc-codec');
const taskDemand = require('./domain/task-demand');
const energyEstimate = require('./domain/energy-estimate');
const taskRanking = require('./domain/task-ranking');
const energyCheckIn = require('./domain/energy-check-in');
const energyCalibration = require('./domain/energy-calibration');
const energySignals = require('./domain/energy-signals');
const wakeTime = require('./domain/wake-time');
const moodNotes = require('./domain/mood-notes');
const adjustEnergy = require('./application/adjust-energy');
const impulseEnergyClassifier = require('./application/impulse-energy-classifier');
const recordEnergyCheckIn = require('./application/record-energy-check-in');
const resetEnergyCalibration = require('./application/reset-energy-calibration');
const strategyFeedback = require('./domain/strategy-feedback');
const recordStrategyShown = require('./application/record-strategy-shown');
const recordStrategyFeedback = require('./application/record-strategy-feedback');
const dailyReview = require('./domain/daily-review');
const materializeDueReviews = require('./application/materialize-due-reviews');

module.exports = Object.freeze({
  taskDemand: Object.freeze({
    ENERGY_BANDS: taskDemand.ENERGY_BANDS,
    inferEnergy: taskDemand.inferEnergy,
    suggestDuration: taskDemand.suggestDuration,
    estimatedMinutes: taskDemand.estimatedMinutes
  }),
  energyEstimate: Object.freeze({
    currentEnergyLevel: energyEstimate.currentEnergyLevel,
    currentEnergyEstimate: energyEstimate.currentEnergyEstimate,
    normalizeEnergyCheckIn: energyEstimate.normalizeEnergyCheckIn,
    energyToBand: energyEstimate.energyToBand,
    energyLabel: energyEstimate.energyLabel,
    resolveWorkHours: energyEstimate.resolveWorkHours,
    baseEnergyAt: energyEstimate.baseEnergyAt
  }),
  taskRanking: Object.freeze({
    smartPickTask: taskRanking.smartPickTask,
    rankTasks: taskRanking.rankTasks,
    recommendTasks: taskRanking.recommendTasks,
    scoreTask: taskRanking.scoreTask,
    getNextStep: taskRanking.getNextStep
  }),
  planningState: Object.freeze({ ...require('./contract/planning-state') }),
  planningPreferences: Object.freeze({ ...require('./domain/planning-preferences') }),
  energySelfReports: Object.freeze({ ...require('./domain/energy-self-reports') }),
  energyCurveTrials: Object.freeze({ ...require('./domain/energy-curve-trials') }),
  aiChangeLedger: Object.freeze({ ...require('./domain/ai-change-ledger') }),
  localProposal: Object.freeze({ ...require('./domain/local-proposal') }),
  recommendations: Object.freeze({ ...require('./application/recommendations') }),
  memoryAggregation: Object.freeze({ ...require('./domain/memory-aggregation') }),
  memoryConfirmation: Object.freeze({ ...require('./domain/memory-confirmation') }),
  proposalPreview: Object.freeze({ ...require('./application/proposal-preview') }),
  aiDiagnostics: Object.freeze({ ...require('./application/ai-diagnostics') }),
  ipcRoutes,
  energyCheckIn: Object.freeze({ ...energyCheckIn }),
  energyCalibration: Object.freeze({ ...energyCalibration }),
  energySignals: Object.freeze({ ...energySignals }),
  wakeTime: Object.freeze({ ...wakeTime }),
  moodNotes: Object.freeze({ ...moodNotes }),
  adjustEnergy: Object.freeze({ ...adjustEnergy }),
  impulseEnergyClassifier: Object.freeze({ ...impulseEnergyClassifier }),
  recordEnergyCheckIn: Object.freeze({ ...recordEnergyCheckIn }),
  resetEnergyCalibration: Object.freeze({ ...resetEnergyCalibration }),
  strategyFeedback: Object.freeze({ ...strategyFeedback }),
  dailyReview: Object.freeze({ ...dailyReview }),
  materializeDueReviews: Object.freeze({ ...materializeDueReviews }),
  recordStrategyShown: Object.freeze({ ...recordStrategyShown }),
  recordStrategyFeedback: Object.freeze({ ...recordStrategyFeedback })
});
