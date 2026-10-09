'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const catalogRoot = path.join(ROOT, 'src/surfaces/shared/interface');
const entry = fs.readFileSync(path.join(catalogRoot, 'i18n.mjs'), 'utf8');
const catalogs = [...entry.matchAll(/import \{ ([A-Z_]+) \} from '(.*?)'/g)]
  .map(match => require(path.resolve(catalogRoot, match[2]))[match[1]]);
const union = Object.assign({}, ...catalogs);
const fields = text => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(hit => hit[1]).sort();
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(item =>
  item.isDirectory() ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);

test('every imported English catalog is frozen, complete and has compatible shared keys', () => {
  assert.ok(catalogs.length >= 3, 'renderer and native catalogs are both checked');
  catalogs.forEach((catalog, index) => {
    assert.ok(Object.isFrozen(catalog));
    for (const [source, english] of Object.entries(catalog)) {
      assert.equal(typeof english, 'string', source);
      assert.ok(english.trim(), source);
      assert.deepEqual(fields(source), fields(english), source);
      for (const earlier of catalogs.slice(0, index)) {
        if (Object.hasOwn(earlier, source)) assert.equal(english, earlier[source], `shadowed wording: ${source}`);
      }
    }
  });
});

test('explicit product copy and all static HTML markers have an English catalog entry', () => {
  const missing = [];
  for (const file of walk(path.join(ROOT, 'src')).filter(file => /\.(?:mjs|js|html)$/.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/interface\/(?:i18n\.mjs|interface-copy\.js)|interface-copy/.test(source)) {
      for (const match of source.matchAll(/\b(?:t|nativeCopy)\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) {
        const text = vm.runInNewContext(match[1], {}, { timeout: 1000 });
        if (/[\u4e00-\u9fff]/.test(text) && !Object.hasOwn(union, text)) missing.push(`${path.relative(ROOT, file)}: ${text}`);
      }
    }
    if (file.endsWith('.html')) {
      for (const match of source.matchAll(/data-i18n(?:-text|-title|-placeholder|-aria-label)?="([^"]+)"/g)) {
        if (/[\u4e00-\u9fff]/.test(match[1]) && !Object.hasOwn(union, match[1])) missing.push(`${path.relative(ROOT, file)} marker: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
