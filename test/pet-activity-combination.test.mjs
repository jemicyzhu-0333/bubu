import test from 'node:test';
import assert from 'node:assert/strict';
import { activityCategories, primaryActivityCategory, applyActivityMirrorSync,
  activityCombinationBlocked, planActivityCombination, attachActivityCombination } from '../src/surfaces/pet/activity-combination.mjs';
import { createActionPlayback } from '../src/surfaces/pet/action-playback.mjs';
import { forms } from '../src/capabilities/companion/index.mjs';
import { MIRROR_ACTIVITIES, SESSION_ACTIVITIES } from '../src/content/session-activities.mjs';

const concurrent = (music = false, coding = false, ai = false) => ({ v: 1, music, coding, ai });
const idle = { state: 'idle', sessionState: 'idle' };
const focused = { state: 'focused', sessionState: 'focused' };
const combo = concurrent(true, true, true);
const ai = MIRROR_ACTIVITIES['mirror-ai'];
const focusActions = Object.values(SESSION_ACTIVITIES).filter(action => action.state === 'focused');

function input(activity = ai, extra = {}) {
  return { activity, concurrent: combo, state: idle, source: 'base', expressionId: activity?.expression, ...extra };
}

test('authoritative versioned categories select one primary while legacy-only senders still work', () => {
  let state = { activityMirror: null, activityMirrorConcurrent: null };
  state = applyActivityMirrorSync(state, { activityMirror: 'music' });
  assert.equal(state.activityMirror, 'music');
  assert.equal(state.activityMirrorConcurrent, null);
  state = applyActivityMirrorSync(state, { activityMirror: 'music', activityMirrorConcurrent: combo });
  assert.equal(state.activityMirror, 'ai');
  assert.deepEqual(state.activityMirrorConcurrent, combo);
  assert.ok(Object.isFrozen(state.activityMirrorConcurrent));
  assert.notStrictEqual(state.activityMirrorConcurrent, combo);
  state = applyActivityMirrorSync(state, { activityMirror: 'ai', activityMirrorConcurrent: concurrent(true, true) });
  assert.equal(state.activityMirror, 'coding', 'expired AI cannot linger through old legacy priority');
  assert.deepEqual(applyActivityMirrorSync(state, {}), state, 'unrelated sync keeps the authoritative current projection');
  for (const malformed of [null, {}, [], { ...combo, v: 2 }, { ...combo, song: 'private' }, { ...combo, music: 1 }]) {
    const cleared = applyActivityMirrorSync(state, { activityMirror: 'ai', activityMirrorConcurrent: malformed });
    assert.equal(cleared.activityMirror, null, JSON.stringify(malformed));
    assert.deepEqual(cleared.activityMirrorConcurrent, concurrent());
  }
  assert.equal(applyActivityMirrorSync(state, { activityMirror: 'music' }).activityMirrorConcurrent, null);
});

test('all category combinations have one primary and at most two deduplicated quiet extras', () => {
  for (let mask = 0; mask < 8; mask++) {
    const signals = concurrent(Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4));
    const category = primaryActivityCategory(signals);
    const action = category && MIRROR_ACTIVITIES[`mirror-${category}`];
    const plan = planActivityCombination(input(action, { concurrent: signals }));
    if (!signals.music && !signals.ai) { assert.equal(plan, null); continue; }
    assert.equal(plan.primary, action.id);
    assert.deepEqual(plan.extras, [...(signals.music ? ['headphones'] : []), ...(signals.ai ? ['robot'] : [])]);
    assert.ok(plan.extras.length <= 2);
    assert.equal(new Set(plan.extras).size, plan.extras.length);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.categories) && Object.isFrozen(plan.extras));
    assert.equal(action.activityCombination, undefined);
  }
  assert.equal(planActivityCombination(input(MIRROR_ACTIVITIES['mirror-music'])), null, 'stale primary cannot acquire current extras');
  assert.deepEqual(activityCategories('music'), concurrent(true));
});

test('all six selected focus actions keep their identity, prop, hands and story with only headphone/robot extras', () => {
  assert.equal(focusActions.length, 6);
  for (const action of focusActions) {
    const decorated = attachActivityCombination(action, input(action, { state: focused, source: 'session' }));
    assert.equal(decorated.id, action.id);
    assert.deepEqual(decorated.activityCombination.extras, ['headphones', 'robot']);
    assert.equal(decorated.activityCombination.primary, action.id);
    const { activityCombination: _plan, ...original } = decorated;
    assert.deepEqual(original, action, action.id);
    assert.ok(!decorated.activityCombination.extras.includes('computer'));
  }
});

test('sleep/rest, pause, interaction, drag, menus and external speech suppress extras without rewriting focus', () => {
  const action = focusActions[0];
  const variations = [
    { state: { ...focused, state: 'sleeping' } }, { state: { ...focused, sessionState: 'resting' } },
    ...['sessionPaused', 'dragging', 'commandMenuOpen', 'foodMenuOpen', 'devtoolsOpen', 'screenLocked']
      .map(key => ({ state: { ...focused, [key]: true } })),
    { state: { ...focused, dockedEdge: 'bottom' } }, { state: { ...focused, currentEgg: {} } },
    { externalSpeech: true }, { transientUi: true },
    ...['input-safe', 'interaction', 'essential', 'cue'].map(source => ({ source })),
    ...['life.sleep', 'life.drowsy', 'work.pause', 'react.hungry'].map(expressionId => ({ expressionId }))
  ];
  for (const variation of variations) {
    const options = input(action, { state: focused, source: 'session', ...variation });
    assert.equal(activityCombinationBlocked(options), true, JSON.stringify(variation));
    assert.strictEqual(attachActivityCombination(action, options), action);
  }
  const decorated = attachActivityCombination(action, input(action, { state: focused, source: 'session' }));
  assert.equal(attachActivityCombination(decorated, input(action, { state: focused, source: 'session', blocked: true })).activityCombination, undefined);
});

test('production action sampling preserves each focus story exactly and calm freezes rather than sleeps', () => {
  for (const skin of ['pink', 'usagi']) for (const action of focusActions) for (const calmVisual of [false, true]) {
    const options = { content: { SESSION_ACTIVITIES, MIRROR_ACTIVITIES }, form: forms.resolvePetForm(skin),
      sessionSnapshot: { activity: action, progress: .35 }, now: 5000, calmVisual };
    const original = createActionPlayback().resolve(options);
    const decorated = createActionPlayback().resolve({ ...options,
      combinationContext: input(action, { state: focused, source: 'session' }) });
    const { activityCombination, ...primary } = decorated.actionConfig;
    assert.deepEqual(primary, original.actionConfig, `${skin}/${action.id}/${calmVisual}`);
    assert.equal(decorated.actionT, original.actionT);
    assert.equal(activityCombination.static, calmVisual);
    assert.deepEqual(activityCombination.extras, ['headphones', 'robot']);
    assert.notEqual(decorated.actionConfig.state, 'sleeping');
  }
});

test('overlap updates do not restart primary; blocked/removed signals cannot return as stale extras', () => {
  for (const skin of ['pink', 'usagi']) {
    const playback = createActionPlayback();
    const call = (now, signals, options = {}) => playback.resolve({ form: forms.resolvePetForm(skin),
      sessionSnapshot: { activity: ai, progress: now / ai.durationMs }, now,
      combinationContext: input(ai, { concurrent: signals }), ...options });
    assert.equal(call(0, concurrent(false, false, true)).actionConfig.mirrorPresentation.phase, 'enter');
    const added = call(1000, concurrent(true, false, true));
    assert.equal(added.actionConfig.mirrorPresentation.phase, 'loop');
    assert.deepEqual(added.actionConfig.activityCombination.extras, ['headphones', 'robot']);
    assert.equal(call(1100, combo, { mirrorBlocked: true }).actionConfig, null);
    const resumed = call(1200, concurrent(false, false, true));
    assert.equal(resumed.actionConfig.mirrorPresentation.phase, 'loop');
    assert.deepEqual(resumed.actionConfig.activityCombination.extras, ['robot']);
    const stopped = playback.resolve({ form: forms.resolvePetForm(skin), now: 1300,
      combinationContext: input(null, { concurrent: concurrent() }) });
    assert.equal(stopped.actionConfig.activityCombination, undefined);
    assert.equal(stopped.actionConfig.mirrorPresentation.phase, 'exit');
    assert.equal(playback.resolve({ form: forms.resolvePetForm(skin), now: 1900 }).actionConfig, null);
  }
});
