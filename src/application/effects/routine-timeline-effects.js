'use strict';

const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const ROUTINE_DIRTY = Object.freeze({ routines: true, energy: true });
const TIMELINE_DIRTY = Object.freeze({ timeline: true });

function createRoutineTimelineEffects({ timelineRecorder, publish, reportEffectError = () => {} } = {}) {
  if (!timelineRecorder || !['recordRoutineLogged', 'recordRoutineLogUndone', 'recordRoutineReminded', 'recordRoutineMissed']
    .every(method => typeof timelineRecorder[method] === 'function')) {
    throw new TypeError('routine timeline effects require a timeline recorder');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('routine timeline effects require post-commit callbacks');
  }

  function publishCommitted(fact) {
    runPostCommitEffect(() => {
      if (fact.type === 'routine-logged') {
        timelineRecorder.recordRoutineLogged({
          revision: fact.revision,
          routineId: fact.routineId,
          kind: fact.kind,
          occurrenceId: fact.occurrenceId,
          status: fact.status,
          scheduled: fact.scheduled,
          loggedAt: fact.at
        });
      } else if (fact.type === 'routine-log-undone') {
        timelineRecorder.recordRoutineLogUndone({ occurrenceId: fact.occurrenceId });
      } else if (fact.type === 'routine-reminded') {
        timelineRecorder.recordRoutineReminded({
          routineId: fact.routineId,
          kind: fact.kind,
          occurrenceId: fact.occurrenceId,
          level: fact.level,
          remindedAt: fact.at
        });
      }
    }, fact, reportEffectError);
    runPostCommitEffect(publish, ROUTINE_DIRTY, reportEffectError);
  }

  function recordMissed(input) {
    let recorded = 0;
    runPostCommitEffect(() => {
      const result = timelineRecorder.recordRoutineMissed(input);
      recorded = result && result.recorded || 0;
    }, input, reportEffectError);
    if (recorded > 0) runPostCommitEffect(publish, TIMELINE_DIRTY, reportEffectError);
  }

  return Object.freeze({ publishCommitted, recordMissed });
}

module.exports = { createRoutineTimelineEffects };
