import { t } from '../../shared/interface/i18n.mjs';

function localDateTime(at) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// One shared presentation for a local inbox draft and a persisted occurrence.
// Callers own source freshness and the command; this dialog owns only UI lifetime.
function createEventTimeDialog({ $, escapeHTML, listen, restoreModalFocus = target => target?.focus?.(), trapFocusWithin } = {}) {
  let draft = null, disposed = false, epoch = 0;
  const pending = new Map();
  const host = () => $('#routineTimeEditor');
  const current = owner => !disposed && draft === owner;
  const changed = owner => owner.isCurrent?.() === false;
  const isOpen = () => Boolean(draft) && !disposed;

  function refresh() {
    const root = host();
    if (!root || !draft) return;
    const busy = pending.has(draft.key);
    if (!busy && changed(draft)) draft.stale = true;
    root.querySelector('[data-time-input]').disabled = busy;
    root.querySelector('[data-time-save]').disabled = busy || draft.stale;
    root.querySelector('[data-time-save]').textContent = t(busy ? '正在保存…' : '确认');
    root.querySelector('[data-time-cancel]').textContent = t('取消');
    root.querySelector('[data-time-label]').textContent = t('发生时间');
    root.querySelector('[data-time-title]').textContent = t('修改时间');
    root.querySelector('[data-time-subtitle]').textContent = draft.title || '';
    root.querySelector('[data-time-close]').setAttribute?.('aria-label', t('关闭'));
    const message = draft.stale ? '这条记录已变化，关闭后重新编辑。' : draft.message;
    root.querySelector('[data-time-status]').textContent = t(message);
    root.querySelector('[data-time-status]').setAttribute?.('data-error', String(Boolean(message) && !busy));
    root.querySelector('[data-time-input]').setAttribute?.('aria-invalid', String(Boolean(message) && !busy));
  }

  function close({ restore = true } = {}) {
    const previous = draft;
    draft = null;
    const closingEpoch = ++epoch;
    if (host()) { host().innerHTML = ''; host().classList.add('hidden'); host().setAttribute?.('aria-hidden', 'true'); }
    if (restore && previous) restoreModalFocus(previous.resolveReturnFocus?.(),
      () => !disposed && !draft && epoch === closingEpoch);
  }

  function open(options) {
    if (!host() || !options?.key || typeof options.submit !== 'function') return false;
    disposed = false;
    epoch++;
    draft = { ...options, message: '', stale: false };
    host().innerHTML = '<section class="modal event-time-dialog">'
      + '<header class="modal-header"><h2 class="modal-title" id="eventTimeTitle" data-time-title></h2>'
      + '<button type="button" class="modal-close" data-time-close><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>'
      + '<div class="modal-body"><p class="event-time-subtitle" id="eventTimeDescription" data-time-subtitle></p>'
      + '<label class="event-time-field"><span data-time-label></span>'
      + `<input class="pixel-input" type="datetime-local" step="${draft.precision === 'minute' ? '60' : '1'}" data-time-input value="${escapeHTML(draft.value || '')}" aria-describedby="routineTimeStatus"></label>`
      + '<p id="routineTimeStatus" class="event-time-status" data-time-status role="status" aria-live="polite"></p></div>'
      + '<footer class="modal-actions"><button type="button" class="pixel-btn" data-time-cancel></button>'
      + '<button type="button" class="pixel-btn btn-focus" data-time-save></button></footer></section>';
    host().classList.remove('hidden');
    host().setAttribute?.('aria-hidden', 'false');
    refresh();
    host().querySelector('[data-time-input]')?.focus?.();
    return true;
  }

  async function save() {
    const owner = draft;
    if (!owner || owner.stale || pending.has(owner.key)) return;
    if (changed(owner)) { owner.stale = true; refresh(); return; }
    const value = host().querySelector('[data-time-input]').value;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const original = localDateTime(owner.originalAt);
    const matchesOriginal = owner.precision === 'minute' ? value === original.slice(0, 16) : normalized === original;
    const at = matchesOriginal && Number.isSafeInteger(owner.originalAt) ? owner.originalAt : new Date(value).getTime();
    if (!value || !Number.isSafeInteger(at) || at < 0
        || (owner.precision === 'minute' ? localDateTime(at).slice(0, 16) !== value : localDateTime(at) !== normalized)) {
      owner.message = '日期和时间无效。'; refresh(); return;
    }
    pending.set(owner.key, owner);
    owner.message = '正在保存…'; refresh();
    try {
      const result = await owner.submit({ at, value });
      if (!current(owner)) return;
      if (result?.ok === true) { close(); owner.onSaved?.(result); }
      else {
        owner.message = result?.ok === false ? result.message || '时间未保存，可以重试。'
          : '结果暂未确认，请先核对日常记录。';
        owner.stale = result?.stale === true;
      }
    } catch (_) {
      if (current(owner)) owner.message = '结果暂未确认，请先核对日常记录。';
    } finally {
      if (pending.get(owner.key) === owner) pending.delete(owner.key);
      if (!disposed) refresh();
    }
  }

  function mount() {
    disposed = false;
    listen(host(), 'click', event => {
      if (event.target?.closest?.('[data-time-save]')) void save();
      else if (event.target?.closest?.('[data-time-cancel], [data-time-close]')) close();
      else if (event.target === host()) close();
    });
    listen(host(), 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Tab' && trapFocusWithin) { trapFocusWithin(event, host()); event.stopPropagation(); }
      else if (event.key === 'Enter' && event.target?.matches?.('[data-time-input]')) { event.preventDefault(); void save(); }
    });
  }
  function dispose() { disposed = true; close({ restore: false }); }
  return Object.freeze({ mount, open, save, close, refresh, dispose, isOpen });
}

export { createEventTimeDialog, localDateTime };
