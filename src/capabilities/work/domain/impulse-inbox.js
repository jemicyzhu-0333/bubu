'use strict';

const MAX_IMPULSE_ID_LENGTH = 200;
const MAX_IMPULSE_TEXT_LENGTH = 500;

function requireImpulseState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('impulse transition requires a state draft');
  }
  if (!Array.isArray(state.impulses)) {
    throw new TypeError('impulse transition requires an impulse collection');
  }
  return state.impulses;
}

function normalizeImpulseText(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.trim();
  return normalized && normalized.length <= MAX_IMPULSE_TEXT_LENGTH ? normalized : null;
}

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('impulse capture requires a finite non-negative time');
  }
  return value;
}

function allocateImpulseId(impulses, createId) {
  if (typeof createId !== 'function') {
    throw new TypeError('impulse capture requires an identity policy');
  }
  const usedIds = new Set(impulses.map(impulse => impulse && impulse.id).filter(Boolean));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = createId('impulse');
    const id = typeof candidate === 'string' ? candidate.trim() : '';
    if (id && id.length <= MAX_IMPULSE_ID_LENGTH && !usedIds.has(id)) return id;
  }
  throw new Error('Could not allocate a unique impulse identity');
}

function findImpulse(state, impulseId, includeResolved = false) {
  const impulses = requireImpulseState(state);
  const id = typeof impulseId === 'string' ? impulseId.trim() : '';
  return impulses.find(impulse => impulse && impulse.id === id && (includeResolved || !impulse.resolution)) || null;
}

function captureImpulse(state, { text, createdAt } = {}, { createId } = {}) {
  const impulses = requireImpulseState(state);
  const normalizedText = normalizeImpulseText(text);
  if (!normalizedText) return { ok: false, reason: 'impulse-text-invalid' };
  const capturedAt = requireTimestamp(createdAt);
  const impulse = {
    id: allocateImpulseId(impulses, createId),
    text: normalizedText,
    createdAt: capturedAt,
    classification: null,
    resolution: null
  };
  state.impulses = [impulse, ...impulses];
  return { ok: true, impulse };
}

function consumeImpulse(state, impulseId) {
  const impulses = requireImpulseState(state);
  const impulse = findImpulse(state, impulseId, true);
  if (!impulse) return { ok: false, reason: 'impulse-not-found' };
  state.impulses = impulses.filter(candidate => candidate.id !== impulse.id);
  return { ok: true, impulse };
}

// 分拣建议挂在闪念自己身上，只是一条建议：不改文字、不移动它，去向由本人确认后才发生。
const TRIAGE_CATEGORIES = Object.freeze(['task', 'routine', 'log', 'state', 'feeling', 'note']);
const TRIAGE_LEVELS = Object.freeze([20, 35, 50, 65, 80]);
const TRIAGE_ROUTINE_KINDS = Object.freeze([
  'medication', 'stimulant', 'meal', 'snack', 'movement', 'rest', 'meeting', 'custom'
]);

function normalizeImpulseTriage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!TRIAGE_CATEGORIES.includes(raw.category)) return null;
  if (!Number.isInteger(raw.confidence) || raw.confidence < 0 || raw.confidence > 100) return null;
  if (!Number.isFinite(raw.at) || raw.at < 0) return null;
  const text = (value, max) => (typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim() : null);
  return {
    category: raw.category,
    confidence: raw.confidence,
    title: text(raw.title, 80),
    routineKind: TRIAGE_ROUTINE_KINDS.includes(raw.routineKind) ? raw.routineKind : null,
    level: TRIAGE_LEVELS.includes(raw.level) ? raw.level : null,
    reason: text(raw.reason, 60),
    at: raw.at
  };
}

function annotateImpulseTriage(state, { impulseId, expectedText, triage } = {}) {
  const impulse = findImpulse(state, impulseId);
  if (!impulse || impulse.classification || impulse.text !== expectedText) return { ok: false, reason: 'impulse-stale' };
  const normalized = normalizeImpulseTriage(triage);
  if (!normalized) return { ok: false, reason: 'impulse-triage-invalid' };
  state.impulses = state.impulses.map(candidate => (candidate.id === impulse.id
    ? { ...candidate, triage: normalized } : candidate));
  return { ok: true, triage: normalized };
}

module.exports = {
  TRIAGE_LEVELS,
  TRIAGE_ROUTINE_KINDS,
  TRIAGE_CATEGORIES,
  normalizeImpulseTriage,
  annotateImpulseTriage,
  MAX_IMPULSE_ID_LENGTH,
  MAX_IMPULSE_TEXT_LENGTH,
  captureImpulse,
  consumeImpulse,
  findImpulse
};
