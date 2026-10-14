import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameThrottle } from '../src/surfaces/pet/frame-throttle.mjs';

function run(hz, fps, { seconds = 10, jitter = 0, seed = 1 } = {}) {
  const t = createFrameThrottle(); let r = seed, draws = 0;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648 - .5) * 2;
  for (let i = 0; i < hz * seconds; i++) if (t.shouldDraw(i * 1000 / hz + jitter * rand(), fps)) draws++;
  return draws / seconds;
}
for (const hz of [60, 90, 120, 144]) for (const fps of [6, 30, 60]) {
  const want = Math.min(hz, fps);
  test(`${hz} Hz display, ${fps} fps cap keeps the remainder (~${want} fps)`, () => {
    assert.ok(Math.abs(run(hz, fps) - want) <= .2, `${run(hz, fps)}`);
    assert.ok(Math.abs(run(hz, fps, { jitter: 1.5 }) - want) <= .5, 'jitter');
  });
}
test('first frame keeps the old start: nothing before one interval', () => { const t = createFrameThrottle(); assert.equal(t.shouldDraw(0, 30), false); assert.equal(t.shouldDraw(34, 30), true); });
test('144 Hz at 60 fps is not 48 fps (pre-existing bug)', () => assert.ok(run(144, 60) > 59));
test('re-anchors after a pause: no catch-up burst', () => {
  const t = createFrameThrottle(); t.shouldDraw(40, 30);
  t.reanchor();
  assert.equal(t.shouldDraw(10000, 30), true);
  assert.equal(t.shouldDraw(10000 + 1000 / 60, 30), false);
});
test('stall re-anchors instead of drawing every vsync to catch up', () => {
  const t = createFrameThrottle(); t.shouldDraw(40, 30);
  assert.equal(t.shouldDraw(500, 30), true);
  assert.equal(t.shouldDraw(500 + 1000 / 144, 30), false);
});
