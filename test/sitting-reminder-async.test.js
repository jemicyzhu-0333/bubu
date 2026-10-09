'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSittingReminderTimer } = require('../src/bootstrap/sitting-reminder-timer');

test('the one 30s timer isolates async rejection and both sync and async error-sink failures', async () => {
  let tick;
  const intervals = [];
  const calls = [];
  const errors = [];
  createSittingReminderTimer({
    lifecycle: { interval: (name, callback, ms) => { intervals.push({ name, ms }); tick = callback; } },
    samplers: [
      { name: 'sync', sample: () => { calls.push('sync'); throw new Error('sync failed'); },
        onError: (error, name) => { errors.push(`${name}:${error.message}`); throw new Error('sink failed'); } },
      { name: 'async', sample: () => { calls.push('async'); return Promise.reject(new Error('async failed')); },
        onError: async (error, name) => { errors.push(`${name}:${error.message}`); throw new Error('async sink failed'); } },
      { name: 'last', sample: () => { calls.push('last'); return Promise.resolve(); } }
    ]
  })();
  tick();
  assert.deepEqual(calls, ['sync', 'async', 'last']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['sync:sync failed', 'async:async failed']);
  assert.deepEqual(intervals, [{ name: 'timer:hydration', ms: 30000 }]);
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 4);
  assert.deepEqual(calls, ['sync', 'async', 'last', 'sync', 'async', 'last']);
});
