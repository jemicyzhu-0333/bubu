'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/bootstrap/create-application');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');
const { registerProcessLifecycle } = require('../src/bootstrap/process-lifecycle');
function host() { return new Proxy({ userDataPath: () => '/synthetic-profile', acquireSingleInstanceLock: () => true },
 { get: (value, name) => value[name] || (() => {}) }); }
test('application closes partially constructed authority and complete stores once in reverse ownership order', () => {
 const calls = [];
 const options = { argv: [], appHost: host(), schemaVersion: 16, normalizePersistedState: value => value,
  createStateRepository: () => ({ close: () => calls.push('config') }), createCredentialStore: () => ({}),
  openCollaborationStorage: () => ({ close: () => calls.push('conversation') }),
  openFactStore: () => { throw new Error('synthetic-open-failure'); } };
 assert.throws(() => createApplication(options), /synthetic-open-failure/);
 assert.deepEqual(calls, ['conversation', 'config']); calls.length = 0;
 const app = createApplication({ ...options, openFactStore: () => ({ close: () => calls.push('facts') }) });
 app.closeStorage(); app.closeStorage(); assert.deepEqual(calls, ['facts', 'conversation', 'config']);
});
test('final session saves finish before portable config authority closes on will-quit', () => {
 const calls = [], lifecycle = createLifecycleRegistry(); let handlers, closed = false;
 lifecycle.register('session-save', () => { assert.equal(closed, false); calls.push('session-save'); });
 registerProcessLifecycle({ lifecycle, appHost: { subscribeLifecycle(value) { handlers = value; return () => calls.push('unsubscribe'); } },
  powerHost: { subscribe: () => () => {} }, isSessionRunning: () => true,
  pauseActiveSessionForInterruption: () => { assert.equal(closed, false); calls.push('pause'); },
  closeStorage: () => { closed = true; calls.push('config-close'); } });
 handlers.onBeforeQuit(); handlers.onWillQuit();
 assert.deepEqual(calls, ['pause', 'unsubscribe', 'session-save', 'config-close']);
});
