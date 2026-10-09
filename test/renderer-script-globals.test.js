'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL, pathToFileURL } = require('node:url');
const { createRendererModuleLoader } = require('../test-support/renderer-modules');

const ROOT = path.resolve(__dirname, '..');

test('renderer pages have a single native module entry, not ordered shared globals', () => {
  for (const page of ['pet', 'popover', 'expression-gallery']) {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer', page + '.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)];
    assert.equal(scripts.length, 1, page);
    assert.match(scripts[0][0], /type="module"/);
    assert.ok(fs.existsSync(path.resolve(ROOT, 'src/renderer', scripts[0][1])));
  }
});

test('shared ESM implementations execute in isolation without publishing window globals', () => {
  for (const file of [
    'src/core/pet-motion.mjs', 'src/core/pet-expression.mjs', 'src/core/pet-art.mjs',
    'src/core/sensory-policy.mjs', 'src/content/expressions.mjs', 'src/skins.mjs',
    'src/capabilities/execution/contract/session-duration.mjs',
    'src/capabilities/work/contract/task-limits.mjs'
  ]) {
    const sandbox = { window: {} };
    const loaded = createRendererModuleLoader(vm.createContext(sandbox))(path.join(ROOT, file));
    const nodeApi = require(path.join(ROOT, file)).default;
    assert.deepEqual(Object.keys(loaded.default).sort(), Object.keys(nodeApi).sort(), file);
    assert.deepEqual(Object.keys(sandbox.window), [], file);
  }
});

test('renderer test loader imports the shipped rig without image loading', () => {
  const source = path.join(ROOT, 'src/capabilities/companion/presentation/usagi-art.mjs');
  const exports = createRendererModuleLoader(vm.createContext({ URL, Path2D: class {} }))(source);
  assert.equal(exports.default.describeRig().state, 'ready');
  assert.equal(exports.default.resolveArtwork({ view: 'profile' }).rig.id, 'usagi-v2');
});
