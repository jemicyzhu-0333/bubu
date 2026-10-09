'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('packaging uses the pinned upstream fetch downloader without vulnerable legacy chains', () => {
  assert.equal(pkg.devDependencies['electron-builder'], '27.0.0-alpha.10');
  assert.equal(lock.packages[''].devDependencies['electron-builder'], pkg.devDependencies['electron-builder']);
  assert.equal(lock.packages['node_modules/electron-builder'].version, pkg.devDependencies['electron-builder']);
  assert.match(lock.packages['node_modules/app-builder-lib'].dependencies['@electron/get'], /^\^5\./);
  const removed = ['got', 'http-cache-semantics', 'global-agent', 'roarr', 'sprintf-js'];
  for (const name of removed) {
    assert.equal(Object.keys(lock.packages).some(key => key.endsWith(`/node_modules/${name}`)
      || key === `node_modules/${name}`), false, `legacy packaging dependency returned: ${name}`);
  }
  assert.equal(pkg.dependencies['electron-updater'], '6.8.10');
  assert.equal(lock.packages['node_modules/electron-updater'].version, '6.8.10');
  assert.equal(pkg.overrides, undefined, 'security fixes must come from upstream dependencies');
  assert.equal(pkg.version, '0.0.1-dev');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('manual native CI validates installed dependencies before producing unsigned artifacts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build-desktop.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|NODE_PATH|continue-on-error|--omit|--ignore-scripts/);
  for (const command of ['npm ci', 'npm audit --audit-level=low', 'npm run check',
    'npm run test:integration', 'node --test test/build-app.test.js test/build-dependency-security.test.js']) {
    assert.ok(workflow.indexOf(command) >= 0, `missing native CI gate: ${command}`);
    assert.ok(workflow.indexOf(command) < workflow.indexOf('run: npm run build:'), `gate runs after packaging: ${command}`);
  }
  assert.match(workflow, /npm run verify:mac-app/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);
});
