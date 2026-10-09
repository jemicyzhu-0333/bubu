'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGrowthPublisher } = require('../src/bootstrap/growth-publication');
const { createPreferencesPublisher } = require('../src/bootstrap/preferences-publication');
const { createTaskUndo } = require('../src/bootstrap/task-undo');
const { harness, taskState, sourceState, NOW, app, localDayKey } = require('../test-support/surface-sync-fixture');

function growthPublisher(h, fault) {
  const effects = [];
  const effect = name => () => { effects.push(name); if (fault === name) throw Error(`failed-${name}`); };
  const publisher = createGrowthPublisher({ publishChange: h.publish,
    notifyLevelUp: effect('level'), announceBond: effect('bond'), announceSkins: effect('skins'),
    recordTaskCompletion: effect('timeline'), celebrateTask: effect('celebrate'),
    notifyRecurrence: effect('recurrence'), clearNudge: effect('nudge'), reportEffectError: () => {} });
  return { publisher, effects };
}
for (const fault of [null, 'timeline', 'celebrate', 'level', 'bond', 'skins']) {
  test(`task completion publishes committed wallet/growth once despite ${fault || 'no'} effect failure`, () => {
    const h = harness({ initial: taskState() }), { publisher, effects } = growthPublisher(h, fault);
    const result = app.createCompleteWorkItemWorkflow({ ...h.ports, publish: publisher.completeTask }).execute({ taskId: 'task-1' });
    assert.equal(result.ok, true); assert.equal(h.commits(), 1); assert.equal(h.state().level, 2);
    assert.equal(h.state().pet.foodTickets, 9); assert.equal(h.publisher.readRevision(), 1);
    assert.equal(h.message('popover').delta.foodTickets, 9); assert.equal(h.message('pet').foodTickets, 9);
    assert.deepEqual(h.message('pet').foodInventory, h.state().pet.foodInventory);
    assert.equal(h.messages.length, 3); assert.deepEqual(effects, ['timeline', 'celebrate', 'level', 'bond', 'skins']);
  });
}
for (const action of ['step', 'landing', 'quick', 'shutdown', 'break']) {
  test(`${action} growth reaches all sampled surfaces in one postcommit publication`, () => {
    let initial = taskState({ task: { steps: [{ id: 'step-1', text: 'Synthetic action' }] } });
    if (action === 'landing') initial = sourceState({ ...initial, focusLandingPrompt: {
      sessionId: 'land-1', taskId: 'task-1', completedAt: NOW - 1, status: 'pending' } });
    if (action === 'quick') initial = sourceState({ ...initial, quickStartDecision: {
      sessionId: 'quick-1', taskId: 'task-1', completedAt: NOW - 1, elapsedMs: 120_000, status: 'pending', resolvedAt: null } });
    const h = harness({ initial }), { publisher } = growthPublisher(h, 'level');
    const config = {
      step: [app.createCompleteWorkStepWorkflow, publisher.completeStep, { taskId: 'task-1', stepId: 'step-1' }],
      landing: [app.createResolveFocusLandingWorkflow, publisher.resolveLanding, { sessionId: 'land-1', action: 'skip', progressMade: true }],
      quick: [app.createResolveQuickStartWorkflow, publisher.resolveQuickStart, { sessionId: 'quick-1', action: 'done', progressMade: true }],
      shutdown: [app.createAcceptHealthyShutdownWorkflow, publisher.healthyShutdown, { dayKey: localDayKey(NOW) }],
      break: [app.createStartBreakSessionWorkflow, publisher.startBreak, { minutes: 5, userInitiated: true }]
    }[action];
    const [factory, publish, input] = config;
    const command = factory({ ...h.ports, sessionClock: { now: () => NOW }, renewExpiry: () => null, publish });
    assert.equal(command.execute(input).ok, true); assert.equal(h.commits(), 1);
    assert.equal(h.messages.length, 3); assert.equal(h.publisher.readRevision(), 1);
    assert.equal(h.message('popover').delta.level, h.state().level);
    assert.equal(h.message('popover').delta.foodTickets, h.state().pet.foodTickets);
    assert.equal(h.message('pet').foodTickets, h.state().pet.foodTickets);
    assert.equal(h.message('pet').contextRevision, h.message('quick').revision);
  });
}
test('task undo publishes restored wallet/feed even if derived timeline retraction fails', () => {
  const h = harness({ initial: taskState({ level: 2 }) });
  const undo = createTaskUndo({ ...h.ports, timelineRecorder: { recordTaskCompletionUndone() { throw Error('history-unavailable'); } },
    publishChange: h.publish, reportEffectError() {} });
  const done = app.createCompleteWorkItemWorkflow({ ...h.ports, undo: undo.registry }).execute({ taskId: 'task-1' });
  assert.equal(h.state().pet.foodTickets, 9);
  assert.equal(undo.undoComplete(done.undo.token).ok, true);
  assert.equal(h.state().pet.foodTickets, 6); assert.equal(h.state().level, 2);
  assert.equal(h.message('popover').delta.foodTickets, 6); assert.equal(h.message('pet').foodTickets, 6);
  assert.equal(h.messages.length, 3);
});
test('task-only updates preserve pending identity but publish changed edit eligibility', () => {
  const initial = taskState();
  initial.focusLandingPrompt = { sessionId: 'original-session', taskId: 'task-1', completedAt: NOW - 1000, status: 'pending' };
  const h = harness({ initial }), before = h.sample(); assert.equal(before.focusLandingPrompt.taskEditable, true);
  app.createCompleteWorkItemWorkflow({ ...h.ports, publish: () => h.publish({ tasks: true }) }).execute({ taskId: 'task-1' });
  const prompt = h.message('popover').delta.focusLandingPrompt;
  assert.equal(prompt.sessionId, 'original-session'); assert.equal(prompt.taskId, 'task-1'); assert.equal(prompt.taskEditable, false);
});
for (const failedEffect of ['hydration', 'dnd', 'notifications', 'visibility', 'shortcut', 'sensory']) {
  test(`settings publication preserves committed cleanup after ${failedEffect} effect failure`, () => {
    const h = harness(), called = [];
    const port = name => () => { called.push(name); if (name === failedEffect) throw Error(name); };
    const publish = createPreferencesPublisher({ refreshHydration: port('hydration'), setDnd: port('dnd'),
      closeNotifications: port('notifications'), activateScheduled: port('scheduled'), checkBoundaries: port('boundaries'),
      setPetVisible: port('visibility'), syncActivity: port('activity'), rebindShortcut: port('shortcut'),
      setQuickPanelEnabled: port('quick'), refreshBoundaryWatcher: port('watcher'), updateSensory: port('sensory'),
      publishImpulseSensory: port('impulse'), publishChange: h.publish, reportEffectError() {} });
    publish({ changedKeys: ['dnd', 'petEnabled', 'quickPanelShortcut', 'motionMode'],
      settings: { dnd: true, petEnabled: false, quickPanelShortcut: 'auto' }, careChanged: true });
    assert.equal(h.messages.length, 3); assert.equal(h.message('popover').dirty.pet, true);
    assert.equal(h.message('pet').contextRevision, 1); assert.equal(called.includes('impulse'), true);
  });
}
test('same-value disabled preferences clean stale meal advice and refresh pet without a changed settings key', () => {
  const initial = sourceState();
  initial.pet.care.decision = { id: `${NOW}:0`, expiresAt: NOW + 5000, slot: null };
  initial.pet.care.plan = { foodId: 'berry', reactionIndex: 0, expiresAt: NOW + 5000, slot: null };
  initial.pet.care.nextMealAt = NOW + 1000;
  const h = harness({ initial });
  const result = app.createUpdatePreferencesWorkflow({ ...h.ports, publish: fact => {
    assert.deepEqual(fact.changedKeys, []); assert.equal(fact.careChanged, true);
    h.publish({ settings: true, pet: fact.careChanged });
  } }).execute({ patch: { aiPetMealsEnabled: false } });
  assert.equal(result.ok, true); assert.equal(h.commits(), 1); assert.equal(h.messages.length, 3);
  assert.equal(h.state().pet.care.plan, null); assert.equal(h.state().pet.care.decision, null);
  assert.equal(h.state().pet.foodTickets, 6); assert.equal(h.state().pet.satiation, 65);
});
