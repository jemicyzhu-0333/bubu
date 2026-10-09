'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcutHost } = require('../src/platform/electron');

function createShortcutHarness(results = {}) {
  const calls = [];
  return {
    calls,
    globalShortcut: {
      register(accelerator, handler) {
        calls.push(['register', accelerator, handler]);
        const result = results[accelerator];
        if (result instanceof Error) throw result;
        return result !== false;
      },
      unregisterAll() {
        calls.push(['unregister-all']);
      }
    }
  };
}

test('shortcut host registers the complete declared binding set', () => {
  const harness = createShortcutHarness();
  const host = createShortcutHost({ globalShortcut: harness.globalShortcut });
  const openPanel = () => {};
  const capture = () => {};

  const result = host.registerAll([
    { accelerator: 'Alt+Space', handler: openPanel },
    { accelerator: 'Alt+Shift+Space', handler: capture }
  ]);

  assert.deepEqual(result, { ok: true, failed: [] });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.failed), true);
  assert.deepEqual(harness.calls, [
    ['register', 'Alt+Space', openPanel],
    ['register', 'Alt+Shift+Space', capture]
  ]);
});

test('shortcut host reports every failed binding without hiding later attempts', () => {
  const harness = createShortcutHarness({
    'Alt+Space': false,
    'Alt+Shift+Space': new Error('platform failure')
  });
  const host = createShortcutHost({ globalShortcut: harness.globalShortcut });

  assert.deepEqual(host.registerAll([
    { accelerator: 'Alt+Space', handler: () => {} },
    { accelerator: 'Alt+Shift+Space', handler: () => {} },
    { accelerator: 'Alt+Control+Space', handler: () => {} }
  ]), {
    ok: false,
    failed: ['Alt+Space', 'Alt+Shift+Space']
  });
  assert.equal(harness.calls.filter(([kind]) => kind === 'register').length, 3);
});

test('shortcut host validates before side effects and disposes exactly once', () => {
  const harness = createShortcutHarness();
  const host = createShortcutHost({ globalShortcut: harness.globalShortcut });
  const duplicateBindings = [
    { accelerator: 'Alt+Space', handler: () => {} },
    { accelerator: 'Alt+Space', handler: () => {} }
  ];

  assert.throws(() => host.registerAll(duplicateBindings), /duplicate shortcut/);
  assert.deepEqual(harness.calls, []);
  assert.equal(host.dispose(), true);
  assert.equal(host.dispose(), false);
  assert.deepEqual(harness.calls, [['unregister-all']]);
  assert.throws(() => host.registerAll([{ accelerator: 'Alt+Space', handler: () => {} }]), /disposed/);
});

test('shortcut host rejects incomplete Electron implementations', () => {
  assert.throws(() => createShortcutHost({ globalShortcut: {} }), /globalShortcut/);
});
