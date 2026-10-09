'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const work = require('../src/capabilities/work');
const progress = require('../src/capabilities/progress');
const attention = require('../src/capabilities/attention');
const companion = require('../src/capabilities/companion');
const { createPowerHost } = require('../src/platform/electron');
const { createSittingReminderTimer } = require('../src/bootstrap');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { createPetRenderer } = require('../src/surfaces/pet/renderer.mjs');
const { createPetFrameContext } = require('../src/surfaces/pet/frame-context.mjs');

const NOW = new Date(2026, 8, 12, 12).getTime();
const rule = overrides => ({
  frequency: 'daily', interval: 1, weekdays: null,
  strategy: 'fixed', anchorDate: '2026-09-01', ...overrides
});

test('level-up feedback presents celebration without minting food when notifications fail', () => {
  const reward = Object.freeze({ recorded: true, leveledUp: true, level: 2, levelUpFood: 'cake' });
  const expressions = [];
  const foods = [];
  const errors = [];
  companion.levelUpFeedback.presentLevelUp(reward, {
    notify: () => { throw new Error('notification unavailable'); },
    presentExpression: (...args) => expressions.push(args),
    publishFoodDrop: food => foods.push(food), reportEffectError: error => errors.push(error)
  });
  assert.equal(expressions[0][0], 'react.celebrate');
  assert.deepEqual(foods, []);
  assert.equal(errors.length, 1);
  companion.levelUpFeedback.presentLevelUp({ leveledUp: false });
});

test('open recurrence catches up to the latest grid day, not a future slot', () => {
  const cases = [
    [rule({ interval: 3 }), '2026-09-01', '2026-09-12', { date: '2026-09-10', skipped: 3 }],
    [rule({ frequency: 'weekly', weekdays: [1, 3, 5] }), '2026-09-02', '2026-09-12', { date: '2026-09-11', skipped: 4 }],
    [rule({ frequency: 'monthly', anchorDate: '2026-01-31' }), '2026-01-31', '2026-03-30', { date: '2026-02-28', skipped: 1 }],
    [rule({ frequency: 'monthly', anchorDate: '2026-01-31' }), '2026-01-31', '2026-03-31', { date: '2026-03-31', skipped: 2 }],
    [rule(), '2026-09-12', '2026-09-01', { date: '2026-09-12', skipped: 0 }]
  ];
  for (const [recurrence, from, today, expected] of cases) {
    assert.deepEqual(work.recurrence.occurrenceDateOnOrBefore(recurrence, from, today), expected);
  }
});

test('weekly catch-up remains bounded across centuries and matches single-step walking', () => {
  const recurrence = rule({ frequency: 'weekly', interval: 3, weekdays: [1, 2, 5] });
  let cursor = '2026-09-01';
  let skipped = 0;
  while (work.recurrence.advanceOnce(recurrence, cursor) <= '2036-09-12') {
    cursor = work.recurrence.advanceOnce(recurrence, cursor);
    skipped += 1;
  }
  assert.deepEqual(work.recurrence.occurrenceDateOnOrBefore(recurrence, '2026-09-01', '2036-09-12'), { date: cursor, skipped });
  assert.ok(work.recurrence.occurrenceDateOnOrBefore(recurrence, '2026-09-01', '9026-09-12').date <= '9026-09-12');
});

test('rolling an old open occurrence preserves identity, checked steps and investment, once', () => {
  const task = { id: 'open', seriesId: 'series', occurrenceDate: '2026-09-01', plannedFor: '2026-09-01',
    focusedMs: 1234, steps: [{ id: 'step', done: true, completionCycle: 1 }] };
  const series = { id: 'series', state: 'active', rule: rule(), openTaskId: 'open', lastOccurrenceDate: '2026-09-01', missedCount: 0 };
  const state = { tasks: [task], recurrenceSeries: [series], xp: 99 };
  const input = { now: NOW, today: '2026-09-12' };
  const options = { createId: () => { throw new Error('must not create an occurrence'); } };
  assert.deepEqual(work.seriesRefresh.refreshSeriesOccurrences(state, input, options).rolledTaskIds, ['open']);
  assert.equal(task.occurrenceDate, '2026-09-12');
  assert.equal(task.focusedMs, 1234);
  assert.equal(task.steps[0].done, true);
  assert.equal(series.missedCount, 10);
  assert.equal(state.xp, 99);
  const once = structuredClone(state);
  assert.deepEqual(work.seriesRefresh.refreshSeriesOccurrences(state, input, options).rolledTaskIds, []);
  assert.deepEqual(state, once);
});

test('sitting clock resets after absence, rejects missing evidence and requires injected time', () => {
  const clock = attention.sittingClock.createSittingClock();
  assert.throws(() => clock.sample({ idleSeconds: 0 }), /timestamp/);
  clock.sample({ now: NOW, idleSeconds: 0 });
  assert.equal(clock.sample({ now: NOW + 60000, idleSeconds: 0 }).sittingMs, 60000);
  assert.equal(clock.sample({ now: NOW + 120000, idleSeconds: 100 }).atKeyboard, false);
  assert.equal(clock.sample({ now: NOW + 600000, idleSeconds: 300 }).rested, true);
  assert.equal(clock.sample({ now: NOW + 620000, idleSeconds: 0 }).sittingMs, 0);
  assert.equal(clock.sample({ now: NOW + 630000, idleSeconds: undefined }).atKeyboard, false);
  clock.restart(NOW);
  clock.noteRested();
  assert.equal(clock.sittingMs(NOW + 60000), 0);
});

test('sitting reminder samples during focus, respects work hours and does not repeat immediately', () => {
  let at = NOW;
  let running = false;
  let working = true;
  let idle = 0;
  let randomCalls = 0;
  const requests = [];
  const reminder = attention.sittingReminder.createSittingReminder({
    now: () => at, idleSeconds: () => idle,
    isSessionRunning: () => running, isWorkTime: () => working,
    getSettings: () => ({ hydrationEvery: 15 }),
    random: () => { randomCalls += 1; return 0.5; },
    remind: request => requests.push(request)
  });
  reminder.sample();
  running = true;
  for (let minute = 0; minute < 16; minute += 1) {
    at += 60000;
    assert.equal(reminder.sample().triggered, false);
  }
  assert.equal(reminder.sample().triggered, false);
  running = false;
  working = false;
  assert.equal(reminder.sample().triggered, false);
  working = true;
  assert.equal(reminder.sample().triggered, true);
  assert.equal(reminder.sample().triggered, false);
  assert.equal(requests.length, 1);
  assert.equal(randomCalls, 1);
  idle = 600;
  at += 3600000;
  reminder.sample();
  idle = 0;
  assert.equal(reminder.sample().triggered, false);
});

test('sitting evidence resets on sleep gaps, clock rollback and idle port failures', () => {
  const clock = attention.sittingClock.createSittingClock();
  clock.sample({ now: NOW, idleSeconds: 0 });
  assert.equal(clock.sample({ now: NOW + 60000, idleSeconds: 0 }).sittingMs, 60000);
  assert.equal(clock.sample({ now: NOW + 3600000, idleSeconds: 0 }).sittingMs, 0);
  assert.equal(clock.sample({ now: NOW, idleSeconds: 0 }).sittingMs, 0);
  let at = NOW;
  let failing = false;
  const reminder = attention.sittingReminder.createSittingReminder({
    sittingClock: clock, now: () => at,
    idleSeconds: () => { if (failing) throw new Error('idle unavailable'); return 0; },
    isSessionRunning: () => false, isWorkTime: () => true,
    getSettings: () => ({ hydrationEvery: 1 }),
    remind: () => { throw new Error('must not remind without continuous evidence'); }
  });
  reminder.sample();
  failing = true;
  at += 30000;
  assert.throws(() => reminder.sample(), /idle unavailable/);
  failing = false;
  at += 30000;
  assert.equal(reminder.sample().triggered, false);
});

test('power idle port fails closed and hydration timer reports sampling failures', () => {
  const monitor = new EventEmitter();
  monitor.getSystemIdleTime = () => 123;
  const host = createPowerHost({ powerMonitor: monitor });
  assert.equal(host.systemIdleSeconds(), 123);
  monitor.getSystemIdleTime = () => NaN;
  assert.throws(() => host.systemIdleSeconds(), /idle/);
  let tick;
  const errors = [];
  createSittingReminderTimer({
    lifecycle: { interval: (name, callback, delay) => {
      assert.equal(name, 'timer:hydration'); assert.equal(delay, 30000); tick = callback;
    } },
    sample: () => { throw new Error('idle unavailable'); },
    onError: error => errors.push(error.message)
  })();
  tick();
  assert.deepEqual(errors, ['idle unavailable']);
});

test('sitting reminder timer runs multiple isolated samplers on one legacy lifecycle interval', () => {
  const intervals = [];
  const calls = [];
  const errors = [];
  const start = createSittingReminderTimer({
    lifecycle: {
      interval: (name, callback, delay) => intervals.push({ name, callback, delay })
    },
    onError: (error, name) => errors.push(`${name}:${error.message}`),
    samplers: [
      { name: 'first', sample: () => calls.push('first') },
      {
        name: 'broken',
        sample: () => { calls.push('broken'); throw new Error('sample failed'); },
        onError: error => { errors.push(`broken:${error.message}`); throw new Error('sink failed'); }
      },
      { name: 'fallback', sample: () => { calls.push('fallback'); throw new Error('fallback failed'); } },
      { name: 'last', sample: () => calls.push('last') }
    ]
  });

  start();
  assert.equal(intervals.length, 1);
  assert.deepEqual({ name: intervals[0].name, delay: intervals[0].delay }, {
    name: 'timer:hydration',
    delay: 30 * 1000
  });

  intervals[0].callback();
  assert.deepEqual(calls, ['first', 'broken', 'fallback', 'last']);
  assert.deepEqual(errors, ['broken:sample failed', 'fallback:fallback failed']);
});

test('hungry expression uses its subdued static and moving presentation', () => {
  const hungry = EXPRESSIONS.find(expression => expression.id === 'react.hungry');
  assert.equal(hungry.face.mouth, 'wavy');
  assert.equal(hungry.static.face.mouth, 'wavy');
  assert.equal(hungry.face.eyeOffsetY, -1);
  assert.deepEqual(hungry.loops, [{ primitive: 'breath', amplitude: 1, periodMs: 2600 }]);
});

test('surprised(拖拽/意外)走呆萌惊讶而不是机械大瞓眼', () => {
  // 防回归：拖拽态映射到 react.surprised，旧版用 eyes:'wide'（几乎实心的大方块眼）
  // + 大 O 嘴，读起来“机械/像故障”。现在固定为圆瞳高光眼、小圆 O 嘴、微微上抬看向
  // 被捏的点，并保留注视（拖动时看向拖动方向）。
  const surprised = EXPRESSIONS.find(expression => expression.id === 'react.surprised');
  assert.equal(surprised.face.eyes, 'surprised');
  assert.equal(surprised.face.mouth, 'surprised');
  assert.equal(surprised.face.eyeOffsetY, -1);
  assert.equal(surprised.face.gaze.enabled, true);
  assert.equal(surprised.static.face.eyes, 'surprised');
});

test('page particles draw through the production scene pipeline without stopping subsequent frames', async () => {
  const { RasterBrowserImage } = require('../test-support/raster-browser-image.js');
  globalThis.Image = RasterBrowserImage;
  await require('../src/capabilities/companion/presentation/dango-raster-production.mjs').default.ready({ all: true });
  delete globalThis.Image;
  const calls = [];
  const context = {
    globalAlpha: 1, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, transform() {},
    drawImage: (image, ...rect) => calls.push({ image, rect }),
    fillRect() { assert.fail('production Dango particles must use their generated sprite'); }
  };
  const state = {
    sceneParticles: [{ type: 'page', x: 50, y: 40, vx: 0, vy: 1, life: 100, baseLife: 100, color: '#ffffff' }],
    currentSkin: 'pink', stimulationMode: 'balanced', animDt: 16, sceneSpawnedTotal: 0
  };
  const renderer = createPetRenderer({
    pctx: {}, octx: {}, sctx: context,
    reducedMotion: () => false, getTimePeriod: () => 'unknown', legacyFrameMs: 1000 / 60,
    petSceneLayer: { drawBackdrop() {}, limitParticles: particles => particles },
    emitPetRate: () => 0
  });
  const frame = createPetFrameContext({ state, now: 0, dt: 16, wallNow: NOW, policy: { calmVisual: false } });
  const first = renderer.executeFrame(frame, 'drawScene');
  assert.equal(frame.state.sceneParticles[0].y, 40);
  renderer.executeFrame(createPetFrameContext({
    state: { ...state, ...first.updates }, now: 16, dt: 16, wallNow: NOW, policy: { calmVisual: false }
  }), 'drawScene');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.image.src.includes('/effects/page.png')));
  assert.deepEqual(calls[0].rect, calls[1].rect);
});
