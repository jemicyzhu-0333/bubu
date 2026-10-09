'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createRendererModuleLoader } = require('../test-support/renderer-modules');

test('renderer loader preserves named import aliases, plain bindings and the identifier as', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-module-loader-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'dependency.mjs'), `
    export const value = 42;
    export const plain = 'unchanged';
    export const as = 'legal identifier';
    export default { label: 'default' };
  `);
  const entry = path.join(directory, 'entry.mjs');
  fs.writeFileSync(entry, `
    import {
      value as renamed,
      value as secondName,
      plain,
      as,
      as as renamedAs,
      default as defaultValue,
    } from './dependency.mjs';
    export const result = [renamed, secondName, plain, as, renamedAs, defaultValue.label];
  `);
  const nativeModule = await import(pathToFileURL(entry).href);
  const context = vm.createContext({});
  const load = createRendererModuleLoader(context);
  const loaded = load(entry);
  assert.deepEqual(Array.from(loaded.result), nativeModule.result);
  assert.deepEqual(Array.from(loaded.result), [42, 42, 'unchanged', 'legal identifier', 'legal identifier', 'default']);
  assert.equal(load(entry), loaded, 'module cache preserves identity');
  assert.equal(context.renamed, undefined, 'import bindings stay module-local');
});
