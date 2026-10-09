'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { assertCanonicalPersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { summarizeStartupOutput, waitForOutcome } = require('./verify-macos-install');
const ELECTRON = "process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json')('electron')";
const QUIT = `setTimeout(() => ${ELECTRON}.app.quit(), 100); true`;

function createEmptyProfile() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-first-launch-')));
  const userDataPath = path.join(root, 'profile');
  fs.mkdirSync(userDataPath);
  assert.deepEqual(fs.readdirSync(userDataPath), []);
  return { root, userDataPath };
}

// Never create/repair an authority while checking whether the app created one.
// This runs only after the exact child closes, with SQLite read-only handles.
function readFreshAuthority(userDataPath) {
  const files = ['config.sqlite', 'config.sqlite.identity.sqlite'];
  for (const name of files) {
    const stat = fs.lstatSync(path.join(userDataPath, name));
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'regular SQL authority required');
  }
  assert.equal(fs.existsSync(path.join(userDataPath, 'config.json')), false);
  const identity = new DatabaseSync(path.join(userDataPath, files[1]), { readOnly: true });
  let database;
  try {
    database = new DatabaseSync(path.join(userDataPath, files[0]), { readOnly: true });
    assert.equal(identity.prepare('PRAGMA application_id').get().application_id, 0x42554255);
    const binding = identity.prepare('SELECT * FROM config_identity').all();
    assert.equal(binding.length, 1);
    assert.equal(binding[0].phase, 'READY');
    assert.equal(binding[0].source_exists, 0, 'first launch must not import an existing config');
    assert.equal(database.prepare('PRAGMA application_id').get().application_id, binding[0].application_id);
    const rows = database.prepare('SELECT * FROM config_snapshot').all();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.authority_id, binding[0].authority_id);
    assert.ok(Number.isSafeInteger(row.revision) && row.revision > 0);
    assert.equal(row.payload_version, PERSISTED_SCHEMA_VERSION);
    assert.equal(row.payload_hash, createHash('sha256').update(row.payload_json).digest('hex'));
    const state = JSON.parse(row.payload_json);
    assertCanonicalPersistedState(state);
    assert.deepEqual(state.tasks, [], 'fresh app must not contain seeded tasks');
    return { authorityId: binding[0].authority_id, revision: row.revision, brand: 'BUBU', identityPhase: 'READY', schemaVersion: row.payload_version };
  } finally { database?.close(); identity.close(); }
}

function connectInspector(url) {
  assert.match(url, /^ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/);
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(String(event.data));
    const receiver = pending.get(response.id);
    if (!receiver) return;
    pending.delete(response.id);
    clearTimeout(receiver.timer);
    if (response.error || response.result?.exceptionDetails) receiver.reject(new Error('installed inspector evaluation failed'));
    else receiver.resolve(response.result?.result?.value);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('inspector connection timeout')); }, 5000);
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('inspector connection failed')); }, { once: true });
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        evaluate(expression, timeoutMs = 5000) {
          assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, 'bounded inspector request budget required');
          const id = ++nextId;
          return new Promise((done, fail) => {
            const timer = setTimeout(() => { pending.delete(id); fail(new Error('inspector request timeout')); }, timeoutMs);
            pending.set(id, { resolve: done, reject: fail, timer });
            socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
          });
        },
        close() { socket.close(); }
      });
    }, { once: true });
  });
}

// Native Windows bootstrap performs synchronous, real DACL inspections. A
// queued main-thread evaluation can therefore take longer than a loopback
// connection or quit request. Share one monotonic readiness budget across all
// probes instead of multiplying a long per-request timeout by the poll count.
async function waitForInstalledWindow(inspector, completion, { wait = waitForOutcome,
  now = () => performance.now(), budgetMs = 120000 } = {}) {
  assert.ok(Number.isFinite(budgetMs) && budgetMs > 0 && budgetMs <= 120000, 'bounded readiness budget required');
  const deadline = now() + budgetMs;
  for (let probes = 0; probes < 480; probes++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const ready = await inspector.evaluate(`(() => { const e = ${ELECTRON}; return e.app.isReady() && e.BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isVisible() && !w.webContents.isLoading() && w.webContents.getURL().startsWith('file:')); })()`, remaining);
    if (now() >= deadline) break;
    if (ready === true) return;
    assert.equal(await wait(completion, Math.min(250, deadline - now())), null, 'installed app exited before UI boot');
  }
  throw new Error('production app did not finish a visible local window within readiness deadline');
}

async function verifyProfileLaunch(executable, { fixture, fresh = true, spawnChild = spawn, connect = connectInspector,
  wait = waitForOutcome, createProfile = createEmptyProfile, readProfile = readFreshAuthority } = {}) {
  const ownedFixture = !fixture;
  fixture ||= createProfile();
  let child, closed = false, completion, inspector, failure;
  let output = '', omitted = 0, stage = 'empty-profile';
  try {
    if (fresh) assert.deepEqual(fs.readdirSync(fixture.userDataPath), [], 'profile must be genuinely empty before executable launch');
    stage = 'launch';
    child = spawnChild(executable, [`--user-data-dir=${fixture.userDataPath}`, '--inspect=127.0.0.1:0'], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
    });
    const capture = data => {
      const text = String(data), available = Math.max(0, 65536 - output.length);
      output += text.slice(0, available); omitted += Math.max(0, text.length - available);
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    completion = new Promise(resolve => {
      let error;
      child.once('error', caught => { error = caught; });
      child.once('close', (code, signal) => { closed = true; resolve({ code, signal, error }); });
    });
    for (let attempt = 0; attempt < 30 && !inspector; attempt++) {
      assert.equal(await wait(completion, 200), null, 'installed app exited before inspector readiness');
      const url = output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/)?.[1];
      if (url) inspector = await connect(url);
    }
    assert.ok(inspector, 'loopback child inspector not ready');
    stage = 'production-window-readiness';
    await waitForInstalledWindow(inspector, completion, { wait });
    assert.equal(await wait(completion, 1000), null, 'installed app exited after readiness');
    const lockfile = path.join(fixture.userDataPath, 'lockfile');
    const lockfileObserved = fs.existsSync(lockfile) && fs.lstatSync(lockfile).isFile() && fs.lstatSync(lockfile).size === 0;
    if (process.platform === 'win32') assert.equal(lockfileObserved, true, 'Windows production singleton lockfile must be observed');
    stage = 'graceful-quit';
    await inspector.evaluate(QUIT);
    inspector.close(); inspector = null;
    const outcome = await wait(completion, 10000);
    assert.ok(outcome, 'installed app did not quit cleanly');
    assert.ifError(outcome.error);
    assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
    assert.equal(omitted, 0, 'startup diagnostic output limit exceeded');
    assert.equal(/App threw an error|ReferenceError|TypeError|Uncaught|UnhandledPromiseRejection|config-profile-brand-required/.test(output), false, 'installed startup reported an error');
    stage = 'closed-authority-verification';
    return { ...readProfile(fixture.userDataPath), visibleLocalWindowReady: true, normalExit: true, lockfileObserved,
      acceptance: 'installed executable, genuinely empty profile, production bootstrap; loopback inspector observes UI readiness and requests app.quit; no manual UI or OS trust acceptance asserted' };
  } catch (error) {
    failure = error;
    error.diagnostic = { stage, closed, omitted,
      startupCodes: [...new Set(output.match(/config-(?:profile-brand-required|profile-brand-mismatch|identity-invalid|authority-invalid)/g) || [])],
      profileFiles: Object.fromEntries(['lockfile', 'Preferences', 'Local State', 'config.sqlite', 'config.sqlite.identity.sqlite', 'bubu.sqlite'].map(name => [name, fs.existsSync(path.join(fixture.userDataPath, name))])),
      output: summarizeStartupOutput(output) };
    throw error;
  } finally {
    if (failure && inspector && !closed) {
      try {
        await inspector.evaluate(QUIT);
        inspector.close(); inspector = null;
        const outcome = await wait(completion, 5000);
        failure.diagnostic.failureQuitClean = !!outcome && outcome.code === 0 && outcome.signal === null;
      } catch (_) { failure.diagnostic.failureQuitClean = false; }
    }
    inspector?.close();
    if (child && !closed) { child.kill('SIGKILL'); await wait(completion, 5000); }
    if (failure) failure.diagnostic.childClosedAfterCleanup = closed;
    if (ownedFixture && (!child || closed)) fs.rmSync(fixture.root, { recursive: true, force: true });
    fixture.childClosed = !child || closed;
  }
}
async function verifyFreshLaunch(executable, ports = {}) {
  const fixture = (ports.createProfile || createEmptyProfile)();
  try {
    const firstLaunch = await verifyProfileLaunch(executable, { ...ports, fixture, fresh: true });
    const reopen = await verifyProfileLaunch(executable, { ...ports, fixture, fresh: false });
    assert.equal(reopen.authorityId, firstLaunch.authorityId, 'reopen must preserve the same authority identity');
    assert.ok(reopen.revision >= firstLaunch.revision, 'reopen must preserve the committed authority');
    return { firstLaunch, reopen };
  } finally {
    if (fixture.childClosed) fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}
module.exports = { createEmptyProfile, readFreshAuthority, connectInspector, waitForInstalledWindow, verifyProfileLaunch, verifyFreshLaunch };
