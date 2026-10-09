'use strict';

// 两份很小的、只留在本机的个人记录（schema 11）：
//
// - wakeTimes：某一天实际几点起的。曲线的基线原本按“上班时间往前推”猜起床时间，熬夜后的第二天
//   就会猜错；本人说一句“今天 9 点起的”，当天的基线就从这里起算。值为 null 表示“问过了，跳过”，
//   免得一天问两次。只留最近 14 天。
// - moodNotes：本人在收件箱里明确选了“留个记录”的一句情绪。它从来不进任何模型请求，也不参与
//   任何计算，只在进展页那天的时间线里给本人自己看，并且随时可以删。最多 100 条、每条 ≤ 500 字。
const MAX_WAKE_DAYS = 14;
// 起床时间按当天 00:00 起算的分钟数。晚于 14:00 的“起床”基本是记错了，宁可不收。
const MAX_WAKE_MINUTE = 14 * 60 - 1;
const MAX_MOOD_NOTES = 100;
const MAX_MOOD_TEXT = 500;
const MAX_MOOD_ID = 64;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWakeMinute(value) {
  if (value === null) return null;
  return Number.isInteger(value) && value >= 0 && value <= MAX_WAKE_MINUTE ? value : undefined;
}

function normalizeWakeTimes(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = [];
  for (const [dayKey, value] of Object.entries(raw)) {
    if (!DAY_KEY.test(dayKey)) continue;
    const minute = normalizeWakeMinute(value);
    if (minute === undefined) continue;
    entries.push([dayKey, minute]);
  }
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries.slice(-MAX_WAKE_DAYS));
}

function normalizeMoodNote(raw) {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!id || id.length > MAX_MOOD_ID || !text || text.length > MAX_MOOD_TEXT) return null;
  if (!Number.isFinite(raw.at) || raw.at < 0) return null;
  return { id, at: Math.trunc(raw.at), text };
}

function normalizeMoodNotes(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const notes = [];
  for (const item of raw) {
    const note = normalizeMoodNote(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return notes.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)).slice(-MAX_MOOD_NOTES);
}

module.exports = {
  MAX_WAKE_DAYS,
  MAX_WAKE_MINUTE,
  MAX_MOOD_NOTES,
  MAX_MOOD_TEXT,
  MAX_MOOD_ID,
  normalizeWakeMinute,
  normalizeWakeTimes,
  normalizeMoodNote,
  normalizeMoodNotes
};
