'use strict';

// 一天的故事：竖着读的时间线。
//
// 旧版是一条 24 小时 × 160px/时 的横向甘特，面板只有 532px 宽，一屏只看得到三个小时，
// 大部分时候看到的是凌晨的空白和一排说明文字。进展页要回答的只有一个问题——“那天我做了
// 什么、在哪儿停下、又从哪儿回来”——它是一串按时间排开的事，天然是竖的。
//
// 所以：
// - 顶部一条压扁的全天能量线，只做背景参考，不单独占一个“区块”；
// - 下面按上午 / 下午 / 晚上分段，每条是一行：时间、色点、一句话；
// - 专注区间是一行带时长条的记录，而不是悬在 24 小时轴上的一截色块；
// - 长时间没有记录时写一行“x 小时没有记录”，只陈述，不评价——空白不等于没做。
import { routineSymbol } from './routine-symbols.mjs';
import { timelineCategory, timelineIcon, storedClock, changeDescription, changeDetail } from './timeline-change-row.mjs';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const GAP_NOTE_MS = 90 * MINUTE_MS;
const LONG_FOCUS_MS = 90 * MINUTE_MS;
// 兼容旧接口：timeline.mjs 与测试曾按像素定位；竖版不再用它，只保留导出。
const PX_PER_HOUR = 0;

const PARTS = Object.freeze([
  { from: 0, label: '深夜' },
  { from: 6, label: '上午' },
  { from: 12, label: '下午' },
  { from: 18, label: '晚上' }
]);

function hhmm(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function localDayKey(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function partOf(timestamp, offsetMinutes = null) {
  const hour = Number.isInteger(offsetMinutes) ? new Date(timestamp + offsetMinutes * MINUTE_MS).getUTCHours()
    : new Date(timestamp).getHours();
  let found = PARTS[0];
  for (const part of PARTS) if (hour >= part.from) found = part;
  return found.label;
}

function taskTitle(taskId, state) {
  if (!taskId) return '自由专注';
  for (const pool of [state.tasks, state.archivedTasks]) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find(task => task && task.id === taskId);
    if (found && found.title) return found.title;
  }
  return '不在当前列表里的任务';
}

function routineTitle(marker, state) {
  const items = state.routines && Array.isArray(state.routines.items) ? state.routines.items : [];
  const found = items.find(item => item && item.id === marker.routineId);
  return found && found.title ? found.title : null;
}

// 每条记录一句话。category 决定色点：focus 伙伴色、done 琥珀、routine 青、muted 灰。
function describeMarker(marker, state) {
  if (marker.change) return { icon: '', ...changeDescription(marker) };
  if (marker.redactionState === 'redacted') return { icon: '', label: '内容已移除', verb: '记录', category: 'muted' };
  if (marker.visibility === 'private') return { icon: '', label: '私密记录', verb: '记录', category: 'muted' };
  if (marker.kind === 'inbox.captured') return { icon: '', label: '1 条便签', verb: '收下', category: 'muted' };
  if (marker.kind === 'inbox.resolved') return { icon: '', label: '1 条收件', verb: '已处理', category: 'muted' };
  if (marker.kind === 'task.changed') return { icon: '', label: '任务', verb: '已修改', category: 'muted' };
  if (marker.kind === 'routine.schedule.changed') return { icon: '', label: '日常计划', verb: '已修改', category: 'routine' };
  if (marker.kind.startsWith('routine.')) {
    const title = routineTitle(marker, state);
    const name = title || '已移除的日常';
    const icon = title ? routineSymbol(marker.routineKind).icon : '';
    if (marker.kind === 'routine.logged') {
      if (marker.status === 'done') return { icon, label: name, verb: '做了', category: 'routine' };
      if (marker.status === 'skipped') return { icon, label: name, verb: '跳过', category: 'muted' };
      return { icon, label: name, verb: '记录', category: 'muted' };
    }
    if (marker.kind === 'routine.reminded') return { icon, label: name, verb: '提醒', category: 'muted' };
    if (marker.kind === 'routine.missed') return { icon, label: name, verb: '提醒时段结束', category: 'muted' };
  }
  if (marker.kind === 'session.started') {
    const verb = marker.sessionKind === 'quick-start' ? '两分钟启动' : '开始专注';
    return { icon: '', label: taskTitle(marker.taskId, state), verb, category: 'focus' };
  }
  if (marker.kind === 'session.completed') {
    return { icon: '', label: taskTitle(marker.taskId, state), verb: '专注结束', category: 'focus' };
  }
  if (marker.kind === 'task.completed') {
    return { icon: '', label: taskTitle(marker.taskId, state), verb: '完成', category: 'done' };
  }
  if (marker.kind === 'energy.profile.changed') return { icon: '', label: '你确认的估计试用', verb: '已调整', category: 'muted' };
  if (marker.kind === 'planning.preference.changed') return { icon: '', label: '安排偏好', verb: '已调整', category: 'muted' };
  if (marker.kind === 'energy.profile-calibrated') {
    return { icon: '', label: '按你的自评更新了能量模型', verb: '校准', category: 'muted' };
  }
  return { icon: '', label: '记录类型暂不可用', verb: '其他记录', category: 'muted' };
}

function focusEntries(day, state) {
  const entries = [];
  for (const lane of (Array.isArray(day.lanes) ? day.lanes : [])) {
    const label = lane.other ? '其他' : taskTitle(lane.taskId, state);
    for (const segment of (lane.segments || [])) {
      if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) continue;
      const durationMs = Number.isFinite(segment.durationMs) && segment.durationMs > 0
        ? segment.durationMs : Math.max(0, segment.endMs - segment.startMs);
      entries.push({
        type: 'focus', at: segment.startMs, end: segment.endMs, durationMs, label,
        eventId: segment.eventId,
        sessionId: segment.sessionId, causationId: segment.causationId, commandId: segment.commandId,
        quick: segment.sessionKind === 'quick-start'
      });
    }
  }
  return entries;
}

function sameCausalIdentity(left, right) {
  // Prefer the most specific shared identity. Conflicting session IDs must not
  // be hidden by a broader command shared by two independent sessions.
  for (const key of ['sessionId', 'causationId', 'commandId']) {
    if (typeof left[key] !== 'string' || !left[key].trim()
        || typeof right[key] !== 'string' || !right[key].trim()) continue;
    return left[key] === right[key];
  }
  return false;
}

function markerEntries(markers, focus, state) {
  const entries = [];
  for (const marker of markers) {
    if (!marker || !Number.isFinite(marker.occurredAt)) continue;
    // Only an explicit causal identity proves that this boundary belongs to a
    // displayed interval. Nearby times, matching titles and legacy missing IDs
    // cannot prove sameness (ARCHITECTURE「事实流与长期记忆」).
    if (marker.kind === 'session.started' || marker.kind === 'session.completed') {
      if (focus.some(entry => sameCausalIdentity(marker, entry))) continue;
    }
    entries.push({ type: 'marker', at: marker.occurredAt, eventId: marker.eventId, marker, ...describeMarker(marker, state) });
  }
  return entries;
}

// 本人留下的情绪记录（存在状态里，不依赖事实存储）。只在这一天的时间线里给自己看。
function moodEntries(day, state) {
  const notes = Array.isArray(state.moodNotes) ? state.moodNotes : [];
  return notes
    .filter(note => note && Number.isFinite(note.at) && note.at >= day.dayStart && note.at < day.dayEnd)
    .map(note => ({ type: 'mood', at: note.at, id: note.id, text: note.text }));
}

function energySpark(curve, day, state, escapeHTML) {
  const today = Number.isFinite(state.serverNow) ? localDayKey(state.serverNow) : null;
  const previousDay = today ? new Date(state.serverNow) : null;
  if (previousDay) previousDay.setDate(previousDay.getDate() - 1);
  if (today && day.dayKey !== today && day.dayKey !== localDayKey(previousDay.getTime())) {
    return { label: '较早日期的能量打卡未完整保留，不画失真的曲线', markup: '', levelAt: () => null };
  }
  if (Number.isFinite(day.dayStart) && Number.isFinite(day.dayEnd)
      && day.dayEnd - day.dayStart !== 24 * HOUR_MS) {
    return { label: '夏令时切换日的能量采样无法准确覆盖当天，不画失真的曲线', markup: '', levelAt: () => null };
  }
  if (!curve || curve.dayKey !== day.dayKey || !Array.isArray(curve.levels) || curve.levels.length < 2) {
    return { label: '估计能量曲线未启用或不可用', markup: '', levelAt: () => null };
  }
  const start = day.dayStart;
  const perSample = Number.isFinite(curve.sampleMinutes) && curve.sampleMinutes > 0
    ? curve.sampleMinutes : 1440 / curve.levels.length;
  const W = 288;
  const H = 72;
  const x = minute => (minute / 1440) * W;
  const y = level => H - 4 - (Math.max(0, Math.min(100, level)) / 100) * (H - 8);
  const points = curve.levels
    .map((level, index) => ({ minute: index * perSample, level }))
    .filter(point => Number.isFinite(point.level));
  if (points.length < 2) return { label: '这天没有足够的能量记录', markup: '', levelAt: () => null };
  const levelAt = timestamp => {
    const minute = (timestamp - start) / MINUTE_MS;
    if (!Number.isFinite(minute) || minute < 0 || minute >= 1440) return null;
    const value = curve.levels[Math.floor(minute / perSample)];
    return Number.isFinite(value) ? value : null;
  };
  const path = points.map((point, index) =>
    `${index ? 'L' : 'M'}${x(point.minute).toFixed(1)},${y(point.level).toFixed(1)}`).join(' ');
  const nowMinute = today === day.dayKey && Number.isFinite(curve.nowMinute) ? curve.nowMinute : null;
  const now = nowMinute === null ? ''
    : `<line class="tl-spark-now" x1="${x(nowMinute).toFixed(1)}" x2="${x(nowMinute).toFixed(1)}" y1="2" y2="${H - 2}"></line>`;
  const valid = points.map(point => point.level);
  const low = Math.round(Math.min(...valid));
  const high = Math.round(Math.max(...valid));
  const label = `估计能量 ${low}–${high}（10–90，仅为估计）`;
  const extremes = points.length ? [points.reduce((a,b) => a.level <= b.level ? a : b), points.reduce((a,b) => a.level >= b.level ? a : b)] : [];
  const dots = extremes.map(point => `<circle class="tl-extreme-dot" cx="${x(point.minute)}" cy="${y(point.level)}" r="2"/>`).join('');
  // HTML labels keep their font proportions when the SVG stretches across the panel.
  const annotations = extremes.map((point, index) => {
    const left = Math.max(7, Math.min(93, x(point.minute) / W * 100));
    const top = Math.max(10, Math.min(90, (y(point.level) + (index ? -10 : 12)) / H * 100));
    return `<span class="tl-extreme" style="left:${left}%;top:${top}%">${index ? '高' : '低'} ${Math.round(point.level)}</span>`;
  }).join('');
  const markup = `<figure class="tl-spark" aria-label="${escapeHTML(label)}">`
    + '<span class="tl-spark-caption">能量估计</span>'
    + `<div class="tl-spark-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
    + `<path class="tl-spark-fill" d="${path} L${W},${H} L0,${H} Z"></path>`
    + `<path class="tl-spark-line" d="${path}"></path>${now}${dots}</svg>${annotations}</div>`
    + '<figcaption><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></figcaption>'
    + '</figure>';
  return { label, markup, levelAt };
}

function durationWidth(durationMs) {
  // 时长条：0–90 分钟线性铺满，更长的也只到满格，免得一条长专注把别的都压成点。
  return Math.max(6, Math.round(Math.min(1, durationMs / LONG_FOCUS_MS) * 100));
}

function entryMarkup(entry, formatMs, escapeHTML, levelAt) {
  const attrs = `data-row-id="${escapeHTML(entry.rowId)}" aria-expanded="false" aria-controls="timelineDetail"`;
  const clock = storedClock(entry.at, entry.marker?.utcOffsetMinutes) || hhmm(entry.at);
  const typeIcon = timelineIcon(timelineCategory(entry));
  const level = levelAt(entry.at);
  const energyNote = Number.isFinite(level) ? ` · 当时估计能量约 ${Math.round(level)}` : '';
  if (entry.type === 'mood') {
    const detail = `${hhmm(entry.at)} · 你留下的情绪记录 · ${entry.text}`;
    return `<li class="tl-row tl-row-mood"><button type="button" class="tl-event" ${attrs} data-detail="${escapeHTML(detail)}">`
      + `<time>${clock}</time><i class="tl-dot" aria-hidden="true">${typeIcon}</i>`
      + `<span class="tl-text"><span class="tl-verb">心情</span><span class="tl-label">${escapeHTML(entry.text)}</span></span>`
      + '</button>'
      + `<button type="button" class="tl-del" data-mood-id="${escapeHTML(entry.id)}" aria-label="删除这条情绪记录">删除</button></li>`;
  }
  if (entry.type === 'focus') {
    const verb = entry.quick ? '两分钟启动' : '专注';
    const duration = entry.durationMs < MINUTE_MS ? (entry.durationMs > 0 ? `${Math.max(1, Math.floor(entry.durationMs / 1000))}秒` : '刚开始') : formatMs(entry.durationMs);
    const detail = `${hhmm(entry.at)}–${hhmm(entry.end)} · ${verb} ${duration} · ${entry.label}${energyNote}`;
    return `<li class="tl-row tl-row-focus"><button type="button" class="tl-event tl-seg" ${attrs} data-detail="${escapeHTML(detail)}">`
      + `<time>${clock}</time><i class="tl-dot" aria-hidden="true">${typeIcon}</i>`
      + `<span class="tl-text"><span class="tl-verb">${verb} ${escapeHTML(duration)}</span>`
      + `<span class="tl-label">${escapeHTML(entry.label)}</span>`
      + `<span class="tl-bar" style="--w:${durationWidth(entry.durationMs)}%" aria-hidden="true"></span></span>`
      + '</button></li>';
  }
  const detail = entry.marker?.change ? `${clock} · ${entry.verb} · ${entry.label}\n${changeDetail(entry.marker)}`
    : `${clock} · ${entry.verb} · ${entry.label}${energyNote}`;
  const receiptAttr = entry.marker?.change && entry.marker.visibility !== 'private' && entry.marker.redactionState !== 'redacted'
    ? ` data-receipt-id="${escapeHTML(entry.marker.change.receiptId)}"` : '';
  const icon = entry.icon ? `<span class="tl-icon" aria-hidden="true">${entry.icon}</span>` : '';
  const doneClass = entry.category === 'done' ? ' tl-task-complete' : '';
  return `<li class="tl-row tl-row-${entry.category}"><button type="button" class="tl-event${doneClass}" ${attrs}${receiptAttr} data-detail="${escapeHTML(detail)}">`
    + `<time>${clock}</time><i class="tl-dot" aria-hidden="true">${typeIcon}</i>`
    + `<span class="tl-text"><span class="tl-verb">${escapeHTML(entry.verb)}</span>`
    + `<span class="tl-label">${icon}${escapeHTML(entry.label)}</span></span>`
    + '</button></li>';
}

function gapMarkup(ms) {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  const text = hours ? `${hours} 小时${minutes ? ` ${minutes} 分` : ''}` : `${minutes} 分钟`;
  return `<li class="tl-gap" aria-hidden="true"><span>${text}没有记录</span></li>`;
}

function buildTimelineStory({ day, energyCurve, state = {}, formatMs, escapeHTML, filter = 'all' }) {
  const markers = Array.isArray(day.markers) ? day.markers : [];
  const focus = focusEntries(day, state);
  let entries = [...focus, ...markerEntries(markers, focus, state), ...moodEntries(day, state)]
    .sort((left, right) => {
      const timeOrder = left.at - right.at;
      if (timeOrder) return timeOrder;
      if (left.type === 'focus' && right.type !== 'focus') return -1;
      if (right.type === 'focus' && left.type !== 'focus') return 1;
      const leftId = typeof left.eventId === 'string' ? left.eventId : (left.id || '');
      const rightId = typeof right.eventId === 'string' ? right.eventId : (right.id || '');
      return leftId < rightId ? -1 : (leftId > rightId ? 1 : 0);
    });
  entries = entries.map((entry, index) => ({ ...entry, rowId: entry.eventId || entry.id || `legacy-${index}-${entry.at}` }));
  const allEntryCount = entries.length;
  if (filter !== 'all') entries = entries.filter(entry => timelineCategory(entry) === filter
    || (entry.marker?.changes || []).some(change => change.kind.startsWith(`${filter}.`)));
  const energy = energySpark(energyCurve, day, state, escapeHTML);
  const rows = [];
  let part = null;
  let lastEnd = null;
  for (const entry of entries) {
    const entryPart = partOf(entry.at, entry.marker?.utcOffsetMinutes);
    if (entryPart !== part) {
      rows.push(`<li class="tl-part">${entryPart}</li>`);
      part = entryPart;
    } else if (lastEnd !== null && entry.at - lastEnd >= GAP_NOTE_MS) {
      rows.push(gapMarkup(entry.at - lastEnd));
    }
    rows.push(entryMarkup(entry, formatMs, escapeHTML, energy.levelAt));
    lastEnd = Math.max(lastEnd ?? 0, entry.end ?? entry.at);
  }
  const list = rows.length
    ? `<ol class="tl-list">${rows.join('')}</ol>`
    : '<p class="tl-none">暂无活动记录。没有逐条记录，不代表没有行动。</p>';
  return {
    width: 0,
    height: 0,
    firstEvent: entries.length ? entries[0].at : undefined,
    entryCount: entries.length,
    allEntryCount,
    energyLabel: energy.label,
    markup: energy.markup + list
  };
}

export { buildTimelineStory, PX_PER_HOUR };
