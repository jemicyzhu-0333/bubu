'use strict';

// Energy signals are bounded, non-clinical corrections inferred from a saved
// impulse. The text itself remains owned by work.impulses and is never copied
// here; keeping only the stable reference prevents a private thought from
// spreading into a second persisted record.
const ENERGY_SIGNAL_SOURCES = Object.freeze(['impulse-ai']);
const MAX_ENERGY_SIGNALS = 128;
const MAX_ENERGY_SIGNAL_DELTA = 12;
const MAX_ENERGY_SIGNAL_REASON = 120;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function normalizeEnergySignal(raw) {
  if (!isPlainObject(raw)) return null;
  const id = boundedString(raw.id, 200);
  const referenceId = boundedString(raw.referenceId, 200);
  const source = ENERGY_SIGNAL_SOURCES.includes(raw.source) ? raw.source : null;
  const at = Number.isSafeInteger(raw.at) && raw.at >= 0 ? raw.at : null;
  const delta = Number.isInteger(raw.delta)
    && raw.delta !== 0
    && Math.abs(raw.delta) <= MAX_ENERGY_SIGNAL_DELTA
    ? raw.delta : null;
  const confidence = Number.isInteger(raw.confidence)
    && raw.confidence >= 0 && raw.confidence <= 100
    ? raw.confidence : null;
  const reason = boundedString(raw.reason, MAX_ENERGY_SIGNAL_REASON);
  if (!id || !referenceId || !source || at === null || delta === null
      || confidence === null || !reason) return null;
  return { id, source, referenceId, at, delta, confidence, reason };
}

function normalizeEnergySignals(raw) {
  const byId = new Map();
  for (const candidate of Array.isArray(raw) ? raw : []) {
    const signal = normalizeEnergySignal(candidate);
    if (signal) byId.set(signal.id, signal);
  }
  return [...byId.values()]
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    .slice(-MAX_ENERGY_SIGNALS);
}

module.exports = {
  ENERGY_SIGNAL_SOURCES,
  MAX_ENERGY_SIGNALS,
  MAX_ENERGY_SIGNAL_DELTA,
  MAX_ENERGY_SIGNAL_REASON,
  normalizeEnergySignal,
  normalizeEnergySignals
};
