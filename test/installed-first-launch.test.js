'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { createEmptyProfile, readFreshAuthority, verifyFreshLaunch, connectInspector } = require('../scripts/installed-first-launch');
const { verifyWindowsInstall } = require('../scripts/verify-windows-install');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
function initialize(profile) {
  const repository = createSqliteStateAdapter({ userDataPath: profile.userDataPath });
  try { repository.commit(normalizePersistedState({})); } finally { repository.close(); }
}
test('fresh fixture has no bootstrap files; missing authority checks do not mint an identity', () => {
  const profile = createEmptyProfile();
  try {
    assert.deepEqual(fs.readdirSync(profile.userDataPath), []);
    assert.throws(() => readFreshAuthority(profile.userDataPath), /ENOENT/);
    assert.deepEqual(fs.readdirSync(profile.userDataPath), []);
  } finally { fs.rmSync(profile.root, { recursive: true, force: true }); }
});
test('closed fresh authority validates brand, binding and canonical persisted state without repair', () => {
  const profile = createEmptyProfile();
  try {
    initialize(profile);
    assert.equal(readFreshAuthority(profile.userDataPath).brand, 'BUBU');
    const identity = path.join(profile.userDataPath, 'config.sqlite.identity.sqlite');
    const handle = new DatabaseSync(identity);
    handle.exec('PRAGMA application_id = 0'); handle.close();
    const bytes = fs.readFileSync(identity);
    assert.throws(() => readFreshAuthority(profile.userDataPath));
    assert.deepEqual(fs.readFileSync(identity), bytes);
  } finally { fs.rmSync(profile.root, { recursive: true, force: true }); }
});
function launchPorts({ startupError = false, noWindow = false, abnormalExit = false } = {}) {
  let profile, child, launches = 0, killed = 0;
  const ports = {
    createProfile() { profile = createEmptyProfile(); return profile; },
    spawnChild(executable, argv, options) {
      assert.equal(executable, '/synthetic-installed/bubu');
      assert.deepEqual(argv, [`--user-data-dir=${profile.userDataPath}`, '--inspect=127.0.0.1:0']);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '');
      if (launches++ === 0) {
        assert.deepEqual(fs.readdirSync(profile.userDataPath), []);
        if (!startupError) initialize(profile);
      } else assert.ok(fs.existsSync(path.join(profile.userDataPath, 'config.sqlite')));
      if (process.platform === 'win32') fs.writeFileSync(path.join(profile.userDataPath, 'lockfile'), '');
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { killed++; child.emit('close', null, 'SIGKILL'); };
      queueMicrotask(() => child.stderr.emit('data', `Debugger listening on ws://127.0.0.1:9876/1234-abcd\n${startupError ? 'App threw an error: config-profile-brand-required' : ''}`));
      return child;
    },
    async wait(completion, delay) {
      await Promise.resolve();
      return delay >= 5000 ? completion : null;
    },
    async connect() { return {
      async evaluate(expression) {
        if (expression.includes('app.quit')) { child.emit('close', abnormalExit ? 1 : 0, null); return true; }
        return !noWindow;
      }, close() {}
    }; }
  };
  return { ports, get launches() { return launches; }, get killed() { return killed; }, get profile() { return profile; } };
}
test('installed launch and reopen use the same unseeded profile, normal exit, then read SQL', async () => {
  const fixture = launchPorts();
  const report = await verifyFreshLaunch('/synthetic-installed/bubu', fixture.ports);
  assert.equal(fixture.launches, 2); assert.equal(fixture.killed, 0);
  assert.equal(report.firstLaunch.visibleLocalWindowReady, true);
  assert.equal(report.reopen.normalExit, true);
  assert.equal(fs.existsSync(fixture.profile.root), false);
});
for (const [name, options] of [['startup error dialog', { startupError: true }], ['missing UI readiness', { noWindow: true }], ['nonzero exit', { abnormalExit: true }]]) {
  test(`installed launch rejects ${name} and never reports reopening success`, async () => {
    const fixture = launchPorts(options);
    await assert.rejects(verifyFreshLaunch('/synthetic-installed/bubu', fixture.ports));
    assert.equal(fixture.launches, 1);
    assert.equal(fs.existsSync(fixture.profile.root), false);
  });
}
test('inspector never connects outside exact loopback URL shape', () => {
  assert.throws(() => connectInspector('ws://0.0.0.0:9000/abcd'));
  assert.throws(() => connectInspector('ws://example.com:9000/abcd'));
});
test('NSIS install rejects other platforms and non-CI machines before changing installation', async () => {
  const execFile = () => assert.fail('must not run installer');
  await assert.rejects(verifyWindowsInstall({ platform: 'linux', execFile }), /requires Windows/);
  await assert.rejects(verifyWindowsInstall({ platform: 'win32', env: {}, execFile }), /disposable GitHub Actions/);
});

test('NSIS verifier installs the actual exe, launches the installed target and uninstalls only that target', async () => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-installer-test-'));
  const installer = path.join(root, 'installer.exe');
  fs.writeFileSync(installer, 'synthetic-installer');
  const calls = []; let installed;
  try {
    const report = await verifyWindowsInstall({ platform: 'win32', env: { GITHUB_ACTIONS: 'true' }, argv: ['node', 'script', installer],
      execFile(file, args, options) {
        calls.push(file);
        if (file === installer) {
          assert.deepEqual(args.slice(0, 2), ['/S', '/currentuser']);
          assert.equal(options.windowsVerbatimArguments, true);
          installed = args[2].slice(3);
          fs.mkdirSync(path.join(installed, 'resources'), { recursive: true });
          fs.writeFileSync(path.join(installed, 'bubu.exe'), 'exe');
          fs.writeFileSync(path.join(installed, 'resources/app.asar'), 'asar');
          fs.writeFileSync(path.join(installed, 'Uninstall 小步.exe'), 'uninstaller');
        } else {
          assert.equal(file, path.join(installed, 'Uninstall 小步.exe'));
          assert.deepEqual(args, ['/S', '/currentuser', `_?=${installed}`]);
          assert.equal(options.windowsVerbatimArguments, true);
        }
      },
      async launch(file) { assert.equal(file, path.join(installed, 'bubu.exe')); calls.push('launch'); return { firstLaunch: { normalExit: true }, reopen: { normalExit: true } }; },
      async upgrade(file) { assert.equal(file, path.join(installed, 'bubu.exe')); calls.push('upgrade'); return { result: 'passed' }; },
      log() {}
    });
    assert.equal(report.result, 'passed'); assert.equal(calls.length, 4); assert.equal(calls[1], 'launch'); assert.equal(calls[2], 'upgrade');
    assert.equal(fs.existsSync(installed), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('real inspector supports scope-independent built-in loader when global require is absent', async () => {
  const os = require('node:os'), { spawn } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-inspector-test-'));
  const script = path.join(root, 'main.cjs');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const child = spawn(process.execPath, ['--inspect=127.0.0.1:0', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  let inspector;
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('real inspector did not start')), 5000);
      child.once('error', reject);
      child.stderr.on('data', data => {
        const url = String(data).match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/)?.[0];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    inspector = await connectInspector(url);
    assert.equal(await inspector.evaluate('typeof require'), 'undefined');
    assert.equal(await inspector.evaluate("typeof process.getBuiltinModule('module').createRequire(process.execPath)('node:fs').readFileSync"), 'function');
  } finally {
    inspector?.close(); child.kill(); await closed; fs.rmSync(root, { recursive: true, force: true });
  }
});
test('manual diagnosis only hashes owned synthetic residue and does not follow symlinks', t => {
  const { profileManifest } = require('../scripts/diagnose-windows-first-launch');
  const profile = createEmptyProfile();
  try {
    fs.writeFileSync(path.join(profile.userDataPath, 'Preferences'), 'synthetic-only');
    const records = profileManifest(profile);
    assert.equal(records[0].name, 'Preferences');
    assert.equal(records[0].type, 'file');
    assert.equal(records[0].size, 14);
    assert.match(records[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(records).includes('synthetic-only'), false);
  } finally { fs.rmSync(profile.root, { recursive: true, force: true }); }
});
