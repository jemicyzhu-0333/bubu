'use strict';

const { planningPreferences, energySelfReports, energyCurveTrials, planningState } = require('../../capabilities/guidance');
const { buildEnergyCurveSource } = require('./energy-curve-view');
const { localDayKey } = require('../../core/calendar');
// A planning context keeps demand preference distinct from current self-report
// and current estimate. It never replaces the task's own demand or rewrites state.
function buildPlanningGuidanceView({ snapshot, now, dayKey = localDayKey(now), workStartHour = null } = {}) {
  const state = { ...snapshot,
    planningPreferences: snapshot.planningPreferences || planningState.createPlanningPreferences(),
    energySelfReports: snapshot.energySelfReports || planningState.createEnergySelfReports(),
    energyCurveTrials: snapshot.energyCurveTrials || planningState.createEnergyCurveTrials() };
  const items = planningPreferences.planningPreferencesAt(state, now);
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const applicable = items.filter(item => minute >= item.startMinute && minute < item.endMinute)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  const source = buildEnergyCurveSource({ snapshot: state, dayKey, workStartHour });
  return { version: state.planningPreferences.version, preferences: items,
    currentDemandPreference: applicable[0] ? { id: applicable[0].id, version: applicable[0].version,
      demand: applicable[0].demand, source: 'user-confirmed-planning-preference' } : null,
    currentUserSelfReport: state.energyCheckIn ? { ...state.energyCheckIn, source: 'user-self-report' } : null,
    coverage: energySelfReports.selfReportCoverage(state, now),
    trial: energyCurveTrials.curveTrialStatus(state, { source, now }),
    editableParameters: planningState.TRIAL_PARAMETERS };
}
module.exports = { buildPlanningGuidanceView };
