'use strict';

// Disposable native evidence only. No application profile or credential is read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

function shape(value, depth = 0) {
  assert.ok(depth <= 12, 'runtime preference shape is too deep');
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: value.map(item => shape(item, depth + 1)) };
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key], depth + 1)]));
  return typeof value === 'string' ? { type: 'string', length: value.length } : typeof value;
}

function manifest(directory) {
  const records = [];
  function visit(parent, prefix = '', depth = 0) {
    assert.ok(depth < 12 && records.length < 2000, 'runtime tree is too large');
    for (const name of fs.readdirSync(parent).sort()) {
      const file = path.join(parent, name), stat = fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), 'unexpected runtime member type');
      const relative = prefix + name;
      records.push({ path: relative, kind: stat.isDirectory() ? 'directory' : 'file', ...(stat.isFile() ? { bytes: stat.size } : {}) });
      if (stat.isDirectory()) visit(file, relative + '/', depth + 1);
    }
  }
  visit(directory);
  const localState = path.join(directory, 'Local State');
  assert.ok(fs.statSync(localState).size < 65536, 'runtime preferences exceed evidence bound');
  return { members: records, localStateShape: shape(JSON.parse(fs.readFileSync(localState, 'utf8'))) };
}

async function child() {
  const { app, BrowserWindow } = require('electron');
  const minimal = process.argv.includes('--fixture-minimal-default');
  if (minimal) {
    // Exercise the no-command-line-override default-name mapping on a disposable
    // appData root. Verify containment before allowing Electron readiness.
    const root = process.env.BUBU_RUNTIME_FIXTURE_ROOT;
    assert.ok(root && path.isAbsolute(root));
    app.setPath('appData', root); app.setName('小步');
    assert.equal(app.commandLine.hasSwitch('user-data-dir'), false);
    assert.equal(app.getPath('userData'), path.join(root, '小步'));
    fs.mkdirSync(path.join(root, 'bubu'));
    const { createAppHost } = require('../src/platform/electron/app-host');
    const host = createAppHost({ app });
    assert.equal(host.userDataPath(), path.join(root, 'bubu'));
    assert.equal(app.getPath('sessionData'), path.join(root, 'bubu'));
  }
  const started = performance.now();
  const event = name => console.log('__BUBU_FIXTURE_EVENT__' + JSON.stringify({ event: name, elapsedMs: Math.round(performance.now() - started) }));
  event('entry');
  app.on('will-quit', () => event('will-quit'));
  await app.whenReady();
  event('ready');
  if (minimal) { setTimeout(() => app.quit(), 1800); return; }
  const window = new BrowserWindow({ width: 240, height: 160, show: true, webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html,<canvas id="c" width="200" height="100"></canvas><script>const c=document.getElementById("c");const x=c.getContext("2d");x.fillStyle="blue";x.fillRect(0,0,200,100);</script>');
  event('window-loaded');
  setTimeout(() => app.quit(), 1800);
}

function run() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'requires a disposable hosted runner');
  const { execFileSync } = require('node:child_process');
  const { installedElectronEnvironment } = require('./installed-electron-environment');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-runtime-fixture-'));
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const executable = require('electron');
  const report = { sourceCommit: process.env.GITHUB_SHA, electronVersion: require('electron/package.json').version,
    acceptance: 'disposable pure Electron runtime fixture; no real user data, application startup, migration, or credential acceptance asserted' };
  try {
    const minimalRoot = path.join(root, 'default-app-data'); fs.mkdirSync(minimalRoot);
    const minimalStdout = execFileSync(executable, [__filename, '--fixture-child', '--fixture-minimal-default'], {
      env: { ...installedElectronEnvironment(), BUBU_RUNTIME_FIXTURE_ROOT: minimalRoot }, stdio: 'pipe', timeout: 30000
    });
    const minimalEvents = String(minimalStdout).split(/\r?\n/).filter(line => line.startsWith('__BUBU_FIXTURE_EVENT__'))
      .map(line => JSON.parse(line.slice('__BUBU_FIXTURE_EVENT__'.length)));
    assert.ok(minimalEvents.some(event => event.event === 'ready'));
    report.minimalDefaultLaunch = { ...manifest(path.join(minimalRoot, 'bubu')), events: minimalEvents,
      userDataOverrideSwitch: false, defaultProductNameMappedToBubu: true,
      acceptance: 'real Electron path service with a disposable appData root; no BrowserWindow, no real Windows account profile' };
    for (const phase of ['firstLaunch', 'reopen']) {
      const stdout = execFileSync(executable, [__filename, '--fixture-child', `--user-data-dir=${profile}`], {
        env: installedElectronEnvironment(), stdio: 'pipe', timeout: 30000
      });
      const events = String(stdout).split(/\r?\n/).filter(line => line.startsWith('__BUBU_FIXTURE_EVENT__'))
        .map(line => JSON.parse(line.slice('__BUBU_FIXTURE_EVENT__'.length)));
      assert.ok(events.some(event => event.event === 'window-loaded'), 'native window evidence missing');
      report[phase] = { ...manifest(profile), events };
    }
    const output = path.resolve(__dirname, '../dist/windows-runtime-fixture.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (require.main === module) {
  if (process.versions.electron && process.argv.includes('--fixture-child')) child().catch(error => { console.error(error); require('electron').app.exit(1); });
  else run();
}
module.exports = { shape, manifest };
