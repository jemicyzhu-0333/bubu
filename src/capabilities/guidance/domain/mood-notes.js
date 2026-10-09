'use strict';

// 本人在收件箱里明确选了“留个记录”的情绪（ARCHITECTURE「日常与能量」）。
// 只有文字和时间：不带分类、不算分、不进任何模型请求；只在进展页那天的时间线里给自己看，随时可删。
const { normalizeMoodNote, normalizeMoodNotes } = require('../../../core/wellbeing');

function requireDraft(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('mood notes require a state draft');
  }
}

function addMoodNote(state, raw) {
  requireDraft(state);
  const note = normalizeMoodNote(raw);
  if (!note) return { ok: false, reason: 'mood-note-invalid' };
  const current = normalizeMoodNotes(state.moodNotes);
  if (current.some(item => item.id === note.id)) return { ok: false, reason: 'mood-note-conflict' };
  state.moodNotes = normalizeMoodNotes([...current, note]);
  return { ok: true, note };
}

function deleteMoodNote(state, id) {
  requireDraft(state);
  const key = typeof id === 'string' ? id.trim() : '';
  const current = normalizeMoodNotes(state.moodNotes);
  if (!key || !current.some(item => item.id === key)) return { ok: false, reason: 'mood-note-not-found' };
  state.moodNotes = current.filter(item => item.id !== key);
  return { ok: true };
}

module.exports = { addMoodNote, deleteMoodNote };
