'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionHost } = require('../src/platform/electron');

function createSessionHarness({ requestError = null } = {}) {
  const calls = [];
  let checkHandler;
  let requestHandler;
  const defaultSession = {
    setPermissionCheckHandler(handler) {
      calls.push(['check', handler]);
      checkHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      calls.push(['request', handler]);
      if (requestError && handler) throw requestError;
      requestHandler = handler;
    }
  };
  return {
    calls,
    session: { defaultSession },
    get checkHandler() { return checkHandler; },
    get requestHandler() { return requestHandler; }
  };
}

test('permission host denies checks and requests without exposing Electron session', () => {
  const harness = createSessionHarness();
  const host = createPermissionHost({ session: harness.session });
  const dispose = host.denyAll();

  assert.equal(harness.checkHandler({}, 'camera', 'file://app', {}), false);
  let decision = null;
  harness.requestHandler({}, 'microphone', allowed => { decision = allowed; }, {});
  assert.equal(decision, false);
  assert.deepEqual(Object.keys(host), ['denyAll']);

  assert.equal(dispose(), true);
  assert.equal(harness.checkHandler, null);
  assert.equal(harness.requestHandler, null);
  assert.equal(dispose(), false);
});

test('permission host fails closed and rolls back a partial installation', () => {
  const failure = new Error('request handler failed');
  const harness = createSessionHarness({ requestError: failure });
  const host = createPermissionHost({ session: harness.session });

  assert.throws(() => host.denyAll(), failure);
  assert.equal(harness.checkHandler, null);
  assert.deepEqual(harness.calls.map(([kind, handler]) => [kind, typeof handler]), [
    ['check', 'function'],
    ['request', 'function'],
    ['check', 'object']
  ]);
});

test('permission host rejects incomplete Electron session implementations', () => {
  assert.throws(() => createPermissionHost({ session: null }), /Electron session/);
  assert.throws(
    () => createPermissionHost({ session: { defaultSession: {} } }).denyAll(),
    /permission handlers/
  );
});
