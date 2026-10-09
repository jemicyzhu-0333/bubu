'use strict';

const { taskDemand, energyEstimate, taskRanking } = require('../../capabilities/guidance');
const { availability } = require('../../capabilities/work');

const readNow = () => Date.now();
const ports = { parsedTimestamp: availability.parsedTimestamp, readNow };

function currentEnergyLevel(stats, pomodoroState, settings, energyCheckIn) {
  return energyEstimate.currentEnergyLevel(stats, pomodoroState, settings, energyCheckIn, readNow);
}

function currentEnergyEstimate(input = {}) {
  return energyEstimate.currentEnergyEstimate(input, readNow);
}

function smartPickTask(tasks, currentLevel, options = {}) {
  return taskRanking.smartPickTask(tasks, currentLevel, options, ports);
}

function rankTasks(tasks, currentEnergy, options = {}) {
  return taskRanking.rankTasks(tasks, currentEnergy, options, ports);
}

function recommendTasks(tasks, currentEnergy, options = {}) {
  return taskRanking.recommendTasks(tasks, currentEnergy, options, ports);
}

function scoreTask(task, currentEnergy, options = {}) {
  return taskRanking.scoreTask(task, currentEnergy, options, readNow);
}

module.exports = {
  ENERGY_BANDS: taskDemand.ENERGY_BANDS,
  inferEnergy: taskDemand.inferEnergy,
  suggestDuration: taskDemand.suggestDuration,
  currentEnergyLevel,
  currentEnergyEstimate,
  normalizeEnergyCheckIn: energyEstimate.normalizeEnergyCheckIn,
  energyToBand: energyEstimate.energyToBand,
  energyLabel: energyEstimate.energyLabel,
  smartPickTask,
  rankTasks,
  recommendTasks,
  scoreTask,
  getNextStep: taskRanking.getNextStep,
  estimatedMinutes: taskDemand.estimatedMinutes,
  resolveWorkHours: energyEstimate.resolveWorkHours,
  baseEnergyAt: energyEstimate.baseEnergyAt
};
