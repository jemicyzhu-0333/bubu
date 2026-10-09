'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sourceState, taskState, runningState, NOW, app, preferences, execution, guidance, routines, load, localDayKey } = require('../test-support/surface-sync-fixture');
const { createSessionStartPublisher } = load('src/bootstrap/session-start-publication');

function assertFresh(h, previous, { commits = 1, changedEnergy = false } = {}) {
  const merged = h.apply(previous); assert.equal(merged.applied, true);
  const current = h.sample(), popover = h.message('popover'), pet = h.message('pet'), quick = h.message('quick');
  assert.equal(h.commits(), commits); assert.deepEqual(h.errors, []);
  assert.equal(merged.state.energy.level, current.energy.level);
  assert.deepEqual(merged.state.recommendations, current.recommendations);
  assert.equal(pet.energyLevel, current.energy.level);
  assert.equal(quick.revision, popover.revision); assert.equal(pet.contextRevision, popover.revision);
  assert.deepEqual(quick.delta.quickPanel, current.quickPanel); assert.deepEqual(quick.delta.quickPanel, h.modes.at(-1));
  assert.equal(h.messages.filter(row => row.surface === 'pet' && row.payload.contextRevision === popover.revision).length, 1);
  assert.equal(pet.focusRing?.elapsedMs ?? null, execution.sessionProjection.projectFocusRing(current.pomodoro)?.elapsedMs ?? null);
  if (changedEnergy) assert.notEqual(current.energy.level, previous.energy.level, 'real input changes modeled energy');
  return current;
}

test('real settings commit refreshes exact energy and recommendation values alongside quick and pet', () => {
  const h = harness(), before = h.sample();
  const command = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) });
  assert.equal(command.execute({ patch: { workStartHour: 5 } }).ok, true);
  const fresh = assertFresh(h, before, { changedEnergy: true });
  if (new Date(NOW).getTimezoneOffset() === 0) {
    assert.equal(before.energy.level, 55); assert.equal(fresh.energy.level, 64);
  }
});
test('actual routine log and undo preserve once-only publication, fresh recommendations and no rewards', () => {
  const h = harness({ initial: sourceState({ routines: [{ id: 'movement', title: 'Synthetic movement', kind: 'movement',
    createdAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000, active: true, schedule: null }] }) });
  const before = h.sample(), xp = h.state().xp, inventory = h.state().pet.foodInventory;
  const effects = app.createRoutineTimelineEffects({ timelineRecorder: {
    recordRoutineLogged() {}, recordRoutineLogUndone() {}, recordRoutineReminded() {}, recordRoutineMissed() {}
  }, publish: h.publish });
  const command = routines.logRoutineOccurrence.createLogRoutineOccurrenceCommand({ ...h.ports, publish: effects.publishCommitted });
  const logged = command.log({ routineId: 'movement', status: 'done', at: NOW - 15 * 60_000 });
  assert.equal(logged.ok, true); const current = assertFresh(h, before, { changedEnergy: true });
  if (new Date(NOW).getTimezoneOffset() === 0) assert.equal(current.energy.level, 53);
  assert.equal(h.publisher.readRevision(), 1);
  assert.equal(command.undo({ occurrenceId: logged.occurrenceId }).ok, true);
  const undone = assertFresh(h, current, { commits: 2 }); assert.equal(undone.energy.level, before.energy.level);
  assert.equal(h.publisher.readRevision(), 2); assert.equal(h.state().xp, xp); assert.deepEqual(h.state().pet.foodInventory, inventory);
  const repeated = command.undo({ occurrenceId: logged.occurrenceId });
  assert.equal(repeated.ok, false); assert.equal(h.commits(), 2); assert.equal(h.publisher.readRevision(), 2);
});
test('actual wake-time commit refreshes recommendations, same-time energy and once-only pet context', () => {
  const h = harness(), before = h.sample();
  const command = app.createSetWakeTimeCommand({ ...h.ports, publish: h.publishFact(fact => fact.dirty) });
  assert.equal(command.execute({ minutes: 240 }).ok, true);
  assertFresh(h, before, { changedEnergy: true });
});
test('explicit energy check-in publishes exact absolute value once; duplicate input is no-op', () => {
  const h = harness(), before = h.sample();
  const command = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({ ...h.ports, publish: h.publishFact({ energy: true, recommendations: true }) });
  const input = { checkIn: { level: 80, state: 'high', timestamp: NOW } };
  assert.equal(command.execute(input).ok, true); assert.equal(assertFresh(h, before).energy.level, 80);
  assert.equal(command.execute(input).changed, false); assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
});
test('actual relative energy adjustment uses current estimate and publishes its exact new value', () => {
  const h = harness(), before = h.sample();
  const command = guidance.adjustEnergy.createAdjustEnergyCommand({ ...h.ports,
    currentLevelFor: (state, now) => app.currentEnergyLevelAt({ snapshot: state, settings: state.settings, at: now, dayKey: localDayKey(now), workStartHour: preferences.workSchedule.getWorkHours(state.settings).start, pomodoro: execution.sessionProjection.projectSession(state.focusSession, now) }), publish: h.publishFact({ energy: true, recommendations: true }) });
  const result = command.execute({ direction: 'higher' }); assert.equal(result.ok, true);
  const fresh = assertFresh(h, before); assert.equal(fresh.energy.level, Math.min(90, before.energy.level + 10));
});
for (const transition of ['pause', 'stop', 'due']) test(`real timed ${transition} publishes settlement and current energy atomically`, () => {
  const initial = runningState({ minutes: transition === 'due' ? 30 : 120 });
  const h = harness({ initial, now: NOW - 25 * 60_000 }), before = h.sample(); h.setTime(NOW);
  const factory = transition === 'pause' ? execution.pauseSession.createPauseSessionCommand
    : transition === 'stop' ? app.createStopFocusSessionWorkflow : app.createCompleteDueSessionWorkflow;
  const command = factory({ ...h.ports, publish: h.publishFact({ pomodoro: true, stats: true, tasks: true, quickStartDecision: true }) });
  const result = command.execute(); assert.equal(result.ok, true);
  const fresh = assertFresh(h, before, { changedEnergy: true });
  if (new Date(NOW).getTimezoneOffset() === 0) assert.equal(fresh.energy.level, 49);
  if (transition === 'pause') {
    assert.equal(fresh.pomodoro.paused, true); assert.equal(h.message('pet').focusRing.running, false);
    assert.equal(h.message('pet').focusRing.sessionId, initial.focusSession.sessionId);
  } else {
    assert.equal(fresh.pomodoro.status, 'idle'); assert.equal(h.message('pet').focusRing, null);
    assert.equal(fresh.quickPanel.mode, 'idle');
  }
  const xp = h.state().xp, ledger = h.state().rewardLedger;
  command.execute(); assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
  assert.equal(h.state().xp, xp); assert.deepEqual(h.state().rewardLedger, ledger);
});
for (const quick of [false, true]) test(`actual ${quick ? 'quick-start' : 'focus'} start uses existing start publisher and preserves kind/identity`, () => {
  const h = harness({ initial: taskState() }), before = h.sample();
  const startPublisher = createSessionStartPublisher({ notify() {}, recordTimeline() {}, publish: h.publish, reportEffectError: h.reportEffectError });
  const command = app.createStartFocusSessionWorkflow({ ...h.ports, publish: startPublisher });
  const result = command.execute({ taskId: 'task-1', minutes: 25, quick }); assert.equal(result.ok, true);
  const fresh = assertFresh(h, before); assert.equal(fresh.pomodoro.kind, quick ? 'quick-start' : 'focus');
  assert.equal(fresh.quickPanel.session.kind, fresh.pomodoro.kind);
  assert.equal(fresh.quickPanel.session.sessionId, h.state().focusSession.sessionId);
  assert.equal(h.message('pet').focusRing.sessionId, h.state().focusSession.sessionId);
  assert.equal(h.message('pet').focusRing.plannedMs, quick ? 120_000 : 25 * 60_000);
  assert.equal(h.message('pet').baseState, 'focused');
  assert.equal(command.execute({ taskId: 'task-1', minutes: 25, quick }).ok, false);
  assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
});
test('actual break start projects resting state without actionable linked task or steps', () => {
  const h = harness({ initial: taskState() }), before = h.sample();
  const command = app.createStartBreakSessionWorkflow({ ...h.ports, publish: h.publishFact({ pomodoro: true }) });
  assert.equal(command.execute({ taskId: 'task-1', minutes: 5 }).ok, true);
  const fresh = assertFresh(h, before);
  assert.equal(fresh.quickPanel.session.kind, 'break'); assert.equal(fresh.quickPanel.task, null);
  assert.equal(fresh.quickPanel.taskActionable, false); assert.deepEqual(fresh.quickPanel.steps, []);
  assert.equal(h.message('pet').baseState, 'resting'); assert.equal(h.message('pet').focusRing.mode, 'break');
});
test('actual pause then resume preserves canonical identity and publishes unpaused same-time projections', () => {
  const h = harness({ initial: runningState({ task: true }) }), before = h.sample();
  const pause = execution.pauseSession.createPauseSessionCommand({ ...h.ports, publish: h.publishFact({ pomodoro: true }) });
  assert.equal(pause.execute().ok, true); const paused = assertFresh(h, before);
  h.setTime(NOW + 10 * 60_000);
  const resume = app.createResumeFocusSessionWorkflow({ ...h.ports, publish: h.publishFact({ pomodoro: true, stats: true, tasks: true }) });
  assert.equal(resume.execute({ sessionId: paused.pomodoro.sessionId, intent: 'resume' }).ok, true);
  const fresh = assertFresh(h, paused, { commits: 2 });
  assert.equal(fresh.pomodoro.paused, false); assert.equal(fresh.pomodoro.running, true);
  assert.equal(fresh.pomodoro.elapsedMs, paused.pomodoro.elapsedMs);
  assert.equal(h.message('pet').focusRing.running, true);
  assert.equal(h.message('pet').focusRing.sessionId, paused.pomodoro.sessionId);
  assert.equal(resume.execute({ sessionId: paused.pomodoro.sessionId, intent: 'resume' }).ok, false);
  assert.equal(h.commits(), 2); assert.equal(h.publisher.readRevision(), 2);
});
test('actual duration adjustment retains session identity and uses new duration on all surfaces', () => {
  const h = harness({ initial: runningState({ task: true }) }), before = h.sample();
  const command = app.createAdjustFocusDurationWorkflow({ ...h.ports, publish: h.publishFact({ pomodoro: true, settings: true }) });
  assert.equal(command.execute({ minutes: 60 }).ok, true); const fresh = assertFresh(h, before);
  assert.equal(fresh.pomodoro.sessionId, before.pomodoro.sessionId);
  assert.equal(fresh.pomodoro.plannedDurationMs, 60 * 60_000); assert.equal(h.message('pet').focusRing.plannedMs, 60 * 60_000);
  assert.equal(command.execute({ minutes: 60 }).changed, false); assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
});
test('actual linked task completion disables further task work and resume without duplicate reward', () => {
  const h = harness({ initial: runningState({ task: true }), now: NOW - 25 * 60_000 }), before = h.sample(); h.setTime(NOW);
  const command = app.createCompleteWorkItemWorkflow({ ...h.ports, publish: h.publishFact(fact => ({ tasks: true, stats: true,
    companion: Boolean(fact.bond), skin: fact.newlyUnlockedSkins.length > 0, nowTask: true,
    recommendations: true, recurrenceSeries: Boolean(fact.nextOccurrenceDate), focusLandingPrompt: true, pomodoro: fact.sessionPaused })) });
  assert.equal(command.execute({ taskId: 'task-1' }).ok, true);
  const fresh = assertFresh(h, before, { changedEnergy: true });
  assert.equal(h.state().tasks[0].done, true); assert.equal(fresh.quickPanel.taskActionable, false);
  assert.deepEqual(fresh.quickPanel.steps, []); assert.equal(fresh.quickPanel.session.paused, true);
  assert.equal(fresh.quickPanel.session.resumeAction.enabled, false); assert.equal(h.message('pet').focusRing.running, false);
  const xp = h.state().xp, food = h.state().pet.foodInventory;
  assert.equal(command.execute({ taskId: 'task-1' }).ok, false);
  assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1); assert.equal(h.state().xp, xp); assert.deepEqual(h.state().pet.foodInventory, food);
});
test('held quick-start projection retains identity, kind, held flag and explicit completion action', () => {
  const initial = runningState({ task: true, quick: true });
  initial.focusSession = execution.focusSession.pauseForOfflineConfirmation(initial.focusSession, NOW + 60_000);
  // The public recovery helper returns a transition envelope.
  if (initial.focusSession.session) initial.focusSession = initial.focusSession.session;
  const h = harness({ initial, now: NOW + 60_000 }); h.publish({ pomodoro: true });
  const pop = h.message('popover').delta.pomodoro, quick = h.message('quick').delta.quickPanel;
  assert.equal(pop.kind, 'quick-start'); assert.equal(pop.awaitingOfflineConfirmation, true);
  assert.equal(quick.session.sessionId, pop.sessionId); assert.equal(quick.session.awaitingOfflineConfirmation, true);
  assert.equal(quick.session.resumeAction.intent, 'confirm-completion'); assert.equal(h.message('pet').focusRing.running, false);
});

function capturedHarness() {
  return harness({ initial: sourceState({ settings: { aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true },
    impulses: [{ id: 'capture-1', text: 'FAKE_CAPTURE_TEXT_SENTINEL explicit rested state', createdAt: NOW }] }) });
}
const captureFact = { type: 'impulse-captured', impulseId: 'capture-1', capturedAt: NOW, revision: 1 };
const fakeResult = { ok: true, classification: { direction: 'up', delta: 7, confidence: 88, reason: 'FAKE_CLASSIFICATION_REASON_SENTINEL' } };
test('allowed fake captured-energy analysis commits once, refreshes surfaces and exposes no source text', async () => {
  const h = capturedHarness(), before = h.sample(), requests = [];
  const workflow = app.createAnalyzeImpulseEnergyWorkflow({ ...h.ports, readSnapshot: h.repository.snapshot,
    classify: async payload => { requests.push(payload); assert.equal(h.commits(), 0); return fakeResult; },
    publish: h.publishFact({ energy: true, recommendations: true }) });
  assert.equal((await workflow.handleCaptured(captureFact)).changed, true);
  assertFresh(h, before, { changedEnergy: true }); assert.equal(h.state().energySignals[0].delta, 7);
  assert.deepEqual(requests, [{ impulseText: 'FAKE_CAPTURE_TEXT_SENTINEL explicit rested state' }]);
  const wire = JSON.stringify([h.message('quick'), h.message('pet')]);
  assert.equal(wire.includes('FAKE_CAPTURE_TEXT_SENTINEL'), false); assert.equal(wire.includes('FAKE_CLASSIFICATION_REASON_SENTINEL'), false);
  // Use a fresh spy on the duplicate; it does execute fake classification again, but must not commit or publish again.
  const duplicate = app.createAnalyzeImpulseEnergyWorkflow({ ...h.ports, readSnapshot: h.repository.snapshot,
    classify: async () => fakeResult, publish: h.publishFact({ energy: true, recommendations: true }) });
  assert.equal((await duplicate.handleCaptured(captureFact)).changed, false);
  assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
});
for (const kind of ['neutral', 'low-confidence', 'provider-failure', 'throw', 'late-opt-out']) {
  test(`fake captured-energy ${kind} does not publish or mutate an estimate`, async () => {
    const h = capturedHarness(), before = h.state(); let resolve;
    const workflow = app.createAnalyzeImpulseEnergyWorkflow({ ...h.ports, readSnapshot: h.repository.snapshot,
      classify: async () => {
        if (kind === 'throw') throw Error('synthetic classifier failure');
        if (kind === 'late-opt-out') return new Promise(done => { resolve = done; });
        if (kind === 'provider-failure') return { ok: false, reason: 'provider-timeout' };
        return { ok: true, classification: { ...fakeResult.classification, ...(kind === 'neutral' ? { direction: 'neutral', delta: 0 } : { confidence: 69 }) } };
      }, publish: h.publishFact({ energy: true, recommendations: true }) });
    const pending = workflow.handleCaptured(captureFact);
    if (kind === 'late-opt-out') {
      app.createUpdatePreferencesWorkflow({ ...h.ports, publish: h.publishFact({ settings: true }) }).execute({ patch: { aiImpulseEnergyEnabled: false } });
      resolve(fakeResult);
    }
    assert.equal((await pending).changed, false);
    assert.equal(h.commits(), kind === 'late-opt-out' ? 1 : 0); assert.equal(h.publisher.readRevision(), kind === 'late-opt-out' ? 1 : 0);
    assert.deepEqual(h.state().energySignals, before.energySignals);
    if (kind !== 'late-opt-out') assert.deepEqual(h.messages, []);
  });
}
test('archive release has a legitimate second publication without repeated business settlement', () => {
  const h = harness({ initial: sourceState({ impulses: [{ id: 'capture-1', text: 'Synthetic kept idea', createdAt: NOW }] }) });
  const organization = app.createOrganizeInboxWorkflow({ ...h.ports, publish: h.publishFact({ impulses: true }) });
  assert.equal(organization.execute({ id: 'capture-1', action: 'keep', category: 'note' }).ok, true);
  assert.equal(h.commits(), 1); assert.equal(h.publisher.readRevision(), 1);
  const records = [], archive = { available: true, put: rows => { records.push(...structuredClone(rows)); return { ok: true }; } };
  const workflow = app.createArchiveInboxRecordsWorkflow({ ...h.ports, readSnapshot: h.repository.snapshot, archive,
    publish: h.publishFact({ impulses: true }) });
  assert.equal(workflow.flush().released, 1); assert.equal(h.commits(), 2); assert.equal(h.publisher.readRevision(), 2);
  assert.equal(records.length, 1); assert.equal(records[0].text, 'Synthetic kept idea'); assert.equal(h.state().impulses.length, 0);
  assert.equal(workflow.flush().released, 0); assert.equal(h.commits(), 2); assert.equal(h.publisher.readRevision(), 2);
});

test('actual pause command and publication share runtime-clock evidence after a forward wall jump', () => {
  const h = harness({ initial: runningState({ task: true }), now: NOW - 25 * 60_000, monotonic: true });
  const before = h.sample(); assert.equal(before.pomodoro.elapsedMs, 5 * 60_000);
  h.setTime(NOW + 6 * 3_600_000); h.setMonotonic(25 * 60_000);
  const pause = execution.pauseSession.createPauseSessionCommand({ ...h.ports, publish: h.publishFact({ pomodoro: true, stats: true, tasks: true }) });
  assert.equal(pause.execute().ok, true);
  const fresh = assertFresh(h, before);
  assert.equal(fresh.pomodoro.elapsedMs, 30 * 60_000);
  assert.equal(h.message('pet').focusRing.elapsedMs, 30 * 60_000);
  assert.equal(h.message('quick').delta.quickPanel.session.elapsedMs, 30 * 60_000);
  assert.equal(h.counts.runtimeWall, 0);
});
