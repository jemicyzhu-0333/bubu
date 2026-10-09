'use strict';

// ARCHITECTURE「事实流与长期记忆」: the single writer to the timeline fact store. It turns already-
// committed session/task facts into timeline events (via the pure domain
// builders) and appends them AFTER the document commit has succeeded. History is
// derived evidence, never the source of truth, so every failure here is
// swallowed: a fact-store error must not turn a committed focus session or task
// completion into a retryable command. A tier-'none' store whose append is a
// no-op is handled by the same path — nothing to record, nothing thrown.

const {
  planningChangedFacts, inboxCapturedFacts, inboxResolvedFacts, sessionStartedFacts, sessionSettlementFacts, taskCompletedFacts, taskCompletedEventId, energyCalibratedFacts,
  routineLoggedFacts, routineLoggedEventId, routineRemindedFacts, routineMissedFacts
} = require('../domain/timeline-facts');

// The recorder writes only to the injected fact store (derived history), never
// to canonical document state — so its declared write set is empty.
const RECORD_TIMELINE_WRITES = Object.freeze([]);

function createTimelineRecorder({ timeline, logger = () => {} } = {}) {
  // A missing or shape-incomplete store is a no-op, not an error: recording is a
  // best-effort side channel that must never gate the main flow.
  const canAppend = timeline && typeof timeline.append === 'function';

  function trace(operation, error) {
    // A broken logger costs one trace line, never the record path (ARCHITECTURE「事实流与长期记忆」 lesson).
    try {
      logger({ scope: 'timeline-recorder', operation, message: error && error.message });
    } catch (_) { /* swallow */ }
  }

  function appendAll(operation, facts, method = 'append') {
    if (!canAppend || typeof timeline[method] !== 'function' || !Array.isArray(facts) || facts.length === 0) return { recorded: 0 };
    let recorded = 0;
    for (const fact of facts) {
      try {
        // The repository already swallows its own SQL errors and returns a
        // result; this try/catch only guards against an unexpected throw so one
        // bad event can never block the rest, and never surfaces to the caller.
        const result = timeline[method](fact);
        if (result && result.ok) recorded += 1;
      } catch (error) {
        trace(operation, error);
      }
    }
    return { recorded };
  }

  // The one retraction in this writer, and the reason the store has a `remove` at
  // all. ARCHITECTURE「日常与能量」 promises a routine tap is always undoable, and `undoOccurrence`
  // deletes the log entry rather than writing a compensating one precisely so a
  // mis-tap leaves nothing behind. A timeline row that outlived the undo would
  // reintroduce that failure one table over — permanently, and for a kind of
  // record ("09:03 已服药") where being wrong is not a cosmetic problem.
  //
  // Swallowed like every other write here: a store that cannot delete must not
  // turn an already-committed undo into a retryable command. An older store with
  // no `remove` is a no-op, same as a tier-'none' append.
  function retract(operation, id) {
    if (!timeline || typeof timeline.remove !== 'function' || typeof id !== 'string' || !id) {
      return { removed: 0 };
    }
    try {
      const result = timeline.remove(id);
      return { removed: result && Number.isFinite(result.removed) ? result.removed : 0 };
    } catch (error) {
      trace(operation, error);
      return { removed: 0 };
    }
  }

  return Object.freeze({
    recordPlanningChanged: input => appendAll('planning-changed', planningChangedFacts(input)),
    recordInboxCaptured: input => appendAll('inbox-captured', inboxCapturedFacts(input)),
    recordInboxResolved: input => appendAll('inbox-resolved', inboxResolvedFacts(input)),
    recordSessionStarted: input => appendAll('session-started', sessionStartedFacts(input)),
    recordSessionSettlement: completion => appendAll('session-settlement', sessionSettlementFacts(completion)),
    recordTaskCompleted: input => appendAll('task-completed', taskCompletedFacts(input)),
    recordEnergyCalibrated: input => appendAll('energy-calibrated', energyCalibratedFacts(input)),
    recordRoutineLogged: input => appendAll('routine-logged', routineLoggedFacts(input), 'upsertRoutineLogged'),
    // The reminder sampler's two side-channel rows. `reminded` is appended after
    // the notified write commits; `missed` never touches the store at all — it is
    // the in-process witness (day-plan.js) turned into a timeline row directly, so
    // it has no publish-hook branch and no document write behind it.
    recordRoutineReminded: input => appendAll('routine-reminded', routineRemindedFacts(input)),
    recordRoutineMissed: input => appendAll('routine-missed', routineMissedFacts(input)),
    // 撤销一次完成：和撤销日常打卡同一个道理——留一条“其实没完成”的时间线记录比什么都没有更糟，所以直接删。
    recordTaskCompletionUndone: ({ taskId, completedAt } = {}) => retract(
      'task-completion-undone',
      typeof taskId === 'string' && taskId && Number.isFinite(completedAt) ? taskCompletedEventId(taskId, completedAt) : null
    ),
    recordRoutineLogUndone: ({ occurrenceId } = {}) => retract(
      'routine-log-undone',
      typeof occurrenceId === 'string' && occurrenceId ? routineLoggedEventId(occurrenceId) : null
    )
  });
}

module.exports = { RECORD_TIMELINE_WRITES, createTimelineRecorder };
