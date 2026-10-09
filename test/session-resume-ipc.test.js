'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createIpcRegistrar, assertIpcPayload, allowedSurfacesFor } = require('../src/application/ipc');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createImpulseSurfaceClient } = require('../src/surfaces/impulse/adapter/surface-client.mjs');

test('resume payload is closed, bounded and requires an explicit identity and intent', () => {
  for (const intent of ['resume', 'confirm-completion']) {
    const action = { sessionId: 'session', intent };
    assert.deepEqual(assertIpcPayload('pomodoro:resume', action), action);
  }
  for (const input of [undefined, null, {}, [], 'resume', { sessionId: 'session' }, { intent: 'resume' },
    { sessionId: '', intent: 'resume' }, { sessionId: ' '.repeat(3), intent: 'resume' },
    { sessionId: 's'.repeat(201), intent: 'resume' }, { sessionId: 1, intent: 'resume' },
    { sessionId: 's', intent: 'stop' }, { sessionId: 's', intent: 'resume', extra: true }]) {
    assert.equal(validateIpcPayload('pomodoro:resume', input).ok, false, JSON.stringify(input));
  }
  assert.deepEqual(allowedSurfacesFor('pomodoro:resume'), ['popover', 'impulse']);
  assert.equal(validateIpcPayload('pomodoro:stop', undefined).ok, true);
  assert.deepEqual(assertIpcPayload('pomodoro:stop', { sessionId: 'held' }), { sessionId: 'held' });
  for (const input of [{}, { sessionId: '' }, { sessionId: 's', extra: true }]) {
    assert.equal(validateIpcPayload('pomodoro:stop', input).ok, false);
  }
});

for (const surface of ['popover', 'impulse']) test(`${surface} scoped client, actual preload and registered route preserve rendered resume/abandon identity`, async () => {
  const calls = [], handlers = new Map(); let exposed;
  const register = createIpcRegistrar({ ipcHost: { handle: (channel, handler) => handlers.set(channel, handler) },
    senderPage: event => event.page, allowedPagesFor: channel => allowedSurfacesFor(channel), validatePayload: assertIpcPayload });
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  for (const channel of ['resume', 'stop']) {
    const line = main.split('\n').find(text => text.startsWith(`registerIpc('pomodoro:${channel}',`));
    vm.runInNewContext(line, { registerIpc: register,
      resumeFocusSession: input => { calls.push(['resume', input]); return { ok: true }; },
      stopFocusSession: (reason, input) => { calls.push(['stop', reason, input]); return { ok: true }; } });
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../src/preload-${surface}.js`), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (_name, bridge) => { exposed = bridge; } },
        ipcRenderer: { invoke: (channel, input) => handlers.get(channel)({ page: surface }, input) } };
    }
  });
  const client = surface === 'popover' ? createPopoverSurfaceClient(exposed) : createImpulseSurfaceClient(exposed);
  const input = { sessionId: 'rendered', intent: 'confirm-completion' };
  await client.resumePomodoro(input); await client.stopPomodoro({ sessionId: 'rendered' });
  assert.deepEqual(calls, [['resume', input], ['stop', 'stopped', { sessionId: 'rendered' }]]);
  await assert.rejects(client.resumePomodoro(), /Invalid IPC payload/);
  await assert.rejects(handlers.get('pomodoro:resume')({ page: 'pet' }, input), /not allowed/);
});
