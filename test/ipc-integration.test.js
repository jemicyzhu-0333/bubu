'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpcRegistrar } = require('../src/application/ipc');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertIpcPayload, allowedSurfacesFor } = require('../src/application/ipc');
const { createQuickStartFixture } = require('../test-support/quick-start-fixture');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createImpulseSurfaceClient } = require('../src/surfaces/impulse/adapter/surface-client.mjs');

test('IPC registrar integrates capability, payload validation and handler dispatch', async () => {
  const handlers = new Map();
  const ipcHost = { handle: (channel, handler) => handlers.set(channel, handler) };
  const register = createIpcRegistrar({
    ipcHost,
    senderPage: event => event.page,
    allowedPagesFor: channel => channel === 'tasks:add' ? ['/renderer/popover.html'] : [],
    validatePayload: (channel, payload) => {
      assert.equal(channel, 'tasks:add');
      if (!payload || typeof payload.title !== 'string') throw new TypeError('invalid title');
      return { title: payload.title.trim() };
    }
  });
  register('tasks:add', (_event, payload) => ({ ok: true, title: payload.title }));
  const invoke = handlers.get('tasks:add');
  assert.deepEqual(await invoke({ page: '/renderer/popover.html' }, { title: '  写测试  ' }), { ok: true, title: '写测试' });
  await assert.rejects(invoke({ page: '/renderer/pet.html' }, { title: '越权' }), /not allowed/);
  await assert.rejects(invoke({ page: '/renderer/popover.html' }, { title: 1 }), /invalid title/);
});

for (const surface of ['popover', 'impulse']) test(`${surface} actual preload and main kickstart route preserve paired identity into atomic workflow`, async () => {
  const f = createQuickStartFixture();
  const task = f.create.execute({ task: { title: 'Synthetic title', steps: [] } }).task;
  const action = f.query.execute().quickPanel.candidates[0].quickStartAction;
  const handlers = new Map(); let bridge;
  const registerIpc = createIpcRegistrar({ ipcHost: { handle: (channel, handler) => handlers.set(channel, handler) },
    senderPage: event => event.page, allowedPagesFor: allowedSurfacesFor, validatePayload: assertIpcPayload });
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const wrapper = main.slice(main.indexOf('function startFocusSession('), main.indexOf('\n\nfunction startRestSession'));
  const route = main.split('\n').find(line => line.startsWith("registerIpc('pomodoro:kickstart',"));
  vm.runInNewContext(wrapper + '\n' + route, { registerIpc, startFocusSessionWorkflow: f.start,
    deferStartToCompletedSession: () => { throw new Error('No due session in this fixture'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../src/preload-${surface}.js`), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (_, value) => { bridge = value; } },
        // Electron IPC structured-clones the preload realm's closed object.
        ipcRenderer: { invoke: (channel, input) => handlers.get(channel)({ page: surface }, structuredClone(input)) } };
    }
  });
  const client = surface === 'popover' ? createPopoverSurfaceClient(bridge) : createImpulseSurfaceClient(bridge);
  const before = f.repository.revision();
  for (const payload of [{ nextAction: 'Action' }, { taskVersion: action.taskVersion },
    { nextAction: 'Action', taskVersion: 'bad' }, { nextAction: 'Action', taskVersion: action.taskVersion, scope: 'current-and-future' }]) {
    await assert.rejects(client.kickstart(task.id, payload), /Invalid IPC payload/);
  }
  await assert.rejects(handlers.get('pomodoro:kickstart')({ page: 'pet' }, { taskId: task.id }), /not allowed/);
  assert.equal(f.repository.revision(), before);
  const result = await client.kickstart(task.id, { nextAction: 'Open notes', taskVersion: action.taskVersion });
  assert.equal(result.ok, true); assert.equal(result.session.plannedDurationMs, 120000);
  assert.equal(f.repository.revision(), before + 1); assert.equal(f.repository.snapshot().tasks[0].nextAction, 'Open notes');
});
