'use strict';

import { t, getLocale, onLocaleChanged } from '../../shared/interface/i18n.mjs';

// 任务清单:筛选、清单本身、每一行的动作、溢出菜单,以及归档那一段与它的翻页。
//
// 这一层拥有四样状态,以前它们都是面板顶上的模块级 let:此刻选中的筛选与标签
// （只改视图,不写任务）、哪些行已经在页面上（按 id 复用 DOM,只有真的变了的行
// 才重绘）、以及此刻打开的是哪一个溢出菜单。
//
// 它不认识计时器、编辑器、拆解与完成确认:一行上的 ⚡ / ✎ / ✨ / 勾选按下去之后
// 发生什么,都是别人回答、由组合根接进来的。归档翻页拿回来的那一页也交回组合
// 根合并——投影缓存不归这一层。
function createPopoverTaskList({
  document, window, $, getState, getSession, escapeHTML, formatMs, localDateInputValue,
  syncPressedButtons, taskDates, describeSeriesRule, taskActionMessage, formatExpiry,
  surfaceClient, taskLaunchBlockReason, seriesForTask, completeTask, openTaskEditor,
  openBreakdown, startFocus, celebrate, showPanelStatus, mergeHistoryPage
} = {}) {
  if (!document || !window || typeof $ !== 'function') {
    throw new TypeError('popover task list requires document, window and $');
  }
  for (const [name, fn] of Object.entries({
    getState, getSession, escapeHTML, formatMs, localDateInputValue, syncPressedButtons,
    describeSeriesRule, taskActionMessage, formatExpiry, taskLaunchBlockReason, seriesForTask,
    completeTask, openTaskEditor, openBreakdown, startFocus, celebrate, showPanelStatus,
    mergeHistoryPage
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover task list requires ${name}`);
  }
  if (!surfaceClient) throw new TypeError('popover task list requires surfaceClient');
  if (!taskDates) throw new TypeError('popover task list requires taskDates');

  let selectedFilter = 'actionable';   // 视图筛选，不写进任务
  let selectedTagFilter = null;
  let renderedRows = new Map();        // id -> element（任务 id 全局唯一）
  const rowCopies = new Map();
  let archiveCopies = [];
  let openOverflowMenu = null;
  let historyLoading = false;
  let mounted = false;
  const teardown = [];

  function listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    teardown.push(() => target.removeEventListener(type, handler, options));
  }

  function todayDayKey() {
    return localDateInputValue();
  }

  // 筛选完全建在正交字段上，彼此可以重叠：一件任务可以同时是“今天”、
  // “重复”和“有截止”。这正是三选一分类做不到的事。
  // 重复任务里已经收尾的那一轮会立刻生成“下一轮”occurrence，但它属于未来的某一天。
  // 它先存着,却不该今天就挤进清单：等 todayDayKey() 走到那天它自己会露面 ——
  // 不做“📆 这一次是 <未来某天>”那种提前外显。“当天处理完当天不再外显”就落在这里。
  function isUpcomingOccurrence(task) {
    return !task.done && Boolean(task.occurrenceDate) && task.occurrenceDate > todayDayKey();
  }

  function taskMatchesFilter(task, filter, now = Date.now()) {
    if (isUpcomingOccurrence(task)) return false;
    const blockReason = taskLaunchBlockReason(task, now);
    switch (filter) {
      case 'actionable': return !task.done && !blockReason;
      case 'today': return !task.done && (task.plannedFor === todayDayKey() || task.occurrenceDate === todayDayKey());
      case 'recurring': return !task.done && Boolean(task.seriesId);
      case 'deadline': return !task.done && Boolean(task.deadline);
      case 'waiting': return !task.done && Boolean(blockReason);
      case 'done': return Boolean(task.done);
      default: return !task.done;
    }
  }

  function renderFilters(now = Date.now()) {
    const state = getState();
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
    for (const [filter, id] of [
      ['actionable', '#cntActionable'], ['today', '#cntToday'], ['recurring', '#cntRecurring'],
      ['deadline', '#cntDeadline'], ['waiting', '#cntWaiting'], ['done', '#cntDone']
    ]) {
      const counter = $(id);
      const count = tasks.filter(task => taskMatchesFilter(task, filter, now)).length;
      if (counter) {
        counter.textContent = count;
        // 计数为 0 的筛选不占位置；“可做”和当前选中的那个始终留着，免得选中项消失。
        const chip = counter.closest('.filter-chip');
        if (chip) chip.classList.toggle('hidden', count === 0 && filter !== 'actionable' && filter !== selectedFilter);
      }
    }
    syncPressedButtons('.filter-chip', button => button.dataset.filter === selectedFilter);

    // 标签筛选只在真的有标签时出现，不给空列表占位。
    const host = $('#tagFilters');
    if (!host) return;
    const tags = [...new Set(tasks.filter(task => !task.done).flatMap(task => task.tags || []))].sort();
    if (selectedTagFilter && !tags.includes(selectedTagFilter)) selectedTagFilter = null;
    host.classList.toggle('hidden', tags.length === 0);
    const signature = `${tags.join('\u0000')}|${selectedTagFilter || ''}`;
    if (host.dataset.sig === signature) return;
    host.dataset.sig = signature;
    host.innerHTML = '';
    for (const tag of tags) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chip tag-chip${selectedTagFilter === tag ? ' active' : ''}`;
      button.dataset.tag = tag;
      button.setAttribute('aria-pressed', String(selectedTagFilter === tag));
      button.textContent = `#${tag}`;
      button.addEventListener('click', () => {
        selectedTagFilter = selectedTagFilter === tag ? null : tag;
        renderList();
      });
      host.appendChild(button);
    }
  }

  function renderList() {
    const state = getState();
    if (!state) return;
    const now = Date.now();
    const list = $('#taskList');
    const empty = $('#emptyTasks');
    const emptyFilter = $('#emptyFilter');
    const activeCount = state.tasks.filter(t => !t.done).length;
    $('#tabTaskCount').textContent = activeCount;
    renderFilters(now);

    if (state.tasks.length === 0) {
      empty.classList.remove('hidden');
      emptyFilter.classList.add('hidden');
      list.innerHTML = '';
      renderedRows.clear();
      rowCopies.clear();
      return;
    }
    empty.classList.add('hidden');

    const session = getSession();
    const currentFocusId = (session.running || session.paused) ? session.taskId : null;
    const visible = state.tasks
      .filter(task => taskMatchesFilter(task, selectedFilter, now))
      .filter(task => !selectedTagFilter || (task.tags || []).includes(selectedTagFilter))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        // 带截止的排前面且按临近程度；其余按新建倒序，刚写下的事不用往下找。
        if (a.deadline && b.deadline) return Date.parse(a.deadline) - Date.parse(b.deadline);
        if (a.deadline !== b.deadline) return a.deadline ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
    emptyFilter.classList.toggle('hidden', visible.length > 0);

    const visibleIds = new Set(visible.map(task => task.id));
    for (const [id, el] of renderedRows) {
      if (!visibleIds.has(id)) { el.remove(); renderedRows.delete(id); rowCopies.delete(id); }
    }

    let prevEl = null;
    for (const task of visible) {
      let el = renderedRows.get(task.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'task-item new-in';
        el.dataset.id = task.id;
        renderedRows.set(task.id, el);
        setTimeout(() => el.classList.remove('new-in'), 350);
      }
      const stepsSig = (task.steps || []).map(s => `${s.id}|${s.title}|${s.done ? 1 : 0}`).join('||');
      // 自动失效倒计时文案会变 → 把剩余分钟数进 sig，让 30s tick 只刷真正变了的行
      const minsLeft = task.expiresAt
        ? Math.floor((Date.parse(task.expiresAt) - now) / 60000) : '';
      const deadlineState = task.deadline ? taskDates.describeDeadline(task.deadline, now) : null;
      const scheduledState = task.scheduledFor ? taskDates.formatScheduledFor(task.scheduledFor, now) : '';
      const series = seriesForTask(task);
      const sig = `${task.title}|${task.done?1:0}|${task.energy}|${task.energyAuto?1:0}|${task.focusedMs||0}|${task.focusSessions||0}|${stepsSig}|${currentFocusId===task.id?(session.running?'r':'p'):'-'}|${task.deadline||''}|${deadlineState ? deadlineState.text : ''}|${task.occurrenceDate||''}|${series ? `${series.state}:${describeSeriesRule(series)}:${series.missedCount||0}` : ''}|${task.overdueCount||0}|${task.expiresAt||''}|${task.expired?1:0}|${minsLeft}|${task.scheduledFor||''}|${scheduledState}|${(task.tags||[]).join(',')}|${task.estimateMinutes||''}|${task.skippedAt?1:0}`;
      if (el.dataset.sig !== sig || el.dataset.locale !== getLocale()) {
        el.dataset.sig = sig;
        el.dataset.locale = getLocale();
        renderRow(el, task, currentFocusId === task.id ? (session.running ? 'running' : 'paused') : null);
      }
      if (el.parentNode !== list) list.appendChild(el);
      if (prevEl) { if (prevEl.nextSibling !== el) list.insertBefore(el, prevEl.nextSibling); }
      else { if (list.firstChild !== el) list.insertBefore(el, list.firstChild); }
      prevEl = el;
    }
  }

  // focusState 只能是 'running' / 'paused' / null：暂停中的会话不能再说“正在专注”
  function renderRow(el, task, focusState) {
    const isCurrentFocus = Boolean(focusState);
    const now = Date.now();
    // 截止、自动失效、预约、重复都只看字段本身，不再先问“它是哪一类”。
    const deadlineState = task.deadline ? taskDates.describeDeadline(task.deadline, now) : null;
    const overdue = !task.done && Boolean(deadlineState && deadlineState.overdue);
    const series = seriesForTask(task);
    const isCurrentRound = !task.occurrenceDate || task.occurrenceDate <= todayDayKey();
    const missedRounds = series && !task.done && !task.skippedAt && isCurrentRound ? (series.missedCount || 0) : 0;
    const expiryAt = task.expiresAt ? Date.parse(task.expiresAt) : null;
    const hasElapsedExpiry = task.expired === true
      || (Number.isFinite(expiryAt) && expiryAt <= now);
    const msLeft = Number.isFinite(expiryAt) && !task.done ? expiryAt - now : null;
    const isExpired = !task.done && hasElapsedExpiry;
    const isSkipped = Boolean(task.skippedAt) && !task.done;
    const isReadOnly = task.done || isSkipped;
    const launchBlockReason = taskLaunchBlockReason(task, now);
    const canStart = !['task-completed', 'task-expired', 'occurrence-skipped'].includes(launchBlockReason);
    el.className = 'task-item'
      + (task.done ? ' done' : '')
      + (isCurrentFocus ? ' current-focus' : '')
      + (overdue ? ' overdue' : '')
      + (missedRounds >= 1 ? ' missed-daily' : '')
      + (isExpired ? ' expired' : '')
      + (isSkipped ? ' skipped' : '')
      + (el.classList.contains('new-in') ? ' new-in' : '');

    // 步骤勾选是单向的：勾上就是做完了，没有“标记未完成”这个动作，
    // 因为步骤奖励已经发出去了而账本只增不减。
    const stepLabel = step => t(step.done ? '已完成步骤：{title}' : isSkipped ? '已跳过任务的只读步骤：{title}'
      : task.done ? '已完成任务的只读步骤：{title}' : '完成步骤：{title}', { title: step.title });
    const stepsHTML = (task.steps && task.steps.length)
      ? `<div class="task-steps">${task.steps.map(s => `
        <button type="button" class="step-item ${s.done ? 'done' : ''}" data-step-id="${escapeHTML(s.id)}" aria-pressed="${s.done ? 'true' : 'false'}" aria-label="${escapeHTML(stepLabel(s))}"${isReadOnly || s.done ? ' disabled' : ''}>
          <span class="step-check ${s.done ? 'checked' : ''}"></span>
          <span class="step-text">${escapeHTML(s.title)}</span>
        </button>`).join('')}</div>`
      : '';
    // 属性是一行灰字，不是一排带框徽章：视线要先落在标题上。只有需要注意的
    // （快到期、已逾期、已失效）才带颜色。
    function metadataCopy() {
      const energyLabel = t({ low: '低能量', medium: '中等能量', high: '高能量' }[task.energy || 'medium']);
      const meta = [];
      // icon：每条属性前面一个小图标（见 shared/icons.css），一眼分得清是重复、截止还是能量，不用逐条读字。
      const add = (text, tone = '', icon = '') => {
        if (text) meta.push(`<span class="meta-item${tone ? ` ${tone}` : ''}"${icon ? ` data-icon="${icon}"` : ''}>${text}</span>`);
      };
      if (series) add(escapeHTML(describeSeriesRule(series)), '', 'repeat');
      if (deadlineState) add(escapeHTML(deadlineState.text), deadlineState.tone === 'ok' ? '' : deadlineState.tone, 'flag');
      const scheduledLabel = task.scheduledFor ? taskDates.formatScheduledFor(task.scheduledFor, now) : '';
      if (scheduledLabel) add(escapeHTML(t('预约于 {time}', { time: scheduledLabel })), '', 'calendar');
      if (msLeft !== null) {
        if (isExpired) add(t('已失效'), 'late', 'timer');
        else if (msLeft < 3600000) add(t('剩 {minutes} 分钟失效', { minutes: Math.max(1, Math.round(msLeft / 60000)) }), 'warn', 'timer');
        else if (msLeft < 12 * 3600000) add(t('剩 {hours} 小时失效', { hours: Math.round(msLeft / 3600000) }), 'warn', 'timer');
        else add(escapeHTML(formatExpiry(task.expiresAt)), '', 'timer');
      }
      if (task.estimateMinutes) add(t('约 {minutes} 分钟', { minutes: task.estimateMinutes }), '', 'clock');
      add(`<span title="${t(task.energyAuto ? '按标题自动推断' : '手动设定')}">${energyLabel}</span>`, `energy energy-${task.energy || 'medium'}`, { low: 'battery-low', medium: 'battery-mid', high: 'battery-high' }[task.energy || 'medium']);
      if ((task.tags || []).length) add(escapeHTML((task.tags || []).map(tag => `#${tag}`).join(' ')), '', 'tag');
      if (isSkipped) add(t('这一次已跳过'));
      // “漏了几轮”是一句陈述，不是一笔债：不扣分、不堆任务，只提一下今天可以重新开始。
      if (missedRounds >= 1) add(t('漏了 {count} 轮，今天可以重新开始', { count: missedRounds }));
      if (task.focusedMs && task.focusedMs > 0) {
        add(escapeHTML(task.focusSessions
          ? t('已专注 {time} · {count} 次', { time: formatMs(task.focusedMs), count: task.focusSessions })
          : t('已专注 {time}', { time: formatMs(task.focusedMs) })), '', 'target');
      }

      return meta.join('<span class="meta-sep" aria-hidden="true"> · </span>');
    }

    // 卡片上只留一个高频动作。其余全部进溢出菜单并带上文字：440px 宽的窗口里
    // 排六个无标签符号按钮，结果是每一个都要猜，而标题被挤到没地方。
    // 菜单的每一项前面一个图标（纯文字的菜单要一条条读；图标让“删除”和“编辑”一眼分开）。
    const MENU_ICONS = { enrich: 'sparkle', edit: 'pencil', skip: 'arrow-right', renew: 'sync', duplicate: 'repeat', delete: 'trash' };
    const overflowItems = [];
    if (!isReadOnly) {
      overflowItems.push({ action: 'enrich', label: '帮我拆成几步' });
      const session = getSession();
      if (!(session.taskId === task.id && (session.running || session.paused))) overflowItems.push({ action: 'edit', label: '编辑任务' });
    }
    if (series && !isReadOnly) {
      // 跳过只属于重复任务，而且不是失败：它不发奖励也不断连击，只把系列往前推一步。
      overflowItems.push({ action: 'skip', label: '跳过这一次' });
    }
    if (isExpired && !isReadOnly) {
      overflowItems.push({ action: 'renew', label: '续期' });
    }
    // 已完成是终态，出口是“再做一遍”而不是重新打开。
    if (task.done) overflowItems.push({ action: 'duplicate', label: '再做一遍' });
    overflowItems.push({ action: 'delete', label: '删除任务（可恢复）' });

    const menuId = `task-menu-${String(task.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const overflowHTML = `
        <button type="button" class="icon-btn more" title="${t('更多动作')}" aria-label="${escapeHTML(t('更多动作：{title}', { title: task.title }))}" aria-haspopup="true" aria-controls="${menuId}" aria-expanded="false">⋯</button>
        <div class="task-menu hidden" id="${menuId}" role="menu" aria-hidden="true">
          ${overflowItems.map(item => `<button type="button" role="menuitem" data-task-action="${item.action}" data-icon="${MENU_ICONS[item.action] || 'sparkle'}">${escapeHTML(t(item.label))}</button>`).join('')}
        </div>`;
    const startLabel = () => t(task.done
      ? '已完成的任务不再计时：{title}'
      : isSkipped ? '这一次已跳过：{title}'
        : hasElapsedExpiry ? '任务已失效，请先续期：{title}'
          : launchBlockReason === 'task-scheduled' ? '提前开始预约任务：{title}' : '开始专注：{title}', { title: task.title });
    const completionLabel = () => t(task.done ? '已完成任务：{title}'
      : isSkipped ? '已跳过任务，只读：{title}' : '完成任务：{title}', { title: task.title });
    const focusLabel = () => t(focusState === 'running' ? '← 正在专注' : '← 计时已暂停');

    el.innerHTML = `
    <div class="task-header">
      <button type="button" class="task-checkbox ${task.done ? 'checked' : ''}" aria-pressed="${task.done ? 'true' : 'false'}" aria-label="${escapeHTML(completionLabel())}"${isReadOnly ? ' disabled' : ''}></button>
      <div class="task-main">
        <div class="task-title">${escapeHTML(task.title)}${focusState ? ` <span class="focus-badge">${focusLabel()}</span>` : ''}</div>
        <div class="task-meta">${metadataCopy()}</div>
      </div>
      <div class="task-actions">
        <button type="button" class="icon-btn play" data-icon="play" title="${escapeHTML(startLabel())}" aria-label="${escapeHTML(startLabel())}"${canStart ? '' : ' disabled'}>${t('开始')}</button>${overflowHTML}
      </div>
    </div>
    ${stepsHTML}
  `;

    rowCopies.set(task.id, () => {
      el.dataset.locale = getLocale();
      el.querySelector('.task-checkbox').setAttribute('aria-label', completionLabel());
      const play = el.querySelector('.icon-btn.play');
      play.textContent = t('开始');
      play.setAttribute('title', startLabel());
      play.setAttribute('aria-label', startLabel());
      const more = el.querySelector('.icon-btn.more');
      more.setAttribute('title', t('更多动作'));
      more.setAttribute('aria-label', t('更多动作：{title}', { title: task.title }));
      const badge = el.querySelector('.focus-badge');
      if (badge) badge.textContent = focusLabel();
      el.querySelector('.task-meta').innerHTML = metadataCopy();
      el.querySelectorAll('.step-item').forEach((node, index) => node.setAttribute('aria-label', stepLabel(task.steps[index])));
      el.querySelectorAll('[data-task-action]').forEach(node => {
        const item = overflowItems.find(item => item.action === node.dataset.taskAction);
        if (item) node.textContent = t(item.label);
      });
    });

    const checkbox = el.querySelector('.task-checkbox');
    if (!isReadOnly) {
      checkbox.addEventListener('click', async (e) => {
        e.stopPropagation();
        await completeTask(task);
      });
    }
    const moreEl = el.querySelector('.icon-btn.more');
    const menuEl = el.querySelector('.task-menu');
    if (moreEl && menuEl) {
      moreEl.addEventListener('click', event => {
        event.stopPropagation();
        const willOpen = menuEl.classList.contains('hidden');
        closeOverflowMenu();
        if (!willOpen) return;
        setOverflowMenuOpen(moreEl, menuEl, true);
        openOverflowMenu = { trigger: moreEl, menu: menuEl };
        const first = menuEl.querySelector('[data-task-action]');
        if (first) first.focus({ preventScroll: true });
      });
      menuEl.querySelectorAll('[data-task-action]').forEach(item => {
        item.addEventListener('click', async event => {
          event.stopPropagation();
          closeOverflowMenu({ focusTrigger: false });
          await runOverflowAction(item.dataset.taskAction, task, moreEl);
        });
      });
    }
    el.querySelector('.icon-btn.play').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!canStart) return;
      await startFocus(task);
    });
    el.querySelectorAll('.step-item').forEach(s => {
      s.addEventListener('click', async (e) => {
        e.stopPropagation();
        const stepId = s.dataset.stepId;
        const step = task.steps.find(item => item.id === stepId);
        if (isReadOnly || !step || step.done) return;
        const result = await surfaceClient.completeStep(task.id, stepId);
        if (result && result.ok === false) {
          showPanelStatus(() => taskActionMessage(result.reason));
          return;
        }
        celebrate();
      });
    });
  }

  function setOverflowMenuOpen(trigger, menu, open) {
    const taskItem = menu.closest('.task-item');
    menu.classList.toggle('hidden', !open);
    menu.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    if (taskItem) taskItem.classList.toggle('menu-open', open);
    if (!open) {
      menu.style.left = '';
      menu.style.top = '';
      menu.style.maxHeight = '';
      return;
    }
    // The tab panel is the scroll owner. An absolute menu remains clipped by
    // that panel even when the task card itself allows overflow, so anchor the
    // menu to the viewport and close it on scroll/resize below.
    const menuRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
    const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
    const maxHeight = Math.max(0, viewportHeight - margin * 2);
    const visibleHeight = Math.min(menuRect.height, maxHeight);
    const preferredBelow = triggerRect.bottom + gap;
    const preferredAbove = triggerRect.top - gap - visibleHeight;
    const preferred = preferredBelow + visibleHeight <= viewportHeight - margin
      ? preferredBelow
      : preferredAbove;
    const top = Math.max(margin, Math.min(preferred, viewportHeight - margin - visibleHeight));
    const left = Math.max(
      margin,
      Math.min(triggerRect.right - menuRect.width, viewportWidth - margin - menuRect.width)
    );
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.maxHeight = `${Math.round(maxHeight)}px`;

    const placed = menu.getBoundingClientRect();
    const driftX = Number.isFinite(placed.left) ? placed.left - left : 0;
    const driftY = Number.isFinite(placed.top) ? placed.top - top : 0;
    if (driftX !== 0) menu.style.left = `${Math.round(left - driftX)}px`;
    if (driftY !== 0) menu.style.top = `${Math.round(top - driftY)}px`;
  }

  function closeOverflowMenu({ focusTrigger = false } = {}) {
    if (!openOverflowMenu) return;
    const { trigger, menu } = openOverflowMenu;
    openOverflowMenu = null;
    if (menu.isConnected) setOverflowMenuOpen(trigger, menu, false);
    if (focusTrigger && trigger.isConnected) trigger.focus();
  }

  async function runOverflowAction(action, task, trigger) {
    if (action === 'edit') { openTaskEditor(task); return; }
    if (action === 'enrich') { await openBreakdown(task, trigger); return; }
    if (action === 'delete') {
      if (!window.confirm(t('删除后会移到可恢复归档。继续吗？'))) {
        if (trigger.isConnected) trigger.focus();
        return;
      }
    }
    const state = getState();
    const result = action === 'delete' ? await surfaceClient.deleteTask(task.id)
      // 续期是唯一能清除 expired 标记的路径，并且在同一笔事务里给出新的失效时间。
      : action === 'renew' ? await surfaceClient.renewTask(task.id, state && state.autoExpiryPreview)
        : action === 'skip' ? await surfaceClient.skipOccurrence(task.id)
          : action === 'duplicate' ? await surfaceClient.duplicateTask(task.id)
            : null;
    if (result && result.ok === false) showPanelStatus(() => taskActionMessage(result.reason));
    else showPanelStatus('');
  }

  function repaintArchiveCopy() {
    const loadMore = $('#historyLoadMore');
    if (loadMore) loadMore.textContent = t(historyLoading ? '加载中…' : '加载更早记录');
    const empty = $('#archiveList').querySelector('.archive-empty');
    if (empty) empty.textContent = t('归档目前是空的');
    archiveCopies.forEach(repaint => repaint());
  }

  function renderArchive() {
    const state = getState();
    if (!state) return;
    const archived = Array.isArray(state.archivedTasks) ? state.archivedTasks : [];
    const list = $('#archiveList');
    // 计数说的必须是这个列表里能看到的东西。之前它拿 history.total（全量历史）
    // 当标题，于是展开后的条数和标题上的数字对不上，用户就以为丢了东西。
    const total = state.history ? state.history.total : archived.length;
    $('#cntArchived').textContent = total > archived.length
      ? `${archived.length}/${total}`
      : String(archived.length);
    const loadMore = $('#historyLoadMore');
    if (loadMore) {
      loadMore.classList.toggle('hidden', !(state.history && state.history.nextCursor));
      loadMore.disabled = historyLoading;
      loadMore.textContent = t(historyLoading ? '加载中…' : '加载更早记录');
    }
    list.innerHTML = '';
    archiveCopies = [];
    if (archived.length === 0) {
      list.innerHTML = `<div class="archive-empty">${t('归档目前是空的')}</div>`;
      return;
    }
    for (const task of archived) {
      const row = document.createElement('div');
      row.className = 'archive-item';
      row.innerHTML = `
      <div class="archive-task-copy">
        <span class="archive-task-title">${escapeHTML(task.title)}</span>
        <span class="archive-task-meta">${task.done ? `${t('已完成')} · ` : ''}${escapeHTML(t(task.seriesId ? '重复任务的某一次' : '一次性任务'))}</span>
      </div>
      <button type="button" class="pixel-btn btn-mini" aria-label="${escapeHTML(t('恢复任务：{title}', { title: task.title }))}">↩ ${t('恢复')}</button>`;
      archiveCopies.push(() => {
        row.querySelector('.archive-task-meta').textContent = (task.done ? `${t('已完成')} · ` : '')
          + t(task.seriesId ? '重复任务的某一次' : '一次性任务');
        const restore = row.querySelector('button');
        restore.textContent = `↩ ${t('恢复')}`;
        restore.setAttribute('aria-label', t('恢复任务：{title}', { title: task.title }));
      });
      row.querySelector('button').addEventListener('click', () => surfaceClient.restoreTask(task.id));
      list.appendChild(row);
    }
  }

  // 拿回来的那一页交回组合根合并:投影缓存不归这一层,这里只管「正在加载」这个
  // 只影响按钮的状态。
  async function loadMoreHistory() {
    const state = getState();
    if (!state || !state.history || !state.history.nextCursor || historyLoading) return;
    historyLoading = true;
    renderArchive();
    try {
      const page = await surfaceClient.listHistory({ cursor: state.history.nextCursor, limit: 30 });
      if (!mounted || !page || page.ok === false) return;
      mergeHistoryPage(page);
    } finally {
      historyLoading = false;
      if (mounted) renderArchive();
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    teardown.push(onLocaleChanged(() => {
      // Copy-only repaint keeps open menus, focus and in-flight actions intact.
      rowCopies.forEach(repaint => repaint());
      repaintArchiveCopy();
      if (openOverflowMenu) setOverflowMenuOpen(openOverflowMenu.trigger, openOverflowMenu.menu, true);
    }));
    // 筛选只改视图，所以它写的是这一层自己的选中项，不落任何任务字段。
    document.querySelectorAll('.filter-chip').forEach(chip => {
      listen(chip, 'click', () => {
        selectedFilter = chip.dataset.filter;
        renderList();
      });
    });
    listen($('#historyLoadMore'), 'click', () => { void loadMoreHistory(); });
    // 溢出菜单不是弹层，点到旁边就应该收起来。
    listen(document, 'click', () => closeOverflowMenu());
    listen(document, 'scroll', event => {
      // A short viewport can make the menu itself scrollable. Scrolling that menu
      // must not close it; scrolling any underlying owner invalidates its anchor.
      if (openOverflowMenu && event.target === openOverflowMenu.menu) return;
      closeOverflowMenu();
    }, true);
    listen(window, 'resize', () => closeOverflowMenu());
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    while (teardown.length) teardown.pop()();
    closeOverflowMenu();
    renderedRows = new Map();
    rowCopies.clear();
    archiveCopies = [];
    historyLoading = false;
    for (const selector of ['#taskList', '#archiveList', '#tagFilters']) {
      const host = $(selector);
      if (!host) continue;
      host.innerHTML = '';
      delete host.dataset.sig;
    }
  }

  return Object.freeze({
    mount, dispose, renderList, renderArchive, setOverflowMenuOpen, closeOverflowMenu,
    isOverflowMenuOpen: () => Boolean(openOverflowMenu)
  });
}


export { createPopoverTaskList };
