'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('shared entry registers presentation without blocking reminder/domain initialization on a slow read', () => {
  const entry = path.join(__dirname, '../src/surfaces/shared/interface/entry.mjs');
  const result = execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { pathToFileURL } = require('node:url');
    const seen = [], listeners = new Map();
    let resolveRead;
    const pending = new Promise(resolve => { resolveRead = resolve; });
    global.document = { body: { dataset: { surface: 'popover' } }, documentElement: { dataset: {}, style: { setProperty() {} } }, querySelectorAll: () => [] };
    global.window = { bubu: { getInterfacePreferences: () => { seen.push('read'); return pending; }, onInterfacePreferences: () => { seen.push('subscribe'); return () => seen.push('unsubscribe'); } }, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
    (async () => {
      let timer;
      const outcome = await Promise.race([import(pathToFileURL(${JSON.stringify(entry)})).then(() => 'imported'), new Promise(resolve => { timer = setTimeout(() => resolve('blocked'), 3000); })]);
      clearTimeout(timer);
      assert.equal(outcome, 'imported');
      assert.deepEqual(seen, ['subscribe', 'read']);
      seen.push('domain-init-registered');
      listeners.get('pagehide')();
      resolveRead({ theme: 'dark', resolvedLocale: 'en', revision: 1 });
      await Promise.resolve(); await Promise.resolve();
      assert.equal(document.documentElement.dataset.appearance, 'light');
      assert.ok(seen.includes('unsubscribe'));
      process.stdout.write('startup-preserved');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result, 'startup-preserved');
});
