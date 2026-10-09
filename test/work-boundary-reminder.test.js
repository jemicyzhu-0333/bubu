'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBoundaryReminder } = require('../src/bootstrap/work-boundary-reminder');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');
const { taskStartBlockReason } = require('../src/capabilities/work/domain/task-availability');

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(overrides = {}) {
  const state = { now: new Date(2026, 7, 29, 22).getTime(), start: 10, end: 21, last: null,
    settings: { dnd: false, workEndReminder: true, nudgeCharacter: 'cat', nudgeWhitelist: [],
      motionMode: 'balanced', stimulationMode: 'balanced', soundEnabled: false },
    tasks: [{ id: 'a', done: false }], delivery: () => ({ shown: true }), record: null };
  const events = []; const requests = []; const timers = [];
  const lifecycle = createLifecycleRegistry({
    setInterval(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearInterval(timer) { timer.cleared = true; },
    setTimeout() { throw new Error('unexpected timeout'); }, clearTimeout() {}
  });
  const getSettings = () => { events.push('settings'); return { ...state.settings }; };
  const ports = {
    lifecycle, getSettings,
    readDate: () => { events.push('date'); return new Date(state.now); },
    getWorkHours: () => { events.push('hours'); getSettings(); return { start: state.start, end: state.end }; },
    readLastNotifiedDay: () => { events.push('last'); return state.last; },
    readTasks: () => { events.push('tasks'); return state.tasks; },
    activateScheduledTasks: at => { events.push(['activate', at]); },
    materializeDueReviews: at => { events.push(['reviews', at]); },
    taskStartBlockReason,
    startNudgeSequence: request => { requests.push(request); events.push('nudge'); return state.delivery(request); },
    getCurrentTheme: () => { events.push('theme'); return { primary: '#000000' }; },
    recordWorkEndReminder: ({ dayKey }) => {
      events.push(['record', dayKey]);
      if (state.record) return state.record(dayKey);
      state.last = dayKey; return { ok: true, changed: true };
    },
    petTalk: text => { events.push(['talk', text]); },
    ...overrides
  };
  return { state, events, requests, timers, lifecycle, owner: createWorkBoundaryReminder(ports) };
}

test('start registers one named minute interval then checks immediately, preserving replacement', async () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.owner), ['start', 'check']);
  assert.equal(Object.isFrozen(f.owner), true);
  assert.equal(f.owner.start(), undefined);
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 60000);
  assert.deepEqual(f.events.slice(0, 4), ['settings', 'date', ['activate', f.state.now], ['reviews', f.state.now]]);
  await flush();
  assert.equal(f.state.last, '2026-08-29');
  f.owner.start(); await flush();
  assert.equal(f.timers.length, 2); assert.equal(f.timers[0].cleared, true);
  assert.equal(f.lifecycle.size, 1); assert.equal(f.requests.length, 1);
});

test('activation and reviews run before DND and reminder-enabled suppression', async () => {
  for (const settings of [{ dnd: true }, { workEndReminder: false }]) {
    const f = fixture(); Object.assign(f.state.settings, settings);
    await f.owner.check();
    assert.deepEqual(f.events, ['settings', 'date', ['activate', f.state.now], ['reviews', f.state.now]]);
    assert.equal(f.requests.length, 0);
  }
});

test('delivery request and settings rereads retain the original field values and ordering', async () => {
  const f = fixture(); f.state.tasks.push({ id: 'done', done: true });
  await f.owner.check();
  const message = '到点收工了。还有 1 件可行动事项，先给明天留一个轻松落点。';
  assert.deepEqual(f.requests[0], { type: 'rest', message, maxLevel: 2, character: 'cat', whitelist: [],
    themePrimary: '#000000', motionMode: 'balanced', stimulationMode: 'balanced', soundEnabled: false,
    actions: [{ id: 'accept-rest', label: '收工并检查落点', primary: true }, { id: 'defer-5', label: '5 分钟后再提醒', deferMinutes: 5 }],
    context: { kind: 'work-end', dayKey: '2026-08-29' }, priority: 100 });
  assert.deepEqual(f.events.map(event => Array.isArray(event) ? event[0] : event),
    ['settings', 'date', 'activate', 'reviews', 'hours', 'settings', 'last', 'tasks', 'theme', 'nudge', 'settings', 'record', 'talk']);
});

test('midnight belongs to the previous local day only until the next work start', async () => {
  for (const [year, month, day, expected] of [[2026, 7, 30, '2026-08-29'], [2026, 2, 8, '2026-03-07'], [2026, 10, 1, '2026-10-31']]) {
    const f = fixture(); f.state.end = 24; f.state.now = new Date(year, month, day, 0, 5).getTime();
    await f.owner.check(); assert.equal(f.state.last, expected);
    f.state.last = null; f.state.now = new Date(year, month, day, 10).getTime();
    await f.owner.check(); assert.equal(f.requests.length, 1);
  }
});

test('ordinary end boundaries and recorded-day monotonic suppression remain exact', async () => {
  const f = fixture(); f.state.now = new Date(2026, 7, 29, 20, 59).getTime();
  await f.owner.check(); assert.equal(f.requests.length, 0);
  f.state.now = new Date(2026, 7, 29, 21).getTime(); await f.owner.check();
  assert.equal(f.state.last, '2026-08-29');
  await f.owner.check(); assert.equal(f.requests.length, 1);
  f.state.now = new Date(2026, 7, 28, 22).getTime(); await f.owner.check();
  assert.equal(f.requests.length, 1);
});

test('overlapping same-day checks coalesce and unsuccessful delivery releases ownership', async () => {
  const f = fixture(); const pending = deferred(); f.state.delivery = () => pending.promise;
  const first = f.owner.check(); await f.owner.check();
  assert.equal(f.requests.length, 1);
  pending.resolve({ shown: false }); await first;
  assert.equal(f.state.last, null);
  f.state.delivery = () => ({ shown: true }); await f.owner.check();
  assert.equal(f.requests.length, 2); assert.equal(f.state.last, '2026-08-29');
});

test('DND changes during delivery leave the date available for a later retry', async () => {
  const f = fixture(); const pending = deferred(); f.state.delivery = () => pending.promise;
  const check = f.owner.check(); f.state.settings.dnd = true;
  pending.resolve({ shown: true }); await check;
  assert.equal(f.state.last, null);
  f.state.settings.dnd = false; f.state.delivery = () => ({ shown: true });
  await f.owner.check(); assert.equal(f.state.last, '2026-08-29');
});

test('post-delivery freshness still checks only DND, not changed reminder settings or hours', async () => {
  const f = fixture(); const pending = deferred(); f.state.delivery = () => pending.promise;
  const check = f.owner.check(); f.state.settings.workEndReminder = false; f.state.end = 24;
  pending.resolve({ shown: true }); await check;
  assert.equal(f.state.last, '2026-08-29');
});

test('limited delivery and unchanged or rejected records do not produce pet speech', async () => {
  for (const outcome of ['limited', 'unchanged', 'rejected']) {
    const f = fixture();
    if (outcome === 'limited') f.state.delivery = () => ({ shown: true, limitedToLevel: 1 });
    else f.state.record = () => outcome === 'unchanged' ? { ok: true, changed: false } : { ok: false };
    await f.owner.check();
    assert.equal(f.events.some(event => Array.isArray(event) && event[0] === 'talk'), false);
    assert.equal(f.events.some(event => Array.isArray(event) && event[0] === 'record'), true);
  }
});

test('delivery and recording errors are swallowed and release same-day ownership', async () => {
  for (const stage of ['delivery', 'record']) {
    const f = fixture();
    if (stage === 'delivery') f.state.delivery = () => Promise.reject(new Error('synthetic delivery'));
    else f.state.record = () => { throw new Error('synthetic record'); };
    assert.equal(await f.owner.check(), undefined);
    f.state.delivery = () => ({ shown: true }); f.state.record = null;
    await f.owner.check(); assert.equal(f.requests.length, 2);
  }
});

test('pre-delivery errors stay outside the catch boundary and reject check', async () => {
  for (const port of ['getSettings', 'readDate', 'activateScheduledTasks', 'materializeDueReviews', 'getWorkHours', 'readLastNotifiedDay', 'readTasks']) {
    const f = fixture({ [port]: () => { throw new Error(`synthetic ${port}`); } });
    await assert.rejects(f.owner.check(), new RegExp(`synthetic ${port}`));
    assert.equal(f.requests.length, 0);
  }
});

test('theme errors occur inside the catch and pet errors do not retry an already recorded day', async () => {
  const theme = fixture({ getCurrentTheme: () => { throw new Error('theme'); } });
  assert.equal(await theme.owner.check(), undefined); assert.equal(theme.requests.length, 0);
  const pet = fixture({ petTalk: () => { throw new Error('pet'); } });
  await pet.owner.check(); await pet.owner.check();
  assert.equal(pet.requests.length, 1); assert.equal(pet.state.last, '2026-08-29');
});

test('lifecycle disposal clears the interval without acquiring ownership of an in-flight promise', async () => {
  const f = fixture(); const pending = deferred(); f.state.delivery = () => pending.promise;
  f.owner.start(); f.lifecycle.dispose();
  assert.equal(f.timers[0].cleared, true);
  pending.resolve({ shown: true }); await flush();
  assert.equal(f.state.last, '2026-08-29', 'extraction must not add a post-await disposal guard');
});

test('start after disposal still performs its immediate check without creating a timer', async () => {
  const f = fixture(); f.lifecycle.dispose();
  f.owner.start(); await flush();
  assert.equal(f.timers.length, 0); assert.equal(f.requests.length, 1);
});

test('a callback already queued before interval disposal retains the original behavior', async () => {
  const f = fixture(); f.state.settings.dnd = true;
  f.owner.start(); await flush();
  const queued = f.timers[0].callback; f.lifecycle.dispose(); f.state.settings.dnd = false;
  queued(); await flush(); assert.equal(f.requests.length, 1);
});
