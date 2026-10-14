'use strict';

// Match the canonical persisted order before the strict transaction validator.
// Updating an early reminder in place must not leave its later answer out of order.
function orderRoutineLog(log) {
  log.days = log.days.filter(day => day.entries.length > 0);
  for (const day of log.days) {
    day.entries.sort((left, right) => Number(left.at || 0) - Number(right.at || 0)
      || left.occurrenceId.localeCompare(right.occurrenceId));
  }
  log.days.sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

module.exports = { orderRoutineLog };
