'use strict';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function candidateId(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = candidate.id ?? (candidate.task && candidate.task.id);
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function candidateTimestamp(candidate, field) {
  const task = candidate && candidate.task && typeof candidate.task === 'object'
    ? candidate.task
    : candidate;
  const value = task && task[field];
  if (value === null || value === undefined || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function comparePriority(left, right) {
  const scoreDelta = finiteNumber(right.candidate.score) - finiteNumber(left.candidate.score);
  if (scoreDelta) return scoreDelta;

  const leftDeadline = candidateTimestamp(left.candidate, 'deadline');
  const rightDeadline = candidateTimestamp(right.candidate, 'deadline');
  if (leftDeadline !== rightDeadline) {
    if (leftDeadline === null) return 1;
    if (rightDeadline === null) return -1;
    return leftDeadline - rightDeadline;
  }

  const leftCreated = candidateTimestamp(left.candidate, 'createdAt');
  const rightCreated = candidateTimestamp(right.candidate, 'createdAt');
  if (leftCreated !== rightCreated) {
    if (leftCreated === null) return 1;
    if (rightCreated === null) return -1;
    return leftCreated - rightCreated;
  }

  const leftId = candidateId(left.candidate) || '';
  const rightId = candidateId(right.candidate) || '';
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return left.index - right.index;
}

/**
 * Measure approachability independently from the overall priority heuristic.
 *
 * The inputs are deliberately limited to explainable rank signals. This keeps
 * the secondary choice deterministic and avoids pretending to infer mood or
 * motivation from opaque behavior.
 */
function recommendationEaseScore(candidate) {
  const item = candidate && typeof candidate === 'object' ? candidate : {};
  const breakdown = item.scoreBreakdown && typeof item.scoreBreakdown === 'object'
    ? item.scoreBreakdown : {};
  const signals = item.signals && typeof item.signals === 'object' ? item.signals : {};
  const estimatedMinutes = Math.max(0, finiteNumber(item.estimatedMinutes, 25));
  const startMinutes = Math.max(2, finiteNumber(item.recommendedStartMinutes, Math.min(estimatedMinutes, 25)));

  const explainableStart = Math.max(0, 10 - (startMinutes - 2) * 0.5);
  const longTaskCost = Math.max(0, estimatedMinutes - 15) / 3;
  const triageCost = signals.needsTriage ? 30 : 0;

  return finiteNumber(breakdown.activation) * 2
    + finiteNumber(breakdown.durationFit)
    + finiteNumber(breakdown.nextStep)
    + finiteNumber(breakdown.energyMatch)
    + explainableStart
    - longTaskCost
    - triageCost;
}

/**
 * Return at most two honest, complementary choices from the complete scored
 * candidate set. Overall priority and startup ease are optimized independently.
 * If the same task wins both strategies, name that fact explicitly rather than
 * assigning the "easiest" label to a runner-up merely to force two cards.
 */
function selectRecommendationCandidates(ranked, limit = 2) {
  const input = Array.isArray(ranked) ? ranked.filter(item => item && typeof item === 'object') : [];
  if (input.length === 0) return [];

  const requested = Number.isInteger(limit) ? Math.max(1, Math.min(2, limit)) : 2;
  const ordered = input
    .map((candidate, index) => ({ candidate, index }))
    .sort(comparePriority);
  const unique = [];
  const seenIds = new Set();
  for (const entry of ordered) {
    const id = candidateId(entry.candidate);
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    unique.push(entry);
  }

  const priorityBase = unique[0].candidate;
  const priority = { ...priorityBase, role: '综合优先', strategy: 'priority' };
  const priorityId = candidateId(priorityBase);
  const byEase = unique.slice()
    .sort((left, right) => {
      const easeDelta = recommendationEaseScore(right.candidate) - recommendationEaseScore(left.candidate);
      if (easeDelta) return easeDelta;
      return comparePriority(left, right);
    });
  const easeBase = byEase[0].candidate;
  const sameWinner = priorityId
    ? candidateId(easeBase) === priorityId
    : easeBase === priorityBase;

  if (sameWinner) {
    const combined = {
      ...priorityBase,
      role: '综合优先 · 同时最容易开始',
      strategy: 'priority-and-ease'
    };
    if (requested === 1 || unique.length === 1) return [combined];
    const alternative = byEase.find(({ candidate }) => {
      const id = candidateId(candidate);
      return priorityId ? id !== priorityId : candidate !== priorityBase;
    });
    return alternative
      ? [combined, { ...alternative.candidate, role: '另一个较易开始', strategy: 'ease-alternative' }]
      : [combined];
  }

  if (requested === 1) return [priority];
  return [
    priority,
    { ...easeBase, role: '最容易开始', strategy: 'ease' }
  ];
}

module.exports = {
  recommendationEaseScore,
  selectRecommendationCandidates
};
