import { t, getLocale } from '../../shared/interface/i18n.mjs';
'use strict';

// 「今天的日常」这一节：今天这几件小事回答过了没有、随手记一笔、管理那张列表。
//
// ARCHITECTURE「日常与能量」 要求它独立成一个模块而不塞进 `today.mjs` —— 那边是一层纯派发,没有业务
// 规则;这里有。
//
// 三条约定贯穿整个文件,写在这里一次,下面只在具体那行提醒:
//
// 1. **不抢跑**。点「做了」之后画面不会先变成已完成,而是等仓库回话、投影回流再重
//    画。ARCHITECTURE「日常与能量」要求真实记录:「如果点了已完成却没有落一条记录,
//    曲线就会和用户的记忆不一致」。乐观渲染恰好是制造这种不一致的做法 —— 写失败
//    时画面已经说了"记上了"。所以失败会走 `#routinesStatus`,而不是静静地回滚。
// 2. **不进游戏化层**(ARCHITECTURE「日常与能量」)。这一节一次都不碰 xp / streak / pet / stats,连"完成
//    了几条"都不往成就里送。两条命令的写集(`['routines','routineLog']` 与
//    `['routineLog']`)在 domain 那侧已经把这件事钉死了,这里是同一条约定的界面侧。
// 3. **不编造**(ARCHITECTURE「日常与能量」)。随手记的 chip 来自用户自己的日常列表,不是一张内置词表;
//    过了时间窗的那条只是"没记上",不标红、不计数、不排成欠账清单。
//
// 时间格式在这里重新声明了一次正则,不是从 `core/routine-model` 引进来的:渲染进程
// 是 ESM 且跑在 file:// 下,读不了 CJS 的 core。所以配套测试会把这里的解析结果和
// `normalizeTimesOfDay` 的结果对着断言,两边不许漂移。

// 种类表在 content 里,界面只补一层中文名和字形。surfaces 允许向内引 content
// (companion-art.mjs 已有先例),所以这里不会出现第二份种类清单。
import { ROUTINE_KINDS } from '../../../content/energy-effects.mjs';
import { createRoutineControls } from './routine-controls.mjs';
import { KIND_LABELS, routineSymbol } from './routine-symbols.mjs';

const WEEKDAY_LABELS = Object.freeze({ 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' });
const FREQUENCY_LABELS = Object.freeze({ daily: '每天', weekdays: '工作日', weekly: '每周' });

// 与 `core/routine-model` 的 TIME_OF_DAY_PATTERN 同一条:补零的 24 小时制。补零不是
// 为了好看,而是让这些字符串按文本排序就等于按时间排序。
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES_OF_DAY = 6;

// 写失败时说人话。没有"未知错误(code 3)"这种,因为这一节的每个失败都有具体原因。
const REFUSALS = Object.freeze({
  'routine-not-found': '这条日常已经不在列表里了。',
  'occurrence-mismatch': '这一条对不上，重开一次面板再试。',
  'occurrence-not-found': '这条已经没有记录可以撤回了。',
  'occurrence-required': '这条没有可撤回的记录。',
  'day-full': '今天记的条数到上限了，先撤回几条。',
  'status-unknown': '这个状态不认识，什么都没记。',
  'title-required': '先给它起个名字。',
  'kind-unknown': '这个种类不认识。',
  'routine-limit': '日常的条数到上限了。',
  'nothing-to-update': '没有要改的东西。'
});

function createPopoverRoutinesFeature({ document, $, getState, escapeHTML, surfaceClient } = {}) {
  if (!document || typeof $ !== 'function' || typeof getState !== 'function'
      || typeof escapeHTML !== 'function') {
    throw new TypeError('routines feature requires document, $, getState and escapeHTML');
  }
  if (!surfaceClient) throw new TypeError('routines feature requires surfaceClient');

  let manageOpen = true;
  let editingId = null;
  let saving = false;
  let editControls = null;
  let editGeneration = 0;
  // 删除要按两次:第一次把按钮变成「真的删」,第二次才发命令。删一条日常会连带删掉
  // 它当天的记录(ARCHITECTURE「日常与能量」),这个代价值一次确认,但不值一个弹层。
  let pendingRemoveId = null;
  let lastKey = '';
  let lastDataKey = '';
  let lastStatus = { source: '', parameters: {} };
  let unsubscribe = null;
  const mutations = new Map();
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  const controls = createRoutineControls({ $, escapeHTML, getState, listen, syncScheduleFields });

  function kindOf(kind) {
    return routineSymbol(kind);
  }

  function band(state = getState()) {
    const routines = state && state.routines;
    if (!routines || typeof routines !== 'object') return null;
    const today = routines.today && typeof routines.today === 'object' ? routines.today : null;
    return {
      items: Array.isArray(routines.items) ? routines.items : [],
      occurrences: today && Array.isArray(today.occurrences) ? today.occurrences : [],
      counts: today && today.counts ? today.counts : { total: 0, done: 0, open: 0, due: 0 },
      remindersEnabled: routines.remindersEnabled !== false
    };
  }

  function say(source, parameters = {}) {
    lastStatus = { source: source || '', parameters };
    const message = t(lastStatus.source, parameters);
    const line = $('#routinesStatus');
    for (const target of [line, $('#routineFormStatus'), $('#routineManageStatus')]) {
      if (!target) continue;
      target.textContent = message || '';
      target.classList.toggle('hidden', !message);
    }
  }

  function reportRefusal(result) {
    if (result && result.ok) {
      say('');
      return true;
    }
    if (result?.ok !== false) { say('结果暂未确认，请先核对日常记录。'); return false; }
    const reason = result && result.reason;
    say(REFUSALS[reason] || '没记上，再试一次。');
    return false;
  }

  function timeOfHhmm(value) {
    return typeof value === 'string' && TIME_OF_DAY.test(value) ? value : null;
  }

  function scheduleText(schedule) {
    if (!schedule || typeof schedule !== 'object') return t('仅手动记录');
    const times = Array.isArray(schedule.timesOfDay) ? schedule.timesOfDay.join(' / ') : '';
    const frequency = FREQUENCY_LABELS[schedule.frequency] ? t(FREQUENCY_LABELS[schedule.frequency]) : schedule.frequency || '';
    if (schedule.frequency === 'weekly') {
      const days = (Array.isArray(schedule.weekdays) ? schedule.weekdays : [])
        .map(day => WEEKDAY_LABELS[day] ? t(WEEKDAY_LABELS[day]) : day).join(getLocale() === 'en' ? ', ' : '、');
      return t('每周{days} {times}', { days, times }).trim();
    }
    return `${frequency} ${times}`.trim();
  }

  // 只画钟点,不画日期:这一节永远只说今天。
  function whenText(occurrence) {
    if (occurrence.timeOfDay) return occurrence.timeOfDay;
    if (!occurrence.loggedAt) return t('随手');
    const at = new Date(occurrence.loggedAt);
    const pad = value => String(value).padStart(2, '0');
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  function answerText(occurrence) {
    if (occurrence.status === 'done') return t('做了');
    if (occurrence.status === 'skipped') return t('跳过了');
    // `missed` 只是"没记上"。这里刻意不写"逾期""欠"这类词,也不提"现在补上"——
    // 那就成了建议(ARCHITECTURE「日常与能量」 禁止的那一类)。
    if (occurrence.status === 'missed') return t('没记上');
    return '';
  }

  function rowState(occurrence) {
    if (occurrence.answered) return occurrence.status;
    if (occurrence.due) return 'due';
    if (occurrence.status === 'missed') return 'missed';
    return 'open';
  }

  function renderRows(view, selector = '#routineRows') {
    const host = $(selector);
    if (!host) return;
    if (!view.occurrences.length) {
      host.innerHTML = view.items.length
        ? `<p class="routine-empty">${t('今天没有提醒')}</p>`
        : `<p class="routine-empty">${t('还没有日常')}</p>`;
      return;
    }
    host.innerHTML = view.occurrences.map(occurrence => {
      const kind = kindOf(occurrence.kind);
      const title = escapeHTML(occurrence.title || '');
      const answered = occurrence.answered;
      const buttons = answered
        ? `<button type="button" class="chip chip-action" data-act="undo" aria-label="${escapeHTML(t('撤回 {title}', { title: occurrence.title || '' }))}">${t('撤回')}</button>`
        : `<button type="button" class="chip routine-act" data-act="done" aria-label="${escapeHTML(t('{title} 做了', { title: occurrence.title || '' }))}">${t('做了')}</button>`
          + `<button type="button" class="chip routine-act" data-act="skipped" aria-label="${escapeHTML(t('{title} 跳过', { title: occurrence.title || '' }))}">${t('跳过')}</button>`;
      return `<div class="routine-row" data-state="${rowState(occurrence)}" `
        + `data-occurrence="${escapeHTML(occurrence.occurrenceId)}" data-routine="${escapeHTML(occurrence.routineId)}">`
        + `<span class="routine-when">${escapeHTML(whenText(occurrence))}</span>`
        + `<span class="routine-kind" aria-hidden="true">${kind.icon}</span>`
        + `<span class="routine-title">${title}</span>`
        + `<span class="routine-answer">${escapeHTML(answerText(occurrence))}</span>`
        + buttons
        + '</div>';
    }).join('');
  }

  // 一个 chip 对应用户自己的一条日常。不截断:上限 40 条是他自己排的,少画一个
  // 就意味着那条没有排程的日常在界面上无处可记。
  function renderQuick(view, selector = '#routineQuick') {
    const host = $(selector);
    const chips = $(selector + 'Chips');
    if (!host || !chips) return;
    const active = view.items.filter(item => item && item.active !== false);
    host.classList.toggle('hidden', active.length === 0);
    chips.innerHTML = active.map(item => {
      const kind = kindOf(item.kind);
      const title = escapeHTML(item.title || '');
      return `<button type="button" class="chip routine-quick-chip" data-act="quick" `
        + `data-routine="${escapeHTML(item.id)}" aria-label="${escapeHTML(t('记一笔 {title}', { title: item.title || '' }))}">`
        + `${kind.icon} ${title}</button>`;
    }).join('');
  }

  function renderManage(view) {
    const panel = $('#routinesManage');
    const button = $('#btnManageRoutines');
    const list = $('#routineManageList');
    if (panel) panel.classList.toggle('hidden', !manageOpen);
    const reminderToggle = $('#btnRoutineReminders');
    if (reminderToggle) { reminderToggle.textContent = t(view.remindersEnabled ? '已开启' : '已关闭'); reminderToggle.setAttribute('aria-pressed', String(view.remindersEnabled)); }
    controls.renderKinds();
    // 日常页常驻管理区；今天页的入口只负责导航。
    const total = $('#routinesManageCount');
    if (total) total.textContent = String(view.items.length);
    if (button) button.setAttribute('aria-expanded', manageOpen ? 'true' : 'false');
    if (!list) return;
    list.innerHTML = view.items.length ? view.items.map(item => {
      const kind = kindOf(item.kind);
      const title = escapeHTML(item.title || '');
      const reminding = item.active !== false;
      const activityLabel = t(item.schedule ? (reminding ? '提醒中' : '已静音') : (reminding ? '已启用' : '已停用'));
      const removing = pendingRemoveId === item.id;
      return `<div class="routine-manage-row" data-routine="${escapeHTML(item.id)}">`
        + `<span class="routine-kind" aria-hidden="true">${kind.icon}</span>`
        + `<span class="routine-title">${title}</span>`
        + `<span class="routine-schedule">${escapeHTML(item.customLabel || t(kind.label))} · ${escapeHTML(scheduleText(item.schedule))}</span>`
        + `<button type="button" class="chip chip-action" data-act="edit" aria-label="${escapeHTML(t('编辑 {title} 提醒', { title: item.title || '' }))}">${t(item.schedule ? '编辑提醒' : '设置提醒')}</button>`
        + `<button type="button" class="chip routine-act" data-act="active" aria-pressed="${reminding}" `
        + `aria-label="${escapeHTML(t('{title} 提醒', { title: item.title || '' }))}">${activityLabel}</button>`
        + `<button type="button" class="chip chip-action" data-act="remove" `
        + `aria-label="${escapeHTML(t(removing ? '确认删除 {title}' : '删除 {title}', { title: item.title || '' }))}">${t(removing ? '真的删' : '删除')}</button>`
        + '</div>';
    }).join('') : `<p class="routine-empty">${t('添加日常后，在这里修改时间和提醒方式。')}</p>`;
  }

  // 「今天」里日常那块的数字和一句话：数字是今天该答的几件里答了几件，那句话只说
  // 接下来最值得知道的一件事。没记上的不计数、不催（ARCHITECTURE「日常与能量」）。
  function renderCount(view) {
    const target = $('#routinesCount');
    const sub = $('#routinesTileSub');
    const { total = 0, done = 0, due = 0 } = view.counts;
    if (target) target.textContent = total ? `${done}/${total}` : String(view.items.length);
    if (!sub) return;
    sub.textContent = !view.items.length ? t('还没有日常')
      : !view.remindersEnabled ? t('提醒已关')
        : due ? t('{count} 件到时间了', { count: due })
          : total && done >= total ? t('今天都记过了')
            : t(total ? '今天的记录' : '随手记一笔');
  }

  // 重画整段就会丢焦点,所以先记下焦点落在哪颗按钮上(按它的动作和它属于谁),
  // 画完再还回去。键盘用户连点两下的时候不会被甩回页面顶上。
  function focusMark() {
    const active = document.activeElement;
    if (!active || !active.dataset || !active.dataset.act) return null;
    const row = active.closest ? active.closest('[data-routine]') : null;
    return {
      host: active.closest && active.closest('#panelRoutines') ? '#routinesManageCard' : '#routinesStrip',
      act: active.dataset.act,
      routine: active.dataset.routine || (row && row.dataset ? row.dataset.routine : '') || ''
    };
  }

  function restoreFocus(mark) {
    if (!mark) return;
    const strip = $(mark.host || '#routinesStrip');
    if (!strip || typeof strip.querySelector !== 'function') return;
    const selector = mark.routine
      ? `[data-routine="${mark.routine}"] [data-act="${mark.act}"], `
        + `[data-act="${mark.act}"][data-routine="${mark.routine}"]`
      : `[data-act="${mark.act}"]`;
    const next = strip.querySelector(selector);
    if (next && typeof next.focus === 'function') next.focus();
  }

  function repaintCopy(view) {
    renderCount(view); controls.repaintCopy();
    say(lastStatus.source, lastStatus.parameters);
    const submit = $('#btnAddRoutine');
    if (submit) submit.textContent = t(editingId ? '保存日常' : '添加日常');
    const toggle = $('#btnRoutineReminders');
    if (toggle) toggle.textContent = t(view.remindersEnabled ? '已开启' : '已关闭');
    for (const selector of ['#routineRows', '#dailyRoutineRows']) {
      const host = $(selector);
      const empty = host?.querySelector?.('.routine-empty');
      if (empty) empty.textContent = t(view.items.length ? '今天没有提醒' : '还没有日常');
      host?.querySelectorAll?.('.routine-row').forEach(row => {
        const occurrence = view.occurrences.find(item => item.occurrenceId === row.dataset.occurrence);
        if (!occurrence) return;
        const when = row.querySelector('.routine-when'), answer = row.querySelector('.routine-answer');
        if (when) when.textContent = whenText(occurrence);
        if (answer) answer.textContent = answerText(occurrence);
        row.querySelectorAll('[data-act]').forEach(button => {
          const act = button.dataset.act;
          button.textContent = t({ undo: '撤回', done: '做了', skipped: '跳过' }[act]);
          button.setAttribute('aria-label', t({ undo: '撤回 {title}', done: '{title} 做了', skipped: '{title} 跳过' }[act], { title: occurrence.title || '' }));
        });
      });
    }
    for (const selector of ['#routineQuickChips', '#dailyRoutineQuickChips']) {
      $(selector)?.querySelectorAll?.('[data-routine]').forEach(button => {
        const item = view.items.find(item => item.id === button.dataset.routine);
        if (item) button.setAttribute('aria-label', t('记一笔 {title}', { title: item.title || '' }));
      });
    }
    const list = $('#routineManageList');
    const empty = list?.querySelector?.('.routine-empty');
    if (empty) empty.textContent = t('添加日常后，在这里修改时间和提醒方式。');
    list?.querySelectorAll?.('.routine-manage-row').forEach(row => {
      const item = view.items.find(item => item.id === row.dataset.routine);
      if (!item) return;
      const label = row.querySelector('.routine-schedule');
      if (label) label.textContent = `${item.customLabel || t(kindOf(item.kind).label)} · ${scheduleText(item.schedule)}`;
      const active = item.active !== false, removing = pendingRemoveId === item.id;
      row.querySelectorAll('[data-act]').forEach(button => {
        const act = button.dataset.act;
        const source = act === 'edit' ? item.schedule ? '编辑提醒' : '设置提醒' : act === 'remove' ? removing ? '真的删' : '删除'
          : item.schedule ? active ? '提醒中' : '已静音' : active ? '已启用' : '已停用';
        button.textContent = t(source);
        button.setAttribute('aria-label', t(act === 'edit' ? '编辑 {title} 提醒' : act === 'remove'
          ? removing ? '确认删除 {title}' : '删除 {title}' : '{title} 提醒', { title: item.title || '' }));
      });
    });
  }

  function render(state = getState()) {
    const view = band(state);
    const strip = $('#routinesStrip');
    if (!view) {
      if (strip) strip.classList.add('hidden');
      return;
    }
    if (strip) strip.classList.remove('hidden');
    const dataKey = JSON.stringify([view, manageOpen, pendingRemoveId]);
    const key = `${getLocale()}|${dataKey}`;
    if (key === lastKey) return;
    lastKey = key;
    if (dataKey === lastDataKey) { repaintCopy(view); return; }
    lastDataKey = dataKey;
    const mark = focusMark();
    renderCount(view);
    renderRows(view);
    renderRows(view, '#dailyRoutineRows');
    renderQuick(view);
    renderQuick(view, '#dailyRoutineQuick');
    renderManage(view);
    restoreFocus(mark);
  }

  async function mutate(key, send) {
    if (mutations.has(key)) return;
    const owner = {};
    mutations.set(key, owner);
    say('正在保存…');
    try {
      const result = await send();
      if (mutations.get(key) === owner) reportRefusal(result);
    } catch (_) {
      if (mutations.get(key) === owner) say('结果暂未确认，请先核对日常记录。');
    } finally {
      if (mutations.get(key) === owner) mutations.delete(key);
    }
  }

  async function answer(routineId, occurrenceId, status) {
    if (!routineId) return;
    // 排程行与随手记行都带着自己的 occurrenceId,所以一律带上:同一条再答一次是
    // 覆盖,不会多出第二行记录。
    await mutate(routineId, () => surfaceClient.logRoutine({ routineId, occurrenceId, status }));
  }

  // 点 chip 时如果正好有一条"现在该做"的排程行还没回答,就算在那条上 —— 用户点
  // ☕ 的意思几乎总是"就是刚才那杯"。只认 due,不认已经过窗的:18 点点一下不该被
  // 记成 9 点那次(那是替他编造)。
  function quickTarget(view, routineId) {
    const due = view.occurrences.filter(item =>
      item.routineId === routineId && item.due && !item.answered);
    return due.length === 1 ? due[0].occurrenceId : undefined;
  }

  function readWeekdays() {
    const row = $('#routineWeekdayRow');
    if (!row || typeof row.querySelectorAll !== 'function') return [];
    return [...row.querySelectorAll('[data-weekday]')]
      .filter(chip => chip.getAttribute('aria-pressed') === 'true')
      .map(chip => Number(chip.dataset.weekday))
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
  }

  // 写错的时间不会被改成相近的那个,只会被拒(ARCHITECTURE「日常与能量」:在用户没设的时间提醒是这个特性
  // 唯一不能犯的错)。所以这里一个一个校,有一个不合格就整条不提交。
  function readSchedule() {
    const frequency = ($('#routineFrequency') || {}).value || '';
    if (!frequency) return { ok: true, schedule: null };
    const raw = (($('#routineTimes') || {}).value || '').split(/[,，、\s]+/).filter(Boolean);
    if (!raw.length) return { ok: false, message: '选择一个提醒时间。' };
    if (raw.length > MAX_TIMES_OF_DAY) return { ok: false, message: '一条日常最多 {count} 个时间。', parameters: { count: MAX_TIMES_OF_DAY } };
    const times = raw.map(timeOfHhmm);
    if (times.some(time => time === null)) {
      return { ok: false, message: '请选择有效的小时和分钟。' };
    }
    const weekdays = frequency === 'weekly' ? readWeekdays() : [];
    if (frequency === 'weekly' && !weekdays.length) {
      return { ok: false, message: '每周至少选一天。' };
    }
    const schedule = { frequency, timesOfDay: [...new Set(times)] };
    const previous = band()?.items.find(item => item.id === editingId);
    if (previous?.schedule?.windowMinutes) schedule.windowMinutes = previous.schedule.windowMinutes;
    if (frequency === 'weekly') schedule.weekdays = weekdays;
    return { ok: true, schedule };
  }

  function restoreEditControls() {
    if (!editControls) return;
    for (const [control, disabled] of editControls) control.disabled = disabled;
    editControls = null;
  }

  function freezeEditControls() {
    const fields = [...($('#routineAddDetails')?.querySelectorAll?.('input, select, button') || [])];
    for (const selector of ['#routineTitle', '#routineKind', '#routineCustomLabel', '#routineFrequency', '#routineTimes', '#routineMaxLevel', '#btnAddRoutine']) {
      if ($(selector)) fields.push($(selector));
    }
    editControls = [...new Set(fields)].filter(control => control.id !== 'btnCancelRoutine').map(control => [control, control.disabled]);
    for (const [control] of editControls) control.disabled = true;
  }

  async function addRoutine() {
    if (saving) return;
    const titleInput = $('#routineTitle');
    const title = ((titleInput || {}).value || '').trim();
    if (!title) {
      say('先给它起个名字。');
      return;
    }
    const kind = ($('#routineKind') || {}).value || '';
    const schedule = readSchedule();
    if (!schedule.ok) {
      say(schedule.message, schedule.parameters);
      return;
    }
    const previous = band()?.items.find(item => item.id === editingId);
    const draft = { title, kind };
    if (kind === 'custom') {
      const customLabel = ($('#routineCustomLabel')?.value || '').trim();
      if (customLabel) draft.customLabel = customLabel;
      else if (previous?.kind !== 'custom' || previous.customLabel) {
        say('给这个类型起个名字。'); return;
      }
      // Inbox-created custom routines legitimately have no type label. Scheduling
      // that same routine must not require inventing one or changing its kind.
    }
    if ($('#routineMaxLevel')) draft.maxLevel = Number($('#routineMaxLevel').value);
    if (schedule.schedule) draft.schedule = schedule.schedule;
    if (previous?.kind === kind) delete draft.kind;
    saving = true; freezeEditControls();
    say('正在保存…');
    const generation = editGeneration;
    let result;
    try { result = editingId ? await surfaceClient.updateRoutine(editingId, { ...draft, schedule: schedule.schedule }) : await surfaceClient.addRoutine(draft); }
    catch (_) { if (generation === editGeneration) say('结果暂未确认，请先核对日常记录。'); return; }
    finally { saving = false; restoreEditControls(); }
    if (generation !== editGeneration || !reportRefusal(result)) return;
    // 只清名字:接着加第二条的人通常还在加同一类东西。
    if (titleInput) titleInput.value = '';
    say(editingId ? '已保存' : '已添加');
    editingId = null;
    const add = $('#routineAddDetails');
    if (add) { add.open = false; add.classList.add('hidden'); }
  }

  function syncScheduleFields() {
    const frequency = ($('#routineFrequency') || {}).value || '';
    const timeRow = $('#routineTimeRow');
    const weekdayRow = $('#routineWeekdayRow');
    if (timeRow) timeRow.classList.toggle('hidden', !frequency);
    if (weekdayRow) weekdayRow.classList.toggle('hidden', frequency !== 'weekly');
  }

  function fillKinds() {
    const select = $('#routineKind');
    if (!select || select.options && select.options.length) return;
    select.innerHTML = ROUTINE_KINDS
      .map(kind => `<option value="${kind}">${t(kindOf(kind).label)}</option>`)
      .join('');
  }

  // 今天页的“管理”：切到日常页，把管理卡带进视野。真 DOM 才做，测试用的假 DOM 没有这些方法。
  function revealManage() {
    const tab = $('#tabRoutines');
    if (tab && typeof tab.click === 'function') tab.click();
    const card = $('#routinesManageCard');
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  async function onClick(event) {
    const target = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!target) return;
    if (target.id === 'btnManageRoutines') {
      manageOpen = true;
      pendingRemoveId = null;
      lastKey = '';
      render();
      if (manageOpen) revealManage();
      return;
    }
    if (target.id === 'btnNewRoutine') { openEditor(); return; }
    if (target.id === 'btnCancelRoutine') { restoreEditControls(); editGeneration++; $('#routineAddDetails').open = false; $('#routineAddDetails').classList.add('hidden'); editingId = null; say(''); return; }
    if (target.id === 'btnRoutineReminders') {
      await mutate('reminders', () => surfaceClient.updateSettings({ routineRemindersEnabled: !band().remindersEnabled }));
      return;
    }
    if (target.id === 'btnAddRoutine') {
      await addRoutine();
      return;
    }
    if (target.dataset && target.dataset.weekday) {
      target.setAttribute('aria-pressed', target.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      return;
    }
    const act = target.dataset ? target.dataset.act : '';
    if (!act) return;
    const row = target.closest('[data-routine]');
    const routineId = (target.dataset && target.dataset.routine)
      || (row && row.dataset ? row.dataset.routine : '');
    const occurrenceId = row && row.dataset ? row.dataset.occurrence : undefined;
    if (act !== 'remove' && pendingRemoveId) {
      pendingRemoveId = null;
      lastKey = '';
    }
    if (act === 'done' || act === 'skipped') {
      await answer(routineId, occurrenceId, act);
      return;
    }
    if (act === 'quick') {
      await answer(routineId, quickTarget(band(), routineId), 'done');
      return;
    }
    if (act === 'undo') {
      await mutate(routineId, () => surfaceClient.undoRoutineLog(occurrenceId));
      return;
    }
    if (act === 'edit') { openEditor(band().items.find(item => item.id === routineId)); return; }
    if (act === 'active') {
      const item = band().items.find(entry => entry && entry.id === routineId);
      if (!item) return;
      await mutate(routineId, () => surfaceClient.updateRoutine(routineId, { active: item.active === false }));
      return;
    }
    if (act === 'remove') {
      if (pendingRemoveId !== routineId) {
        pendingRemoveId = routineId;
        lastKey = '';
        render();
        say('再按一次就删掉，它今天的记录也会一起删。');
        return;
      }
      pendingRemoveId = null;
      lastKey = '';
      await mutate(routineId, () => surfaceClient.removeRoutine(routineId));
    }
  }

  function openEditor(item = null) {
    restoreEditControls();
    editGeneration++;
    editingId = item?.id || null;
    controls.fill(item);
    const add = $('#routineAddDetails');
    if (add) { add.open = true; add.classList.remove('hidden'); $('#routinesManageCard')?.scrollIntoView?.({ block: 'start' }); }
    $('#btnAddRoutine').textContent = t(item ? '保存日常' : '添加日常');
    $('#routineTitle').focus?.(); say('');
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('routines feature requires a projection store');
    }
    if (unsubscribe) return;
    fillKinds();
    syncScheduleFields();
    controls.mount();
    listen($('#routinesStrip'), 'click', onClick);
    listen($('#routinesManageCard'), 'click', onClick);

    listen($('#routineFrequency'), 'change', syncScheduleFields);
    // settings 也订:提醒开关关掉时这一节的标题要说出来,而开关住在另一段里。
    unsubscribe = projectionStore.subscribe(change => {
      if (change.localeOnly) {
        const view = band(change.state || getState());
        if (view) repaintCopy(view);
        return;
      }
      const dirty = change.dirty || {};
      if (dirty.all || dirty.routines || dirty.settings) render(change.state);
    });
    render();
  }

  function dispose() {
    editGeneration++; mutations.clear(); restoreEditControls();
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    while (teardown.length) teardown.pop()();
    manageOpen = true;
    pendingRemoveId = null;
    lastKey = ''; lastDataKey = ''; lastStatus = { source: '', parameters: {} };
  }

  return Object.freeze({ mount, dispose, render, isManageOpen: () => manageOpen });
}

export { createPopoverRoutinesFeature, KIND_LABELS };
