import { t } from '../../shared/interface/i18n.mjs';

function localDateTime(at) {
  const date = new Date(at), pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function suggestionAt(impulse, draft) {
  return draft?.routineKind !== undefined && draft.routineKind !== impulse.triage?.routineKind
    ? null : impulse.triageStatus?.occurredAt;
}
function eventTimeValue(impulse, draft) {
  if (draft?.eventTime !== undefined) return draft.eventTime;
  return localDateTime(suggestionAt(impulse, draft) ?? impulse.createdAt);
}
function parseEventTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = new Date(value).getTime();
  return Number.isSafeInteger(at) && at >= 0 && localDateTime(at) === value ? at : null;
}
function eventTimeAt(impulse, draft, value) {
  if (draft?.eventTime === undefined && value === eventTimeValue(impulse, draft)) {
    return suggestionAt(impulse, draft) ?? impulse.createdAt;
  }
  return parseEventTime(value);
}
function repaintEventTime(row, impulse, draft) {
  const tag = row.querySelector('.inbox-time-ai-tag');
  if (tag) tag.hidden = draft?.eventTime !== undefined || !Number.isSafeInteger(suggestionAt(impulse, draft));
}
function eventTimeField(impulse, draft, escapeHTML) {
  const suggested = draft?.eventTime === undefined && Number.isSafeInteger(suggestionAt(impulse, draft));
  return `<label class="inbox-event-time-label"><span class="inbox-event-time-heading"><span data-i18n="发生时间">${t('发生时间')}</span>`
    + `${suggested ? `<span class="inbox-ai-tag inbox-time-ai-tag" title="${t('AI 建议的时间')}" data-i18n-title="AI 建议的时间">AI</span>` : ''}`
    + `</span><input class="inbox-event-time pixel-input" type="datetime-local" required value="${escapeHTML(eventTimeValue(impulse, draft))}"></label>`;
}
export { localDateTime, eventTimeValue, parseEventTime, eventTimeAt, eventTimeField, repaintEventTime };
