'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('real Canvas tests have a locked development backend for both native CI targets', () => {
  const name = '@napi-rs/canvas';
  assert.equal(pkg.devDependencies[name], '1.0.10');
  assert.equal(pkg.dependencies[name], undefined, 'native test rendering is not an application runtime dependency');
  assert.equal(lock.packages[''].devDependencies[name], pkg.devDependencies[name]);
  const backend = lock.packages[`node_modules/${name}`];
  assert.equal(backend.version, pkg.devDependencies[name]);
  assert.equal(backend.dev, true);
  for (const [platform, arch, suffix] of [['darwin', 'arm64', 'darwin-arm64'], ['win32', 'x64', 'win32-x64-msvc']]) {
    const binaryName = `${name}-${suffix}`;
    const binary = lock.packages[`node_modules/${binaryName}`];
    assert.equal(backend.optionalDependencies[binaryName], backend.version);
    assert.equal(binary.version, backend.version);
    assert.equal(binary.dev, true);
    assert.equal(binary.optional, true);
    assert.deepEqual(binary.os, [platform]);
    assert.deepEqual(binary.cpu, [arch]);
  }
});

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
  // Only these build-tool-scoped overrides are allowed, until electron-builder ships patched
  // glob/minimatch/ejs upstream (GHSA-3g3m-2fjr-6pw4 chain). Remove them when it does.
  assert.deepEqual(pkg.overrides, {
    '@electron/asar': { glob: '^14.0.3', minimatch: '^11.0.4' },
    'app-builder-lib': { minimatch: '^11.0.4', ejs: '^7.0.2' }
  }, 'overrides are limited to the documented build-tool security allowlist');
  for (const [key, min] of Object.entries({ glob: [14, 0, 2], minimatch: [11, 0, 1] })) {
    for (const [at, entry] of Object.entries(lock.packages)) {
      if (!at.endsWith(`node_modules/${key}`)) continue;
      const v = entry.version.split('.').map(Number);
      const ok = v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2];
      assert.ok(ok, `${at}@${entry.version} is below patched ${min.join('.')}`);
    }
  }
  assert.equal(pkg.version, '0.0.2-dev.6');
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
  assert.ok(workflow.includes('run: npm run build:${{ matrix.platform }} -- --${{ matrix.arch }} --test-diagnostics'));
  assert.match(workflow, /npm run verify:mac-app -- --test-diagnostics/);
  assert.match(workflow, /npm run verify:win-install/);
  assert.match(workflow, /npm run verify:mac-install/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);
});
