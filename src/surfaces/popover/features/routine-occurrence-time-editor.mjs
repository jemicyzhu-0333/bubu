import { t } from '../../shared/interface/i18n.mjs';

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

function localDateTime(at) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function recorded(occurrence) {
  return occurrence?.answered === true && ['done', 'skipped'].includes(occurrence.status)
    && Number.isSafeInteger(occurrence.loggedAt) && occurrence.loggedAt >= 0;
}

// PRODUCT「面板交互」: each opening owns its draft and receipt. Projection changes
// cannot replace typed input; canonical freshness is rechecked by routines:log.
function createRoutineOccurrenceTimeEditor({ $, getOccurrences, surfaceClient, escapeHTML, listen } = {}) {
  let draft = null;
  let disposed = false;
  let receipt = false;
  const pending = new Map();
  const host = () => $('#routineTimeEditor');
  const find = id => getOccurrences().find(item => item.occurrenceId === id);
  const current = owner => !disposed && draft === owner;

  function changed(owner) {
    const occurrence = find(owner.occurrenceId);
    return !recorded(occurrence) || occurrence.routineId !== owner.routineId
      || occurrence.loggedAt !== owner.expectedAt || occurrence.status !== owner.status;
  }

  function refresh() {
    const root = host();
    if (!root) return;
    if (!draft) { if (receipt) root.textContent = t('记录时间已保存。'); return; }
    const busy = pending.has(draft.occurrenceId);
    if (!busy && changed(draft)) draft.stale = true;
    root.querySelector('[data-time-input]').disabled = busy;
    root.querySelector('[data-time-save]').disabled = busy || draft.stale;
    root.querySelector('[data-time-save]').textContent = t(busy ? '正在保存…' : '保存时间');
    root.querySelector('[data-time-cancel]').textContent = t('取消');
    root.querySelector('[data-time-label]').textContent = t('实际发生时间');
    root.querySelector('[data-time-title]').textContent = t('修改 {title} 的记录时间', { title: draft.title });
    root.querySelector('[data-time-status]').textContent = t(draft.stale
      ? '这条记录已变化，关闭后重新编辑。' : draft.message);
  }

  function close({ restore = true } = {}) {
    const previous = draft;
    receipt = false;
    draft = null;
    if (host()) { host().innerHTML = ''; host().classList.add('hidden'); }
    if (restore && previous) {
      const rows = ['#dailyRoutineRows', '#yesterdayRoutineRows'].flatMap(selector =>
        [...($(selector)?.querySelectorAll?.('[data-occurrence]') || [])]);
      const row = [...rows].find(item => item.dataset.occurrence === previous.occurrenceId);
      const button = row?.querySelector?.('[data-act="edit-time"]');
      (button || $('#btnNewRoutine'))?.focus?.();
    }
  }

  function open(occurrenceId) {
    const occurrence = find(occurrenceId);
    if (!recorded(occurrence) || !host()) return false;
    disposed = false;
    receipt = false;
    draft = { occurrenceId, routineId: occurrence.routineId, title: occurrence.title || '',
      status: occurrence.status, expectedAt: occurrence.loggedAt,
      value: localDateTime(occurrence.loggedAt), message: '', stale: false };
    host().innerHTML = `<p class="routine-time-title" data-time-title></p>`
      + `<label class="routine-time-field"><span data-time-label></span>`
      + `<input class="pixel-input" type="datetime-local" step="1" data-time-input value="${escapeHTML(draft.value)}" aria-describedby="routineTimeStatus"></label>`
      + `<div class="routine-time-actions"><button type="button" class="chip chip-action" data-time-save></button>`
      + `<button type="button" class="chip" data-time-cancel></button></div>`
      + `<p id="routineTimeStatus" class="capability-note" data-time-status role="status" aria-live="polite"></p>`;
    host().classList.remove('hidden');
    refresh();
    host().querySelector('[data-time-input]')?.focus?.();
    return true;
  }

  async function save() {
    const owner = draft;
    if (!owner || owner.stale || pending.has(owner.occurrenceId)) return;
    if (changed(owner)) { owner.stale = true; refresh(); return; }
    const value = host().querySelector('[data-time-input]').value;
    owner.value = value;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const at = normalized === localDateTime(owner.expectedAt) ? owner.expectedAt : new Date(value).getTime();
    // Round-trip rejects invalid dates and local daylight-saving gaps rather than
    // silently moving the record to a different wall-clock time.
    if (!value || !Number.isSafeInteger(at) || localDateTime(at) !== normalized) {
      owner.message = '日期和时间无效。'; refresh(); return;
    }
    pending.set(owner.occurrenceId, owner);
    owner.message = '正在保存…'; refresh();
    try {
      const result = await surfaceClient.logRoutine({ routineId: owner.routineId,
        occurrenceId: owner.occurrenceId, status: owner.status, at,
        expectedAt: owner.expectedAt, expectedStatus: owner.status });
      if (!current(owner)) return;
      if (result?.ok === true) {
        close();
        receipt = true;
        if (host()) {
          host().textContent = t('记录时间已保存。');
          host().classList.remove('hidden');
        }
      } else {
        owner.message = result?.ok === false
          ? REFUSALS[result.reason] || '时间未保存，可以重试。'
          : '结果暂未确认，请先核对日常记录。';
        if (['target-changed', 'invalid-occurrence-correction', 'occurrence-not-found', 'routine-not-found'].includes(result?.reason)) owner.stale = true;
      }
    } catch (_) {
      if (current(owner)) owner.message = '结果暂未确认，请先核对日常记录。';
    } finally {
      if (pending.get(owner.occurrenceId) === owner) pending.delete(owner.occurrenceId);
      // A late receipt cannot close or replace another opening's message.
      if (!disposed) refresh();
    }
  }

  function mount() {
    disposed = false;
    listen(host(), 'click', event => {
      if (event.target?.closest?.('[data-time-save]')) void save();
      else if (event.target?.closest?.('[data-time-cancel]')) close();
    });
    listen(host(), 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Enter' && event.target?.matches?.('[data-time-input]')) {
        event.preventDefault(); void save();
      }
    });
  }

  function dispose() { disposed = true; close({ restore: false }); }
  return Object.freeze({ mount, open, save, close, refresh, dispose });
}

export { createRoutineOccurrenceTimeEditor, localDateTime, recorded };
