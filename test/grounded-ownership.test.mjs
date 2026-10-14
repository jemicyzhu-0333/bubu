import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationDirector } from '../src/core/pet-presentation.mjs';
import { bodyStateOffset, resolveActionBodyPose } from '../src/surfaces/pet/body-presentation.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';

// Mirrors the renderer: what the real director says won this frame decides.
function frame(director, now, { action, egg, state = 'idle', bob = 2 }) {
  const cur = director.current(now);
  const o = { action, expressionId: cur?.expressionId, source: cur?.source, eventId: cur?.eventId ?? null, actionEventId: egg?.presentationEventId ?? null };
  return { offset: bodyStateOffset({ ...o, state, formId: 'usagi', bob, legacyFrames: 0 }),
    pose: resolveActionBodyPose({ tone: 'normal', x: 2, y: 3, scaleX: 1, scaleY: 1, rotateDeg: 3 }, o) };
}
const setup = () => { let t = 0; const d = createPresentationDirector({ clock: { now: () => t } }); d.setBase({ expressionId: 'life.idle', source: 'base', issuedAt: 0 }); return { d, at: v => (t = v) }; };
const grounded = p => p.offset === 0 && p.pose.x === 0 && p.pose.y === 0 && p.pose.rotateDeg === 0;

for (const id of ['moonwalk', 'paper-return']) {
  const action = PET_ACTIONS[id];
  test(`${id}: auto egg (cue) owns the ground through the real director`, () => {
    const { d } = setup(); const egg = { presentationEventId: 'egg.1' };
    assert.equal(d.presentTransient({ eventId: 'egg.1', expressionId: action.expression, source: 'cue', issuedAt: 0, ttlMs: 8000 }).ok, true);
    for (const t of [0, 16, 1000, 4000]) assert.ok(grounded(frame(d, t, { action, egg })), `t=${t}`);
  });
  test(`${id}: manual egg (interaction) owns the ground`, () => {
    const { d } = setup(); const egg = { presentationEventId: 'egg.2' };
    d.presentTransient({ eventId: 'egg.2', expressionId: action.expression, source: 'interaction', issuedAt: 0, ttlMs: 8000 });
    assert.ok(grounded(frame(d, 500, { action, egg })));
  });
  test(`${id}: interrupted by a higher-priority essential event keeps the essential offset`, () => {
    const { d } = setup(); const egg = { presentationEventId: 'egg.3' };
    d.presentTransient({ eventId: 'egg.3', expressionId: action.expression, source: 'cue', issuedAt: 0, ttlMs: 8000 });
    assert.equal(d.presentTransient({ eventId: 'alert.1', expressionId: 'life.idle', source: 'essential', issuedAt: 100, ttlMs: 3000 }).ok, true);
    const f = frame(d, 200, { action, egg });
    assert.equal(f.offset, 2); assert.notEqual(f.pose.x, 0);
  });
  test(`${id}: a different interaction event does not inherit ownership`, () => {
    const { d } = setup(); const egg = { presentationEventId: 'egg.4' };
    d.presentTransient({ eventId: 'tap.9', expressionId: action.expression, source: 'interaction', issuedAt: 0, ttlMs: 3000 });
    assert.equal(frame(d, 10, { action, egg }).offset, 2);
  });
  test(`${id}: sleep and drag states still win`, () => {
    const { d } = setup(); const egg = { presentationEventId: 'egg.5' };
    d.presentTransient({ eventId: 'egg.5', expressionId: action.expression, source: 'cue', issuedAt: 0, ttlMs: 8000 });
    assert.equal(frame(d, 10, { action, egg, state: 'sleeping' }).offset, 4);
    assert.equal(frame(d, 10, { action, egg, state: 'dragged' }).offset, 0);
  });
  test(`${id}: base preview path unchanged`, () => {
    const { d } = setup(); d.setBase({ expressionId: action.expression, source: 'base', issuedAt: 0 });
    assert.ok(grounded(frame(d, 10, { action })));
  });
}
