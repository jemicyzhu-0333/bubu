'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syntaxFiles } = require('../scripts/check-syntax');
test('portable syntax inventory includes CJS without scanning dependencies or data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tools/node_modules'), { recursive: true });
  for (const name of ['a.js', 'b.mjs', 'c.cjs', 'data.json', 'node_modules/vendor.js']) fs.writeFileSync(path.join(root, 'tools', name), '');
  assert.deepEqual(syntaxFiles(root).map(file => path.relative(root, file)), ['a.js', 'b.mjs', 'c.cjs'].map(name => path.join('tools', name)));
});
