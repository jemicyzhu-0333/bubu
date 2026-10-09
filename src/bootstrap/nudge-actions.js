'use strict';

const { focusSession } = require('../capabilities/execution');

// Compose reminder actions with the existing commands. The host owns offered
// actions, sender and instance checks; canonical routine eligibility is read
// again here because the ordinary logging command also permits corrections.
function registerNudgeActions({
  nudge, resolveRoutineRequest, logRoutineOccurrenceCommand, recordTaskAvoidance,
  readFocusSession, readNowTaskId, getSettings, acceptHealthyShutdown,
  stopFocusSession, startRestSession, startFocusSession
}) {
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
      if (focusSession.isActiveFocusSession(started)) {
        const stopped = stopFocusSession('accepted-rest');
        if (!stopped.ok) return stopped;
      }
      // Stopping commits a new state; re-read before offering the break.
      if (!focusSession.isTimingSession(readFocusSession())) return startRestSession(taskId, { userInitiated: true });
      return { ok: true };
    }
    if (actionId === 'accept-focus') {
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
