'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetHotReload } = require('../src/platform/electron/dev/pet-hot-reload');

function createTimers() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout(callback) { const id = ++nextId; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); },
    flush() { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } }
  };
}

test('pet hot reload filters source files and debounces bursts', () => {
  const timers = createTimers();
  let listener;
  let watchedRoot;
  const reloaded = [];
  const hotReload = createPetHotReload({
    sourceRoot: '/repo/src',
    watch: (root, _options, nextListener) => { watchedRoot = root; listener = nextListener; return { close() {} }; },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    reload: fileName => reloaded.push(fileName)
  });
  hotReload.start();
  assert.equal(watchedRoot, '/repo/src');
  listener('change', 'README.md');
  timers.flush();
  assert.deepEqual(reloaded, []);
  listener('change', 'src/core/pet-art.mjs');
  listener('change', 'src/renderer/pet.html');
  timers.flush();
  assert.deepEqual(reloaded, ['src/renderer/pet.html']);
  listener('change', 'core/pet-art.mjs');
  timers.flush();
  assert.deepEqual(reloaded, ['src/renderer/pet.html', 'core/pet-art.mjs']);
  hotReload.stop();
  listener('change', 'src/core/pet-art.mjs');
  timers.flush();
  assert.deepEqual(reloaded, ['src/renderer/pet.html', 'core/pet-art.mjs']);
});
