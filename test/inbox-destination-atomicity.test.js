'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, inboxState, harness } = require('../test-support/inbox-destination-fixture');
const { classifyInboxDraft } = require('../src/application/workflows/classify-inbox-draft');

for (const category of [null, 'unclassified', 'task', 'routine', 'log', 'state', 'feeling', 'note']) {
  for (const action of ['promote', 'next-step', 'schedule', 'someday', 'feeling']) {
    test(`atomic destination matrix: ${category} → ${action}`, () => {
      let clockCalls = 0;
      const h = harness(category, { clock: { now: () => NOW + clockCalls++ } });
      const expected = action === 'feeling' ? 'feeling' : 'task';
      const result = h.execute(action), { state, commits } = h.repo.inspect();
      assert.equal(result.ok, true);
      assert.equal(commits, 1);
      assert.equal(clockCalls, 1, 'one command time drives the business transition');
      assert.deepEqual(state.impulses[0].classification, { category: expected, routineKind: null, level: null });
      assert.deepEqual(state.impulses[0].resolution, { action, category: expected, at: NOW,
        targetId: action === 'feeling' ? result.id : result.task.id });
      assert.equal(state.impulses[0].text, h.initial.impulses[0].text);
      assert.equal(state.impulses[0].createdAt, NOW - HOUR);
      assert.deepEqual(state.impulses[1], h.initial.impulses[1]);
      assert.deepEqual(state.energySignals, [h.initial.energySignals[1]]);
      for (const path of ['energyCheckIn', 'energySelfReports', 'energyProfile', 'routines', 'routineLog']) {
        assert.deepEqual(state[path], h.initial[path], `${path} stays untouched`);
      }
      if (action === 'feeling') assert.equal(state.moodNotes[0].at, NOW - HOUR);
      else assert.equal(result.task.createdAt, NOW);
      assert.equal(h.facts.length, 1);
      assert.equal(h.execute(action).reason, 'impulse-not-found');
      assert.deepEqual(h.repo.inspect(), { state, commits: 1 });
      assert.equal(h.facts.length, 1, 'a duplicate never publishes again');
    });
  }
}

test('private classification draft withdraws only exact-source signals after a successful non-state label', () => {
  const state = inboxState('state');
  state.energySignals.push({ ...state.energySignals[0], id: 'second-source' },
    { ...state.energySignals[0], id: 'different-kind', source: 'test-only-non-impulse' });
  // This domain-only sentinel intentionally is not a persisted schema extension.
  const before = structuredClone(state);
  assert.equal(classifyInboxDraft(state, { id: 'source', category: 'state', level: 35 }).ok, true);
  assert.deepEqual(state, before);
  assert.equal(classifyInboxDraft(state, { id: 'missing', category: 'task' }).ok, false);
  assert.equal(classifyInboxDraft(state, { id: 'source', category: 'invalid' }).ok, false);
  assert.deepEqual(state, before);
  assert.equal(classifyInboxDraft(state, { id: 'source', category: 'task', routineKind: 'meal', level: 35 }).ok, true);
  assert.deepEqual(state.impulses[0].classification, { category: 'task', routineKind: null, level: null });
  assert.deepEqual(state.energySignals, [before.energySignals[1], before.energySignals[3]]);
  assert.deepEqual(state.energyCheckIn, before.energyCheckIn);
  assert.deepEqual(state.energySelfReports, before.energySelfReports);
});

for (const action of ['promote', 'next-step', 'schedule', 'someday', 'feeling']) {
  test(`direct ${action} overrides an AI suggestion and removes every matching source signal`, () => {
    const initial = inboxState(null);
    initial.impulses[0].triage = { category: 'state', title: null, routineKind: null, level: 35,
      confidence: 90, reason: 'Synthetic state suggestion', at: NOW - HOUR };
    initial.energySignals.push({ ...initial.energySignals[0], id: 'second-source' });
    const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
    const h = harness(null, {}, { initialState: normalizePersistedState(initial, { now: NOW }) });
    assert.equal(h.execute(action).ok, true);
    const state = h.repo.snapshot();
    assert.deepEqual(state.impulses[0].classification,
      { category: action === 'feeling' ? 'feeling' : 'task', routineKind: null, level: null });
    assert.deepEqual(state.energySignals, [h.initial.energySignals.find(signal => signal.referenceId === 'other')]);
    assert.deepEqual(state.energySelfReports, h.initial.energySelfReports);
  });
}

test('colliding mood target rejects the whole draft and preserves all existing notes', () => {
  const initial = inboxState('state');
  initial.moodNotes = [{ id: 'existing-mood', at: NOW - HOUR, text: 'Synthetic existing note' }];
  const h = harness('state', { idFactory: () => 'existing-mood' }, { initialState: initial });
  assert.equal(h.execute('feeling').reason, 'mood-note-conflict');
  assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
  assert.deepEqual(h.facts, []);
});

for (const [name, action, overrides, error] of [
  ['next-step invalid target', 'next-step', { idFactory: () => '' }, /unique task identity/],
  ['schedule throw', 'schedule', { nextWorkStart() { throw new Error('Synthetic schedule failure'); } }, /Synthetic schedule/],
  ['task policy throw', 'promote', { inferEnergy() { throw new Error('Synthetic energy failure'); } }, /Synthetic energy/],
  ['invalid mood target', 'feeling', { idFactory: () => '' }]
]) test(`atomic destination rollback: ${name}`, () => {
  const h = harness('state', overrides);
  if (error) assert.throws(() => h.execute(action), error);
  else assert.equal(h.execute(action).ok, false);
  assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
  assert.deepEqual(h.facts, []);
});

test('stale requested revision never classifies, allocates a target or publishes', () => {
  const h = harness('state', { idFactory() { assert.fail('stale command allocated an ID'); } });
  assert.equal(h.execute('promote', { expectedRevision: 1 }).reason, 'state-revision-conflict');
  assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
  assert.deepEqual(h.facts, []);
});

for (const action of ['promote', 'feeling']) {
  test(`late CAS conflict rolls back classification, source signal and ${action} target`, () => {
    const h = harness('state', { idFactory: prefix => { h.repo.advanceRevision(); return `${prefix}-1`; } });
    assert.equal(h.execute(action).reason, 'state-revision-conflict');
    assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
    assert.deepEqual(h.facts, []);
  });
  test(`repository refusal rolls back the complete ${action} candidate without effects`, () => {
    const h = harness('state', {}, { beforeCommit(candidate) {
      assert.equal(candidate.impulses[0].classification.category, action === 'feeling' ? 'feeling' : 'task');
      assert.deepEqual(candidate.energySignals.map(value => value.referenceId), ['other']);
      throw new Error('Synthetic repository failure');
    } });
    assert.throws(() => h.execute(action), /Synthetic repository failure/);
    assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
    assert.deepEqual(h.facts, []);
  });
  test(`post-commit ${action} effect failure retains business success and duplicate protection`, () => {
    const reports = [];
    const h = harness('state', { publish() { throw new Error('Synthetic closed surface'); },
      reportEffectError: error => reports.push(error.message) });
    assert.equal(h.execute(action).ok, true);
    assert.equal(h.repo.inspect().commits, 1);
    assert.equal(h.repo.snapshot().impulses[0].classification.category, action === 'feeling' ? 'feeling' : 'task');
    assert.deepEqual(h.repo.snapshot().energySignals.map(value => value.referenceId), ['other']);
    assert.deepEqual(reports, ['Synthetic closed surface']);
    assert.equal(h.execute(action).ok, false);
    assert.equal(h.repo.inspect().commits, 1);
  });
}
