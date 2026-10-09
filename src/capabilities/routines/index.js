'use strict';

// The routines capability: a list of recurring things, a per-day log of whether
// they happened, and five channels. It owns `routines` and `routineLog` and
// nothing else — ARCHITECTURE「日常与能量」's "never XP, never a streak, never the pet" is enforced by
// that write set, not by review.

const dayPlan = require('./domain/day-plan');
const routineEditing = require('./domain/routine-editing');
const routineLogging = require('./domain/routine-logging');
const manageRoutine = require('./application/manage-routine');
const logRoutineOccurrence = require('./application/log-routine-occurrence');
const routineReminder = require('./application/routine-reminder');

module.exports = Object.freeze({
  ...require('./contract/ipc-codec'),
  dayPlan: Object.freeze({ ...dayPlan }),
  routineEditing: Object.freeze({ ...routineEditing }),
  scheduleEditing: Object.freeze({ ...require('./domain/schedule-editing') }),
  routineLogging: Object.freeze({ ...routineLogging }),
  manageRoutine: Object.freeze({ ...manageRoutine }),
  logRoutineOccurrence: Object.freeze({ ...logRoutineOccurrence }),
  routineReminder: Object.freeze({ ...routineReminder })
});
