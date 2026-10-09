'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const load = relative => require(path.join(ROOT, relative));
const app = load('src/application');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = load('src/platform/persistence/persisted-schema');
const NOW = Date.parse('2026-10-07T12:00:00Z');
const CAPTURED_AT = NOW - 60_000;
const TEXT = 'Synthetic source: original punctuation,\nsecond line, café ☕';
function fixtureState({ classification = { category: 'state', routineKind: null, level: 35 }, ...overrides } = {}) {
  const state = normalizePersistedState({
    settings: { aiBreakdownEnabled: true, aiCaptureTriageEnabled: true, aiImpulseEnergyEnabled: true, energyCurveEnabled: true },
    impulses: [{ id: 'capture', text: TEXT, createdAt: CAPTURED_AT }, { id: 'unrelated', text: 'Unrelated capture', createdAt: CAPTURED_AT - 1 }],
    energySignals: [
      { id: 'source-signal', source: 'impulse-ai', referenceId: 'capture', at: CAPTURED_AT, delta: -12, confidence: 99, reason: 'Synthetic source signal' },
      { id: 'unrelated-signal', source: 'impulse-ai', referenceId: 'unrelated', at: CAPTURED_AT - 1, delta: 2, confidence: 90, reason: 'Unrelated signal' }
    ],
    energyCheckIn: { level: 65, timestamp: NOW - 4 * 60 * 60_000, state: 'steady' },
    ...overrides
  }, { now: NOW });
  state.impulses.find(item => item.id === 'capture').classification = classification;
  const canonical = normalizePersistedState(state, { now: NOW });
  assert.deepEqual(canonical, state, 'fixture classification is canonical');
  return canonical;
}
function memoryRepository(initial = fixtureState()) {
  let state = structuredClone(initial), revision = 0;
  const commits = [];
  return {
    snapshot: () => structuredClone(state), revision: () => revision,
    get: key => structuredClone(state[key]), commits,
    commit(candidate, context = {}) {
      const normalized = normalizePersistedState(candidate, { now: NOW, ...context });
      assert.deepEqual(normalized, candidate, 'business transition must be canonical before persistence');
      state = structuredClone(candidate); revision++;
      commits.push({ revision, state: structuredClone(state), context: structuredClone(context) });
      return structuredClone(state);
    }
  };
}
const taskPolicies = {
  inferEnergy: () => 'medium', suggestDuration: () => 25,
  suggestNextStep: () => ({ title: 'Synthetic first step' }), nextWorkStart: () => NOW + 24 * 60 * 60_000
};
function destination(repository, action, options = {}) {
  let sequence = 0;
  const ports = { unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => NOW },
    idFactory: kind => `${kind}-${++sequence}`, ...options };
  if (action === 'feeling') {
    const command = app.createKeepMoodNoteCommand(ports);
    return () => command.execute({ impulseId: 'capture' });
  }
  const command = app.createResolveImpulseWorkflow({ ...taskPolicies, ...ports });
  return () => command.execute({ impulseId: 'capture', action });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function sourceSlice(start, end) {
  const source = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production function boundaries are present');
  return source.slice(a, b);
}
module.exports = { ROOT, load, app, normalizePersistedState, PERSISTED_SCHEMA_VERSION, NOW, CAPTURED_AT, TEXT,
  fixtureState, memoryRepository, taskPolicies, destination, deferred, sourceSlice };
