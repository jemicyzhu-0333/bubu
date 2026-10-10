'use strict';

// All processes and cache bytes in this suite are synthetic. Native acceptance
// is provided only by running the verifier on a disposable Windows runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RUNTIME_MEMBERS, claimDefaultProfile, removeOwnedDefaultProfile, copyRuntimeMembers,
  seedWindowsRuntimeFixture, verifyWindowsDefaultProfile } = require('../scripts/verify-windows-default-profile');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-default-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function hosted(appData) {
  return { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', APPDATA: appData };
}
function syntheticRuntime(directory) {
  for (const name of RUNTIME_MEMBERS) {
    if (name === 'Local State') fs.writeFileSync(path.join(directory, name), '{"syntheticFixture":true}');
    else {
      fs.mkdirSync(path.join(directory, name));
      fs.writeFileSync(path.join(directory, name, 'synthetic-cache'), Buffer.from([0, 1, 255]));
    }
  }
}
function syntheticLaunches(appData, events) {
  let count = 0;
  return async (executable, { fixture, fresh, profileArgument }) => {
    assert.equal(executable, 'synthetic-installed.exe');
    assert.equal(fixture.userDataPath, path.join(appData, 'bubu'));
    assert.equal(profileArgument, false);
    assert.equal(fixture.childClosed, false, 'caller clears stale close evidence before every child');
    const phase = count++;
    events.push(`launch-${phase}`);
    assert.equal(fresh, phase === 0);
    const marker = path.join(fixture.userDataPath, 'synthetic-authority');
    if (phase === 0) assert.deepEqual(fs.readdirSync(fixture.userDataPath), []);
    else if (phase === 2) assert.deepEqual(fs.readdirSync(fixture.userDataPath).sort(), [...RUNTIME_MEMBERS].sort());
    else assert.equal(fs.readFileSync(marker, 'utf8'), String(phase - 1));
    if (phase % 2 === 0) fs.writeFileSync(marker, String(phase));
    fixture.childClosed = true;
    return { authorityId: `synthetic-authority-${Math.floor(phase / 2)}`, revision: phase + 1,
      userDataOverrideSwitch: false, lockfileObserved: true, normalExit: true };
  };
}

test('default verification refuses non-Windows, non-CI and self-hosted machines before any profile work', async () => {
  const launch = () => assert.fail('must not launch');
  const seedRuntimeFixture = () => assert.fail('must not seed');
  for (const [platform, env, expected] of [
    ['linux', hosted('/unreadable'), /requires Windows/],
    ['win32', {}, /disposable GitHub Actions/],
    ['win32', { GITHUB_ACTIONS: 'true' }, /github-hosted/],
    ['win32', { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }, /github-hosted/]
  ]) await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', { platform, env, launch, seedRuntimeFixture }), expected);
});

test('default verification requires absolute existing APPDATA', async t => {
  const root = temporary(t);
  for (const appData of [undefined, '', 'relative', path.join(root, 'missing')]) {
    await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', {
      platform: 'win32', env: hosted(appData), launch: () => assert.fail('must not launch')
    }));
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

for (const type of ['directory', 'file', 'dangling-symlink']) {
  test(`default verification never touches a preexisting ${type}`, async t => {
    const root = temporary(t), target = path.join(root, 'bubu');
    if (type === 'directory') {
      fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'do-not-read'), 'daily-user-data');
    } else if (type === 'file') fs.writeFileSync(target, 'daily-user-data');
    else {
      try { fs.symlinkSync(path.join(root, 'missing-target'), target, 'junction'); }
      catch (error) { if (error.code === 'EPERM') return t.skip('symlink creation unavailable'); throw error; }
    }
    const before = fs.lstatSync(target, { bigint: true });
    await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', {
      platform: 'win32', env: hosted(root), launch: () => assert.fail('must not launch'),
      seedRuntimeFixture: () => assert.fail('must not inspect or seed')
    }), /default profile already exists/);
    const after = fs.lstatSync(target, { bigint: true });
    assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs);
    if (type === 'directory') assert.equal(fs.readFileSync(path.join(target, 'do-not-read'), 'utf8'), 'daily-user-data');
    if (type === 'file') assert.equal(fs.readFileSync(target, 'utf8'), 'daily-user-data');
  });
}

test('two independent default profiles each launch and reopen, with one exact runtime seed and no override', async t => {
  const root = temporary(t), events = [];
  fs.mkdirSync(path.join(root, 'another-app'));
  fs.writeFileSync(path.join(root, 'another-app', 'sentinel'), 'unrelated');
  const report = await verifyWindowsDefaultProfile('synthetic-installed.exe', {
    platform: 'win32', env: hosted(root), launch: syntheticLaunches(root, events),
    seedRuntimeFixture(fixture) {
      events.push('seed'); assert.deepEqual(fs.readdirSync(fixture.userDataPath), []);
      syntheticRuntime(fixture.userDataPath); return { acceptance: 'synthetic port only' };
    }
  });
  assert.deepEqual(events, ['launch-0', 'launch-1', 'seed', 'launch-2', 'launch-3']);
  assert.equal(report.emptyProfile.firstLaunch.authorityId, report.emptyProfile.reopen.authorityId);
  assert.equal(report.runtimeOnlyProfile.firstLaunch.authorityId, report.runtimeOnlyProfile.reopen.authorityId);
  assert.notEqual(report.emptyProfile.firstLaunch.authorityId, report.runtimeOnlyProfile.firstLaunch.authorityId);
  assert.equal(report.runtimeOnlyProfile.runtimeFixture.acceptance, 'synthetic port only');
  assert.equal(fs.existsSync(path.join(root, 'bubu')), false);
  assert.equal(fs.readFileSync(path.join(root, 'another-app', 'sentinel'), 'utf8'), 'unrelated');
});

for (const phase of [0, 1, 2, 3]) {
  for (const childClosed of [false, true]) {
    test(`failure during child ${phase} ${childClosed ? 'cleans the owned closed' : 'preserves the possibly live'} default profile`, async t => {
      const root = temporary(t), events = [], launch = syntheticLaunches(root, events);
      let launches = 0;
      const failure = new Error('synthetic launch failure');
      await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', {
        platform: 'win32', env: hosted(root),
        async launch(file, options) {
          if (launches++ === phase) {
            options.fixture.childClosed = childClosed;
            throw failure;
          }
          return launch(file, options);
        },
        seedRuntimeFixture(fixture) { syntheticRuntime(fixture.userDataPath); return {}; }
      }), error => error === failure);
      assert.equal(launches, phase + 1);
      assert.equal(fs.existsSync(path.join(root, 'bubu')), !childClosed);
      assert.equal(failure.defaultProfileDiagnostic.retained, !childClosed);
    });
  }
}

test('seed failure cleans only the owned default directory before any second-pair child starts', async t => {
  const root = temporary(t), events = [];
  await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', {
    platform: 'win32', env: hosted(root), launch: syntheticLaunches(root, events),
    seedRuntimeFixture() { throw new Error('synthetic seed failure'); }
  }), /synthetic seed failure/);
  assert.deepEqual(events, ['launch-0', 'launch-1']);
  assert.equal(fs.existsSync(path.join(root, 'bubu')), false);
});

test('runtime pair rejects any extra seed member, including a fabricated lockfile', async t => {
  const root = temporary(t), events = [];
  await assert.rejects(verifyWindowsDefaultProfile('synthetic-installed.exe', {
    platform: 'win32', env: hosted(root), launch: syntheticLaunches(root, events),
    seedRuntimeFixture(fixture) { syntheticRuntime(fixture.userDataPath); fs.writeFileSync(path.join(fixture.userDataPath, 'lockfile'), ''); }
  }), /exactly the native screenshot cache combination/);
  assert.deepEqual(events, ['launch-0', 'launch-1']);
  assert.equal(fs.existsSync(path.join(root, 'bubu')), false);
});

test('default cleanup refuses a replaced directory or an unclosed child', t => {
  const root = temporary(t), fixture = claimDefaultProfile(root);
  fixture.childClosed = false;
  assert.throws(() => removeOwnedDefaultProfile(fixture), /may be running/);
  fixture.childClosed = true;
  fs.renameSync(fixture.userDataPath, path.join(root, 'original-owned'));
  fs.mkdirSync(fixture.userDataPath);
  fs.writeFileSync(path.join(fixture.userDataPath, 'sentinel'), 'replacement');
  assert.throws(() => removeOwnedDefaultProfile(fixture), /ownership changed/);
  assert.equal(fs.readFileSync(path.join(fixture.userDataPath, 'sentinel'), 'utf8'), 'replacement');
});

function seedPorts(t, changes = {}) {
  const root = temporary(t), target = path.join(root, 'target'); fs.mkdirSync(target);
  let source;
  t.after(() => { if (source) fs.rmSync(path.dirname(source), { recursive: true, force: true }); });
  const options = {
    platform: 'win32', env: { ...hosted(root), electron_run_as_node: '1', ELECTRON_RUN_AS_NODE: '' },
    electronExecutable: 'synthetic-electron.exe', electronVersion: '44.4.5',
    execFile(executable, argv, settings) {
      assert.equal(executable, 'synthetic-electron.exe');
      assert.equal(argv[1], '--fixture-child');
      assert.equal(path.basename(argv[0]), 'probe-windows-runtime-fixture.js');
      assert.equal(argv[2], '--fixture-minimal');
      source = argv[3].slice('--user-data-dir='.length);
      assert.equal(settings.timeout, 30000); assert.equal(settings.maxBuffer, 65536);
      assert.equal(Object.keys(settings.env).some(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE'), false);
      assert.deepEqual(fs.readdirSync(source), []);
      syntheticRuntime(source);
      fs.writeFileSync(path.join(source, 'Preferences'), 'synthetic runtime extra, excluded');
      changes.source?.(source);
      if (changes.error) throw changes.error;
      assert.deepEqual(fs.readFileSync(settings.env.BUBU_RUNTIME_FIXTURE_EVENTS), Buffer.alloc(0));
      fs.appendFileSync(settings.env.BUBU_RUNTIME_FIXTURE_EVENTS,
        '{"event":"ready","elapsedMs":100}\n{"event":"will-quit","elapsedMs":200}\n');
      return Buffer.alloc(0);
    }
  };
  return { target, options, get source() { return source; } };
}

test('seed orchestration copies exact synthetic native-port bytes and removes only the closed temporary source', t => {
  const ports = seedPorts(t);
  const report = seedWindowsRuntimeFixture({ userDataPath: ports.target }, ports.options);
  assert.equal(report.electronVersion, '44.4.5');
  assert.deepEqual(fs.readdirSync(ports.target).sort(), [...RUNTIME_MEMBERS].sort());
  assert.equal(fs.readFileSync(path.join(ports.target, 'Local State'), 'utf8'), '{"syntheticFixture":true}');
  for (const name of RUNTIME_MEMBERS.filter(name => name !== 'Local State')) {
    assert.deepEqual(fs.readFileSync(path.join(ports.target, name, 'synthetic-cache')), Buffer.from([0, 1, 255]));
  }
  assert.equal(report.members.length, 7);
  assert.deepEqual(report.localStateShape, { syntheticFixture: 'boolean' });
  assert.equal(fs.existsSync(ports.source), false);
  assert.equal(fs.existsSync(path.join(ports.target, 'lockfile')), false);
});

test('seed orchestration requires pinned Electron and hosted Windows before launching anything', t => {
  const root = temporary(t);
  const fixture = { userDataPath: root };
  const execFile = () => assert.fail('must not run Electron');
  assert.throws(() => seedWindowsRuntimeFixture(fixture, { platform: 'linux', env: hosted(root), execFile }), /requires Windows/);
  assert.throws(() => seedWindowsRuntimeFixture(fixture, { platform: 'win32', env: { ...hosted(root), RUNNER_ENVIRONMENT: 'self-hosted' }, execFile }), /github-hosted/);
  assert.throws(() => seedWindowsRuntimeFixture(fixture, { platform: 'win32', env: hosted(root), electronVersion: '45.0.0', execFile }), /pinned Electron/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('seed orchestration preserves a temporary source when native child completion is uncertain', t => {
  const failure = Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' });
  const ports = seedPorts(t, { error: failure });
  assert.throws(() => seedWindowsRuntimeFixture({ userDataPath: ports.target }, ports.options), error => error === failure);
  assert.equal(fs.existsSync(ports.source), true);
  assert.deepEqual(fs.readdirSync(ports.target), []);
});

test('seed orchestration refuses business data in its pure runtime source', t => {
  const ports = seedPorts(t, { source: source => fs.writeFileSync(path.join(source, 'config.sqlite'), 'unexpected') });
  assert.throws(() => seedWindowsRuntimeFixture({ userDataPath: ports.target }, ports.options), /must not contain business data/);
  assert.deepEqual(fs.readdirSync(ports.target), []);
  assert.equal(fs.existsSync(ports.source), false);
});

for (const invalid of ['missing-cache', 'file-instead-of-cache', 'directory-instead-of-local-state', 'oversized-local-state', 'hardlinked-cache', 'symlinked-cache']) {
  test(`runtime copy rejects ${invalid} without manufacturing missing runtime content`, t => {
    const root = temporary(t), source = path.join(root, 'source'), target = path.join(root, 'target');
    fs.mkdirSync(source); fs.mkdirSync(target); syntheticRuntime(source);
    const cache = path.join(source, 'GPUPersistentCache'), localState = path.join(source, 'Local State');
    if (invalid === 'missing-cache') fs.rmSync(cache, { recursive: true });
    if (invalid === 'file-instead-of-cache') { fs.rmSync(cache, { recursive: true }); fs.writeFileSync(cache, 'wrong'); }
    if (invalid === 'directory-instead-of-local-state') { fs.unlinkSync(localState); fs.mkdirSync(localState); }
    if (invalid === 'oversized-local-state') fs.writeFileSync(localState, Buffer.alloc(65537));
    if (invalid === 'hardlinked-cache') fs.linkSync(path.join(cache, 'synthetic-cache'), path.join(root, 'extra-link'));
    if (invalid === 'symlinked-cache') {
      fs.renameSync(cache, path.join(root, 'cache'));
      try { fs.symlinkSync(path.join(root, 'cache'), cache, 'junction'); }
      catch (error) { if (error.code === 'EPERM') return t.skip('symlink creation unavailable'); throw error; }
    }
    assert.throws(() => copyRuntimeMembers(source, target));
    assert.equal(fs.existsSync(path.join(target, 'lockfile')), false);
  });
}
