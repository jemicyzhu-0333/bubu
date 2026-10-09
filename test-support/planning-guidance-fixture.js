'use strict';
const { planningState: v, energySelfReports, energyCurveTrials } = require('../src/capabilities/guidance');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { defaultEnergyBaseline } = require('../src/content/energy-effects.mjs');
const START = new Date(2026, 8, 1, 9, 0).getTime();
const DAY = 86400000;
const NOW = START + 8 * DAY;
function planningFixture({ sufficient = false } = {}) {
  const state = { planningPreferences: v.createPlanningPreferences(), energySelfReports: v.createEnergySelfReports(),
    energyCurveTrials: v.createEnergyCurveTrials(), energyCheckIn: { level: 50, state: 'medium', timestamp: START - DAY },
    energyProfile: null, routines: [], routineLog: { days: [] }, energySignals: [], wakeTimes: {}, settings: { energyCurveEnabled: true } };
  if (sufficient) {
    energySelfReports.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: START });
    for (const delta of [0, DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 7 * DAY + 3600000, 7 * DAY + 7200000]) {
      energySelfReports.appendSelfReport(state, { level: 50, at: START + delta });
    }
  }
  return state;
}
function repositoryFixture(initial = planningFixture()) {
  let state = structuredClone(initial), revision = 0, commits = 0, time = NOW, sequence = 0;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) {
      v.validatePlanningPreferences(candidate.planningPreferences);
      v.validateEnergySelfReports(candidate.energySelfReports);
      v.validateEnergyCurveTrials(candidate.energyCurveTrials);
      state = structuredClone(candidate); revision += 1; commits += 1; return structuredClone(state);
    } };
  return { repository, unitOfWork: createUnitOfWork({ repository }), snapshot: repository.snapshot,
    clock: { now: () => time }, setTime: value => { time = value; }, idFactory: () => `planning-${++sequence}`,
    mutate: callback => { callback(state); }, commits: () => commits };
}
const sourceFor = state => energyCurveTrials.curveSource({ profile: state.energyProfile, baseline: state.energyProfile?.baseline || defaultEnergyBaseline() });
module.exports = { START, DAY, NOW, planningFixture, repositoryFixture, sourceFor };
