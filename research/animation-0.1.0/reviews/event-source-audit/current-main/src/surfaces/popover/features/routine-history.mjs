import { t } from '../../shared/interface/i18n.mjs';
import { routineSymbol, ROUTINE_CHECK_ICON } from './routine-symbols.mjs';
'use strict';

// 日常的历史记录：默认收成一行（“历史 · 昨天 3 条”），展开后按天翻页。
// 昨天来自可编辑的 routineLog（沿用 #yesterdayRoutineRows 的行与动作）；更早的
// 日子只在时间轴里留有事实，所以这里只读展示，不提供撤回或改时间。
const MAX_DAYS_BACK = 14;
const PROBE_DAYS = 7;

function dayKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(offset, ms) {
  if (offset === 1) return t('昨天');
  if (offset === 2) return t('前天');
  const d = new Date(ms);
  return t('{month}月{day}日 周{weekday}', { month: d.getMonth() + 1, day: d.getDate(),
    weekday: '日一二三四五六'[d.getDay()] });
}

function createRoutineHistory({ $, escapeHTML, surfaceClient, now = () => Date.now(), getState = () => ({}) } = {}) {
  let offset = 1, expanded = false, view = null, probedFor = '', bound = false;
  const older = new Map(); // dayKey -> entries | null (loading)
  const canReadOlder = typeof surfaceClient?.getTimelineDay === 'function';
  const dayMs = n => now() - n * 86_400_000;

  function entriesFor(n) {
    if (n === 1) return (view?.yesterday || []).map(item => ({ at: item.loggedAt, title: item.title, kind: item.kind, status: item.status }));
    return older.get(dayKeyOf(dayMs(n))) || [];
  }
  function hasAnyHistory() {
    if (view?.yesterday?.length) return true;
    for (const entries of older.values()) if (entries?.length) return true;
    return false;
  }
  async function load(n) {
    const key = dayKeyOf(dayMs(n));
    if (!canReadOlder || n === 1 || older.has(key)) return;
    older.set(key, null);
    let entries = [];
    try {
      const response = await surfaceClient.getTimelineDay(key);
      const markers = response?.ok ? (response.day?.markers || []) : [];
      const items = getState()?.routines?.items || [];
      entries = markers.filter(marker => marker?.kind === 'routine.logged' && ['done', 'skipped'].includes(marker.status))
        .map(marker => { const item = items.find(candidate => candidate.id === marker.routineId);
          return { at: marker.occurredAt, title: item?.title || t('已移除的日常'), kind: item?.kind || marker.routineKind, status: marker.status }; })
        .sort((a, b) => a.at - b.at);
    } catch (_) { entries = []; }
    older.set(key, entries);
    paint();
  }
  async function probe() {
    const today = dayKeyOf(now());
    if (!canReadOlder || probedFor === today) return;
    probedFor = today;
    for (let n = 2; n <= PROBE_DAYS; n += 1) await load(n);
  }
  function time(ms) {
    const d = new Date(ms);
    return Number.isFinite(ms) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  }
  function paint() {
    const section = $('#yesterdayRoutineRecords');
    if (!section || !view) return;
    section.classList.toggle('hidden', !hasAnyHistory());
    const entries = entriesFor(offset), loading = offset > 1 && older.get(dayKeyOf(dayMs(offset))) === null;
    const done = entries.filter(entry => entry.status === 'done').length;
    const label = dayLabel(offset, dayMs(offset));
    const summary = $('#routineHistorySummary');
    if (summary) summary.textContent = loading ? label : entries.length
      ? t('{day} · 做了 {done} / 记了 {count}', { day: label, done, count: entries.length }) : t('{day} · 没有记录', { day: label });
    const toggle = $('#routineHistoryToggle');
    if (toggle) { toggle.setAttribute('aria-expanded', String(expanded)); section.setAttribute?.('data-expanded', String(expanded)); }
    const prev = $('#routineHistoryPrev'), next = $('#routineHistoryNext');
    if (prev) { prev.disabled = !canReadOlder || offset >= MAX_DAYS_BACK; prev.setAttribute('aria-label', t('前一天')); prev.title = t('前一天'); }
    if (next) { next.disabled = offset <= 1; next.setAttribute('aria-label', t('后一天')); next.title = t('后一天'); }
    const body = $('#routineHistoryBody');
    body?.classList?.toggle('hidden', !expanded);
    const editable = $('#yesterdayRoutineRows');
    editable?.classList?.toggle('hidden', offset !== 1);
    const list = $('#routineHistoryList');
    if (!list) return;
    list.classList?.toggle('hidden', offset === 1);
    if (offset === 1) return;
    list.innerHTML = loading ? `<p class="routine-empty">${t('正在读取…')}</p>` : entries.length
      ? entries.map(entry => `<div class="routine-row routine-history-row" data-state="${entry.status}">`
        + `<span class="routine-when">${escapeHTML(time(entry.at))}</span>`
        + `<span class="routine-kind" aria-hidden="true">${routineSymbol(entry.kind).icon}</span>`
        + `<span class="routine-title">${escapeHTML(entry.title || '')}</span>`
        + (entry.status === 'done' ? `<span class="routine-answer routine-complete-mark" role="img" aria-label="${t('已完成')}">${ROUTINE_CHECK_ICON}</span>`
          : `<span class="routine-answer">${t('跳过了')}</span>`) + '</div>').join('')
        + `<p class="routine-history-note">${t('更早的记录只读')}</p>`
      : `<p class="routine-empty">${t('这天没有记录')}</p>`;
  }
  function move(delta) {
    offset = Math.max(1, Math.min(MAX_DAYS_BACK, offset + delta));
    if (!expanded) expanded = true;
    load(offset); paint();
  }
  function bind() {
    if (bound) return; bound = true;
    $('#routineHistoryToggle')?.addEventListener?.('click', () => { expanded = !expanded; paint(); });
    $('#routineHistoryPrev')?.addEventListener?.('click', () => move(1));
    $('#routineHistoryNext')?.addEventListener?.('click', () => move(-1));
  }
  function render(nextView) {
    view = nextView; bind(); paint(); probe();
  }
  return Object.freeze({ render, repaint: paint });
}

export { createRoutineHistory, dayLabel };

