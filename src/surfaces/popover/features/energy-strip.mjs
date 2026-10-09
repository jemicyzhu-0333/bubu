import { t, getLocale } from '../../shared/interface/i18n.mjs';
import { energyPath } from '../ui/energy-path.mjs';
import { createMoodDock } from '../ui/mood-dock.mjs';
'use strict';

// 能量那一小块:今天的曲线、一行归因、五档自评按钮（ARCHITECTURE「日常与能量」）。
//
// 它从外壳里搬出来单独一层,原因不是外壳太长,而是**同一条曲线要被画两次** ——
// ARCHITECTURE「日常与能量」 的当日时间轴上方还要叠一条对齐的能量带。画法放在外壳里,时间轴就得去
// import 外壳,或者把曲线路径算法抄第二遍;`paintCurve` 就是为那一次准备的,
// 它只认一个宿主元素和一份曲线投影,不认识面板头上有什么。
//
// 这里只有一个数。以前头上是一条 `.energy-bar` 进度条,条与曲线并排就是同一件
// 事画两遍 —— 而条走 `currentEnergyEstimate`、曲线走 `buildEnergyCurve`,两个算
// 法早晚在同一屏上写出两个数。现在读数取的就是曲线上「现在」那一列(ARCHITECTURE「日常与能量」)。
const MINUTES_PER_DAY = 24 * 60;
const TREND_TEXT = Object.freeze({ rising: '↗ 正在回升', falling: '↘ 正在下降', flat: '→ 比较平稳' });
const CONFIDENCE_TEXT = Object.freeze({ high: '', medium: '（估算）', low: '（数据还少）' });

// 一个分钟数落在可见窗口里的百分比位置。窗口默认是一整天,ARCHITECTURE「日常与能量」 的时间轴给的是
// 那一天的数据区间(rangeStart→rangeEnd),所以基准不能写死成 1440。
function percentIn(minute, from, span) {
  if (!(span > 0)) return '0%';
  return `${Math.max(0, Math.min(100, ((minute - from) / span) * 100))}%`;
}

// 自评的五档绝对值（很低 / 低 / 一般 / 好 / 很好）。和 guidance/domain/energy-check-in 的
// low / medium / high 三段对齐：40 以下低，70 以下中。
const CHECK_IN_LEVELS = Object.freeze([20, 35, 50, 65, 80]);
const CHECK_IN_LABELS = Object.freeze({ 20: '很低', 35: '低', 50: '一般', 65: '好', 80: '很好' });
function checkInState(level) {
  if (level < 40) return 'low';
  if (level < 70) return 'medium';
  return 'high';
}

function createPopoverEnergyStrip({ $, $$, getState, surfaceClient, escapeHTML, syncPressedButtons } = {}) {
  if (typeof $ !== 'function' || typeof $$ !== 'function') throw new TypeError('energy strip requires $ and $$');
  for (const [name, fn] of Object.entries({ getState, escapeHTML, syncPressedButtons })) {
    if (typeof fn !== 'function') throw new TypeError(`energy strip requires ${name}`);
  }
  if (!surfaceClient) throw new TypeError('energy strip requires surfaceClient');

  const dock = createMoodDock({ host: $('#moodDock'), buttons: $$('.energy-checkin-btn') });
  let lastKey = '';
  let mounted = false;
  const teardown = [];

  // SVG traces the existing samples; no smoothing or averaging is applied to domain values.
  // Windowed plots retain the same sample-aligned coordinates as the timeline.
  function paintCurve(plot, curve, {
    marks = null, nowLine = null, titleOf = () => null,
    fromMinute = 0, toMinute = MINUTES_PER_DAY
  } = {}) {
    if (!plot || !curve || !Array.isArray(curve.levels)) return;
    const perSample = curve.sampleMinutes || (MINUTES_PER_DAY / Math.max(1, curve.levels.length));
    const nowMinute = Number.isFinite(curve.nowMinute) ? curve.nowMinute : null;
    const from = Math.max(0, Math.min(MINUTES_PER_DAY, fromMinute));
    const to = Math.max(from + perSample, Math.min(MINUTES_PER_DAY, toMinute));
    const span = to - from;
    const windowed = from > 0 || to < MINUTES_PER_DAY;
    const first = Math.max(0, Math.floor(from / perSample));
    const last = Math.min(curve.levels.length, Math.ceil(to / perSample));
    const levels = curve.levels.slice(first, last);
    const path = energyPath(levels);
    const cut = nowMinute === null ? 1000
      : Math.max(0, Math.min(1000, (nowMinute - first * perSample) / Math.max(perSample, (last - first) * perSample) * 1000));
    const clip = `${plot.id || 'energyCurve'}-observed`;
    plot.innerHTML = `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">`
      + `<defs><clipPath id="${escapeHTML(clip)}"><rect width="${cut}" height="100"/></clipPath></defs>`
      + `<path class="energy-area" d="${path} L1000,100 L0,100 Z"/>`
      + `<path class="energy-line energy-forecast" d="${path}"/>`
      + `<path class="energy-line" clip-path="url(#${escapeHTML(clip)})" d="${path}"/></svg>`;
    plot.style.left = '0%';
    plot.style.right = '0%';
    if (windowed) {
      // 吸附后多画出来的那一点点用负偏移顶出可视区,而不是把柱子压窄 —— 压窄会让
      // 同一条曲线在两处有两种宽度。
      plot.style.left = `${((first * perSample - from) / span) * 100}%`;
      plot.style.right = `${((to - last * perSample) / span) * 100}%`;
    }
    if (nowLine) {
      // 窗口外的「现在」不画:在一条只画到 18:00 的图上把 23:40 标在最右边,读出来是
      // 「现在是 18:00」。
      const inside = nowMinute !== null && nowMinute >= from && nowMinute <= to;
      nowLine.classList.toggle('hidden', !inside);
      if (inside) nowLine.style.left = percentIn(nowMinute, from, span);
    }
    if (marks) {
      // 刻度带 title:一格 3px 的东西没法在自己身上写字,而「这一下是什么」是它存在
      // 的全部意义。标题按 routineId 回查(ARCHITECTURE「日常与能量」),不从曲线里复制。
      const ticks = Array.isArray(curve.marks) ? curve.marks : [];
      marks.innerHTML = ticks.filter(mark => mark && mark.minute >= from && mark.minute <= to).map(mark => {
        const title = titleOf(mark) || t('一次日常');
        return `<b style="left:${percentIn(mark.minute, from, span)}" title="${escapeHTML(title)}"></b>`;
      }).join('');
    }
  }

  // 归因那一行是曲线唯一的解释出口。它回答的是「为什么此刻是这个数」,所以只说
  // 现在还在起作用的那几件 —— 查询层已经把取整后为 0 的行丢掉了。
  function attributionText(curve, titleOf) {
    const rows = Array.isArray(curve.attribution) ? curve.attribution.slice(0, 3) : [];
    if (!rows.length) return '';
    return rows.map(row => {
      const name = row.source === 'check-in'
        ? t('你的自评')
        : row.source === 'focus-load'
          ? t('专注负荷')
        : row.source === 'impulse-ai'
          ? row.label ? t('闪念判断（{label}）', { label: row.label }) : t('闪念判断')
          : (titleOf(row) || t('日常'));
      return `${name} ${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta)}`;
    }).join(' · ');
  }

  // Wake is supplementary context. Updating it must preserve the person's disclosure choice.
  function renderWake(state) {
    const row = $('#energyWake');
    if (!row) return;
    const wake = state.wake;
    const ask = Boolean(wake && wake.ask);
    row.classList.toggle('hidden', !ask);
  }

  function render() {
    const state = getState();
    if (!state || !state.energy) return;
    renderWake(state);
    const estimate = state.energy;
    const label = estimate.label || {};
    const curve = state.energyCurve && Array.isArray(state.energyCurve.levels) ? state.energyCurve : null;
    // `attribution` / `marks` 在这里当可缺的来读:查询层现在总是给出两个数组,但键值是
    // 整个渲染的入口 —— 它一抛,这一轮里排在后面的每一片都不画了。宁可少一段键。
    const rows = Array.isArray(curve && curve.attribution) ? curve.attribution : [];
    const ticks = Array.isArray(curve && curve.marks) ? curve.marks : [];
    const key = [
      getLocale(),
      estimate.level, label.text || estimate.band,
      curve ? curve.levels.join(',') : 'off',
      curve ? `${curve.nowMinute}|${curve.confidence}|${curve.trend}` : '',
      rows.map(row => `${row.source}${row.id || ''}${row.delta}`).join(','),
      ticks.map(mark => mark.minute).join(',')
    ].join('~');
    if (key === lastKey) return;
    lastKey = key;

    // 标题只存在 routines.items 一处。这里每次重画都回查一遍,所以改名之后曲线上
    // 的悬停文字跟着变 —— 复制一份进曲线的那种做法会让它一直显示旧名字。
    const items = state.routines && Array.isArray(state.routines.items) ? state.routines.items : [];
    const titleOf = row => {
      if (row && row.source === 'impulse-ai' && row.label) return t('闪念判断：{label}', { label: row.label });
      const found = row && row.id ? items.find(item => item && item.id === row.id) : null;
      return found ? found.title : null;
    };

    const reading = $('#energyReading');
    if (reading) {
      // 读数是一句陈述：档位加数字，不带天气图标。它坐在「能量」那块上，所以不再重复标签。
      const source = label.text || estimate.band || '未知';
      const text = ['精力充沛', '状态良好', '中等', '有点累', '需要休息', '未知'].includes(source) ? t(source) : source;
      reading.textContent = `${text} · ${Math.round(estimate.level)}`;
    }

    const host = $('#energyCurve');
    if (host) {
      host.classList.toggle('hidden', curve === null);
      if (curve) {
        host.dataset.confidence = curve.confidence || 'low';
        paintCurve($('#energyCurvePlot'), curve, {
          marks: $('#energyCurveMarks'), nowLine: $('#energyCurveNow'), titleOf
        });
        const plot = $('#energyCurvePlot');
        // 一片 96 根柱子的色块对读屏没有意义,所以整块只留一句话:趋势 + 置信度。
        if (plot) {
          plot.setAttribute('aria-label',
            t('今天的能量曲线，现在约 {level}{trend}{confidence}', { level: Math.round(estimate.level),
              trend: TREND_TEXT[curve.trend] ? `${getLocale() === 'en' ? ', ' : '，'}${t(TREND_TEXT[curve.trend]).slice(2)}` : '',
              confidence: t(CONFIDENCE_TEXT[curve.confidence] || '') }));
        }
      }
    }

    const note = $('#energyAttribution');
    if (note) {
      const parts = [];
      if (curve) {
        if (TREND_TEXT[curve.trend]) parts.push(t(TREND_TEXT[curve.trend]));
        const because = attributionText(curve, titleOf);
        if (because) parts.push(because);
        // 「误差大就把置信度写出来」(ARCHITECTURE「日常与能量」)：淡一点只是提示,说出来才是交代。
        if (CONFIDENCE_TEXT[curve.confidence]) parts.push(t(CONFIDENCE_TEXT[curve.confidence]));
      }
      note.textContent = parts.join(' · ');
      note.classList.toggle('hidden', parts.length === 0);
    }

    // 五档是绝对状态。离当前读数最近的那一档画成“就是这里”：再点它一次等于说“差不多”，
    // 点别的档就是一次新的观测。这样不需要单独的“差不多”按钮，也不会在拉低的读数上越按越低。
    const nearest = nearestCheckInLevel(estimate.level);
    syncPressedButtons('.energy-checkin-btn', button => Number(button.dataset.level) === nearest);
    // 五张脸没有字，选中的那一档在旁边用一个词说出来：图形为主，但不让人猜。
    const caption = $('#energyCheckinCaption');
    if (caption) caption.textContent = t(CHECK_IN_LABELS[nearest] || '');
  }

  function nearestCheckInLevel(level) {
    if (!Number.isFinite(level)) return null;
    return CHECK_IN_LEVELS.reduce((best, candidate) =>
      Math.abs(candidate - level) < Math.abs(best - level) ? candidate : best, CHECK_IN_LEVELS[0]);
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    dock.mount();
    for (const button of $$('.energy-wake-btn')) {
      const handler = async () => {
        if (typeof surfaceClient.setWakeTime !== 'function') return;
        const minutes = button.dataset.minutes === 'skip' ? null : Number(button.dataset.minutes);
        if (minutes !== null && !Number.isInteger(minutes)) return;
        await surfaceClient.setWakeTime(minutes);
      };
      button.addEventListener('click', handler);
      teardown.push(() => button.removeEventListener('click', handler));
    }
    for (const button of $$('.energy-checkin-btn')) {
      const handler = async () => {
        const level = Number(button.dataset.level);
        if (Number.isInteger(level) && typeof surfaceClient.updateEnergyCheckIn === 'function') {
          await surfaceClient.updateEnergyCheckIn({ level, state: checkInState(level), timestamp: Date.now() });
          return;
        }
        if (typeof surfaceClient.adjustEnergy !== 'function' || !button.dataset.direction) return;
        await surfaceClient.adjustEnergy(button.dataset.direction);
      };
      button.addEventListener('click', handler);
      teardown.push(() => button.removeEventListener('click', handler));
    }
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    dock.dispose();
    while (teardown.length) teardown.pop()();
    lastKey = '';
  }

  return Object.freeze({ mount, dispose, render, paintCurve });
}


export { createPopoverEnergyStrip };
