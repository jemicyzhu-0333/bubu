'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, load, NOW, fixtureState, memoryRepository, taskPolicies } = require('../test-support/inbox-regression-fixture');
const { createSurfacePublisher } = load('src/bootstrap/surface-publication');
const { createInboxOrganization } = load('src/bootstrap/inbox-organization');
const { UNAVAILABLE_INBOX_ARCHIVE } = load('src/platform/persistence/sqlite/inbox-archive-repository');
const { localDayKey } = load('src/core/calendar');
const execution = load('src/capabilities/execution');
const guidance = load('src/capabilities/guidance');
const { SKINS } = load('src/skins.mjs');
const { FOODS, PET_APPEARANCE_ITEMS } = load('src/pet-content');
const plain = value => JSON.parse(JSON.stringify(value));
function harness(action, { refuseDestination = false, petFailure = false } = {}) {
  const repository = memoryRepository(fixtureState()), messages = [], modes = [], handlers = new Map(), errors = [];
  let surpriseRefreshes = 0;
  const clock = { now: () => NOW, dayKey: localDayKey };
  const readComposition = app.createSurfaceReadComposition({ readSnapshot: repository.snapshot, clock,
    projectSession: execution.sessionProjection.projectSession });
  let publisher;
  const query = app.createPopoverStateQuery({ readSample: readComposition.sample, readSnapshot: repository.snapshot,
    readRevision: () => publisher.readRevision(), clock,
    skins: SKINS, foods: FOODS, appearanceItems: PET_APPEARANCE_ITEMS, credentialStore: { status: () => ({ configured: false }) },
    aiDisclosure: () => ({}), schemaVersion: 17 });
  const projectPet = (sample, contextRevision) => app.projectPetContext(sample, {
    skins: SKINS, appearanceItems: PET_APPEARANCE_ITEMS, contextRevision
  });
  const send = (surface, channel) => payload => {
    if (petFailure && surface === 'pet') throw new Error('Synthetic pet publication failure');
    messages.push({ surface, channel, payload: plain(payload) }); return true;
  };
  // Execute exported production seams with actual UoW commands. Only OS delivery,
  // sizing and reminder/policy ports are synthetic; no main-source excerpt remains.
  publisher = createSurfacePublisher({ readSample: readComposition.sample, projectPopover: query.project, projectPet,
    sendPopover: send('popover', 'state:diff'), sendQuick: send('quick-panel', 'state:diff'),
    sizeQuick: value => modes.push(value), sendPet: send('pet', 'pet:sync'),
    afterPet() { surpriseRefreshes++; }, reportEffectError: error => errors.push(error.message) });
  const initial = query.execute();
  let sequence = 0;
  const inbox = createInboxOrganization({ unitOfWork: app.createUnitOfWork({ repository }), readSnapshot: repository.snapshot,
    clock: { now: () => NOW }, idFactory: kind => refuseDestination && action === 'feeling' ? '' : `${kind}-${++sequence}`,
    archive: UNAVAILABLE_INBOX_ARCHIVE, taskPolicies: refuseDestination ? { ...taskPolicies, suggestNextStep: () => null } : taskPolicies,
    publishChange: publisher.publish, reportEffectError: error => errors.push(error.message) });
  inbox.register((name, callback) => handlers.set(name, callback));
  const checkIn = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({
    unitOfWork: app.createUnitOfWork({ repository }), clock: { now: () => NOW },
    publish: () => publisher.publish({ energy: true, recommendations: true }), reportEffectError: error => errors.push(error.message) });
  const result = action === 'check-in' ? checkIn.execute({ checkIn: { level: 80, state: 'high', timestamp: NOW } })
    : action === 'feeling' ? handlers.get('impulses:keep-mood')(null, 'capture')
    : action === 'promote' ? handlers.get('impulses:promote')(null, 'capture')
      : handlers.get('impulses:review')(null, { id: 'capture', action });
  return { repository, messages, modes, errors, initial, result, final: query.execute(), currentEnergy: readComposition.sample().energyEstimate,
    surpriseRefreshes: () => surpriseRefreshes, purePet: () => projectPet(readComposition.sample(), publisher.readRevision()), checkIn };
}
for (const action of ['promote', 'next-step', 'schedule', 'someday', 'feeling']) {
  test(`bootstrap ${action} feeds refreshed energy into real shared popover, quick-panel and pet publication`, () => {
    const h = harness(action);
    assert.equal(h.result.ok, true); assert.equal(h.repository.revision(), 1); assert.deepEqual(h.errors, []);
    assert.notEqual(h.final.energy.level, h.initial.energy.level, 'synthetic withdrawal actually changes the current reading');
    const popover = h.messages.filter(row => row.surface === 'popover' && row.channel === 'state:diff');
    assert.equal(popover.length, 1);
    assert.deepEqual(popover[0].payload.delta.energy, plain(h.final.energy));
    assert.deepEqual(popover[0].payload.delta.energyCheckIn, plain(h.final.energyCheckIn));
    assert.deepEqual(popover[0].payload.delta.energyCurve, plain(h.final.energyCurve));
    const quick = h.messages.filter(row => row.surface === 'quick-panel' && row.channel === 'state:diff');
    assert.equal(quick.length, 1); assert.deepEqual(plain(h.modes[0]), plain(h.final.quickPanel));
    assert.deepEqual(quick[0].payload.delta, { quickPanel: plain(h.final.quickPanel) });
    assert.equal(quick[0].payload.revision, popover[0].payload.revision);
    assert.equal(h.final.recommendations.energy.level, h.final.energy.level);
    const pet = h.messages.filter(row => row.surface === 'pet' && row.channel === 'pet:sync');
    assert.equal(pet.length, 1, 'shared publisher must refresh the pet after source-signal withdrawal');
    assert.equal(pet[0].payload.contextRevision, popover[0].payload.revision);
    assert.equal(pet[0].payload.energyLevel, h.currentEnergy.level);
    assert.equal(pet[0].payload.energyLevel, h.final.energy.level);
    assert.deepEqual(popover[0].payload.delta.recommendations, plain(h.final.recommendations), 'popover recommendations must not retain the previous energy');
  });
}

test('explicit energy check-in delivers the same pet context exactly once through the shared publisher', () => {
  const h = harness('check-in');
  assert.equal(h.result.ok, true); assert.equal(h.repository.revision(), 1);
  assert.deepEqual(h.errors, []);
  const pet = h.messages.filter(message => message.surface === 'pet');
  assert.equal(pet.length, 1);
  assert.equal(h.surpriseRefreshes(), 1, 'the existing policy refresh also runs once');
  assert.equal(h.messages.filter(message => message.surface === 'popover').length, 1);
  assert.equal(h.messages.filter(message => message.surface === 'quick-panel').length, 1);
  assert.equal(pet[0].payload.energyLevel, h.final.energy.level);
  const count = h.messages.length;
  assert.equal(h.checkIn.execute({ checkIn: h.result.checkIn }).changed, false);
  assert.equal(h.messages.length, count, 'a repeated explicit report has no effects');
  assert.deepEqual(plain(h.purePet()), pet[0].payload, 'shared publication equals the pure scoped pet projection');
  assert.equal(h.messages.length, count, 'projection does not publish another context');
});

test('an explicit check-in remains committed when the shared pet effect fails', () => {
  const h = harness('check-in', { petFailure: true });
  assert.equal(h.result.ok, true); assert.equal(h.result.changed, true);
  assert.equal(h.repository.revision(), 1);
  assert.equal(h.repository.snapshot().energyCheckIn.level, 80);
  assert.deepEqual(h.errors, ['Synthetic pet publication failure']);
  assert.equal(h.checkIn.execute({ checkIn: h.result.checkIn }).changed, false);
  assert.equal(h.repository.revision(), 1);
});

for (const action of ['next-step', 'feeling']) {
  test(`failed bootstrap ${action} publishes no popover, quick-panel, pet or recommendation update`, () => {
    const h = harness(action, { refuseDestination: true });
    assert.equal(h.result.ok, false);
    assert.equal(h.repository.revision(), 0);
    assert.deepEqual(h.repository.snapshot(), fixtureState());
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.modes, []);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.final.energy, h.initial.energy);
    assert.deepEqual(h.final.recommendations, h.initial.recommendations);
  });
}
