'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpcHost } = require('../src/platform/electron');

function createIpcHarness({ removalFailure = null } = {}) {
  const handlers = new Map();
  const calls = [];
  const ipcMain = {
    handle(channel, handler) {
      calls.push(['handle', channel]);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      calls.push(['remove', channel]);
      handlers.delete(channel);
      if (channel === removalFailure) throw new Error(`cannot remove ${channel}`);
    }
  };
  return { calls, handlers, ipcMain };
}

test('IPC host owns registrations and removes them in reverse order', async () => {
  const harness = createIpcHarness();
  const host = createIpcHost({ ipcMain: harness.ipcMain });
  const first = async () => 'first';
  const second = async () => 'second';

  assert.equal(host.handle('state:get', first), true);
  assert.equal(host.handle('tasks:add', second), true);
  assert.equal(await harness.handlers.get('state:get')(), 'first');
  assert.deepEqual(Object.keys(host), ['handle', 'dispose']);

  assert.equal(host.dispose(), true);
  assert.equal(host.dispose(), false);
  assert.deepEqual(harness.calls, [
    ['handle', 'state:get'],
    ['handle', 'tasks:add'],
    ['remove', 'tasks:add'],
    ['remove', 'state:get']
  ]);
  assert.equal(harness.handlers.size, 0);
});

test('IPC host rejects duplicate and late registrations before platform calls', () => {
  const harness = createIpcHarness();
  const host = createIpcHost({ ipcMain: harness.ipcMain });

  host.handle('state:get', () => null);
  assert.throws(() => host.handle('state:get', () => null), /duplicate IPC handler/);
  assert.equal(harness.calls.length, 1);
  host.dispose();
  assert.throws(() => host.handle('tasks:add', () => null), /disposed/);
});

test('IPC host attempts every removal before reporting cleanup failures', () => {
  const harness = createIpcHarness({ removalFailure: 'tasks:add' });
  const host = createIpcHost({ ipcMain: harness.ipcMain });
  host.handle('state:get', () => null);
  host.handle('tasks:add', () => null);

  assert.throws(() => host.dispose(), AggregateError);
  assert.deepEqual(harness.calls.slice(-2), [
    ['remove', 'tasks:add'],
    ['remove', 'state:get']
  ]);
  assert.equal(host.dispose(), false);
});

test('IPC host rejects incomplete Electron implementations', () => {
  assert.throws(() => createIpcHost({ ipcMain: { handle() {} } }), /handle and removeHandler/);
});
