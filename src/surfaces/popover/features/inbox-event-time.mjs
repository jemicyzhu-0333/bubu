import { t, getLocale } from '../../shared/interface/i18n.mjs';

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
  if (Number.isSafeInteger(draft?.eventTimeInstant) && value === localDateTime(draft.eventTimeInstant)) return draft.eventTimeInstant;
  if (draft?.eventTime === undefined && value === eventTimeValue(impulse, draft)) {
    return suggestionAt(impulse, draft) ?? impulse.createdAt;
  }
  return parseEventTime(value);
}
function displayEventTime(impulse, draft) {
  const at = parseEventTime(eventTimeValue(impulse, draft));
  return at === null ? t('选择时间') : new Date(at).toLocaleString(getLocale(), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  });
}
function repaintEventTime(row, impulse, draft) {
  const tag = row.querySelector('.inbox-time-ai-tag');
  if (tag) tag.hidden = draft?.eventTime !== undefined || !Number.isSafeInteger(suggestionAt(impulse, draft));
  const value = row.querySelector('.inbox-event-time-value');
  if (value) value.textContent = displayEventTime(impulse, draft);
}
function eventTimeField(impulse, draft, escapeHTML) {
  const suggested = draft?.eventTime === undefined && Number.isSafeInteger(suggestionAt(impulse, draft));
  return `<div class="inbox-event-time-row"><span class="inbox-event-time-heading" data-i18n="发生时间">${t('发生时间')}</span>`
    + `<button type="button" class="inbox-event-time-edit" data-inbox-action="edit-time" aria-label="${t('修改时间')}" data-i18n-aria-label="修改时间" title="${t('修改时间')}" data-i18n-title="修改时间">`
    + `<span class="inbox-event-time-value">${escapeHTML(displayEventTime(impulse, draft))}</span>`
    + `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m10.7 2.7 2.6 2.6M3 10.4 10.8 2.6a1.2 1.2 0 0 1 1.7 0l.9.9a1.2 1.2 0 0 1 0 1.7L5.6 13H3v-2.6Z"/></svg></button>`
    + `<span class="inbox-ai-tag inbox-time-ai-tag" title="${t('AI 建议的时间')}" data-i18n-title="AI 建议的时间"${suggested ? '' : ' hidden'}>AI</span></div>`;
}
export { localDateTime, eventTimeValue, parseEventTime, eventTimeAt, eventTimeField, repaintEventTime };
