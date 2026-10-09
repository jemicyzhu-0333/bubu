import test from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorPlayback, resolveMirrorBodyPose, ENTER_MS, EXIT_MS } from '../src/surfaces/pet/mirror-playback.mjs';
import { createActionPlayback } from '../src/surfaces/pet/action-playback.mjs';
import { createSessionActivityController } from '../src/core/session-activity.mjs';
import { MIRROR_ACTIVITIES, MIRROR_ROTATIONS, SESSION_ACTIVITIES } from '../src/content/session-activities.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { PET_FORMS } from '../src/capabilities/companion/form-registry.mjs';
import { EXPRESSIONS } from '../src/content/expressions.mjs';
import { createExpressionRegistry, sampleExpressionPose } from '../src/core/pet-expression.mjs';

const music = MIRROR_ACTIVITIES['mirror-music'];
const ai = MIRROR_ACTIVITIES['mirror-ai'];
const content = { PET_ACTIONS, SESSION_ACTIVITIES, MIRROR_ACTIVITIES };
const input = (action, now, options = {}) => ({ action, now, progress: action ? (now % action.durationMs) / action.durationMs : 0,
  formId: 'dango', ...options });

test('mirror enter happens once across category refreshes, loop seams and delayed samples for both forms', () => {
  for (const formId of ['dango', 'usagi']) for (const action of [music, ai]) {
    const playback = createMirrorPlayback();
    for (const now of [0, ENTER_MS - 1, ENTER_MS, action.durationMs - 1, action.durationMs,
      action.durationMs + 1, 3 * action.durationMs + 137, 1000 * action.durationMs + 137]) {
      const result = playback.sample(input(action, now, { formId }));
      assert.equal(result.action.id, action.id);
      assert.equal(result.action.durationMs, action.durationMs);
      assert.equal(result.action.mirrorPresentation.phase, now < ENTER_MS ? 'enter' : 'loop');
      assert.equal(result.action.mirrorPresentation.loopProgress, (now % action.durationMs) / action.durationMs);
      assert.equal(result.action.mirrorPresentation.elapsedMs, now);
      assert.equal(result.action.mirrorPresentation.static, false);
    }
    assert.equal(action.mirrorPresentation, undefined, 'content records are not mutated');
  }
});

test('category null settles once, keeps the last loop pose, and cannot replay after completion', () => {
  const playback = createMirrorPlayback();
  playback.sample(input(music, 0));
  const before = playback.sample(input(music, 4567));
  const first = playback.sample(input(null, 4600));
  assert.equal(first.action.mirrorPresentation.phase, 'exit');
  assert.equal(first.action.mirrorPresentation.progress, 0);
  assert.equal(first.progress, before.progress);
  assert.equal(first.action.propOpacity, 1);
  const middle = playback.sample(input(null, 4600 + EXIT_MS / 2));
  assert.equal(middle.action.propOpacity, .5);
  assert.equal(middle.progress, before.progress);
  assert.equal(playback.sample(input(null, 4600 + EXIT_MS)).action, null);
  assert.equal(playback.sample(input(null, 4600 + EXIT_MS * 3)).action, null);
  assert.equal(playback.snapshot(), null);
});

test('early exit never increases visible intensity and a superseding category discards old exit', () => {
  const playback = createMirrorPlayback();
  playback.sample(input(music, 0));
  const entering = playback.sample(input(music, ENTER_MS / 4));
  const ending = playback.sample(input(null, ENTER_MS / 4 + 1));
  assert.equal(ending.action.propOpacity, entering.action.propOpacity);
  const changed = playback.sample(input(ai, ENTER_MS / 4 + 2));
  assert.equal(changed.action.id, 'mirror-ai');
  assert.equal(changed.action.mirrorPresentation.phase, 'enter');
  playback.sample(input(ai, 1500));
  const stopped = playback.sample(input(null, 1600));
  assert.equal(stopped.action.id, 'mirror-ai');
});

test('manual feedback records the latest context without replaying entry or queueing an exit', () => {
  const playback = createMirrorPlayback();
  playback.sample(input(music, 0));
  assert.equal(playback.sample(input(music, 200, { blocked: true })).action, null);
  assert.equal(playback.sample(input(ai, 300, { blocked: true })).action, null);
  const resumed = playback.sample(input(ai, 400));
  assert.equal(resumed.action.mirrorPresentation.phase, 'loop');
  playback.sample(input(ai, 500, { blocked: true }));
  assert.equal(playback.sample(input(null, 600)).action, null);
  assert.equal(playback.sample(input(null, 2000)).action, null);
});

test('focus, rest, coding and previews win immediately without changing their identity', () => {
  for (const replacement of [SESSION_ACTIVITIES['focus-read'], SESSION_ACTIVITIES['rest-tea'], MIRROR_ACTIVITIES['mirror-coding']]) {
    const playback = createMirrorPlayback();
    playback.sample(input(ai, 0)); playback.sample(input(ai, 1000));
    playback.sample(input(null, 1100));
    const result = playback.sample(input(replacement, 1200));
    assert.strictEqual(result.action, replacement);
    assert.equal(playback.sample(input(null, 1300)).action, null);
  }
});

test('hidden reset, form switch and calm policy discard settling and do not replay setup', () => {
  for (const reset of ['hidden', 'form', 'calm']) {
    const playback = createMirrorPlayback();
    playback.sample(input(ai, 0)); playback.sample(input(ai, 1000));
    playback.sample(input(null, 1100));
    if (reset === 'hidden') playback.reset();
    const options = reset === 'form' ? { formId: 'usagi' } : reset === 'calm' ? { calmVisual: true } : {};
    assert.equal(playback.sample(input(null, 1200, options)).action, null);
    assert.equal(playback.sample(input(null, 1250, options)).action, null);
  }
  const playback = createMirrorPlayback();
  playback.sample(input(ai, 0)); playback.reset();
  assert.equal(playback.sample(input(ai, 200)).action.mirrorPresentation.phase, 'loop');
  assert.equal(playback.sample(input(ai, 300, { formId: 'usagi' })).action.mirrorPresentation.phase, 'loop');
  const a = playback.sample(input(ai, 400, { formId: 'usagi', calmVisual: true }));
  const b = playback.sample(input(ai, 8000, { formId: 'usagi', calmVisual: true }));
  assert.deepEqual(a, b);
  assert.equal(a.progress, .5);
  assert.equal(a.action.mirrorPresentation.static, true);
  assert.equal(playback.sample(input(ai, 8100, { formId: 'usagi' })).action.mirrorPresentation.phase, 'loop');
});

test('action selection still owns manual/preview precedence and coding calm progress', () => {
  const playback = createActionPlayback();
  const controller = createSessionActivityController({ activities: MIRROR_ACTIVITIES, rotations: MIRROR_ROTATIONS, clock: { now: () => 0 } });
  controller.setMode('mirror-ai', 0);
  const call = (now, extra = {}) => playback.resolve({ content, form: PET_FORMS.dango,
    sessionSnapshot: controller.snapshot(now), now, ...extra });
  assert.equal(call(0).actionConfig.mirrorPresentation.phase, 'enter');
  assert.equal(call(100, { egg: { id: 'wave', duration: 5000 } }).actionConfig.id, 'wave');
  assert.equal(playback.snapshot(), null);
  assert.equal(call(200).actionConfig.mirrorPresentation.phase, 'loop');
  assert.equal(call(300, { preview: { category: 'action', id: 'dance' } }).actionConfig.id, 'dance');
  controller.setMode('mirror-coding', 400);
  assert.equal(call(7000, { calmVisual: true }).actionT, .5);
});

test('mirror base faces keep their IDs while generic enter and beat body tracks stay neutral', () => {
  const registry = createExpressionRegistry(EXPRESSIONS);
  for (const sourceAction of [music, ai]) {
    const action = { ...sourceAction, mirrorPresentation: { phase: 'enter', progress: 0, static: false } };
    for (const elapsed of [0, 100, 240, 600, 1300, 6000]) {
      const original = sampleExpressionPose(registry, action.expression, elapsed);
      const result = resolveMirrorBodyPose(original.body, { action, expressionId: action.expression, source: 'base' });
      assert.deepEqual(result, { tone: original.body.tone, x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });
      assert.equal(action.expression, sourceAction.expression);
      assert.deepEqual(original, sampleExpressionPose(registry, action.expression, elapsed), 'original pose/face is unmodified');
      for (const source of ['interaction', 'essential', 'input-safe', 'cue', 'session']) {
        assert.strictEqual(resolveMirrorBodyPose(original.body, { action, expressionId: action.expression, source }), original.body);
      }
      assert.strictEqual(resolveMirrorBodyPose(original.body, { action, expressionId: 'life.sleep', source: 'base' }), original.body);
      assert.strictEqual(resolveMirrorBodyPose(original.body, { action: sourceAction, expressionId: action.expression }), original.body);
    }
  }
  const happy = sampleExpressionPose(registry, 'react.happy', 0);
  assert.equal(happy.body.y, 3, 'ordinary happy feedback keeps its original enter');
  assert.strictEqual(resolveMirrorBodyPose(happy.body, { action: PET_ACTIONS['high-five'], expressionId: 'react.happy' }), happy.body);
  assert.strictEqual(resolveMirrorBodyPose(happy.body, { expressionId: 'react.happy' }), happy.body);
});
