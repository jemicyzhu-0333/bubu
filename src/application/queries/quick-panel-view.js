'use strict';
const { projectQuickStartAction } = require('./quick-start-action');

// ARCHITECTURE「快捷行动面板」: the impulse surface receives a read-only,
// closed, compact view instead of deriving session mode and candidate identity a
// second time. It writes nothing and reads no clock; the authoritative pomodoro
// projection already contains the elapsed/remaining values sampled by main.

const QUICK_PANEL_MODES = Object.freeze({
  ACTIVE: 'active',
  IDLE: 'idle',
  FALLBACK: 'fallback'
});

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function taskSummary(task) {
  if (!task || typeof task !== 'object' || !text(task.id)) return null;
  return Object.freeze({
    id: text(task.id),
    title: text(task.title) || '未命名任务',
    seriesId: text(task.seriesId) || null
  });
}

function incompleteSteps(task) {
  const steps = task && Array.isArray(task.steps) ? task.steps : [];
  return Object.freeze(steps
    .filter(step => step && step.done !== true && text(step.id) && text(step.title))
    .map(step => Object.freeze({ id: text(step.id), title: text(step.title) })));
}

function candidateSummary(candidate, tasks, startState, now) {
  if (!candidate || typeof candidate !== 'object') return null;
  const nested = taskSummary(candidate.task);
  const candidateId = text(candidate.id) || (nested && nested.id);
  const task = taskSummary(tasks.find(item => item && item.id === candidateId));
  if (!task) return null;
  return Object.freeze({
    id: task.id,
    title: task.title,
    role: text(candidate.role, 60) || '建议先做',
    reason: text(candidate.reason, 240),
    quickStartAction: projectQuickStartAction({ taskId: task.id, tasks, startState, now }),
    minutes: Number.isInteger(candidate.recommendedStartMinutes)
      ? candidate.recommendedStartMinutes
      : null
  });
}

function buildQuickPanelView(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return Object.freeze({ mode: QUICK_PANEL_MODES.FALLBACK });
  }

  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const session = state.pomodoro && typeof state.pomodoro === 'object' ? state.pomodoro : {};
  const active = session.running === true || session.paused === true;
  const chosenMinutes = state.focusMinutes && Number.isInteger(state.focusMinutes.chosen)
    ? state.focusMinutes.chosen
    : 25;

  if (active) {
    const kind = session.kind || (session.mode === 'break' ? 'break' : 'focus');
    const linked = kind === 'break' ? null : tasks.find(item => item && item.id === session.taskId);
    const task = taskSummary(linked);
    return Object.freeze({
      mode: QUICK_PANEL_MODES.ACTIVE,
      session: Object.freeze({
        sessionId: text(session.sessionId) || null,
        taskId: text(session.taskId) || null,
        kind,
        awaitingOfflineConfirmation: session.awaitingOfflineConfirmation === true,
        recoveryReason: session.recoveryReason || null,
        resumeAction: session.resumeAction || null,
        running: session.running === true,
        paused: session.paused === true,
        elapsedMs: Number.isFinite(session.elapsedMs) ? Math.max(0, session.elapsedMs) : 0,
        remainingMs: Number.isFinite(session.remainingMs) ? Math.max(0, session.remainingMs) : 0
      }),
      task,
      taskActionable: Boolean(linked && !linked.done && !linked.skippedAt),
      steps: incompleteSteps(linked && !linked.done && !linked.skippedAt ? linked : null),
      chosenMinutes
    });
  }

  const source = state.recommendations && Array.isArray(state.recommendations.candidates)
    ? state.recommendations.candidates
    : [];
  const seen = new Set();
  const candidates = [];
  for (const candidate of source) {
    const summary = candidateSummary(candidate, tasks, state.startState, state.now);
    if (!summary || seen.has(summary.id)) continue;
    seen.add(summary.id);
    candidates.push(summary);
    if (candidates.length === 3) break;
  }

  return Object.freeze({
    mode: QUICK_PANEL_MODES.IDLE,
    candidates: Object.freeze(candidates),
    chosenMinutes
  });
}

module.exports = { QUICK_PANEL_MODES, buildQuickPanelView };
