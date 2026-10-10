'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyProfileLaunch } = require('./installed-first-launch');
const { installedElectronEnvironment } = require('./installed-electron-environment');
const { shape, readFixtureEvents } = require('./probe-windows-runtime-fixture');

const ELECTRON_VERSION = '44.4.5';
const RUNTIME_MEMBERS = Object.freeze(['GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'Local State']);

function assertHostedWindows(platform, env) {
  assert.equal(platform, 'win32', 'default-profile verification requires Windows');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'default-profile verification requires a disposable GitHub Actions runner');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'default-profile verification requires a disposable github-hosted runner');
}

function assertAbsent(target) {
  try { fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.fail('default profile already exists; no existing profile may be read, replaced, or removed');
}

function claimDefaultProfile(appData) {
  assert.ok(typeof appData === 'string' && path.isAbsolute(appData), 'absolute native APPDATA is required');
  const parent = fs.lstatSync(appData);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink(), 'APPDATA must be an existing ordinary directory');
  const userDataPath = path.join(appData, 'bubu');
  assertAbsent(userDataPath);
  // mkdir without recursive is the exclusive claim. An intervening creation
  // fails; no recovery path adopts or removes the other process's directory.
  fs.mkdirSync(userDataPath);
  const identity = fs.lstatSync(userDataPath, { bigint: true });
  return { userDataPath, identity, childClosed: true };
}

function removeOwnedDefaultProfile(fixture) {
  assert.equal(fixture.childClosed, true, 'cannot remove a profile while its application child may be running');
  const current = fs.lstatSync(fixture.userDataPath, { bigint: true });
  assert.ok(current.isDirectory() && !current.isSymbolicLink()
    && current.dev === fixture.identity.dev && current.ino === fixture.identity.ino,
  'default-profile directory ownership changed; preserve it');
  fs.rmSync(fixture.userDataPath, { recursive: true, force: false });
}

// Only copies a verifier-owned pure-Electron fixture. This is not a profile
// admission allowlist and must never be used to inspect a person's profile.
function copyRuntimeMembers(source, destination) {
  assert.deepEqual(fs.readdirSync(destination), [], 'runtime fixture destination must be empty');
  const members = [];
  let totalBytes = 0;
  function copy(relative, depth = 0) {
    assert.ok(depth < 12 && members.length < 2000, 'runtime fixture exceeds bounded tree size');
    const input = path.join(source, relative), output = path.join(destination, relative);
    const stat = fs.lstatSync(input);
    assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)),
      'runtime fixture members must be ordinary directories or single-link files');
    if (depth === 0) assert.equal(stat.isDirectory(), relative !== 'Local State', 'runtime fixture member has the wrong type');
    if (stat.isDirectory()) {
      members.push({ path: relative.replaceAll(path.sep, '/'), kind: 'directory' });
      fs.mkdirSync(output);
      for (const name of fs.readdirSync(input).sort()) copy(path.join(relative, name), depth + 1);
    } else {
      totalBytes += stat.size;
      assert.ok(totalBytes <= 64 * 1024 * 1024, 'runtime fixture exceeds byte bound');
      if (relative === 'Local State') assert.ok(stat.size <= 65536, 'Local State exceeds fixture bound');
      fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
      const bytes = fs.readFileSync(output);
      assert.deepEqual(bytes, fs.readFileSync(input), 'runtime fixture must retain native bytes');
      members.push({ path: relative.replaceAll(path.sep, '/'), kind: 'file', bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  for (const name of RUNTIME_MEMBERS) copy(name);
  assert.deepEqual(fs.readdirSync(destination).sort(), [...RUNTIME_MEMBERS].sort());
  return { members, localStateShape: shape(JSON.parse(fs.readFileSync(path.join(destination, 'Local State'), 'utf8'))) };
}

function seedWindowsRuntimeFixture(fixture, { platform = process.platform, env = process.env,
  execFile = execFileSync, electronExecutable, electronVersion } = {}) {
  assertHostedWindows(platform, env);
  electronVersion ??= require('electron/package.json').version;
  assert.equal(electronVersion, ELECTRON_VERSION, 'native runtime fixture requires the pinned Electron version');
  electronExecutable ??= require('electron');
  assert.deepEqual(fs.readdirSync(fixture.userDataPath), [], 'runtime seed target must be genuinely empty');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-default-runtime-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  const eventsFile = path.join(root, 'events.jsonl');
  fs.writeFileSync(eventsFile, '', { flag: 'wx' });
  let childClosed = false;
  try {
    // This script starts minimal pure Electron without a renderer and quits. It never
    // loads production main or creates business data. No Local State is made up.
    execFile(electronExecutable, [path.join(__dirname, 'probe-windows-runtime-fixture.js'),
      '--fixture-child', '--fixture-minimal', `--user-data-dir=${profile}`], {
      env: { ...installedElectronEnvironment(env), BUBU_RUNTIME_FIXTURE_EVENTS: eventsFile },
      stdio: 'pipe', timeout: 30000, maxBuffer: 65536
    });
    childClosed = true;
    const events = readFixtureEvents(eventsFile);
    assert.ok(events.some(event => event.event === 'ready'), 'native runtime readiness evidence missing');
    assert.ok(events.some(event => event.event === 'will-quit'), 'native runtime graceful quit evidence missing');
    for (const name of ['config.json', 'config.sqlite', 'config.sqlite.identity.sqlite', 'bubu.sqlite']) {
      assert.equal(fs.existsSync(path.join(profile, name)), false, 'pure runtime fixture must not contain business data');
    }
    return { electronVersion, ...copyRuntimeMembers(profile, fixture.userDataPath),
      acceptance: 'native pure Electron runtime bytes copied from a disposable temporary profile; no business profile, secret fixture fabrication, or user data copied' };
  } finally {
    // A timeout or failed spawn may leave a native process using the source.
    // Preserve that temporary source rather than guessing that it is closed.
    if (childClosed) fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyDefaultPair(executable, { appData, runtime, launch, seedRuntimeFixture }) {
  const fixture = claimDefaultProfile(appData);
  let stage = runtime ? 'runtime-seed' : 'empty-profile';
  try {
    let runtimeFixture;
    if (runtime) {
      runtimeFixture = await seedRuntimeFixture(fixture);
      assert.deepEqual(fs.readdirSync(fixture.userDataPath).sort(), [...RUNTIME_MEMBERS].sort(),
        'seed must contain exactly the native screenshot cache combination');
      assert.equal(fs.existsSync(path.join(fixture.userDataPath, 'lockfile')), false,
        'the installed app, not the verifier, must create its native singleton lock');
    } else assert.deepEqual(fs.readdirSync(fixture.userDataPath), [], 'independent default profile must be truly empty');
    stage = 'first-launch';
    fixture.childClosed = false;
    const firstLaunch = await launch(executable, { fixture, fresh: !runtime, profileArgument: false });
    assert.equal(fixture.childClosed, true, 'first launch child must close before reopening');
    stage = 'reopen';
    fixture.childClosed = false;
    const reopen = await launch(executable, { fixture, fresh: false, profileArgument: false });
    assert.equal(fixture.childClosed, true, 'reopened child must close before cleanup');
    for (const result of [firstLaunch, reopen]) {
      assert.equal(result.userDataOverrideSwitch, false, 'native default launch must not override its profile');
      assert.equal(result.lockfileObserved, true, 'native installed app must create its own zero-byte lockfile');
    }
    assert.equal(reopen.authorityId, firstLaunch.authorityId, 'reopen must preserve the same authority identity');
    assert.ok(reopen.revision >= firstLaunch.revision, 'reopen must preserve the committed authority');
    return { ...(runtime ? { runtimeFixture } : {}), firstLaunch, reopen };
  } catch (error) {
    error.defaultProfileDiagnostic = { scenario: runtime ? 'runtime-only' : 'empty', stage,
      childClosed: fixture.childClosed === true, retained: fixture.childClosed !== true };
    throw error;
  } finally {
    if (fixture.childClosed) removeOwnedDefaultProfile(fixture);
  }
}

async function verifyWindowsDefaultProfile(executable, { platform = process.platform, env = process.env,
  launch = verifyProfileLaunch, seedRuntimeFixture = fixture => seedWindowsRuntimeFixture(fixture, { platform, env }) } = {}) {
  assertHostedWindows(platform, env);
  const ports = { appData: env.APPDATA, launch, seedRuntimeFixture };
  const emptyProfile = await verifyDefaultPair(executable, { ...ports, runtime: false });
  const runtimeOnlyProfile = await verifyDefaultPair(executable, { ...ports, runtime: true });
  assert.notEqual(emptyProfile.firstLaunch.authorityId, runtimeOnlyProfile.firstLaunch.authorityId,
    'independent empty and runtime-only cases must mint distinct authorities');
  return { emptyProfile, runtimeOnlyProfile,
    acceptance: 'disposable hosted Windows runner only; actual APPDATA/bubu, no user-data-dir override; independent empty and pure-runtime cache profiles each launch and reopen; no daily-user profile or manual OS trust acceptance asserted' };
}

if (require.main === module) verifyWindowsDefaultProfile(process.argv[2])
  .then(report => console.log(JSON.stringify(report, null, 2)))
  .catch(error => { console.error(error.stack); process.exitCode = 1; });

module.exports = { RUNTIME_MEMBERS, claimDefaultProfile, removeOwnedDefaultProfile, copyRuntimeMembers,
  seedWindowsRuntimeFixture, verifyWindowsDefaultProfile };
