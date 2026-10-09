'use strict';
const { currentEnergyEstimate } = require('./energy-estimate');
const { scoreTask } = require('./task-ranking');
const { selectRecommendationCandidates } = require('../../../core/recommendation-strategy');
function projectRecommendations(input, taskStartBlockReason, readNow) {
function buildRecommendations({ state, settings, pomodoro, now, limit = 2, modelPrior = null, curveLevel = null }) {
  const stats = state.stats;
  const estimate = currentEnergyEstimate({
    stats,
    pomodoroState: pomodoro,
    settings,
    energyCheckIn: state.energyCheckIn,
    now,
    // ARCHITECTURE「日常与能量」. Passed through rather than computed here: the energy curve
    // needs routines state, and a guidance domain module reading another
    // capability's state would be the boundary break this layer exists to stop.
    modelPrior,
    curveLevel
  }, readNow);
  // Score every currently actionable task. The priority and ease strategies
  // must see the same complete pool; pre-truncating by priority could hide the
  // genuinely easiest task below an arbitrary top-N boundary.
  const ranked = state.tasks
    .filter(task => taskStartBlockReason(task, now) === null)
    .map(task => scoreTask(task, estimate, { now }, readNow));
  const candidates = selectRecommendationCandidates(ranked, limit);
  // The two cards are a presentation limit, not a scoring boundary. Preserve
  // the already-computed score for an explicitly selected Now task so its
  // duration and next action never fall back to stale creation-time metadata.
  const nowTaskId = state.nowTaskId;
  const nowCandidate = ranked.find(candidate => candidate.id === nowTaskId) || null;
  return { energy: estimate, candidates, nowCandidate, generatedAt: now };
}


return buildRecommendations(input);
}
module.exports = { projectRecommendations };
