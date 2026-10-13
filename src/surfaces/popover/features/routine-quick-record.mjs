'use strict';

function localDayKey(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// PRODUCT「日常事项」: these are recording shortcuts, never a claim that an old
// inbox activity happened again. Established reminders remain reusable; manual
// activities are suggested only on their creation or actual recording day.
function quickRecordItems(view, now) {
  const today = localDayKey(now);
  const occurredToday = at => Number.isSafeInteger(at) && at <= now && localDayKey(at) === today;
  return view.items.filter(item => item && item.active !== false && (item.schedule
    || occurredToday(item.createdAt)
    || view.occurrences.some(entry => entry.routineId === item.id
      && entry.status === 'done' && occurredToday(entry.loggedAt))));
}

function quickRecordTarget(view, routineId, now) {
  // A projection may have been delivered before its window closed. Recheck both
  // bounds at the tap, rather than assigning a fresh event to a stale due row.
  const due = view.occurrences.filter(item => item.routineId === routineId
    && item.scheduled && item.due && !item.answered
    && Number.isSafeInteger(item.scheduledAt) && Number.isSafeInteger(item.windowEndsAt)
    && item.scheduledAt <= now && now <= item.windowEndsAt);
  return due.length === 1 ? due[0].occurrenceId : undefined;
}

export { quickRecordItems, quickRecordTarget };
