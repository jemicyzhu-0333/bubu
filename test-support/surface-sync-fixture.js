'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const load = name => require(path.join(ROOT, name));
const app = load('src/application');
const { createSurfacePublisher } = load('src/bootstrap/surface-publication');
const { createPetQueries } = load('src/bootstrap/pet-queries');
const { normalizePersistedState } = load('src/platform/persistence/persisted-schema');
const { applyStateDelta } = load('src/core/state-channel.mjs');
const { localDayKey } = load('src/core/calendar');
const { SKINS } = load('src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = load('src/pet-content');
const execution = load('src/capabilities/execution');
const preferences = load('src/capabilities/preferences');
const guidance = load('src/capabilities/guidance');
const routines = load('src/capabilities/routines');
const companion = load('src/capabilities/companion');
const NOW = Date.parse('2026-10-07T12:00:00Z');
const plain = value => structuredClone(value);
function sourceState(overrides = {}) {
  return normalizePersistedState({ ...overrides, settings: { energyCurveEnabled: true, ...overrides.settings } }, { now: NOW });
}
function taskState(overrides = {}) {
  return sourceState({ tasks: [{ id: 'task-1', title: 'Synthetic task', createdAt: NOW - 3_600_000,
    updatedAt: NOW - 3_600_000, nextAction: 'Open a synthetic document', ...overrides.task }], ...overrides });
}
function runningState({ task = false, minutes = 120, quick = false } = {}) {
  const initial = task ? taskState() : sourceState();
  const input = { taskId: task ? 'task-1' : null, minutes, now: NOW - (quick ? 60_000 : 30 * 60_000), sessionId: 'synthetic-focus' };
  initial.focusSession = (quick ? execution.focusSession.startQuickStart : execution.focusSession.startFocus)(initial.focusSession, input).session;
  return initial;
}
function harness({ initial = sourceState(), now = NOW, faults = {}, sampleStep = 0, monotonic = false } = {}) {
  let state = structuredClone(initial), revision = 0, time = now, commits = 0, monoTime = 0;
  const counts = { snapshot: 0, wall: 0, projectSession: 0, runtimeWall: 0, monotonic: 0, maintenance: 0 };
  const messages = [], modes = [], errors = [], attempts = [], samples = [], projectionSamples = [], facts = [];
  const repository = {
    snapshot: () => { counts.snapshot++; return plain(state); },
    revision: () => revision,
    get: key => plain(state[key]),
    commit(candidate, context) {
      if (faults.commit) throw Error('synthetic precommit failure');
      if (context.expectedRevision !== revision) throw Error('synthetic compare-and-swap conflict');
      const normalized = normalizePersistedState(candidate, context);
      assert.deepEqual(normalized, candidate, 'business transition is canonical before commit');
      state = normalized; revision++; commits++; return plain(state);
    }
  };
  const clock = { now: () => time, dayKey: localDayKey };
  const sampleClock = { now: () => { counts.wall++; const at = time; time += sampleStep; return at; }, dayKey: localDayKey };
  const runtimeClock = new execution.runtimeClock.RuntimeSessionClock({
    wallNow: () => { counts.runtimeWall++; return time; }, monotonicNow: () => { counts.monotonic++; return monoTime; }
  });
  const sessionClock = monotonic ? runtimeClock : { now: (_session, wallNow) => wallNow };
  const readComposition = app.createSurfaceReadComposition({ readSnapshot: repository.snapshot, clock: sampleClock,
    projectSession: (session, wallNow) => { counts.projectSession++; return execution.sessionProjection.projectSession(session, sessionClock.now(session, wallNow)); }
  });
  const readSample = () => {
    attempts.push('readSample');
    if (faults.readSample) throw Error('synthetic readSample failure');
    const sample = readComposition.sample(); samples.push(sample); return sample;
  };
  let publisher;
  const query = app.createPopoverStateQuery({ readSample, readSnapshot: repository.snapshot,
    readRevision: () => publisher.readRevision(), clock: sampleClock,
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: true, sentinel: 'FAKE_CREDENTIAL_STATUS_SENTINEL' }) },
    aiDisclosure: () => ({}), schemaVersion: 18
  });
  const reportEffectError = error => { errors.push(error.message); if (faults.report) throw Error('synthetic report failure'); };
  function effect(name, callback) {
    return (...args) => {
      attempts.push(name);
      if (faults[name] === 'missing' || faults[name] === 'destroyed') return false;
      if (faults[name] === true || faults[name] === 'throw') throw Error(`synthetic ${name} failure`);
      const result = callback(...args);
      return faults[name] === 'false' ? false : result;
    };
  }
  const projectPet = (sample, contextRevision) => app.projectPetContext(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision });
  publisher = createSurfacePublisher({ readSample,
    projectPopover: effect('projectPopover', sample => { projectionSamples.push(['popover', sample]); return query.project(sample); }),
    projectPet: effect('projectPet', (sample, contextRevision) => { projectionSamples.push(['pet', sample]); return projectPet(sample, contextRevision); }),
    sendPopover: effect('sendPopover', payload => { messages.push({ surface: 'popover', payload: plain(payload) }); return true; }),
    sendQuick: effect('sendQuick', payload => { messages.push({ surface: 'quick', payload: plain(payload) }); return true; }),
    sizeQuick: effect('sizeQuick', mode => modes.push(plain(mode))),
    sendPet: effect('sendPet', payload => { messages.push({ surface: 'pet', payload: plain(payload) }); return true; }),
    reconcileReminders: effect('reconcileReminders', () => {}),
    afterPet: effect('afterPet', () => {}), reportEffectError
  });
  const unitOfWork = app.createUnitOfWork({ repository });
  const publish = dirty => publisher.publish(dirty);
  const publishFact = dirty => fact => { facts.push(fact); return publish(typeof dirty === 'function' ? dirty(fact) : dirty); };
  const petQueries = createPetQueries({
    readSample,
    projectState: sample => app.projectPetState(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: publisher.readRevision() }),
    foods: FOODS
  });
  return { repository, unitOfWork, readComposition, readSample, query, projectPet, publisher, petQueries,
    counts, messages, modes, errors, attempts, samples, projectionSamples, facts, faults, clock, sessionClock, runtimeClock,
    setTime: at => { time = at; }, setMonotonic: at => { monoTime = at; }, getTime: () => time,
    commits: () => commits, reportEffectError, publish, publishFact,
    sample: () => query.execute(), state: () => plain(state),
    message: surface => messages.filter(row => row.surface === surface).at(-1)?.payload,
    apply(previous) { return applyStateDelta(previous, this.message('popover')); },
    resetCounts() { for (const key of Object.keys(counts)) counts[key] = 0; },
    ports: { unitOfWork, clock, sessionClock, idFactory: kind => `synthetic-${kind}`, reportEffectError }
  };
}
module.exports = { ROOT, load, NOW, plain, sourceState, taskState, harness, runningState, app, execution,
  preferences, guidance, routines, companion, localDayKey, applyStateDelta, SKINS, FOODS, PET_APPEARANCE_ITEMS };
