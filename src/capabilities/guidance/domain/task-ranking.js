'use strict';

const { ENERGY_FLOOR, ENERGY_CEILING } = require('../../../core/energy-curve');
const { clamp, finiteNumber, taskEnergyBand, estimatedMinutes } = require('./task-demand');
const { parseTimestamp, energyToBand } = require('./energy-estimate');

function getNextStep(task) {
  if (!task) return null;
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const index = steps.findIndex(step => step && !step.done && String(step.title || '').trim());
  if (index < 0) {
    const explicit = typeof task.nextAction === 'string' ? task.nextAction.trim() : '';
    return explicit ? { index: -1, title: explicit, estimatedMin: null } : null;
  }
  const step = steps[index];
  return {
    index,
    title: String(step.title).trim(),
    estimatedMin: clamp(finiteNumber(step.estimatedMin || step.suggestedMin || step.minutes, 0), 0, 120) || null
  };
}

function normalizeFriction(task, duration, nextStep) {
  const raw = task && (task.activationFriction !== undefined && task.activationFriction !== null
    ? task.activationFriction
    : (task.startFriction !== undefined ? task.startFriction : task.friction));
  if (typeof raw === 'string') {
    const mapped = { low: 20, easy: 20, medium: 50, normal: 50, high: 80, hard: 80 }[raw.toLowerCase()];
    if (mapped !== undefined) return mapped;
  }
  const numeric = finiteNumber(raw);
  if (numeric !== null) return clamp(numeric, 0, 100);
  if (nextStep) return 25;
  if (duration <= 10) return 25;
  if (duration <= 25) return 45;
  return 65;
}

function decayedCount(task, countFields, timestampFields, now, halfLifeDays = 7) {
  let count = 0;
  for (const field of countFields) {
    const value = finiteNumber(task && task[field]);
    if (value !== null) { count = Math.max(0, value); break; }
  }
  if (!count) return 0;
  let timestamp = null;
  for (const field of timestampFields) {
    timestamp = parseTimestamp(task && task[field]);
    if (timestamp !== null) break;
  }
  if (timestamp === null) return count;
  const ageDays = Math.max(0, now - timestamp) / 86400000;
  return count * Math.pow(0.5, ageDays / halfLifeDays);
}

function deadlineScore(task, now) {
  const deadline = parseTimestamp(task && task.deadline);
  const explicitOverdue = Math.max(0, finiteNumber(task && task.overdueCount, 0));
  if (deadline === null) {
    return {
      score: Math.min(8, explicitOverdue * 2),
      deadline: null,
      daysLeft: null,
      overdue: explicitOverdue > 0
    };
  }
  const deltaDays = (deadline - now) / 86400000;
  if (deltaDays < 0) {
    return { score: 34 + Math.min(12, Math.ceil(Math.abs(deltaDays)) * 2), deadline, daysLeft: deltaDays, overdue: true };
  }
  if (deltaDays <= 1) return { score: 30, deadline, daysLeft: deltaDays, overdue: false };
  if (deltaDays <= 3) return { score: 20, deadline, daysLeft: deltaDays, overdue: false };
  if (deltaDays <= 7) return { score: 12, deadline, daysLeft: deltaDays, overdue: false };
  if (deltaDays <= 14) return { score: 5, deadline, daysLeft: deltaDays, overdue: false };
  return { score: 0, deadline, daysLeft: deltaDays, overdue: false };
}

function durationFitScore(duration, band) {
  const target = { low: 10, medium: 25, high: 45 }[band] || 25;
  const diff = Math.abs(duration - target);
  if (diff <= 5) return 12;
  if (diff <= 15) return 8;
  if (diff <= 30) return 3;
  return duration > target ? -4 : 0;
}

function energyMatchScore(taskBand, currentBand) {
  const matrix = {
    low: { low: 18, medium: 4, high: -16 },
    medium: { low: 7, medium: 16, high: 4 },
    high: { low: 3, medium: 10, high: 16 }
  };
  return (matrix[currentBand] && matrix[currentBand][taskBand]) || 0;
}

// 0.1.2 removed `categoryScore`. PRODUCT.md enumerates the recommendation
// inputs as deadline, overdue distance, energy match, suggested duration, next
// step clarity, activation friction and recent selection — a task "type" was
// never one of them, and weighting one silently punished ad-hoc capture.

function recommendedStartMinutes({ duration, energyBand, friction, avoidance, nextStep }) {
  if (friction >= 70 || avoidance >= 2) return 2;
  if (nextStep && nextStep.estimatedMin) return clamp(Math.round(nextStep.estimatedMin), 2, 25);
  const cap = { low: 10, medium: 15, high: 25 }[energyBand] || 15;
  return clamp(Math.min(duration, cap), 2, 25);
}

function buildReason({ deadline, energyMatch, energyBand, duration, nextStep, avoidance, selection, friction, recurring }) {
  const reasons = [];
  if (deadline.overdue) reasons.push('已超过截止时间，建议先重新确认范围');
  else if (deadline.daysLeft !== null && deadline.daysLeft <= 1) reasons.push('截止时间在 24 小时内');
  else if (deadline.daysLeft !== null && deadline.daysLeft <= 3) reasons.push('截止时间较近');
  if (nextStep) reasons.push(`已有明确下一步“${nextStep.title}”`);
  if (avoidance >= 2) reasons.push('近期多次推迟，建议缩小到 2 分钟启动');
  else if (selection >= 1) reasons.push('近期已选过，继续它可减少切换成本');
  if (energyMatch >= 10) reasons.push(`与当前${energyBand === 'low' ? '低' : energyBand === 'high' ? '高' : '中等'}能量匹配`);
  if (duration <= 10) reasons.push('预计用时短，容易开始');
  if (friction >= 70 && avoidance < 2) reasons.push('启动阻力偏高，建议先做最小动作');
  if (reasons.length === 0 && recurring) reasons.push('这是重复任务在今天的这一次');
  if (reasons.length === 0) reasons.push('综合时间、能量和启动成本后较适合现在开始');
  return reasons.slice(0, 3).join('；');
}

function normalizeCurrentEnergy(value) {
  if (value && typeof value === 'object') {
    if (value.band && ['low', 'medium', 'high'].includes(value.band)) {
      return {
        level: clamp(finiteNumber(value.level, 50), ENERGY_FLOOR, ENERGY_CEILING),
        band: value.band
      };
    }
    if (value.level !== undefined) {
      const level = clamp(finiteNumber(value.level, 50), ENERGY_FLOOR, ENERGY_CEILING);
      return { level, band: energyToBand(level) };
    }
  }
  if (typeof value === 'string' && ['low', 'medium', 'high'].includes(value)) {
    return { level: { low: 25, medium: 50, high: 80 }[value], band: value };
  }
  const level = clamp(finiteNumber(value, 50), ENERGY_FLOOR, ENERGY_CEILING);
  return { level, band: energyToBand(level) };
}

function scoreTask(task, currentEnergy, options = {}, readNow) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : readNow();
  const energy = normalizeCurrentEnergy(currentEnergy);
  const taskBand = taskEnergyBand(task);
  const duration = estimatedMinutes({ ...task, energy: taskBand });
  const nextStep = getNextStep(task);
  const friction = normalizeFriction(task, duration, nextStep);
  const deadline = deadlineScore(task, now);
  const avoidance = decayedCount(
    task,
    ['recentAvoidanceCount', 'avoidanceCount', 'deferCount'],
    ['lastAvoidedAt', 'lastDeferredAt'],
    now
  );
  const selection = decayedCount(
    task,
    ['recentSelectionCount', 'selectionCount', 'pickCount'],
    ['lastSelectedAt', 'lastPickedAt'],
    now,
    3
  );
  const lastStartedAt = parseTimestamp(task.lastStartedAt);
  const recentlyStarted = lastStartedAt !== null && now - lastStartedAt >= 0 && now - lastStartedAt <= 6 * 3600000;

  const breakdown = {
    deadline: deadline.score,
    energyMatch: energyMatchScore(taskBand, energy.band),
    durationFit: durationFitScore(duration, energy.band),
    activation: friction <= 30 ? 12 : (friction <= 60 ? 5 : -6),
    nextStep: nextStep ? 10 : 0,
    avoidance: Math.min(10, Math.round(avoidance * 3)),
    recentSelection: Math.min(6, Math.round(selection * 2)),
    resumeMomentum: recentlyStarted ? 6 : 0,
    expired: task.expired ? -10 : 0
  };
  const score = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  const startMinutes = recommendedStartMinutes({ duration, energyBand: energy.band, friction, avoidance, nextStep });

  return {
    task,
    id: task.id,
    title: task.title,
    score,
    scoreBreakdown: breakdown,
    reason: buildReason({
      deadline,
      energyMatch: breakdown.energyMatch,
      energyBand: energy.band,
      duration,
      nextStep,
      avoidance,
      selection,
      friction,
      recurring: Boolean(task.seriesId)
    }),
    recommendedStartMinutes: startMinutes,
    nextStep,
    estimatedMinutes: duration,
    energy: { current: energy.band, task: taskBand },
    signals: {
      overdue: deadline.overdue,
      daysLeft: deadline.daysLeft,
      activationFriction: friction,
      recentAvoidanceCount: Number(avoidance.toFixed(2)),
      recentSelectionCount: Number(selection.toFixed(2)),
      recentlyStarted,
      needsBreakdown: !nextStep && (friction >= 70 || duration > 45),
      needsTriage: Boolean(task.expired)
    }
  };
}

function stableTaskCompare(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  const aDeadline = parseTimestamp(a.task.deadline);
  const bDeadline = parseTimestamp(b.task.deadline);
  if (aDeadline !== bDeadline) {
    if (aDeadline === null) return 1;
    if (bDeadline === null) return -1;
    return aDeadline - bDeadline;
  }
  const aCreated = finiteNumber(a.task.createdAt, Number.MAX_SAFE_INTEGER);
  const bCreated = finiteNumber(b.task.createdAt, Number.MAX_SAFE_INTEGER);
  if (aCreated !== bCreated) return aCreated - bCreated;
  const aId = String(a.task.id || a.task.title || '');
  const bId = String(b.task.id || b.task.title || '');
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * Rank active tasks and return structured, explainable candidates.
 * This function never mutates `tasks` and never uses randomness.
 */
function rankTasks(tasks, currentEnergy, options = {}, ports = {}) {
  const { parsedTimestamp, readNow } = ports;
  const input = Array.isArray(tasks) ? tasks : [];
  const safeOptions = options && typeof options === 'object' ? options : {};
  const includeDone = !!safeOptions.includeDone;
  const includeExpired = !!safeOptions.includeExpired;
  const includeScheduled = !!safeOptions.includeScheduled;
  const now = Number.isFinite(Number(safeOptions.now)) ? Number(safeOptions.now) : readNow();
  const limit = clamp(Math.floor(finiteNumber(safeOptions.limit, 3)), 1, 20);
  return input
    .filter(task => task
      && (includeDone || !task.done)
      && !task.skippedAt
      && (includeExpired || !(task.expired
        || (parsedTimestamp(task.expiresAt) !== null && parsedTimestamp(task.expiresAt) <= now)))
      && (includeScheduled || parseTimestamp(task.scheduledFor) === null || parseTimestamp(task.scheduledFor) <= now))
    .map(task => scoreTask(task, currentEnergy, { ...safeOptions, now }, readNow))
    .sort(stableTaskCompare)
    .slice(0, limit);
}

function recommendTasks(tasks, currentEnergy, options = {}, ports = {}) {
  const { readNow } = ports;
  const safeOptions = options && typeof options === 'object' ? options : {};
  const energy = normalizeCurrentEnergy(currentEnergy);
  const candidates = rankTasks(tasks, energy, safeOptions, ports);
  return {
    energy,
    candidates,
    topCandidate: candidates[0] || null,
    generatedAt: Number.isFinite(Number(safeOptions.now)) ? Number(safeOptions.now) : readNow()
  };
}

// Backward-compatible API used by main.js: return the original task object.
// Selection is now deterministic; callers that need explanations should use
// recommendTasks() or rankTasks().
function smartPickTask(tasks, currentLevel, options = {}, ports = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const top = rankTasks(tasks, currentLevel, { ...safeOptions, limit: 1 }, ports)[0];
  return top ? top.task : null;
}

module.exports = {
  smartPickTask,
  rankTasks,
  recommendTasks,
  scoreTask,
  getNextStep
};
