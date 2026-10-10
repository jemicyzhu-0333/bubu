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

const EVENT_NAMES = new Set(['entry', 'default-app-data-set', 'default-name-set', 'default-path-observed', 'default-host-mapped', 'ready', 'window-loaded', 'will-quit']);
function readFixtureEvents(file) {
  if (!fs.existsSync(file)) return [];
  assert.ok(fs.statSync(file).size <= 8192, 'event evidence exceeds bound');
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const event = JSON.parse(line);
    assert.deepEqual(Object.keys(event).sort(), ['elapsedMs', 'event']);
    assert.ok(EVENT_NAMES.has(event.event) && Number.isSafeInteger(event.elapsedMs) && event.elapsedMs >= 0);
    return event;
  });
}
function entryMode({ electron = !!process.versions.electron, childRequested = process.argv.includes('--fixture-child'),
  nodeMain = require.main === module } = {}) {
  return electron && childRequested ? 'child' : nodeMain && !electron ? 'node' : 'import';
}

async function child() {
  const started = performance.now();
  const event = name => {
    const text = JSON.stringify({ event: name, elapsedMs: Math.round(performance.now() - started) });
    if (process.env.BUBU_RUNTIME_FIXTURE_EVENTS) fs.appendFileSync(process.env.BUBU_RUNTIME_FIXTURE_EVENTS, text + '\n');
    else console.log('__BUBU_FIXTURE_EVENT__' + text);
  };
  event('entry');
  const { app, BrowserWindow } = require('electron');
  const minimalDefault = process.argv.includes('--fixture-minimal-default');
  const minimal = minimalDefault || process.argv.includes('--fixture-minimal');
  if (minimalDefault) {
    // No command-line profile override: exercise default-name mapping through
    // Electron's path service, contained in a disposable appData root.
    const root = process.env.BUBU_RUNTIME_FIXTURE_ROOT;
    assert.ok(root && path.isAbsolute(root));
    app.setPath('appData', root); event('default-app-data-set');
    app.setName('小步'); event('default-name-set');
    assert.equal(app.commandLine.hasSwitch('user-data-dir'), false);
    assert.equal(app.getPath('userData'), path.join(root, '小步')); event('default-path-observed');
    fs.mkdirSync(path.join(root, 'bubu'));
    const { createAppHost } = require('../src/platform/electron/app-host');
    const host = createAppHost({ app });
    assert.equal(host.userDataPath(), path.join(root, 'bubu'));
    assert.equal(app.getPath('sessionData'), path.join(root, 'bubu')); event('default-host-mapped');
  }
  app.on('will-quit', () => event('will-quit'));
  await app.whenReady(); event('ready');
  if (minimal) { setTimeout(() => app.quit(), 1800); return; }
  const window = new BrowserWindow({ width: 240, height: 160, show: true, webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html,<canvas id="c" width="200" height="100"></canvas><script>const c=document.getElementById("c");const x=c.getContext("2d");x.fillStyle="blue";x.fillRect(0,0,200,100);</script>');
  event('window-loaded'); setTimeout(() => app.quit(), 1800);
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
  function phase(name, args, directory, extraEnvironment, readyEvent) {
    const eventsFile = path.join(root, name + '.events.jsonl'); fs.writeFileSync(eventsFile, '', { flag: 'wx' });
    let result;
    try {
      execFileSync(executable, [__filename, '--fixture-child', ...args], {
        env: { ...installedElectronEnvironment(), ...extraEnvironment, BUBU_RUNTIME_FIXTURE_EVENTS: eventsFile },
        stdio: 'pipe', timeout: 30000
      });
      const events = readFixtureEvents(eventsFile);
      assert.ok(events.some(event => event.event === readyEvent), 'native readiness evidence missing');
      result = { status: 'passed', ...manifest(directory), events };
    } catch (error) {
      result = { status: 'failed', code: /^[A-Z_]+$/.test(error.code || '') ? error.code : null,
        events: readFixtureEvents(eventsFile) };
    }
    report[name] = result;
    return result.status === 'passed';
  }
  const minimalRoot = path.join(root, 'default-app-data'); fs.mkdirSync(minimalRoot);
  phase('minimalDefaultLaunch', ['--fixture-minimal-default'], path.join(minimalRoot, 'bubu'),
    { BUBU_RUNTIME_FIXTURE_ROOT: minimalRoot }, 'ready');
  report.minimalDefaultLaunch.userDataOverrideSwitch = false;
  report.minimalDefaultLaunch.defaultProductNameMappedToBubu = report.minimalDefaultLaunch.events.some(event => event.event === 'default-host-mapped');
  if (phase('firstLaunch', [`--user-data-dir=${profile}`], profile, {}, 'window-loaded')) {
    phase('reopen', [`--user-data-dir=${profile}`], profile, {}, 'window-loaded');
  } else report.reopen = { status: 'not-run', reason: 'first launch did not complete; profile not reused' };
  const output = path.resolve(__dirname, '../dist/windows-runtime-fixture.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (['minimalDefaultLaunch', 'firstLaunch', 'reopen'].every(name => report[name].status === 'passed')) {
    fs.rmSync(root, { recursive: true, force: true });
  } else process.exitCode = 1; // Failed synthetic directories remain for runner disposal.
}

// Electron 44 dynamically imports CLI entries; require.main is not this module.
if (entryMode() === 'child') child().catch(() => { console.error('runtime-fixture-child-failed'); require('electron').app.exit(1); });
else if (entryMode() === 'node') run();
module.exports = { shape, manifest, entryMode, readFixtureEvents };
