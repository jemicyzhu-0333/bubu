'use strict';
const app = require('../src/application');
const execution = require('../src/capabilities/execution');
const { createSessionStartPublisher } = require('../src/bootstrap/session-start-publication');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { localDayKey } = require('../src/core/calendar');
const { SKINS } = require('../src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = require('../src/pet-content');

const NOW = Date.parse('2026-10-07T12:00:00Z');
function memoryRepository(initial = normalizePersistedState({}, { now: NOW })) {
  let state = structuredClone(initial), revision = 0;
  return {
    snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate, context) { state = normalizePersistedState(candidate, context); revision++; return structuredClone(state); }
  };
}
function createQuickStartFixture({ repository = memoryRepository(), onPublish = () => {}, effectFailure = false } = {}) {
  let sequence = 0, samples = 0;
  const events = [], failures = [];
  const unitOfWork = app.createUnitOfWork({ repository });
  const clock = { now: () => { samples++; return NOW; }, dayKey: localDayKey };
  const idFactory = kind => `synthetic-${kind}-${++sequence}`;
  const create = app.createWorkItemWorkflow({ unitOfWork, clock, idFactory,
    inferEnergy: () => 'low', suggestDuration: () => 10 });
  const start = app.createStartFocusSessionWorkflow({ unitOfWork, clock, sessionClock: { now: () => NOW + 250 }, idFactory,
    synchronize: () => { if (effectFailure) throw new Error('Synthetic sync effect'); },
    publish: createSessionStartPublisher({
      notify: value => { if (effectFailure) throw new Error('Synthetic notify effect'); events.push(['notify', value]); },
      focusPet: () => { if (effectFailure) throw new Error('Synthetic pet effect'); },
      recordTimeline: value => { if (effectFailure) throw new Error('Synthetic timeline effect'); events.push(['timeline', value]); },
      publish: dirty => { events.push(['publish', dirty]); onPublish({ revision: repository.revision(), dirty }); },
      reportEffectError: error => failures.push(error.message)
    }), reportEffectError: error => failures.push(error.message) });
  const query = app.createPopoverStateQuery({ readSnapshot: repository.snapshot, readRevision: repository.revision,
    readSession: () => repository.snapshot().focusSession, clock,
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS, credentialStore: { status: () => ({ configured: false }) },
    aiDisclosure: () => ({}), pomodoroView: () => execution.sessionProjection.projectSession(repository.snapshot().focusSession, NOW + 250), schemaVersion: 17 });
  return { repository, create, start, query, events, failures, samples: () => samples };
}
module.exports = { NOW, memoryRepository, createQuickStartFixture };
