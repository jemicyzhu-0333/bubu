'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcRoutes } = require('../src/capabilities/preferences');

function routeFor(channel) {
  return ipcRoutes.find(route => route.channel === channel) || null;
}

test('quickPanel:describeShortcut is a preferences query scoped to the popover', () => {
  const route = routeFor('quickPanel:describeShortcut');
  assert.ok(route, 'the route must be declared by the preferences capability');
  assert.equal(route.capability, 'preferences');
  // It reports a platform runtime fact, not persisted state, so it is a query
  // rather than a command (ARCHITECTURE「快捷行动面板」).
  assert.equal(route.kind, 'query');
  assert.deepEqual([...route.surfaces], ['popover']);
});

test('quickPanel:describeShortcut takes no payload and rejects any body', () => {
  const route = routeFor('quickPanel:describeShortcut');
  // No arguments still goes through the codec, so the closed contract stays
  // exhaustive instead of leaking a bare, unvalidated channel.
  assert.deepEqual(route.decode(undefined), { ok: true, value: undefined });
  assert.deepEqual(route.decode(null), { ok: true, value: undefined });
  const rejected = route.decode({ accelerator: 'Alt+Shift+Space' });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some(message => /payload must be empty/.test(message)));
});
