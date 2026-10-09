'use strict';

function createPopoverProgressFeature({
  document, getState, $, formatMs, escapeHTML, onDaySelected
} = {}) {
  if (!document || typeof getState !== 'function' || typeof $ !== 'function'
      || typeof formatMs !== 'function' || typeof escapeHTML !== 'function'
      || typeof onDaySelected !== 'function') {
    throw new TypeError('progress feature requires its scoped renderer dependencies');
  }

  let lastStatsKey = '';
  let selectedHeatmapDay = null;
  let todayOpened = false;
  let unsubscribe = null;

  const weekdayLabels = Object.freeze({ 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' });

  function localDateKey(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function msToLevel(ms) {
    const minutes = ms / 60000;
    if (minutes < 1) return 'hm-lv0';
    if (minutes < 25) return 'hm-lv1';
    if (minutes < 60) return 'hm-lv2';
    if (minutes < 120) return 'hm-lv3';
    return 'hm-lv4';
  }

  function sumValues(record, keys = null) {
    if (!record || typeof record !== 'object') return 0;
    return (keys || Object.keys(record)).reduce((total, key) => total + (Number(record[key]) || 0), 0);
  }

  // 进展页不做连续打卡：断一天就清零的数字，对容易中断的人是持续的压力。
  // 顶上一行只陈述最近 7 天发生了什么，中断后回来同样算一次。
  function renderWeekFacts(stats, todayKey) {
    const host = $('#weekFacts');
    if (!host) return;
    const [year, month, date] = todayKey.split('-').map(Number);
    const keys = [];
    for (let offset = 6; offset >= 0; offset -= 1) keys.push(localDateKey(new Date(year, month - 1, date - offset)));
    const focusMs = sumValues(stats.dailyFocus, keys);
    const done = sumValues(stats.dailyCompletions, keys);
    const returns = sumValues(stats.dailyReturns, keys);
    host.textContent = `最近 7 天：专注 ${formatMs(focusMs)} · 完成 ${done} 件 · 回来 ${returns} 次`;
  }

  function renderStats(state = getState()) {
    if (!state) return;
    const stats = state.stats || {};
    const day = localDateKey(new Date(state.serverNow ?? Date.now()));
    const key = `${day}|${JSON.stringify(stats)}|${selectedHeatmapDay || ''}`;
    if (key === lastStatsKey) return;
    lastStatsKey = key;

    $('#stTotalFocus').textContent = formatMs(stats.totalFocusMs || 0);
    $('#stTotalTasks').textContent = stats.totalTasksDone || 0;
    $('#stTotalReturns').textContent = sumValues(stats.dailyReturns);
    renderWeekFacts(stats, day);
    $('#stTotalPomo').textContent = stats.totalPomodoros || 0;
    renderHeatmap(state);
  }

  function renderHeatmap(state = getState()) {
    const container = $('#heatmap');
    if (!container || !state) return;
    const daily = (state.stats && state.stats.dailyFocus) || {};
    const completions = (state.stats && state.stats.dailyCompletions) || {};
    // 统计一变整块热力图就重建；重建前焦点在哪一天，重建后还给同一天，不然键盘用户正在挪的时候焦点会掉回页面顶上。
    const focusedDay = container.contains(document.activeElement) ? document.activeElement.getAttribute('data-day') : null;
    container.innerHTML = '';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', '最近 12 周，每天一格；用方向键移动，回车查看当天');
    const today = new Date(state.serverNow ?? Date.now());
    today.setHours(0, 0, 0, 0);
    const grid = [];
    for (let i = 12 * 7 - 1; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const key = localDateKey(date);
      grid.push({ key, ms: daily[key] || 0, done: completions[key] || 0 });
    }
    // 漫游 tabindex：整个热力图只占一个 Tab 停靠点（84 个格子曾经是 84 个），停在选中的那天，没有就停在今天。
    const stopKey = grid.some(cell => cell.key === selectedHeatmapDay) ? selectedHeatmapDay : grid[grid.length - 1].key;
    for (let week = 0; week < 12; week += 1) {
      const column = document.createElement('div');
      column.className = 'hm-week';
      for (let day = 0; day < 7; day += 1) {
        const cell = grid[week * 7 + day];
        const cellEl = document.createElement('div');
        cellEl.className = `hm-cell ${msToLevel(cell.ms)}${cell.key === selectedHeatmapDay ? ' selected' : ''}`;
        cellEl.title = `${cell.key} · 专注 ${formatMs(cell.ms)} · 完成 ${cell.done} 件`;
        if (cell.done > 0) cellEl.setAttribute('data-completions', cell.done > 9 ? '9+' : String(cell.done));
        cellEl.setAttribute('role', 'button');
        cellEl.setAttribute('data-day', cell.key);
        cellEl.tabIndex = cell.key === stopKey ? 0 : -1;
        cellEl.setAttribute('aria-pressed', String(cell.key === selectedHeatmapDay));
        cellEl.setAttribute('aria-label', `${cell.key}，专注 ${formatMs(cell.ms)}，完成 ${cell.done} 件，查看当天时间线`);
        cellEl.addEventListener('mouseenter', () => {
          const tip = $('#heatmapTip');
          if (tip) tip.textContent = cellEl.title;
        });
        cellEl.addEventListener('mouseleave', () => {
          const tip = $('#heatmapTip');
          if (tip) tip.textContent = '';
        });
        cellEl.addEventListener('click', () => selectHeatmapDay(cell.key));
        cellEl.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectHeatmapDay(cell.key);
            return;
          }
          const target = heatmapNeighbour(container, cellEl, event.key);
          if (!target) return;
          event.preventDefault();
          moveHeatmapStop(container, target);
        });
        column.appendChild(cellEl);
      }
      container.appendChild(column);
    }
    if (focusedDay) {
      const back = container.querySelector(`[data-day="${focusedDay}"]`);
      if (back) moveHeatmapStop(container, back);
    }
    renderHeatmapDetail(state);
  }

  // 格子按“周（列）× 星期（行）”排：左右是上一周 / 下一周，上下是前一天 / 后一天，Home / End 到头到尾。
  function heatmapNeighbour(container, from, key) {
    const cells = [...container.querySelectorAll('[data-day]')];
    const index = cells.indexOf(from);
    const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (key === 'Home') return cells[0];
    if (key === 'End') return cells[cells.length - 1];
    if (!(key in offsets) || index < 0) return null;
    return cells[index + offsets[key]] || null;
  }

  function moveHeatmapStop(container, target) {
    container.querySelectorAll('[data-day]').forEach(cell => { cell.tabIndex = cell === target ? 0 : -1; });
    target.focus();
  }

  function selectHeatmapDay(key) {
    selectedHeatmapDay = selectedHeatmapDay === key ? null : key;
    const container = $('#heatmap');
    if (container) {
      container.querySelectorAll('[data-day]').forEach(cell => {
        const selected = cell.getAttribute('data-day') === selectedHeatmapDay;
        cell.classList.toggle('selected', selected);
        cell.setAttribute('aria-pressed', String(selected));
      });
      // 停靠点跟着选择走：选了哪天，下次 Tab 回到热力图就落在哪天。
      const cells = [...container.querySelectorAll('[data-day]')];
      const stop = cells.find(cell => cell.getAttribute('data-day') === selectedHeatmapDay) || cells[cells.length - 1];
      if (stop) cells.forEach(cell => { cell.tabIndex = cell === stop ? 0 : -1; });
    }
    renderHeatmapDetail();
    // 只在这里通知时间轴。放进 renderHeatmapDetail 的话,每次统计变动都会重新
    // 取一遍当日时间轴 —— 一次用户点击换来一串请求。
    onDaySelected(selectedHeatmapDay);
  }

  function renderHeatmapDetail(state = getState()) {
    const host = $('#heatmapDetail');
    if (!host) return;
    if (!selectedHeatmapDay || !state) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }
    const stats = state.stats || {};
    const day = selectedHeatmapDay;
    const focusMs = (stats.dailyFocus && stats.dailyFocus[day]) || 0;
    const done = (stats.dailyCompletions && stats.dailyCompletions[day]) || 0;
    const launches = (stats.dailyLaunches && stats.dailyLaunches[day]) || 0;
    const returns = (stats.dailyReturns && stats.dailyReturns[day]) || 0;
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="hm-detail-head">
        <span class="hm-detail-date">${escapeHTML(day)} · 周${weekdayLabels[heatmapWeekday(day)]}</span>
        <button type="button" class="modal-close hm-detail-close" aria-label="关闭 ${escapeHTML(day)} 的详情">✕</button>
      </div>
      <div class="hm-detail-facts">
        <span data-progress-metric="focus"><b>${escapeHTML(formatMs(focusMs))}</b> 专注</span>
        <span data-progress-metric="completions"><b>${done}</b> 件完成</span>
        <span data-progress-metric="launches"><b>${launches}</b> 次启动</span>
        <span data-progress-metric="returns"><b>${returns}</b> 次返回</span><details class="inline-help"><summary aria-label="统计和活动记录如何计算">?</summary><p>启动：开始一轮专注或两分钟起步。返回：恢复已暂停的专注，或确认两分钟起步后的继续、收口。它们来自每日统计，不代表任务完成数。</p><p>日常等具体活动记录在下方时间线中。统计为零，不代表没有行动。</p></details>
      </div>
`;
    const close = host.querySelector('.hm-detail-close');
    if (close) close.addEventListener('click', () => selectHeatmapDay(day));
  }

  // 进展页第一次被打开时，今天的事实和时间线直接摊开：回看最常问的就是“今天怎么样”，
  // 不该先点一下热力图才看得到。只自动打开一次；用户自己合上以后，这一次会话里不再替他弹开。
  function showToday() {
    if (todayOpened || selectedHeatmapDay) return;
    const state = getState();
    if (!state) return;
    todayOpened = true;
    const serverNow = Number.isFinite(state.serverNow) ? state.serverNow : Date.now();
    selectHeatmapDay(localDateKey(new Date(serverNow)));
  }

  function heatmapDateOf(dayKey) {
    const [year, month, day] = String(dayKey).split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function heatmapWeekday(dayKey) {
    return ((heatmapDateOf(dayKey).getDay() + 6) % 7) + 1;
  }

  function mount(projectionStore) {
    if (!projectionStore || typeof projectionStore.subscribe !== 'function') {
      throw new TypeError('progress feature requires a projection store');
    }
    if (unsubscribe) return;
    unsubscribe = projectionStore.subscribe(change => {
      const dirty = change.dirty || {};
      if (dirty.all || dirty.stats) renderStats(change.state);
    });
  }

  function dispose() {
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    selectedHeatmapDay = null;
    todayOpened = false;
    lastStatsKey = '';
  }

  return Object.freeze({ mount, dispose, renderStats, renderHeatmap, renderHeatmapDetail, selectHeatmapDay, showToday });
}


export { createPopoverProgressFeature };
