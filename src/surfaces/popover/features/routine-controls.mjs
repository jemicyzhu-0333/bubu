import { t } from '../../shared/interface/i18n.mjs';
import { ROUTINE_KINDS } from '../../../content/energy-effects.mjs';
import { routineSymbol } from './routine-symbols.mjs';

// A form draft only. Persistence and reminder scheduling stay in routines.
function createRoutineControls({ $, escapeHTML: esc, getState, listen, syncScheduleFields }) {
  let times = [];
  const pad = n => String(n).padStart(2, '0');
  function renderKinds() {
    const host = $('#routineKindChoices');
    if (!host) return;
    const value = $('#routineKind').value;
    host.innerHTML = ROUTINE_KINDS.map(kind => `<button type="button" class="routine-kind-choice" data-kind="${kind}" aria-pressed="${value === kind}">${routineSymbol(kind).icon}<span data-kind-label>${t(kind === 'custom' ? '自定义' : routineSymbol(kind).label)}</span></button>`).join('');
    $('#routineCustomRow')?.classList.toggle('hidden', value !== 'custom');
    const names = [...new Set((getState()?.routines?.items || []).map(r => r.customLabel).filter(Boolean))];
    if ($('#routineCustomLabels')) $('#routineCustomLabels').innerHTML = names.map(name => `<option value="${esc(name)}"></option>`).join('');
  }
  function renderTimes() {
    const host = $('#routineTimeChoices');
    if (!host) return;
    $('#routineTimes').value = times.join(',');
    const options = (count, selected) => Array.from({ length: count }, (_, n) => `<option value="${pad(n)}" ${pad(n) === selected ? 'selected' : ''}>${pad(n)}</option>`).join('');
    host.innerHTML = times.map((time, i) => `<div class="routine-time-slot"><span data-icon="clock" data-icon-only></span><select data-time-index="${i}" data-part="0" aria-label="${t('第{index}次提醒的小时', { index: i + 1 })}">${options(24,time.slice(0,2))}</select><span>:</span><select data-time-index="${i}" data-part="1" aria-label="${t('第{index}次提醒的分钟', { index: i + 1 })}">${options(60,time.slice(3))}</select><button type="button" data-remove-time="${i}" aria-label="${t('移除 {time}', { time })}">×</button></div>`).join('');
    if ($('#btnAddRoutineTime')) $('#btnAddRoutineTime').disabled = times.length >= 6;
  }
  function repaintCopy() {
    $('#routineKindChoices')?.querySelectorAll('[data-kind]').forEach(button => {
      const label = button.querySelector('[data-kind-label]');
      if (label) label.textContent = t(routineSymbol(button.dataset.kind).label);
    });
    $('#routineTimeChoices')?.querySelectorAll('[data-time-index]').forEach(select => {
      select.setAttribute('aria-label', t(select.dataset.part === '0' ? '第{index}次提醒的小时' : '第{index}次提醒的分钟', { index: Number(select.dataset.timeIndex) + 1 }));
    });
    $('#routineTimeChoices')?.querySelectorAll('[data-remove-time]').forEach(button => {
      button.setAttribute('aria-label', t('移除 {time}', { time: times[Number(button.dataset.removeTime)] }));
    });
    for (const option of $('#routineKind')?.options || []) option.textContent = t(routineSymbol(option.value).label);
  }
  function renderFrequency() {
    const value = $('#routineFrequency')?.value || '';
    $('#routineFrequencyChoices')?.querySelectorAll('[data-frequency]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.frequency === value)));
    syncScheduleFields();
  }
  function setTimeValues(values) { times = [...values]; renderTimes(); }
  function fill(item = null) {
    $('#routineTitle').value = item?.title || '';
    $('#routineKind').value = item?.kind || 'medication';
    if ($('#routineCustomLabel')) $('#routineCustomLabel').value = item?.customLabel || '';
    $('#routineFrequency').value = item?.schedule?.frequency || '';
    if ($('#routineMaxLevel')) $('#routineMaxLevel').value = String(item?.maxLevel || 2);
    $('#routineWeekdayRow')?.querySelectorAll('[data-weekday]').forEach(button => button.setAttribute('aria-pressed', String((item?.schedule?.weekdays || []).includes(Number(button.dataset.weekday)))));
    setTimeValues(item?.schedule?.timesOfDay || []);
    renderKinds(); renderFrequency();
  }
  function mount() {
    renderKinds(); renderFrequency(); renderTimes();
    listen($('#routineKindChoices'), 'click', e => {
      const button = e.target.closest('[data-kind]'); if (!button) return;
      $('#routineKind').value = button.dataset.kind; renderKinds();
    });
    listen($('#routineFrequencyChoices'), 'click', e => {
      const button = e.target.closest('[data-frequency]'); if (!button) return;
      $('#routineFrequency').value = button.dataset.frequency;
      renderFrequency();
    });
    listen($('#routineTimeChoices'), 'change', e => {
      if (!e.target.matches('[data-time-index]')) return;
      const i = Number(e.target.dataset.timeIndex), parts = times[i].split(':');
      parts[Number(e.target.dataset.part)] = e.target.value; times[i] = parts.join(':');
      $('#routineTimes').value = times.join(',');
    });
    listen($('#routineTimeChoices'), 'click', e => {
      const button = e.target.closest('[data-remove-time]'); if (!button) return;
      times.splice(Number(button.dataset.removeTime),1); renderTimes();
    });
    listen($('#routineTimePresets'), 'click', e => {
      const button = e.target.closest('[data-time]'); if (!button || times.length >= 6 || times.includes(button.dataset.time)) return;
      times.push(button.dataset.time); renderTimes();
    });
    listen($('#btnAddRoutineTime'), 'click', () => {
      if (times.length < 6) { times.push('09:00'); renderTimes(); }
    });
  }
  return { mount, fill, renderKinds, repaintCopy };
}
export { createRoutineControls };
