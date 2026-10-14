'use strict';

const { focusSession } = require('../capabilities/execution');

// Compose reminder actions with the existing commands. The host owns offered
// actions, sender and instance checks; canonical routine eligibility is read
// again here because the ordinary logging command also permits corrections.
function registerNudgeActions({
  nudge, resolveRoutineRequest, logRoutineOccurrenceCommand, recordTaskAvoidance,
  readFocusSession, readNowTaskId, getSettings, acceptHealthyShutdown,
  stopFocusSession, startRestSession, startFocusSession, resumeFocusSession
}) {
  const { STATUS } = focusSession;
  // A paused round is still on the clock (isTimingSession) but is neither running
  // focus nor running break. Accepting a reminder must therefore treat it by its
  // underlying kind, otherwise the accept is a silent no-op while paused.
  const pausedKind = session => focusSession.isPausedSession(session) ? focusSession.sessionKind(session) : null;
  const isFocusKind = kind => kind === STATUS.FOCUS || kind === STATUS.QUICK_START;
  const resume = session => (typeof resumeFocusSession === 'function'
    ? resumeFocusSession({ sessionId: session.sessionId })
    : { ok: false, reason: 'resume-unavailable' });
  nudge.setActionHandler(({ actionId, type, context, deferMinutes }) => {
    if (actionId === 'complete-routine' || actionId === 'skip-routine-today') {
      const { routineId, occurrenceId } = context || {};
      if (type !== 'routine' || ![routineId, occurrenceId].every(id => (
        typeof id === 'string' && id.length > 0 && id.trim() === id
      ))) return { ok: false, reason: 'invalid-routine-reminder' };
      const request = resolveRoutineRequest({ routineId, occurrenceId });
      if (!request || request.type !== 'routine' || request.context?.routineId !== routineId
          || request.context?.occurrenceId !== occurrenceId || !Number.isSafeInteger(request.resolvedAt)) {
        return { ok: false, reason: 'stale-routine-reminder' };
      }
      // ARCHITECTURE「日常与能量」: one exact occurrence, not the whole day or a
      // free log. Eligibility and the actual answer share this captured instant.
      return logRoutineOccurrenceCommand.log({ routineId, occurrenceId,
        status: actionId === 'complete-routine' ? 'done' : 'skipped', at: request.resolvedAt });
    }
    if (deferMinutes && context && context.kind === 'break-complete' && context.taskId) {
      recordTaskAvoidance({ taskId: context.taskId });
      return { ok: true };
    }
    if (actionId === 'accept-rest') {
      if (context && context.kind === 'work-end') {
        return { ok: true, ...acceptHealthyShutdown(context.dayKey) };
      }
      const started = readFocusSession();
      const taskId = started.taskId || (context && context.taskId) || null;
      const paused = pausedKind(started);
      // Paused break: the rest the user accepts is the one already on the clock.
      if (paused === STATUS.BREAK) return resume(started);
      if (focusSession.isActiveFocusSession(started) || isFocusKind(paused)) {
        const stopped = stopFocusSession('accepted-rest');
        if (!stopped.ok) return stopped;
      }
      // Stopping commits a new state; re-read before offering the break.
      if (!focusSession.isTimingSession(readFocusSession())) return startRestSession(taskId, { userInitiated: true });
      return { ok: true };
    }
    if (actionId === 'accept-focus') {
      const current = readFocusSession();
      const paused = pausedKind(current);
      if (isFocusKind(paused)) return resume(current);
      if (paused === STATUS.BREAK) {
        const stopped = stopFocusSession('accepted-focus');
        if (!stopped.ok) return stopped;
      }
      if (focusSession.isTimingSession(readFocusSession())) return { ok: true };
      const taskId = (context && context.taskId) || readNowTaskId() || null;
      return startFocusSession(taskId, getSettings().pomodoroMinutes);
    }
    if (type === 'focus' && actionId === 'dismiss' && context && context.taskId) {
      recordTaskAvoidance({ taskId: context.taskId });
    }
    return { ok: true };
  });
}

module.exports = { registerNudgeActions };
