'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork, createTimelineDayQuery, createOrganizeInboxWorkflow, createInboxTimelineEffects } = require('../src/application');
const { createInboxOrganization } = require('../src/bootstrap/inbox-organization');
const { createEnergyAssistance } = require('../src/bootstrap/energy-assistance');
const { progress, work } = require('../src/capabilities');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const { localDayKey } = require('../src/core/calendar');
const NOW = new Date(2026, 9, 4, 12).getTime();
const NO_ARCHIVE = Object.freeze({ available: false, page: () => [], existing: () => [], count: () => 0,
  remove: () => ({ ok: false }), removeByTarget: () => ({ ok: false }) });
function stateHarness(impulses = []) {
  let state = normalizePersistedState({ impulses }, { now: NOW }), revision = 0;
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(value) { state = structuredClone(value); revision++; return structuredClone(state); } };
  return { repository, unitOfWork: createUnitOfWork({ repository }) };
}
function recorder() {
  const events = [];
  return { events, timelineRecorder: progress.recordTimeline.createTimelineRecorder({ timeline: {
    append: event => { events.push(event); return { ok: true, inserted: true }; }
  } }) };
}
function organization(h, rec, overrides = {}) {
  const routes = {}, dirty = [], errors = [];
  let seq = 0;
  const component = createInboxOrganization({ unitOfWork: h.unitOfWork, readSnapshot: h.repository.snapshot,
    clock: { now: () => NOW }, idFactory: prefix => `${prefix}-${++seq}`, archive: NO_ARCHIVE,
    taskPolicies: { inferEnergy: () => 'medium', suggestDuration: () => 25, suggestNextStep: () => 'One step', nextWorkStart: () => NOW + 1000 },
    timelineRecorder: rec.timelineRecorder, publishChange: value => dirty.push(value),
    reportEffectError: error => errors.push(error), ...overrides });
  component.register((channel, handler) => { routes[channel] = handler; });
  return { component, routes, dirty, errors };
}

test('truthful day query distinguishes unavailable, thrown and legacy empty reads from successful empty history', () => {
  let curveReads = 0;
  for (const timeline of [null, { readDay: () => [] }, { queryRange() { throw new Error('offline'); } },
    { queryRange: () => ({ ok: false, availability: 'unavailable', items: [] }) },
    { queryRange: () => ({ ok: true, items: [] }) }]) {
    const query = createTimelineDayQuery({ timeline, energyCurveForDay: () => { curveReads++; } });
    assert.deepEqual(query.execute({ dayKey: '2026-10-04' }), { ok: false, reason: 'timeline-unavailable' });
  }
  assert.equal(curveReads, 0);
  const asked = [];
  const query = createTimelineDayQuery({ timeline: { queryRange: range => { asked.push(range); return { ok: true, availability: 'available', items: [] }; } },
    energyCurveForDay: dayKey => ({ dayKey, levels: [] }) });
  const result = query.execute({ dayKey: '2026-10-04' });
  assert.equal(result.ok, true);
  assert.equal(result.day.rangeStart, null);
  assert.equal(result.energyCurve.dayKey, '2026-10-04');
  assert.deepEqual(asked, [{ fromDayKey: '2026-10-04', toDayKey: '2026-10-04' }]);
  assert.equal(query.execute({ dayKey: '2026-02-31' }).reason, 'timeline-day-invalid');
});

test('energy projection failure cannot hide otherwise readable history', () => {
  const query = createTimelineDayQuery({ timeline: { queryRange: () => ({ ok: true, availability: 'available', items: [] }) },
    energyCurveForDay() { throw new Error('curve unavailable'); } });
  assert.equal(query.execute({ dayKey: '2026-10-04' }).ok, true);
  assert.equal(query.execute({ dayKey: '2026-10-04' }).energyCurve, null);
});

test('manual capture records only metadata after canonical commit and before selected-day refresh', async () => {
  const h = stateHarness(), rec = recorder(), order = [];
  const assistance = createEnergyAssistance({ unitOfWork: h.unitOfWork, readSnapshot: h.repository.snapshot,
    clock: { now: () => NOW }, getSettings: () => h.repository.snapshot().settings,
    credentialStore: { status: () => ({ configured: false }), get: () => { throw new Error('No provider calls are allowed in this fixture'); } },
    readEstimate: () => null, publishEnergy: () => {}, publishChange: dirty => { order.push({ dirty, recorded: rec.events.length }); },
    notify: () => {}, reportEffectError: () => {}, timelineRecorder: rec.timelineRecorder });
  const command = work.captureImpulse.createCaptureImpulseCommand({ unitOfWork: h.unitOfWork,
    clock: { now: () => NOW }, idFactory: () => 'captured-1', publish: fact => {
      assert.equal(h.repository.snapshot().impulses.length, 1);
      assistance.publishCapturedImpulse(fact);
    } });
  assert.equal(command.execute({ text: 'PRIVATE CAPTURE BODY' }).ok, true);
  await Promise.resolve();
  assert.equal(rec.events.length, 1);
  assert.equal(rec.events[0].kind, 'inbox.captured');
  assert.equal(rec.events[0].occurredAt, NOW);
  assert.equal(rec.events[0].source, 'local-app');
  assert.equal(typeof rec.events[0].timezone, 'string');
  assert.equal(rec.events[0].localDayKey, localDayKey(NOW));
  assert.doesNotMatch(JSON.stringify(rec.events), /PRIVATE CAPTURE BODY/);
  assert.deepEqual(order[0], { dirty: { impulses: true, timeline: true }, recorded: 1 });
});

test('organize metadata uses resolution time and excludes private original and label-only changes', () => {
  const h = stateHarness([{ id: 'i1', text: 'PRIVATE ORIGINAL', createdAt: NOW - 86400000 }]);
  const rec = recorder(), app = organization(h, rec);
  assert.equal(app.routes['impulses:organize'](null, { id: 'i1', action: 'classify', category: 'note' }).ok, true);
  assert.equal(rec.events.length, 0);
  assert.equal(app.routes['impulses:organize'](null, { id: 'i1', action: 'keep' }).ok, true);
  assert.equal(rec.events.length, 1);
  assert.equal(rec.events[0].occurredAt, NOW);
  assert.equal(rec.events[0].dayKey, localDayKey(NOW));
  assert.equal(rec.events[0].payload.inboxId, 'i1');
  assert.doesNotMatch(JSON.stringify(rec.events), /PRIVATE ORIGINAL|note/);
  assert.equal(app.routes['impulses:organize'](null, { id: 'i1', action: 'keep' }).ok, false);
  assert.equal(rec.events.length, 1);
  assert.equal(typeof app.component.flushResolved, 'function');
});

test('keep-all publishes only newly resolved canonical identities once, ignoring missing/resolved/no-op repeats', () => {
  const h = stateHarness([{ id: 'old', text: 'old', createdAt: NOW - 1000,
    resolution: { action: 'keep', category: 'note', at: NOW - 500, targetId: null } },
    { id: 'new', text: 'PRIVATE NEW BODY', createdAt: NOW - 200 }]);
  const initial = h.repository.snapshot();
  work.inboxRecords.resolveRecord(initial, 'old', { action: 'keep', category: 'note', at: NOW - 500, targetId: null });
  h.repository.commit(initial);
  const facts = [];
  const workflow = createOrganizeInboxWorkflow({ unitOfWork: h.unitOfWork, clock: { now: () => NOW },
    profiles: ROUTINE_EFFECT_PROFILES, idFactory: () => 'unused', publish: fact => facts.push(fact) });
  assert.equal(workflow.keepAll({ ids: ['old', 'new', 'new', 'absent'] }).kept, 1);
  assert.deepEqual(facts[0].resolutions, [{ inboxId: 'new', resolvedAt: NOW, action: 'keep', targetId: null }]);
  assert.equal(Object.isFrozen(facts[0].resolutions[0]), true);
  const revision = h.repository.revision();
  assert.equal(workflow.keepAll({ ids: ['old', 'new'] }).ok, false);
  assert.equal(h.repository.revision(), revision);
  assert.equal(facts.length, 1);
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE NEW BODY/);
});

test('task conversion and keeping a mood source create neutral inbox facts; deletion creates none', () => {
  const h = stateHarness(['task', 'mood', 'deleted'].map(id => ({ id, text: `PRIVATE ${id}`, createdAt: NOW - 86400000 })));
  const rec = recorder(), app = organization(h, rec);
  assert.equal(app.routes['impulses:promote'](null, 'task').ok, true);
  assert.equal(app.routes['impulses:keep-mood'](null, 'mood').ok, true);
  assert.equal(app.routes['impulses:review'](null, { id: 'deleted', action: 'delete' }).ok, true);
  assert.equal(rec.events.length, 2);
  assert.ok(rec.events.every(event => event.kind === 'inbox.resolved' && event.occurredAt === NOW));
  assert.deepEqual(rec.events.map(event => event.payload.inboxId), ['task', 'mood']);
  assert.doesNotMatch(JSON.stringify(rec.events), /PRIVATE/);
});

test('a failing timeline observer never prevents committed resolution or archive release', () => {
  const h = stateHarness([{ id: 'i1', text: 'original', createdAt: NOW - 1000 }]);
  const archived = [];
  const archive = { ...NO_ARCHIVE, available: true, put(records) { archived.push(...structuredClone(records)); return { ok: true }; } };
  const app = organization(h, { timelineRecorder: { recordInboxResolved() { throw new Error('offline'); } } }, { archive });
  assert.equal(app.routes['impulses:organize'](null, { id: 'i1', action: 'keep' }).ok, true);
  assert.equal(archived[0].resolution.at, NOW);
  assert.deepEqual(h.repository.snapshot().impulses, []);
  assert.equal(app.errors.length, 1);
  assert.equal(app.routes['impulses:organize'](null, { id: 'i1', action: 'keep' }).ok, false);
});

test('effect adapter ignores unknown capture signals, deletion, and never copies extra fact fields', () => {
  const rec = recorder();
  const effects = createInboxTimelineEffects({ timelineRecorder: rec.timelineRecorder });
  assert.equal(effects.captured({ type: 'external-ai-hook', impulseId: 'i', capturedAt: NOW }), 0);
  assert.equal(effects.resolved([{ inboxId: 'i', action: 'delete', resolvedAt: NOW }]), 0);
  effects.resolved([{ inboxId: 'i', action: 'keep', resolvedAt: NOW, text: 'PRIVATE', category: 'feeling', targetId: null }]);
  assert.equal(rec.events.length, 1);
  assert.doesNotMatch(JSON.stringify(rec.events), /PRIVATE|feeling/);
});
