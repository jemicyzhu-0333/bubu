'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, load, NOW, CAPTURED_AT, TEXT, fixtureState, memoryRepository, taskPolicies } = require('../test-support/inbox-regression-fixture');
const { createInboxOrganization } = load('src/bootstrap/inbox-organization');
const { openDatabase } = load('src/platform/persistence/sqlite/sqlite-database');
const { localDayKey } = load('src/core/calendar');
function composition(repository, archive, options = {}) {
  let sequence = 0;
  const handlers = new Map(), errors = [];
  const inbox = createInboxOrganization({
    unitOfWork: app.createUnitOfWork({ repository }), readSnapshot: repository.snapshot,
    clock: { now: () => NOW }, idFactory: kind => `${kind}-${++sequence}`, archive, taskPolicies,
    publishChange: () => {}, reportEffectError: error => errors.push(error.message), ...options
  });
  inbox.register((name, handler) => handlers.set(name, handler));
  return { inbox, handlers, errors };
}
for (const action of ['promote', 'next-step', 'schedule', 'someday', 'feeling']) {
  test(`bootstrap ${action} archives normalized final label, exact raw source, target and both timestamps once`, t => {
    const facts = openDatabase({ filePath: ':memory:', driver: 'node:sqlite', logger: () => {} });
    t.after(() => facts.close());
    const initial = fixtureState(), repository = memoryRepository(initial), timeline = [];
    const h = composition(repository, facts.inboxArchive, {
      timelineRecorder: { recordInboxResolved: value => { timeline.push(value); return { recorded: 1 }; } }
    });
    const invoke = () => action === 'feeling' ? h.handlers.get('impulses:keep-mood')(null, 'capture')
      : action === 'promote' ? h.handlers.get('impulses:promote')(null, 'capture')
        : h.handlers.get('impulses:review')(null, { id: 'capture', action });
    const result = invoke();
    assert.equal(result.ok, true);
    assert.equal(repository.revision(), 2, 'one business commit plus one archive-release commit');
    const business = repository.commits[0], release = repository.commits[1];
    const source = business.state.impulses.find(item => item.id === 'capture');
    const targetId = action === 'feeling' ? result.id : result.task.id;
    const expectedCategory = action === 'feeling' ? 'feeling' : 'task';
    assert.deepEqual(source.classification, { category: expectedCategory, routineKind: null, level: null });
    assert.deepEqual(source.resolution, { action, category: expectedCategory, at: NOW, targetId });
    assert.equal(source.text, TEXT); assert.equal(source.createdAt, CAPTURED_AT);
    const targets = action === 'feeling' ? business.state.moodNotes : action === 'someday' ? business.state.archivedTasks : business.state.tasks;
    assert.equal(targets.length, 1);
    assert.equal(action === 'feeling' ? targets[0].at : targets[0].createdAt, action === 'feeling' ? CAPTURED_AT : NOW);
    const page = h.handlers.get('impulses:history')(null, {});
    assert.equal(page.available, true); assert.equal(page.total, 1); assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0], { id: 'capture', text: TEXT, createdAt: CAPTURED_AT,
      classification: { category: expectedCategory, routineKind: null, level: null },
      resolution: { action, category: expectedCategory, at: NOW, targetId } });
    assert.equal(release.state.impulses.some(item => item.id === 'capture'), false);
    assert.equal(business.state.energySignals.some(item => item.referenceId === 'capture'), false);
    for (const field of ['energyCheckIn', 'energySelfReports', 'routines', 'routineLog']) {
      assert.deepEqual(release.state[field], initial[field], `${field} remains unchanged`);
    }
    assert.deepEqual(release.state.energySignals, initial.energySignals.filter(item => item.referenceId !== 'capture'));
    assert.equal(timeline.length, 1); assert.equal(timeline[0].resolvedAt, NOW); assert.equal(timeline[0].targetId, targetId);
    assert.deepEqual(invoke(), { ok: false, reason: 'impulse-not-found' });
    assert.equal(repository.revision(), 2); assert.equal(timeline.length, 1);
    assert.equal(h.inbox.flushResolved().released, 0); assert.equal(repository.revision(), 2);
    assert.deepEqual(h.errors, []);
  });
}
test('routine log publication retains original business revision after archive release advances canonical state', t => {
  const facts = openDatabase({ filePath: ':memory:', driver: 'node:sqlite', logger: () => {} });
  t.after(() => facts.close());
  const initial = fixtureState(), repository = memoryRepository(initial), routineFacts = [], routineTimeline = [], inboxTimeline = [];
  const timelineRecorder = {
    recordInboxResolved: value => { inboxTimeline.push({ value, observedRevision: repository.revision() }); return { recorded: 1 }; },
    recordRoutineLogged: value => { routineTimeline.push({ value, observedRevision: repository.revision() }); return { recorded: 1 }; },
    recordRoutineLogUndone: () => ({ removed: 0 }), recordRoutineReminded: () => ({ recorded: 0 }), recordRoutineMissed: () => ({ recorded: 0 })
  };
  const effects = app.createRoutineTimelineEffects({ timelineRecorder, publish: () => {} });
  const h = composition(repository, facts.inboxArchive, { timelineRecorder,
    publishRoutine: fact => { routineFacts.push(fact); effects.publishCommitted(fact); } });
  assert.equal(h.handlers.get('impulses:organize')(null, { id: 'capture', action: 'log', category: 'log',
    routineKind: 'movement', title: 'Synthetic movement', createNew: true }).ok, true);
  assert.equal(repository.revision(), 2);
  assert.equal(routineFacts.length, 1);
  assert.equal(Object.isFrozen(routineFacts[0]), true);
  assert.equal(routineFacts[0].revision, 1);
  assert.equal(routineFacts[0].at, CAPTURED_AT);
  assert.equal(routineFacts[0].dayKey, localDayKey(CAPTURED_AT));
  assert.equal(routineTimeline[0].observedRevision, 2, 'archive release has already completed before the routine effect');
  assert.equal(routineTimeline[0].value.revision, 1, 'fact retains original business transaction identity');
  assert.equal(routineTimeline[0].value.loggedAt, CAPTURED_AT);
  assert.equal(inboxTimeline[0].observedRevision, 1);
  assert.equal(inboxTimeline[0].value.resolvedAt, NOW);
  const saved = repository.snapshot(), entry = saved.routineLog.days.find(day => day.dayKey === localDayKey(CAPTURED_AT)).entries[0];
  assert.equal(entry.occurrenceId, routineFacts[0].occurrenceId);
  assert.equal(entry.at, CAPTURED_AT);
  assert.equal(saved.routines[0].schedule, null);
  assert.deepEqual(h.errors, []);
});
module.exports = { composition };
for (const action of ['promote', 'feeling']) {
  for (const archiveMode of ['unavailable', 'put-failed']) {
    test(`${action} business success with ${archiveMode} archive preserves the exact resolved source and refuses duplicates`, () => {
      const { UNAVAILABLE_INBOX_ARCHIVE } = load('src/platform/persistence/sqlite/inbox-archive-repository');
      const archive = archiveMode === 'unavailable' ? UNAVAILABLE_INBOX_ARCHIVE
        : { ...UNAVAILABLE_INBOX_ARCHIVE, available: true, put: () => ({ ok: false, reason: 'synthetic-archive-write-failed' }) };
      const repository = memoryRepository(), h = composition(repository, archive);
      const invoke = () => action === 'feeling' ? h.handlers.get('impulses:keep-mood')(null, 'capture')
        : h.handlers.get('impulses:promote')(null, 'capture');
      const result = invoke();
      assert.equal(result.ok, true); assert.equal(repository.revision(), 1);
      const state = repository.snapshot(), source = state.impulses.find(item => item.id === 'capture');
      assert.equal(source.text, TEXT); assert.equal(source.createdAt, CAPTURED_AT);
      assert.deepEqual(source.classification, { category: action === 'feeling' ? 'feeling' : 'task', routineKind: null, level: null });
      assert.deepEqual(source.resolution, { action, category: action === 'feeling' ? 'feeling' : 'task', at: NOW,
        targetId: action === 'feeling' ? result.id : result.task.id });
      assert.deepEqual(invoke(), { ok: false, reason: 'impulse-not-found' });
      assert.equal(repository.revision(), 1); assert.deepEqual(repository.snapshot(), state);
      assert.equal(h.errors.length, archiveMode === 'put-failed' ? 1 : 0);
    });
  }
}
