'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const guidance = require('../src/capabilities/guidance');

function repository() {
  let state = { strategyFeedback: {} };
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    state: () => structuredClone(state),
    commits: () => commits
  };
}

test('strategy shown and feedback commands own strategyFeedback writes', () => {
  const store = repository();
  const events = [];
  const unitOfWork = createUnitOfWork({ repository: store });
  const shown = guidance.recordStrategyShown.createRecordStrategyShownCommand({
    unitOfWork,
    clock: { now: () => 100 },
    publish: fact => events.push(fact.type)
  });
  const feedback = guidance.recordStrategyFeedback.createRecordStrategyFeedbackCommand({
    unitOfWork,
    clock: { now: () => 200 },
    publish: fact => events.push(fact.type)
  });

  assert.equal(shown.execute({ strategyId: 'focus-start' }).ok, true);
  assert.equal(feedback.execute({ strategyId: 'focus-start', helpful: true }).ok, true);
  assert.deepEqual(events, ['strategy-shown', 'strategy-feedback-recorded']);
  assert.equal(store.commits(), 2);
  assert.equal(store.state().strategyFeedback['focus-start'].helpful, true);
});

test('invalid and stale strategy feedback requests perform no writes', () => {
  const store = repository();
  let published = 0;
  const command = guidance.recordStrategyFeedback.createRecordStrategyFeedbackCommand({
    unitOfWork: createUnitOfWork({ repository: store }),
    clock: { now: () => 300 },
    publish: () => { published += 1; }
  });
  assert.equal(command.execute({ strategyId: 'bad id', helpful: true }).reason, 'strategy-invalid');
  assert.equal(command.execute({ strategyId: 'focus-start', helpful: true, expectedRevision: 3 }).reason, 'state-revision-conflict');
  assert.equal(store.commits(), 0);
  assert.equal(published, 0);
});
