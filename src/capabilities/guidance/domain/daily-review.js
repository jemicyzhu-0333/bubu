'use strict';

const { addDaysToKey, compareDayKeys, localDayKey } = require('../../../core/calendar');
const { isPlainObject, trimmedString } = require('../../../core/field-normalizers');

const REVIEW_KINDS = Object.freeze(['closeout', 'startup']);
const REVIEW_ACTIONS = Object.freeze(['done', 'dismissed', 'progress']);
const MAX_REVIEW_CARDS = 14;
const MAX_FACT_ITEMS = 20;

const MAX_STARTUP_PICKS = 3;

function timestampDay(timestamp) {
  return Number.isFinite(Number(timestamp)) ? localDayKey(Number(timestamp)) : null;
}

function allTasks(state) {
  return [...(Array.isArray(state && state.tasks) ? state.tasks : []),
    ...(Array.isArray(state && state.archivedTasks) ? state.archivedTasks : [])];
}

function compactTask(task) {
  return Object.freeze({
    id: task.id,
    title: trimmedString(task.title, '未命名任务', 100),
    deadline: task.deadline || null,
    plannedFor: task.plannedFor || null,
    nextAction: trimmedString(task.nextAction || task.lastCheckpoint, null, 200),
    recurring: Boolean(task.seriesId)
  });
}

function buildCloseout(state, { dayKey }) {
  const tasks = allTasks(state);
  const completed = tasks
    .filter(task => task && task.done && timestampDay(task.completedAt) === dayKey)
    .sort((a, b) => Number(a.completedAt) - Number(b.completedAt) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_FACT_ITEMS)
    .map(compactTask);
  // 收口卡只回答“今天”：今天留下的落点，不是所有时候留下过落点的任务。更早的落点在第二天的
  // 启动卡里作为“昨天延续”出现，不需要在每天的收口里再列一遍，越列越长就没人读了。
  const landedOn = task => timestampDay(task.lastCheckpoint ? task.lastCheckpointAt : task.updatedAt);
  const landings = (Array.isArray(state && state.tasks) ? state.tasks : [])
    .filter(task => task && !task.done && !task.skippedAt && (task.lastCheckpoint || task.nextAction)
      && landedOn(task) === dayKey)
    .sort((a, b) => Number(b.lastCheckpointAt || b.updatedAt || 0) - Number(a.lastCheckpointAt || a.updatedAt || 0))
    .slice(0, MAX_FACT_ITEMS)
    .map(compactTask);
  const impulses = (Array.isArray(state && state.impulses) ? state.impulses : [])
    .filter(item => !item.resolution)
    .slice(0, MAX_FACT_ITEMS)
    .map(item => Object.freeze({ id: item.id, text: trimmedString(item.text, '未命名闪念', 200), createdAt: item.createdAt }));
  return Object.freeze({
    kind: 'closeout', dayKey,
    completed,
    focusMs: Math.max(0, Number(state && state.stats && state.stats.dailyFocus && state.stats.dailyFocus[dayKey]) || 0),
    landings,
    impulses
  });
}

function buildStartup(state, { dayKey }) {
  const yesterday = addDaysToKey(dayKey, -1);
  const active = (Array.isArray(state && state.tasks) ? state.tasks : [])
    .filter(task => task && !task.done && !task.skippedAt && !task.expired);
  const carryovers = active
    .filter(task => (task.plannedFor && compareDayKeys(task.plannedFor, dayKey) < 0)
      || timestampDay(task.lastCheckpointAt) === yesterday)
    .sort((a, b) => String(a.plannedFor || '').localeCompare(String(b.plannedFor || '')) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_FACT_ITEMS)
    .map(compactTask);
  const deadlineCandidates = active
    .filter(task => task.deadline)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 3)
    .map(compactTask);
  const newlyAdded = active
    .filter(task => timestampDay(task.createdAt) === dayKey)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_FACT_ITEMS)
    .map(compactTask);
  const expiring = active
    .filter(task => task.expiresAt)
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX_FACT_ITEMS)
    .map(compactTask);
  // 今天先做这几件：1–3 件，按“截止最近 → 计划在今天 → 昨天延续 → 今天新增”的顺序去重取前三。
  // 这是启动困难最需要的一步——不是再看一遍清单，而是有人替你把第一件摆到面前。确认之后
  // 它们计划到今天，第一件直接成为“现在”。
  const seen = new Set();
  const plannedToday = active
    .filter(task => task.plannedFor && compareDayKeys(task.plannedFor, dayKey) === 0)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)))
    .map(compactTask);
  const picks = [...deadlineCandidates, ...plannedToday, ...carryovers, ...newlyAdded]
    .filter(task => (seen.has(task.id) ? false : seen.add(task.id)))
    .slice(0, MAX_STARTUP_PICKS);
  return Object.freeze({ kind: 'startup', dayKey, picks, carryovers, deadlineCandidates, newlyAdded, expiring });
}

function reviewId(kind, dayKey) {
  if (!REVIEW_KINDS.includes(kind)) throw new TypeError('invalid review kind');
  return `review:${kind}:${dayKey}`;
}

function ensureReviewCard(state, { kind, dayKey, now }) {
  const reviews = isPlainObject(state.reviews) ? state.reviews : (state.reviews = { pending: [] });
  if (!Array.isArray(reviews.pending)) reviews.pending = [];
  const id = reviewId(kind, dayKey);
  const existing = reviews.pending.find(card => card && card.id === id);
  if (existing) return { created: false, card: existing };
  const card = { id, kind, dayKey, createdAt: now, status: 'pending', progress: 0 };
  reviews.pending.push(card);
  reviews.pending.sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || a.id.localeCompare(b.id));
  reviews.pending = reviews.pending.slice(-MAX_REVIEW_CARDS);
  return { created: true, card };
}

// A closeout summarises a day that happened. A day with no completion, no
// focused minute, no checkpoint, no new task and no captured impulse has
// nothing to close, and an empty card on a new user's second morning reads as
// a chore rather than a summary.
function dayHadActivity(state, dayKey) {
  const focusMs = Number(state && state.stats && state.stats.dailyFocus && state.stats.dailyFocus[dayKey]) || 0;
  if (focusMs > 0) return true;
  const touched = task => task && [task.completedAt, task.lastCheckpointAt, task.createdAt]
    .some(timestamp => timestampDay(timestamp) === dayKey);
  if (allTasks(state).some(touched)) return true;
  return (Array.isArray(state && state.impulses) ? state.impulses : [])
    .some(item => item && timestampDay(item.createdAt) === dayKey);
}

function ensureDueReviews(state, { now, workStartHour = 10, workEndHour = 21 } = {}) {
  const date = new Date(now);
  const dayKey = localDayKey(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const created = [];
  const yesterday = addDaysToKey(dayKey, -1);
  if (dayHadActivity(state, yesterday)) {
    const previous = ensureReviewCard(state, { kind: 'closeout', dayKey: yesterday, now });
    if (previous.created) created.push(previous.card);
  }
  if (minute >= Math.min(24 * 60, workStartHour * 60 + 30)) {
    const startup = ensureReviewCard(state, { kind: 'startup', dayKey, now });
    if (startup.created) created.push(startup.card);
  }
  if (workEndHour < 24 && minute >= workEndHour * 60) {
    const closeout = ensureReviewCard(state, { kind: 'closeout', dayKey, now });
    if (closeout.created) created.push(closeout.card);
  }
  return created;
}

function findReview(state, id) {
  return state && state.reviews && Array.isArray(state.reviews.pending)
    ? state.reviews.pending.find(item => item.id === id) || null
    : null;
}

function openReview(state, id) {
  const card = findReview(state, id);
  if (!card) return { ok: false, reason: 'review-not-found' };
  const facts = card.kind === 'closeout'
    ? buildCloseout(state, { dayKey: card.dayKey })
    : buildStartup(state, { dayKey: card.dayKey });
  return { ok: true, card: { ...card }, facts };
}

function resolveReview(state, { id, action, progress, confirmedTaskIds = [], now }) {
  if (!REVIEW_ACTIONS.includes(action)) return { ok: false, reason: 'review-action-invalid' };
  const card = findReview(state, id);
  if (!card) return { ok: false, reason: 'review-not-found' };
  if (card.status !== 'pending') return { ok: false, reason: 'review-already-resolved' };
  if (action === 'progress') {
    card.progress = Math.max(0, Math.min(100, Number.isInteger(progress) ? progress : card.progress));
    return { ok: true, card, updatedTasks: [] };
  }
  const startup = card.kind === 'startup' ? buildStartup(state, { dayKey: card.dayKey }) : null;
  const candidateIds = startup
    ? new Set([...startup.picks, ...startup.deadlineCandidates].map(task => task.id))
    : new Set();
  // 顺序保留：用户勾选的第一件就是要设为“现在”的那件。
  const updatedTasks = [...new Set(confirmedTaskIds)]
    .filter(taskId => candidateIds.has(taskId))
    .slice(0, MAX_STARTUP_PICKS);
  card.status = action;
  card.progress = 100;
  return { ok: true, card, updatedTasks };
}

module.exports = {
  MAX_STARTUP_PICKS,
  dayHadActivity,
  REVIEW_KINDS,
  REVIEW_ACTIONS,
  MAX_REVIEW_CARDS,
  buildCloseout,
  buildStartup,
  reviewId,
  ensureReviewCard,
  ensureDueReviews,
  openReview,
  resolveReview
};
