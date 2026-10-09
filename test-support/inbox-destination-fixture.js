'use strict';

const assert = require('node:assert/strict');
const { createUnitOfWork, createResolveImpulseWorkflow, createKeepMoodNoteCommand,
  createOrganizeInboxWorkflow } = require('../src/application');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { energySelfReports } = require('../src/capabilities/guidance');

const NOW = Date.parse('2026-10-07T15:00:00Z');
const HOUR = 3_600_000;

function inboxState(category = 'state') {
  const state = normalizePersistedState({ impulses: [
    { id: 'source', text: 'Synthetic capture\nwith original wording', createdAt: NOW - HOUR },
    { id: 'other', text: 'Unrelated synthetic capture', createdAt: NOW - HOUR }
  ] }, { now: NOW });
  state.impulses[0].classification = category === null ? null : { category,
    routineKind: ['routine', 'log'].includes(category) ? 'meal' : null, level: category === 'state' ? 35 : null };
  state.energySignals = ['source', 'other'].map((referenceId, n) => ({ id: `signal-${n}`,
    source: 'impulse-ai', referenceId, at: NOW - HOUR, delta: -4, confidence: 90, reason: 'Synthetic inference' }));
  state.energyCheckIn = { level: 65, state: 'medium', timestamp: NOW - 1000 };
  energySelfReports.setSelfReportConsent(state, { enabled: true, expectedVersion: 0, now: NOW - HOUR });
  energySelfReports.appendSelfReport(state, { at: NOW - 1000, level: 65 });
  return normalizePersistedState(state, { now: NOW });
}

function repository(initial, { beforeCommit = () => {} } = {}) {
  let state = structuredClone(initial), revision = 0, commits = 0;
  return {
    snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate, context) {
      assert.equal(context.expectedRevision, revision);
      assert.deepEqual(normalizePersistedState(candidate, context), candidate, 'the entire candidate is canonical');
      beforeCommit(candidate, context);
      state = structuredClone(candidate); revision++; commits++;
      return structuredClone(state);
    },
    inspect: () => ({ state: structuredClone(state), commits }),
    advanceRevision: () => { revision++; }
  };
}

function harness(category = 'state', overrides = {}, repositoryOptions = {}) {
  const initial = repositoryOptions.initialState || inboxState(category);
  const repo = repository(initial, repositoryOptions), facts = [];
  const unitOfWork = createUnitOfWork({ repository: repo });
  let sequence = 0;
  const ports = { unitOfWork, clock: { now: () => NOW }, idFactory: prefix => `${prefix}-${++sequence}`,
    publish: fact => facts.push(fact), ...overrides };
  const workflow = createResolveImpulseWorkflow({ ...ports, inferEnergy: () => 'medium', suggestDuration: () => 25,
    suggestNextStep: () => ({ title: 'Synthetic first step' }), nextWorkStart: () => NOW + HOUR, ...overrides });
  const keep = createKeepMoodNoteCommand(ports);
  return { initial, repo, facts, workflow, keep, unitOfWork, organize: createOrganizeInboxWorkflow(ports),
    execute: (action, extra = {}) => action === 'feeling' ? keep.execute({ impulseId: 'source', ...extra })
      : workflow.execute({ impulseId: 'source', action, ...extra }) };
}

module.exports = { NOW, HOUR, inboxState, repository, harness };
