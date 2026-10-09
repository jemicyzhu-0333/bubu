'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sourceState, taskState, runningState, NOW, app, preferences, execution,
  SKINS, PET_APPEARANCE_ITEMS, applyStateDelta } = require('../test-support/surface-sync-fixture');
const PET_KEYS = ['contextRevision', 'baseState', 'paused', 'focusRing', 'sessionDisplay', 'skin', 'level', 'theme',
  'appearanceItemIds', 'energyLevel', 'work', 'satiation', 'motionMode', 'stimulationMode', 'petActivityMode', 'dnd', 'foodInventory', 'foodTickets', 'totalFeeds', 'basicMeal'];
const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), expected.slice().sort());

for (const flag of ['energy', 'wellbeing', 'pomodoro', 'focusSession', 'stats', 'settings', 'routines']) {
  test(`real publisher expands ${flag} to shared energy and recommendation projection`, () => {
    const h = harness(); h.publish({ [flag]: true });
    const popover = h.message('popover'), pet = h.message('pet'), quick = h.message('quick');
    assert.equal(popover.dirty.energy, true); assert.equal(popover.dirty.recommendations, true);
    assert.equal(popover.delta.energy.level, popover.delta.recommendations.energy.level);
    assert.equal(pet.energyLevel, popover.delta.energy.level);
    assert.equal(pet.contextRevision, popover.revision); assert.equal(quick.revision, popover.revision);
    assert.equal(h.messages.filter(row => row.surface === 'pet').length, 1);
  });
}
for (const flag of ['pet', 'companion', 'appearance', 'skin', 'tasks']) {
  test(`real publisher routes consumed ${flag} invalidation to pet once`, () => {
    const h = harness(); h.publish({ [flag]: true });
    assert.equal(h.messages.filter(row => row.surface === 'pet').length, 1);
    assert.equal(h.message('pet').contextRevision, 1);
  });
}
test('one publication shares exactly one canonical sample, wall time and runtime session projection', () => {
  const h = harness({ initial: runningState({ task: true }), sampleStep: 1000, monotonic: true });
  h.resetCounts(); h.publish({ all: true });
  assert.deepEqual(h.counts, { snapshot: 1, wall: 1, projectSession: 1, runtimeWall: 0, monotonic: 1, maintenance: 0 });
  assert.equal(h.projectionSamples[0][1], h.projectionSamples[1][1]);
  const p = h.message('popover'), q = h.message('quick'), pet = h.message('pet');
  assert.equal(p.delta.serverNow, NOW);
  assert.equal(p.delta.pomodoro.elapsedMs, q.delta.quickPanel.session.elapsedMs);
  assert.equal(p.delta.pomodoro.elapsedMs, pet.focusRing.elapsedMs);
  assert.equal(p.delta.energy.level, pet.energyLevel);
  assert.deepEqual(q.delta.quickPanel, h.modes[0]);
  assert.equal(h.commits(), 0);
});
test('rollback and forward wall-clock corrections cannot replace monotonic session time', () => {
  const h = harness({ initial: runningState({ task: true }), monotonic: true });
  h.publish({ all: true });
  h.setTime(NOW - 2 * 3_600_000); h.setMonotonic(60_000); h.publish({ pomodoro: true });
  assert.equal(h.message('popover').delta.pomodoro.elapsedMs, 31 * 60_000);
  assert.equal(h.message('quick').delta.quickPanel.session.elapsedMs, 31 * 60_000);
  assert.equal(h.message('pet').focusRing.elapsedMs, 31 * 60_000);
  h.setTime(NOW + 6 * 3_600_000); h.setMonotonic(120_000); h.publish({ pomodoro: true });
  assert.equal(h.message('popover').delta.pomodoro.elapsedMs, 32 * 60_000);
  assert.equal(h.message('pet').focusRing.elapsedMs, 32 * 60_000);
  assert.equal(h.counts.runtimeWall, 0);
});
test('query.project and pet mappers use their supplied sample without hidden reads or maintenance', () => {
  const h = harness({ initial: runningState({ task: true }) });
  const sample = h.readSample(), state = h.state(); h.resetCounts();
  const popover = h.query.project(sample);
  const pet = app.projectPetContext(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: 12 });
  const hydration = app.projectPetState(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: 12 }, { screenLocked: true, visualState: 'focused' });
  assert.deepEqual(h.counts, { snapshot: 0, wall: 0, projectSession: 0, runtimeWall: 0, monotonic: 0, maintenance: 0 });
  assert.equal(popover.energy.level, pet.energyLevel); assert.equal(hydration.energy.level, pet.energyLevel);
  assert.equal(hydration.state, pet.baseState); assert.equal(hydration.screenLocked, true);
  assert.equal(h.commits(), 0); assert.deepEqual(h.state(), state);
});
test('closed quick and pet wire payloads exclude private canonical sentinels in idle and active modes', () => {
  for (const active of [false, true]) {
    const initial = active ? runningState({ task: true }) : taskState();
    initial.impulses = [{ id: 'private', text: 'FAKE_CAPTURE_TEXT_SENTINEL', createdAt: NOW }];
    initial.moodNotes = [{ id: 'private-mood', text: 'FAKE_MOOD_TEXT_SENTINEL', at: NOW }];
    initial.settings.aiBaseUrl = 'https://fake-private-setting.example';
    initial.tasks[0].description = 'FAKE_TASK_DESCRIPTION_SENTINEL';
    const h = harness({ initial: sourceState(initial) }), before = h.state(); h.publish({ all: true });
    const quick = h.message('quick'), pet = h.message('pet'), view = quick.delta.quickPanel;
    keys(quick, ['revision', 'dirty', 'delta']); keys(quick.delta, ['quickPanel']); keys(pet, PET_KEYS);
    keys(pet.work, ['start', 'end']);
    if (active) {
      keys(view, ['mode', 'session', 'task', 'taskActionable', 'steps', 'chosenMinutes']);
      keys(view.session, ['sessionId', 'taskId', 'kind', 'awaitingOfflineConfirmation', 'recoveryReason', 'resumeAction', 'running', 'paused', 'elapsedMs', 'remainingMs']);
      keys(view.task, ['id', 'title', 'seriesId']);
      keys(pet.focusRing, ['mode', 'sessionId', 'plannedMs', 'elapsedMs', 'running']);
    } else {
      keys(view, ['mode', 'candidates', 'chosenMinutes']);
      for (const candidate of view.candidates) {
        keys(candidate, ['id', 'title', 'role', 'reason', 'quickStartAction', 'minutes']);
        keys(candidate.quickStartAction, ['taskId', 'intent', 'enabled', 'reason', 'taskVersion']);
      }
    }
    const wire = JSON.stringify({ quick, pet });
    for (const value of ['FAKE_CAPTURE_TEXT_SENTINEL', 'FAKE_MOOD_TEXT_SENTINEL', 'FAKE_CREDENTIAL_STATUS_SENTINEL',
      'FAKE_TASK_DESCRIPTION_SENTINEL', 'fake-private-setting.example']) assert.equal(wire.includes(value), false, value);
    assert.equal(h.commits(), 0); assert.deepEqual(h.state(), before);
  }
});
for (const fault of ['reconcileReminders', 'sizeQuick', 'sendPopover', 'sendQuick', 'sendPet', 'afterPet', 'projectPopover', 'projectPet']) {
  for (const reporterThrows of [false, true]) test(`${fault} failure remains isolated with reporter throwing=${reporterThrows}`, () => {
    const h = harness({ faults: { [fault]: true, report: reporterThrows } });
    const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
    const result = command.execute({ patch: { workStartHour: 5 } });
    assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(h.commits(), 1);
    assert.equal(h.publisher.readRevision(), 1);
    for (const port of ['sendPopover', 'sendQuick']) assert.ok(h.attempts.includes(port), port);
    if (fault !== 'projectPet') assert.ok(h.attempts.includes('sendPet'));
    assert.ok(h.attempts.includes('afterPet'));
    assert.ok(h.errors.some(error => error.includes(fault)));
    assert.equal(command.execute({ patch: { workStartHour: 5 } }).changed, false);
    assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
  });
}
for (const surface of ['Popover', 'Quick', 'Pet']) {
  for (const failure of ['false', 'missing', 'destroyed']) test(`${surface} ${failure} delivery cannot suppress other ports or retry a command`, () => {
    const port = `send${surface}`, h = harness({ faults: { [port]: failure } });
    const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
    assert.equal(command.execute({ patch: { workStartHour: 5 } }).ok, true);
    for (const other of ['sendPopover', 'sendQuick', 'sendPet']) assert.ok(h.attempts.includes(other));
    assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
  });
}
test('sample failure sends invalidations, preserves committed success and recovers by full read', () => {
  const h = harness({ faults: { readSample: true, report: true } });
  const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
  assert.equal(command.execute({ patch: { workStartHour: 5 } }).ok, true);
  for (const surface of ['popover', 'quick']) keys(h.message(surface), ['revision', 'dirty']);
  assert.equal(h.message('pet'), undefined); assert.equal(h.commits(), 1);
  h.faults.readSample = false; h.faults.report = false;
  const read = h.sample(); assert.equal(read.revision, 1); assert.equal(read.settings.workStartHour, 5);
  h.publish({ all: true }); assert.equal(h.message('pet').contextRevision, 2); assert.equal(h.commits(), 1);
});
test('back-to-back publications have independent revisions and lost deltas recover only through full popover state', () => {
  const h = harness(), initial = h.sample();
  h.publish({ energy: true }); h.publish({ energy: true });
  assert.equal(h.message('popover').revision, 2); assert.equal(h.message('quick').revision, 2); assert.equal(h.message('pet').contextRevision, 2);
  assert.equal(h.apply(initial).reason, 'revision-gap');
  const fresh = h.sample(); assert.equal(fresh.revision, 2);
  h.publish({ all: true }); assert.equal(h.apply(initial).applied, true);
  for (const revision of [2, 3]) assert.equal(applyStateDelta({ ...fresh, revision: 3 }, { revision, dirty: {}, delta: {} }).reason, 'stale-revision');
  assert.equal(h.commits(), 0);
});
test('repository rejection and invalid or stale commands have zero publication and leave state unchanged', () => {
  for (const input of [{ patch: { workStartHour: -1 } }, { patch: { workStartHour: 5 }, expectedRevision: 4 }, { patch: {} }]) {
    const h = harness(), before = h.state();
    const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
    command.execute(input); assert.equal(h.commits(), 0); assert.equal(h.publisher.readRevision(), 0); assert.deepEqual(h.messages, []); assert.deepEqual(h.state(), before);
  }
  const h = harness({ faults: { commit: true } }), before = h.state();
  const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
  assert.throws(() => command.execute({ patch: { workStartHour: 5 } }), /precommit/);
  assert.equal(h.commits(), 0); assert.equal(h.publisher.readRevision(), 0); assert.deepEqual(h.messages, []); assert.deepEqual(h.state(), before);
});

test('pet hydration uses a closed field set and retains current appearance, sensory settings and food state', () => {
  const initial = sourceState({ settings: { motionMode: 'reduced', stimulationMode: 'low', dnd: true,
    aiBaseUrl: 'https://fake-private-setting.example' },
    impulses: [{ id: 'private', text: 'FAKE_CAPTURE_TEXT_SENTINEL', createdAt: NOW }],
    moodNotes: [{ id: 'private-mood', text: 'FAKE_MOOD_TEXT_SENTINEL', at: NOW }] });
  initial.pet.foodTickets = 9;
  const h = harness({ initial }), sample = h.readSample();
  const value = app.projectPetState(sample, { skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision: 7 },
    { screenLocked: true, visualState: 'resting' });
  keys(value, PET_KEYS.filter(key => !['baseState', 'energyLevel'].includes(key)).concat(['state', 'energy', 'screenLocked', 'visualState']));
  keys(value.energy, ['level', 'band', 'source', 'confidence', 'reason', 'checkIn', 'checkInAgeMinutes', 'checkInWeight', 'prior', 'activityAdjustment']);
  assert.equal(value.contextRevision, 7); assert.equal(value.foodTickets, 9);
  assert.equal(value.motionMode, sample.settings.motionMode); assert.equal(value.stimulationMode, sample.settings.stimulationMode);
  assert.equal(value.dnd, true); assert.equal(value.screenLocked, true); assert.equal(value.visualState, 'resting');
  assert.deepEqual(value.appearanceItemIds, h.projectPet(sample, 7).appearanceItemIds);
  for (const sentinel of ['FAKE_CAPTURE_TEXT_SENTINEL', 'FAKE_MOOD_TEXT_SENTINEL', 'FAKE_CREDENTIAL_STATUS_SENTINEL', 'fake-private-setting.example']) {
    assert.equal(JSON.stringify(value).includes(sentinel), false);
  }
});

test('real inbox count composition consumes sampled impulses without a second canonical read', () => {
  const { createInboxOrganization } = require('../src/bootstrap/inbox-organization');
  const { taskPolicies } = require('../test-support/inbox-regression-fixture');
  const { FOODS } = require('../src/pet-content');
  const initial = sourceState();
  initial.impulses = [{ id: 'local-history', text: 'Private retained capture', createdAt: NOW - 1000,
    classification: { category: 'note', routineKind: null, level: null },
    resolution: { action: 'keep', category: 'note', at: NOW, targetId: null } }];
  const h = harness({ initial });
  const archive = { ...require('../src/platform/persistence/sqlite/inbox-archive-repository').UNAVAILABLE_INBOX_ARCHIVE,
    available: true, count: () => ({ ok: true, total: 1 }), existing: () => ({ ok: true, ids: [] }) };
  const inbox = createInboxOrganization({ ...h.ports, readSnapshot: h.repository.snapshot, archive, taskPolicies,
    publishChange: h.publish, reportEffectError: h.reportEffectError });
  const query = app.createPopoverStateQuery({ readSample: h.readSample, readSnapshot: h.repository.snapshot,
    readRevision: h.publisher.readRevision, clock: { now: () => NOW, dayKey: require('../src/core/calendar').localDayKey },
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS,
    credentialStore: { status: () => ({ configured: false }) }, aiDisclosure: () => ({}), schemaVersion: 17,
    countInboxHistory: impulses => inbox.historyTotal(impulses) });
  h.resetCounts();
  const state = query.execute();
  assert.equal(state.inboxHistoryTotal, 2); assert.equal(h.counts.snapshot, 1); assert.equal(h.counts.wall, 1);
  assert.equal(h.counts.projectSession, 1); assert.equal(h.commits(), 0);
  h.resetCounts(); assert.equal(inbox.historyTotal(), 2); assert.equal(h.counts.snapshot, 1,
    'standalone count still reads canonical state normally');
  archive.existing = () => ({ ok: true, ids: ['local-history'] });
  h.resetCounts(); assert.equal(query.execute().inboxHistoryTotal, 1); assert.equal(h.counts.snapshot, 1);
  archive.count = () => ({ ok: false });
  h.resetCounts(); assert.equal(query.execute().inboxHistoryTotal, null); assert.equal(h.counts.snapshot, 1);
});
