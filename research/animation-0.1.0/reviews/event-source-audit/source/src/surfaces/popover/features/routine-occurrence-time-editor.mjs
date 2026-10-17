import { createEventTimeDialog, localDateTime } from '../ui/event-time-dialog.mjs';

const REFUSALS = Object.freeze({
  'day-full': '这一天的记录已满，原时间保持不变。',
  'log-full': '可编辑记录已满，原时间保持不变。',
  'invalid-occurrence-time': '日期和时间无效。',
  'occurrence-in-future': '记录时间不能晚于现在。',
  'occurrence-outside-window': '只能修改今天或昨天的记录时间。',
  'invalid-occurrence-correction': '这条记录已变化，关闭后重新编辑。',
  'target-changed': '这条记录已变化，关闭后重新编辑。',
  'occurrence-not-found': '这条记录已不在列表中，无法修改时间。',
  'routine-not-found': '这条记录已不在列表中，无法修改时间。'
});

function recorded(occurrence) {
  return occurrence?.answered === true && ['done', 'skipped'].includes(occurrence.status)
    && Number.isSafeInteger(occurrence.loggedAt) && occurrence.loggedAt >= 0;
}

function createRoutineOccurrenceTimeEditor({ $, getOccurrences, surfaceClient, escapeHTML, listen,
  restoreModalFocus, trapFocusWithin, onSaved = () => {} } = {}) {
  const timeDialog = createEventTimeDialog({ $, escapeHTML, listen, restoreModalFocus, trapFocusWithin });
  const find = id => getOccurrences().find(item => item.occurrenceId === id);
  function open(occurrenceId) {
    const occurrence = find(occurrenceId);
    if (!recorded(occurrence)) return false;
    const { routineId, status, loggedAt: expectedAt } = occurrence;
    return timeDialog.open({ key: `routine:${occurrenceId}`, title: occurrence.title || '',
      value: localDateTime(expectedAt).slice(0, 16), originalAt: expectedAt, precision: 'minute',
      isCurrent: () => {
        const latest = find(occurrenceId);
        return recorded(latest) && latest.routineId === routineId
          && latest.loggedAt === expectedAt && latest.status === status;
      },
      resolveReturnFocus: () => {
        const rows = ['#dailyRoutineRows', '#yesterdayRoutineRows'].flatMap(selector =>
          [...($(selector)?.querySelectorAll?.('[data-occurrence]') || [])]);
        const row = rows.find(item => item.dataset.occurrence === occurrenceId);
        return row?.querySelector?.('[data-act="edit-time"]') || $('#btnNewRoutine');
      },
      submit: async ({ at }) => {
        const result = await surfaceClient.logRoutine({ routineId, occurrenceId, status, at,
          expectedAt, expectedStatus: status });
        return result?.ok !== false ? result : { ...result,
          message: REFUSALS[result.reason] || '时间未保存，可以重试。',
          stale: ['target-changed', 'invalid-occurrence-correction', 'occurrence-not-found', 'routine-not-found'].includes(result.reason) };
      },
      onSaved: () => onSaved('记录时间已保存。')
    });
  }
  return Object.freeze({ ...timeDialog, open, timeDialog });
}

export { createRoutineOccurrenceTimeEditor, localDateTime, recorded };

