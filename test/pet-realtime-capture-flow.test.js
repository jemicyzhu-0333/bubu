'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { collectRealtime } = require('../tools/pet-realtime-capture/collect.mjs');
const { runCapture, captureEnvironment } = require('../tools/pet-realtime-capture/run.mjs');
const { createCaptureReport } = require('../tools/pet-realtime-capture/report.mjs');
const { decodeCapturePackage } = require('../tools/pet-realtime-capture/package.mjs');
const { saveCapture, sourceIdentity } = require('../tools/pet-realtime-capture/evidence.mjs');
const { createOwnedWindowPort } = require('../tools/pet-realtime-capture/window-port.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jXcAAAAASUVORK5CYII=', 'base64');
const GOOD = { code: 0, signal: null, elapsedMs: 1, stopReason: 'exited', cleanup: { requested: true, confirmed: true, errors: [] }, stdout: '', stderr: '' };
function capturePorts({ gap = false, stale = false } = {}) {
  let now = 0, generation = 0, sequence = 0, rendered = 1, paused = false, closed = false, down = false, mode = 'idle';
  const rows = [], mutations = [];
  return { mutations, now: () => now, signal: new AbortController().signal,
    async delay(ms) { now += ms; if (!paused && !closed) { for (let i = 0; i < Math.max(1, Math.floor(ms / 16)); i++) {
      sequence++; rendered++; rows.push({ sequence, atMs: now - ms + i * 16, frameIntervalMs: 16, updateMs: 2, renderSubmissionMs: 1 });
    } if (down && mode === 'pending') mode = 'petting'; else if (!down && mode === 'landing') mode = 'idle'; } },
    async read({ afterSequence }) { const filtered = rows.filter(item => item.sequence > afterSequence);
      if (gap && filtered.length) filtered.shift();
      return { schemaVersion: 1, instanceId: stale && generation ? 'generation-0' : `generation-${generation}`, ready: true, closed,
        time: paused ? 0 : now / 1000, frameScheduled: !paused && !closed, pendingOperations: 0,
        startup: { readyMs: 100 + generation, firstFrame: { renderSubmissionMs: 50 + generation } },
        frames: { epoch: 0, rows: filtered, lastSequence: sequence, overwrittenSinceCursor: gap && filtered.length ? 1 : 0, remaining: 0 },
        stage: { mode, pointerId: down ? 1 : null, captured: down, pendingCount: 0, renderedFrames: rendered,
          inputTargets: { body: { x: 110, y: 90 } }, graphics: { renderer: 'SwiftShader' }, resources: { geometries: closed ? 0 : 5, textures: 2 },
          pool: { pending: 0, actors: closed ? 0 : 1, budget: { claimedBytes: closed ? 0 : 123 } } }, events: { rows: [] }, errors: [] };
    },
    async input(type) { mutations.push(type); if (type === 'mouseDown') { down = true; mode = 'pending'; }
      if (type === 'mouseMove' && down) mode = 'drag'; if (type === 'mouseUp') { down = false; mode = 'landing'; } },
    async cancel() { mutations.push('cancel'); mode = 'idle'; down = false; }, async pause(value) { paused = value; },
    async dispose() { closed = true; down = false; mode = 'disposed'; },
    async reload() { generation++; sequence = 0; rows.length = 0; rendered = 1; closed = false; mode = 'idle'; },
    async screenshot() { return PNG; }, async processes() { return { metrics: [] }; } };
}
test('fixed collector completes all bounded phases/reloads and packages raw observations without native acceptance', async () => {
  const report = createCaptureReport({ runId: 'test' }), ports = capturePorts();
  await collectRealtime(report, ports);
  assert(report.frames.length > 500); assert(report.frames.length < 18000);
  assert.equal(report.screenshots.length, 5); assert.equal(report.capture.lifecycle.length, 3);
  assert.equal(report.capture.pause.timeFrozen, true); assert.equal(report.capture.pause.redrawsStopped, true);
  assert(report.phases.filter(p => p.id.startsWith('synthetic')).every(p => p.inputSource === 'Electron-injected-not-OS'));
  assert(report.phases.some(p => p.id === 'warmup' && p.performancePhase === false));
  assert.equal(new Set(report.frames.map(p => p.sequence)).size, report.frames.length);
  assert.deepEqual(report.capture.resourceSamples.map(sample => [sample.instanceId, sample.startup.readyMs]),
    [['generation-0', 100], ['generation-0', 100], ['generation-1', 101], ['generation-2', 102]]);
  const packaged = require('../tools/pet-realtime-capture/report.mjs').finalizeReport(report);
  assert.equal(packaged.capture.resourceSamples.at(-1).startup.firstFrame.renderSubmissionMs, 52);
});
test('collector records lost frames and rejects reuse of a prior navigation instance', async () => {
  const report = createCaptureReport({ runId: 'loss' }); await collectRealtime(report, capturePorts({ gap: true }), { screenshots: false });
  assert(report.phases.some(p => p.lostSamples > 0));
  const stale = createCaptureReport({ runId: 'stale' });
  await assert.rejects(collectRealtime(stale, capturePorts({ stale: true })), /reused-diagnostic/);
  assert.equal(stale.capture.status, 'partial');
});
function launcherFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-capture-unit-'));
  fs.mkdirSync(path.join(root, 'research/animation-0.1.0'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'research/animation-0.1.0/package-lock.json']) fs.writeFileSync(path.join(root, file), '{}');
  const profileRoot = path.join(root, 'owned-profile'); fs.mkdirSync(profileRoot); const userDataPath = path.join(profileRoot, 'profile-dev'); fs.mkdirSync(userDataPath);
  const profile = { root: profileRoot, userDataPath, initial: require('../tools/dev-bench/scenarios').buildScenario('realtime-capture', Date.UTC(2026, 10, 1)) };
  const source = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false, criticalDigest: 'c'.repeat(64) };
  let step = 0, removed = 0;
  const overrides = { root, env: {}, signals: new EventEmitter(), makeRunId: () => 'unit-run', log() {},
    identify: () => ({ ...source }), profileFactory: (_options, directory) => {
      if (process.platform !== 'win32') { assert(directory.startsWith(fs.realpathSync('/tmp') + path.sep)); assert(Buffer.byteLength(directory) < 64); }
      profile.root = path.join(directory, 'fixture'); profile.userDataPath = path.join(profile.root, 'profile-dev');
      fs.mkdirSync(profile.userDataPath, { recursive: true });
      for (const name of ['config.sqlite', 'config.sqlite.identity.sqlite']) fs.writeFileSync(path.join(profile.userDataPath, name), 'synthetic fixture authority'); return profile; }, removeProfile: () => { removed++; }, resolveElectron: () => '/fake/electron',
    async runProcess(_cmd, args) { step++; const arg = args.find(value => value.startsWith('--capture-request='));
      if (arg) { const request = JSON.parse(fs.readFileSync(arg.slice(18), 'utf8'));
        const report = createCaptureReport({ runId: request.runId, source: request.source });
        report.capture = { status: 'completed' }; report.endSource = source;
        fs.writeFileSync(request.reportFile, JSON.stringify(report)); }
      return { ...GOOD }; } };
  return { root, overrides, steps: () => step, removed: () => removed, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('one launcher command treats supervisor normal exited cleanup as success and saves a verified result', async () => {
  const f = launcherFixture(); try {
    const result = await runCapture([], f.overrides); assert.equal(result.code, 0); assert.equal(f.steps(), 2); assert.equal(f.removed(), 1);
    const report = decodeCapturePackage(fs.readFileSync(result.output)); assert.equal(report.status, 'completed');
    assert.equal(report.gates.osInput, 'not-accepted'); assert.equal(report.launch.stopReason, 'exited');
  } finally { f.cleanup(); }
});
test('profile cleanup rejection retains its parent without bypassing ownership and still flushes a nonpassing package', async () => {
  const f = launcherFixture(); let ownedRoot, rootRemovals = 0;
  try {
    const create = f.overrides.profileFactory;
    f.overrides.profileFactory = (...args) => { ownedRoot = args[1]; return create(...args); };
    f.overrides.removeProfile = () => { throw new Error('private fixture cleanup detail'); };
    f.overrides.removeRunDirectory = () => { rootRemovals++; };
    const result = await runCapture([], f.overrides), report = decodeCapturePackage(fs.readFileSync(result.output));
    assert.equal(result.code, 2); assert.equal(rootRemovals, 0); assert(fs.existsSync(path.join(ownedRoot, 'fixture/profile-dev')));
    assert.equal(report.status, 'capture-complete-cleanup-unverified'); assert.equal(report.retainedOwnedDirectories, true);
    assert.deepEqual(report.directoryCleanup, { confirmed: false, code: 'fixture-cleanup-rejected' });
    assert.doesNotMatch(JSON.stringify(report), /private fixture cleanup detail/);
  } finally { if (ownedRoot) fs.rmSync(ownedRoot, { recursive: true, force: true }); f.cleanup(); }
});
test('run directory removal error cannot discard the result package or upgrade a partial run', async () => {
  const f = launcherFixture(); let ownedRoot;
  try {
    const create = f.overrides.profileFactory;
    f.overrides.profileFactory = (...args) => { ownedRoot = args[1]; return create(...args); };
    f.overrides.removeRunDirectory = directory => { ownedRoot = directory; throw new Error('private filesystem detail'); };
    for (const failBeforeCollect of [false, true]) {
      f.overrides.makeRunId = () => `cleanup-${failBeforeCollect}`;
      if (failBeforeCollect) f.overrides.resolveElectron = () => { throw new Error('fixture startup failed'); };
      const result = await runCapture([], f.overrides), report = decodeCapturePackage(fs.readFileSync(result.output));
      assert.equal(result.code, 2); assert(fs.existsSync(ownedRoot)); assert.equal(report.retainedOwnedDirectories, true);
      assert.equal(report.status, failBeforeCollect ? 'partial-or-setup-failed' : 'capture-complete-cleanup-unverified');
      assert.deepEqual(report.directoryCleanup, { confirmed: false, code: 'run-directory-cleanup-incomplete' });
      assert.doesNotMatch(JSON.stringify(report), /private filesystem detail/);
      fs.rmSync(ownedRoot, { recursive: true, force: true }); ownedRoot = null;
    }
  } finally { if (ownedRoot) fs.rmSync(ownedRoot, { recursive: true, force: true }); f.cleanup(); }
});
test('closed external-profile arguments produce a bounded failure package without launching or touching that profile', async () => {
  const f = launcherFixture(); try {
    const result = await runCapture(['--user-data-dir=/foreign/profile'], f.overrides);
    assert.equal(result.code, 2); assert.equal(f.steps(), 0); assert(fs.statSync(result.output).size < 65536);
    const report = decodeCapturePackage(fs.readFileSync(result.output)); assert.equal(report.launch.executed, false);
  } finally { f.cleanup(); }
});
test('dependency/start failure and unknown child cleanup both preserve honest partial status', async () => {
  const f = launcherFixture(); try {
    f.overrides.runProcess = async () => ({ ...GOOD, code: 1, cleanup: { confirmed: false, requested: true, errors: ['denied'] } });
    const result = await runCapture([], f.overrides); assert.equal(result.code, 2); assert.equal(f.removed(), 0);
    const report = decodeCapturePackage(fs.readFileSync(result.output)); assert(report.errors.length); assert.notEqual(report.status, 'completed');
  } finally { f.cleanup(); }
});
test('output admission never overwrites a file or symlink; environment uses only a known whitelist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-package-unit-'));
  try { const file = path.join(dir, 'result.gz'), report = createCaptureReport({ runId: 'save' }); saveCapture(file, report);
    const original = fs.readFileSync(file); assert.throws(() => saveCapture(file, report), /EEXIST/); assert(fs.readFileSync(file).equals(original));
    const source = new Proxy({ PATH: 'safe', BUBU_AI_API_KEY: 'secret', HOSTNAME: 'private' }, { ownKeys() { assert.fail('must not enumerate real environment'); } });
    const env = captureEnvironment(source, '/owned-home'); assert.equal(env.PATH, 'safe'); assert.equal(env.HOSTNAME, undefined); assert.equal(env.BUBU_AI_API_KEY, undefined);
    assert.equal(env.HOME, '/owned-home');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('critical source identity refuses symlink traversal rather than reading an unrelated directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-source-unit-'));
  try { fs.mkdirSync(path.join(dir, 'outside')); fs.writeFileSync(path.join(dir, 'outside/data'), 'safe fixture');
    try { fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, 'link'), 'dir'); }
    catch (error) { if (error.code === 'EPERM') { t.skip('symlink creation unavailable on this host'); return; } throw error; }
    assert.throws(() => sourceIdentity(dir, { files: ['link/data'], exec: () => '' }), /symlink/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('owned window port denies foreign URLs and late responses from prior navigation', async () => {
  const contents = new EventEmitter(); let url = pathToFileURL('/fixture/index.html').href, resolve;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => url,
    executeJavaScript: () => new Promise(yes => { resolve = yes; }), sendInputEvent() {} });
  const window = { isDestroyed: () => false, webContents: contents, getContentBounds: () => ({ x: 50, y: 80, width: 220, height: 220 }) };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true, timeoutMs: 30, startupTimeoutMs: 30 });
  const pending = port.read({ afterSequence: 0 }); port.close(); resolve({ instanceId: 'old' }); await assert.rejects(pending, /owner-invalid/);
  const foreign = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true });
  url = 'https://unrelated.invalid'; await assert.rejects(foreign.input('mouseDown', { x: 20, y: 20 }), /owner-invalid/);
});

test('explicit prepare uses only pinned Node/npm steps, private config files, and leaves lockfiles unchanged', async () => {
  const f = launcherFixture(); try {
    const calls = [], original = f.overrides.runProcess; f.overrides.env = { npm_execpath: '/official/npm-cli.js', NODE_OPTIONS: 'private', NPM_TOKEN: 'private' };
    f.overrides.runProcess = async (command, args, options) => { calls.push({ command, args, options }); return original(command, args, options); };
    const result = await runCapture(['--prepare', '--no-screenshots'], f.overrides); assert.equal(result.code, 0); assert.equal(calls.length, 6);
    assert(calls.every(call => call.command === process.execPath || call.command === '/fake/electron'));
    assert(calls[0].args.includes('--ignore-scripts')); assert(calls[0].args.some(value => value.startsWith('--userconfig=')));
    assert(calls[0].args.some(value => value.startsWith('--globalconfig='))); assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
    assert.equal(calls[0].options.env.NPM_TOKEN, undefined); assert(calls.some(call => call.args.some(value => value.endsWith('materialize-d2.mjs'))));
    assert(calls.every(call => call.command !== 'python' && call.command !== 'python3')); assert.equal(fs.readFileSync(path.join(f.root, 'package-lock.json'), 'utf8'), '{}');
  } finally { f.cleanup(); }
});
test('unknown project npm configuration is rejected without reading its contents or launching setup', async () => {
  const f = launcherFixture(); try {
    fs.writeFileSync(path.join(f.root, '.npmrc'), 'token=private fixture text'); f.overrides.env = { npm_execpath: '/official/npm-cli.js' };
    const result = await runCapture(['--prepare'], f.overrides); assert.equal(result.code, 2); assert.equal(f.steps(), 0);
    const decoded = decodeCapturePackage(fs.readFileSync(result.output)); assert.doesNotMatch(JSON.stringify(decoded), /private fixture text/);
  } finally { f.cleanup(); }
});
test('only precise normal-Windows root exit uncertainty may continue; overall cleanup remains sticky and non-passing', async () => {
  const f = launcherFixture(); try {
    const original = f.overrides.runProcess;
    f.overrides.runProcess = async (...args) => ({ ...await original(...args), cleanup: { confirmed: false, requested: true, rootReaped: true,
      descendantsEvidence: 'normal-Windows-descendants-unverified', errors: ['Windows descendants unverified after root exit; retain owned directories'] } });
    const result = await runCapture([], f.overrides); assert.equal(f.steps(), 2); assert.equal(result.code, 2); assert.equal(f.removed(), 0);
    const report = decodeCapturePackage(fs.readFileSync(result.output)); assert.equal(report.status, 'capture-complete-cleanup-unverified');
    assert.equal(report.retainedOwnedDirectories, true); assert.equal(report.fixtureRemoved, false); assert.equal(report.capture.status, 'completed');
  } finally { f.cleanup(); }
});
test('tagged secrets, credential URLs and filesystem paths are removed from necessary diagnostic text', () => {
  const { safeMessage } = require('../tools/pet-realtime-capture/evidence.mjs');
  const text = safeMessage(new Error('API_KEY=fixture-secret password="fixture-password" token=fixture-token https://user:fixture-auth@example.invalid/private /Users/fixture-person/key')).message;
  assert.doesNotMatch(text, /fixture-secret|fixture-password|fixture-token|fixture-auth|fixture-person/);
  const windowsPath = safeMessage(new Error("open 'C:\\Users\\First Last\\private.txt'")).message; assert.doesNotMatch(windowsPath, /First|Last|private.txt/);
  const json = safeMessage(new Error('{"API_KEY":"fixture-json-secret"}')).message; assert.doesNotMatch(json, /fixture-json-secret/);
});
test('fixture policy requires actual canonical idle plus every disabled provider/business effect', () => {
  const { assertCaptureFixtureState, AI_FLAGS } = require('../tools/pet-realtime-capture/fixture-policy.cjs');
  const state = require('../tools/dev-bench/scenarios').buildScenario('realtime-capture', Date.UTC(2026, 10, 1));
  assert.equal(assertCaptureFixtureState(state), true);
  for (const key of [...AI_FLAGS, 'autoCheckUpdates', 'activityMirrorEnabled', 'quickPanelEnabled']) {
    const changed = structuredClone(state); changed.settings[key] = true; assert.throws(() => assertCaptureFixtureState(changed), /safety-invalid/);
  }
  const task = structuredClone(state); task.tasks.push({ title: 'private fixture' }); assert.throws(() => assertCaptureFixtureState(task), /safety-invalid/);
});
test('collector timeout/abort returns promptly and late renderer completion cannot revive an aborted operation', async () => {
  const contents = new EventEmitter(), controller = new AbortController(); let resolve;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
    executeJavaScript: () => new Promise(yes => { resolve = yes; }) });
  const window = { isDestroyed: () => false, webContents: contents };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true,
    signal: controller.signal, timeoutMs: 20, startupTimeoutMs: 20 });
  const pending = port.read({ afterSequence: 0 }); controller.abort(); await assert.rejects(pending, /aborted/);
  resolve({ instanceId: 'late-generation' }); await Promise.resolve(); port.close();
  const second = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true, timeoutMs: 5, startupTimeoutMs: 5 });
  await assert.rejects(second.read({ afterSequence: 0 }), /timeout/); second.close();
});
test('injected input uses the focused owned window and never changes global OS cursor state', async () => {
  const events = [], contents = new EventEmitter(); let focused = false;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href, sendInputEvent: event => events.push(event) });
  const window = { isDestroyed: () => false, webContents: contents, getContentBounds: () => ({ x: 50, y: 80, width: 220, height: 220 }),
    isFocused: () => focused, focus: () => { focused = true; } };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true });
  await port.input('mouseDown', { x: 90, y: 90 }); assert.equal(events[0].type, 'mouseDown'); assert.equal(focused, true);
  await assert.rejects(port.input('mouseDown', { x: -1, y: 90 }), /outside-owned-window/); assert.equal(events.length, 1); port.close();
});

test('actual canonical fixture, authenticated handoff and opaque ownership compose without opening a real user profile', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-rt-')));
  const { createDisposableProfile, removeDisposableProfile } = require('../tools/dev-bench/profile-fixture');
  const { assertCaptureFixtureState } = require('../tools/pet-realtime-capture/fixture-policy.cjs');
  const { createCaptureHandoff, consumeCaptureHandoff, assertCaptureOwnership } = require('../tools/pet-realtime-capture/handoff.cjs');
  let profile;
  try {
    profile = createDisposableProfile({ scenario: 'realtime-capture', now: Date.UTC(2026, 10, 1) },
      { allocateDirectory: () => { const root = path.join(directory, 'fixture'); fs.mkdirSync(root, { mode: 0o700 }); return root; } });
    assert.equal(assertCaptureFixtureState(profile.initial), true);
    const handoff = createCaptureHandoff({ runDirectory: directory, runId: 'actual-fixture', profileProof: profile, source: {}, screenshots: false });
    const request = consumeCaptureHandoff(handoff.requestFile, handoff.token); assert.equal(assertCaptureOwnership(request), true);
    assert.equal(request.fixture.userDataPath, profile.userDataPath); assert.equal(Object.hasOwn(request, 'initial'), false);
  } finally { if (profile) removeDisposableProfile(profile); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('collector preserves error details before unexpected closure rejects the phase', async () => {
  const report = createCaptureReport({ runId: 'closed-detail' }), ports = capturePorts(), read = ports.read;
  let polls = 0;
  ports.read = async options => {
    const value = await read(options); polls++;
    value.errorLog = { schemaVersion: 1, total: polls >= 3 ? 1 : 0, overwritten: 0,
      rows: polls >= 3 ? [{ sequence: 1, atMs: 1, operation: 'frame', message: 'render failed' }] : [] };
    if (polls >= 3) value.closed = true;
    return value;
  };
  await assert.rejects(collectRealtime(report, ports, { screenshots: false }), /surface-closed-unexpectedly/);
  assert.equal(report.capture.status, 'partial');
  assert.equal(report.errors[0].message, 'render failed');
  assert.equal(report.rendererDiagnostics[0].totalOccurrences, 1);
});

test('collector consumes journal on every frame page and reports completed observations with a full detail cap', async () => {
  const report = createCaptureReport({ runId: 'page-detail' }), ports = capturePorts(), read = ports.read;
  const { appendCaptureError } = require('../tools/pet-realtime-capture/report.mjs');
  for (let i = 0; i < 64; i++) appendCaptureError(report, { code: 'earlier' });
  const totals = new Map();
  ports.read = async options => {
    const value = await read(options);
    const total = (totals.get(value.instanceId) ?? 0) + 1; totals.set(value.instanceId, total);
    value.errorLog = { schemaVersion: 1, total, overwritten: Math.max(0, total - 8),
      rows: Array.from({ length: Math.min(8, total) }, (_, index) => ({ sequence: Math.max(0, total - 8) + index + 1,
        atMs: 1, operation: 'runtime-publication', message: 'repeated failure' })) };
    const rows = value.frames.rows;
    value.frames.rows = rows.slice(0, 10); value.frames.remaining = Math.max(0, rows.length - 10);
    return value;
  };
  await collectRealtime(report, ports, { screenshots: false });
  assert.equal(report.capture.status, 'completed-with-observations');
  assert.equal(report.rendererDiagnostics.length, 3);
  assert(report.rendererDiagnostics.every(row => row.missingDetails === 0 && row.totalOccurrences === totals.get(row.instanceId)));
  const occurrences = [...totals.values()].reduce((sum, value) => sum + value, 0);
  assert.equal(report.rendererDiagnostics.reduce((sum, value) => sum + value.droppedDetails, 0), occurrences);
  assert(report.errorAccounting.truncated >= occurrences, 'other capture failures remain counted too');
  assert.equal(report.errors.length, 64);
});


test('terminal drain retains late client rejection before navigating away from each generation', async () => {
  const report = createCaptureReport({ runId: 'late-terminal-detail' }), ports = capturePorts();
  const read = ports.read, dispose = ports.dispose; let settlesAt = Infinity;
  ports.dispose = async () => { settlesAt = ports.now() + 150; await dispose(); };
  ports.read = async options => {
    const value = await read(options), settled = value.closed && ports.now() >= settlesAt;
    value.pendingOperations = value.closed && !settled ? 1 : 0;
    value.errorLog = { schemaVersion: 1, total: settled ? 1 : 0, overwritten: 0,
      rows: settled ? [{ sequence: 1, atMs: ports.now(), operation: 'runtime-publication', message: 'late runtime rejection' }] : [] };
    return value;
  };
  await collectRealtime(report, ports, { screenshots: false });
  assert.equal(report.errors.filter(row => row.message === 'late runtime rejection').length, 3);
  assert(report.capture.lifecycle.every(row => row.operationsSettled && row.pendingOperations === 0 && row.operationDrainElapsedMs === 150));
  assert.equal(report.capture.status, 'completed-with-observations');
});

test('terminal drain times out within its bounded wait and preserves unsettled operations as observations', async () => {
  const report = createCaptureReport({ runId: 'unsettled-terminal' }), ports = capturePorts(), read = ports.read;
  ports.read = async options => {
    const value = await read(options); value.pendingOperations = value.closed ? 2 : 0; return value;
  };
  await collectRealtime(report, ports, { screenshots: false });
  const errors = report.errors.filter(row => row.code === 'terminal-operations-unsettled');
  assert.equal(errors.length, 3); assert(errors.every(row => row.phase === 'boundary'));
  assert(report.capture.lifecycle.every(row => !row.operationsSettled && row.pendingOperations === 2 && row.operationDrainElapsedMs === 2000));
  assert.equal(report.capture.status, 'completed-with-observations');
});

test('missing or malformed terminal operation count never claims settled ownership', async () => {
  for (const counter of [undefined, -1, 0.5, '0']) {
    const report = createCaptureReport({ runId: 'unknown-terminal' }), ports = capturePorts(), read = ports.read;
    ports.read = async options => { const value = await read(options); if (value.closed) value.pendingOperations = counter; return value; };
    await collectRealtime(report, ports, { screenshots: false });
    assert(report.capture.lifecycle.every(row => row.pendingOperations === null && row.operationsSettled === false));
    assert.equal(report.errors.filter(row => row.code === 'terminal-operations-counter-unavailable').length, 3);
    assert.equal(report.capture.status, 'completed-with-observations');
  }
});


test('terminal drain forwards a decreasing read deadline and never claims settlement after read timeout', async () => {
  const report = createCaptureReport({ runId: 'terminal-read-timeout' }), ports = capturePorts(), read = ports.read;
  const budgets = [];
  ports.read = async (options, limits) => {
    const value = await read(options);
    if (value.closed) {
      budgets.push(limits.timeoutMs);
      if (limits.timeoutMs < 2000) throw new Error('capture-collector-timeout');
      value.pendingOperations = 1;
    }
    return value;
  };
  await collectRealtime(report, ports, { screenshots: false });
  assert.deepEqual(budgets, [2000, 1950, 2000, 1950, 2000, 1950]);
  assert.equal(report.errors.filter(row => row.code === 'terminal-operations-read-timeout').length, 3);
  assert(report.capture.lifecycle.every(row => row.operationsSettled === false && row.pendingOperations === 1));
});

test('owned-window narrow diagnostic timeout rejects without accepting a late result', async () => {
  const contents = new EventEmitter(); let complete;
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
    executeJavaScript: () => new Promise(resolve => { complete = resolve; }) });
  const window = { isDestroyed: () => false, webContents: contents };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true, timeoutMs: 100, startupTimeoutMs: 100 });
  await assert.rejects(port.read({ afterSequence: 0 }, { timeoutMs: 5 }), /collector-timeout/);
  complete({ instanceId: 'late-instance' }); await Promise.resolve();
  contents.executeJavaScript = async () => ({ instanceId: 'current-instance' });
  assert.equal((await port.read({ afterSequence: 0 })).instanceId, 'current-instance');
  for (const timeoutMs of [0, -1, Infinity, 101]) await assert.rejects(port.read({}, { timeoutMs }), /read-timeout-invalid/);
  port.close();
});

test('owned movement probe stays in paused non-performance phase and cannot upgrade input acceptance', async () => {
  for (const verified of [true, false]) {
    const report = createCaptureReport({ runId: `move-${verified}` }), ports = capturePorts();
    ports.probeMovement = async () => {
      const state = await ports.read({ afterSequence: 0 }); assert.equal(state.frameScheduled, false);
      return { status: 'movement-observed', inputQuiescent: verified, restoration: { confirmed: verified },
        actorMotionConnected: false, eventMatched: false, compositorAcknowledged: false };
    };
    await collectRealtime(report, ports, { screenshots: false });
    const phase = report.phases.find(item => item.id === 'native-window-movement-probe');
    assert.equal(phase.performancePhase, false); assert.equal(phase.inputSource, 'none');
    assert.equal(report.errors.some(item => item.code === 'native-window-movement-or-restoration-unverified'), !verified);
    if (!verified) assert.equal(report.capture.status, 'completed-with-observations');
    const result = require('../tools/pet-realtime-capture/report.mjs').finalizeReport(report);
    assert.equal(result.gates.osInput, 'not-accepted'); assert.equal(result.productionAccepted, false);
    assert.equal(result.capture.windowMovement.eventMatched, false);
  }
});

test('controlled Electron input carries explicitly supplied global DIP and labels them synthetic rather than sampled OS coordinates', async () => {
  const contents = new EventEmitter(), events = [];
  Object.assign(contents, { isDestroyed: () => false, getURL: () => pathToFileURL('/fixture/index.html').href,
    sendInputEvent: event => events.push(event) });
  const window = { webContents: contents, isDestroyed: () => false, isFocused: () => true,
    getContentBounds: () => ({ x: -1250, y: -80, width: 520, height: 360 }) };
  const port = createOwnedWindowPort({ window, pagePath: '/fixture/index.html', readProfileOwnership: () => true });
  const receipt = await port.input('mouseMove', { x: 100.25, y: 75.9 });
  assert.equal(events[0].globalX, -1150); assert.equal(events[0].globalY, -4);
  assert.deepEqual(receipt, { local: { x: 100, y: 76 }, global: { x: -1150, y: -4 }, coordinateSource: 'caller-supplied-controlled-fixture-not-OS' });
  port.close();
});

test('held fixture phase preserves unavailable/incomplete status and never upgrades native gates', async () => {
  for (const status of ['completed', 'unavailable', 'incomplete']) {
    const report = createCaptureReport({ runId: `held-${status}` }), ports = capturePorts();
    ports.probeHeldTransport = async () => ({ status, requiresDispose: false, pointerDriven: false,
      OSInputProven: false, eventMatched: false, compositorAcknowledged: false });
    await collectRealtime(report, ports, { screenshots: false });
    const phase = report.phases.find(item => item.id === 'synthetic-held-window-roundtrip');
    assert.equal(phase.performancePhase, false); assert.equal(phase.inputSource, 'Electron-injected-not-OS');
    assert.equal(phase.status, status === 'incomplete' ? 'partial' : status);
    assert.equal(report.capture.heldTransport.status, status);
    assert.equal(report.capture.lifecycle.length, 3, 'unsupported native handoff does not stop ordinary G1 capture');
    const result = require('../tools/pet-realtime-capture/report.mjs').finalizeReport(report);
    assert.equal(result.productionAccepted, false); assert.equal(result.gates.osInput, 'not-accepted');
  }
});
test('held fixture unknown outcome preserves result and stops before new input, probes or reload', async () => {
  const report = createCaptureReport({ runId: 'held-unknown' }), ports = capturePorts(); let called = 0;
  ports.probeHeldTransport = async () => { called++; return { status: 'incomplete', requiresDispose: true,
    mutationOutcomeUnknown: true, disposal: { attempted: true, confirmed: true } }; };
  await assert.rejects(collectRealtime(report, ports, { screenshots: false }), /held-window-roundtrip-owner-unsettled/);
  assert.equal(called, 1); assert.equal(report.capture.status, 'partial'); assert.equal(report.capture.heldTransport.mutationOutcomeUnknown, true);
  assert.equal(report.capture.lifecycle.length, 0); assert.equal(report.phases.at(-1).status, 'partial');
});
