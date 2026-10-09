'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, NOW, CAPTURED_AT, TEXT, fixtureState, memoryRepository, destination, deferred } = require('../test-support/inbox-regression-fixture');
for (const action of ['promote', 'feeling']) {
  for (const completionOrder of ['energy-first', 'triage-first']) {
    test(`late fake AI ${completionOrder} after manual ${action} cannot revive a signal or overwrite classification`, async () => {
      const repository = memoryRepository(fixtureState({ classification: null }));
      const energy = deferred(), triage = deferred(), calls = [], effects = [];
      const ports = { unitOfWork: app.createUnitOfWork({ repository }), readSnapshot: repository.snapshot,
        clock: { now: () => NOW }, publish: fact => effects.push(fact) };
      const analysis = app.createAnalyzeImpulseEnergyWorkflow({ ...ports, classify: payload => {
        calls.push(['energy', payload]); return energy.promise;
      } });
      const classification = app.createTriageCaptureWorkflow({ ...ports, triage: payload => {
        calls.push(['triage', payload]); return triage.promise;
      } });
      const fact = { type: 'impulse-captured', impulseId: 'capture', capturedAt: CAPTURED_AT, revision: 0 };
      const pendingEnergy = analysis.handleCaptured(fact), pendingTriage = classification.handleCaptured(fact);
      assert.deepEqual(calls, [['energy', { impulseText: TEXT }], ['triage', { impulseText: TEXT }]]);
      assert.equal(destination(repository, action)().ok, true);
      const committed = repository.snapshot(), revision = repository.revision();
      assert.equal(revision, 1);
      const finishEnergy = () => energy.resolve({ ok: true,
        classification: { direction: 'down', delta: -11, confidence: 99, reason: 'Late synthetic answer' } });
      const finishTriage = () => triage.resolve({ ok: true,
        triage: { category: 'state', confidence: 99, title: null, routineKind: null, level: 20, reason: 'Late synthetic suggestion' } });
      if (completionOrder === 'energy-first') { finishEnergy(); await pendingEnergy; finishTriage(); }
      else { finishTriage(); await pendingTriage; finishEnergy(); }
      const answers = await Promise.all([pendingEnergy, pendingTriage]);
      assert.ok(answers.every(result => result.ok === true && result.changed === false));
      assert.deepEqual(repository.snapshot(), committed, 'neither delayed apply can mutate the committed outcome');
      assert.equal(repository.revision(), revision);
      assert.deepEqual(effects, []);
      assert.deepEqual(committed.impulses.find(item => item.id === 'capture').classification,
        { category: action === 'feeling' ? 'feeling' : 'task', routineKind: null, level: null });
      assert.equal(committed.energySignals.some(item => item.referenceId === 'capture'), false);
      assert.equal(committed.energySignals.some(item => item.referenceId === 'unrelated'), true);
    });
  }
}
