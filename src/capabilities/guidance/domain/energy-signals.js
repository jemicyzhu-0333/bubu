'use strict';

const {
  MAX_ENERGY_SIGNALS,
  normalizeEnergySignal,
  normalizeEnergySignals
} = require('../../../core/energy-signal');

function requireDraft(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('energy signal requires a state draft');
  }
}

function recordEnergySignal(state, rawSignal) {
  requireDraft(state);
  const signal = normalizeEnergySignal(rawSignal);
  if (!signal) return { ok: false, reason: 'energy-signal-invalid' };
  const current = normalizeEnergySignals(state.energySignals);
  const existing = current.find(item => item.id === signal.id);
  if (existing) {
    return JSON.stringify(existing) === JSON.stringify(signal)
      ? { ok: true, changed: false, signal: existing }
      : { ok: false, reason: 'energy-signal-conflict' };
  }
  state.energySignals = [...current, signal]
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    .slice(-MAX_ENERGY_SIGNALS);
  return { ok: true, changed: true, signal };
}

function removeImpulseEnergySignal(state, impulseId) {
  requireDraft(state);
  state.energySignals = (state.energySignals || []).filter(signal => !(signal.source === 'impulse-ai' && signal.referenceId === impulseId));
}

module.exports = { recordEnergySignal, removeImpulseEnergySignal };
