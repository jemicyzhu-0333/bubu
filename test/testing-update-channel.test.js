'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dump } = require('js-yaml');
const { EventEmitter } = require('node:events');
const { AppUpdater } = require('electron-updater');
const { updateReleasePolicy: policyApi } = require('../src/capabilities/app-maintenance');
const { createUpdateTransport } = require('../src/platform/electron/update-transport');
const { createApplicationUpdates } = require('../src/bootstrap/desktop-updates');
const { feed, signedInfo, identity } = require('./fixtures/update-channel');

function fixture(t, { platform = 'win32', arch = 'x64', version = '0.0.1-dev.1', track = 'testing',
  info = signedInfo({ platform, arch, track }), tags = [`v${info.version}`], feedPatch = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-updates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app-update.yml'), dump({ ...feed(platform, track), ...feedPatch }));
  const app = { version, name: 'bubu', isPackaged: true, whenReady: async () => {},
    appUpdateConfigPath: path.join(root, 'app-update.yml'), userDataPath: root, baseCachePath: root,
    onQuit() {}, onSessionEnd() {} };
  const updater = new AppUpdater(null, app);
  updater._testOnlyOptions = { platform };
  const requests = [];
  let downloads = 0, installs = 0, downloadResolve, progress, cancelToken;
  updater.httpExecutor = { createRequest() { throw new Error('fixture receives completed metadata only'); }, async request(options) {
    requests.push({ host: options.hostname, path: options.path, headers: options.headers });
    if (options.path.endsWith('.atom')) return `<feed>${tags.map(tag => `<entry><link href="https://github.com/jemicyzhu-0333/bubu/releases/tag/${tag}"/><title>Fixture</title><content>Fixture</content></entry>`).join('')}</feed>`;
    if (options.path.endsWith('/latest')) return JSON.stringify({ tag_name: tags.find(tag => !tag.includes('-')) });
    if (options.path.endsWith('.yml')) return dump(info);
    throw new Error('Unexpected fixture endpoint');
  } };
  // Only native download/install boundaries are substituted. Discovery, semver,
  // official provider URL resolution, YAML and Ed25519 verification are real.
  updater.doDownloadUpdate = options => {
    downloads += 1; cancelToken = options.cancellationToken;
    return new Promise((resolve, reject) => {
      downloadResolve = () => resolve({ updateFile: path.join(root, 'fixture-installer') });
      cancelToken.onCancel(() => reject(new Error('cancelled')));
    });
  };
  updater.quitAndInstall = options => { installs += 1; assert.deepEqual(options, { isSilent: false, isForceRunAfter: true, waitUntilNextLaunch: false }); };
  progress = percent => updater.emit('download-progress', { percent });
  const configuration = createUpdateTransport({ app: { isPackaged: true, getVersion: () => version }, platform, arch,
    resourcesPath: root, buildIdentity: identity(platform, arch, track), loadUpdater: () => ({ autoUpdater: updater }), loadNativeUpdater: () => new EventEmitter() });
  t.after(() => configuration.transport.dispose?.());
  return { root, updater, configuration, requests, downloads: () => downloads, installs: () => installs,
    finish: () => downloadResolve(), progress, info };
}
async function tickUntil(predicate) {
  for (let i = 0; i < 50 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'fixture operation did not start');
}
test('actual official GitHub provider discovers dev.1 to dev.2 for both supported architectures', async t => {
  for (const [platform, arch, metadata] of [['win32', 'x64', 'dev.yml'], ['darwin', 'arm64', 'dev-mac.yml']]) {
    const h = fixture(t, { platform, arch, tags: ['v1.0.0', 'v0.0.1-beta.9', 'v0.0.1-dev.2', 'v0.0.1-dev.1'] });
    const found = await h.configuration.transport.check();
    assert.deepEqual(found, { available: true, version: '0.0.1-dev.2' });
    assert.equal(h.downloads(), 0); assert.equal(h.installs(), 0);
    assert.ok(h.requests.some(request => request.path === `/jemicyzhu-0333/bubu/releases/download/v0.0.1-dev.2/${metadata}`));
    assert.ok(h.requests.every(request => request.host === 'github.com'));
    assert.equal(h.updater.allowDowngrade, false); assert.equal(h.updater.autoInstallEvent, 'manual');
    assert.equal(h.updater.disableDifferentialDownload, true); assert.equal(h.updater.disableWebInstaller, true);
  }
});
test('equal and older signed versions never download; stable does not accept a signed testing offer', async t => {
  for (const version of ['0.0.1-dev.2', '0.0.1-dev.3']) {
    const h = fixture(t, { version });
    assert.equal((await h.configuration.transport.check()).available, false);
    assert.throws(() => h.configuration.transport.download(() => {}), /no-update/);
  }
  const stable = fixture(t, { track: 'stable', version: '1.0.0', tags: ['v1.0.1'], info: signedInfo() });
  await assert.rejects(stable.configuration.transport.check(), /incompatible/);
  assert.equal(stable.downloads(), 0);
});
test('official signature verifier refuses tampered, missing, and wrong-key manifests before any download', async t => {
  const badInfo = signedInfo(); badInfo.files[0].sha512 = Buffer.alloc(64, 2).toString('base64');
  const missing = signedInfo(); delete missing.signature;
  for (const info of [badInfo, missing]) {
    const h = fixture(t, { info });
    await assert.rejects(h.configuration.transport.check(), /not signed|signature verification failed/);
    assert.equal(h.downloads(), 0);
  }
  // RFC 8032 TEST 2 public key, deliberately unrelated to TEST 1's signature.
  const wrongKey = `MCowBQYDK2VwAyEAPUBDwr4VrAjN39XVEPQPVjmGDWkRHxHGfgWbJElhtGU=`;
  const wrong = fixture(t, { feedPatch: { updateManifestPublicKey: wrongKey } });
  await assert.rejects(wrong.configuration.transport.check(), /signature verification failed/);
  assert.equal(wrong.downloads(), 0);
});
test('untrusted feed configuration fails before network, even with a signed application marker', async t => {
  for (const feedPatch of [{ provider: 'generic', url: 'https://evil.invalid/' }, { repo: 'another-repo' },
    { owner: 'another-owner' }, { private: true }, { channel: 'dev-x64' }, { host: 'evil.invalid' },
    { token: 'fixture-not-a-token' }, { requestHeaders: { Authorization: 'fixture-not-a-token' } },
    { updateManifestPublicKey: '' }, { updateManifestPublicKey: 'malformed-public-key' }, { publisherName: [] }]) {
    const h = fixture(t, { feedPatch });
    await assert.rejects(h.configuration.transport.check()); assert.equal(h.requests.length, 0);
  }
});
test('wrong platform/architecture, absolute URLs, web installers and incompatible schema fail closed', () => {
  const policy = policyApi.releasePolicy({ version: '0.0.1-dev.1', track: 'testing', platform: 'win32', arch: 'x64' });
  for (const change of [info => { info.files[0].url = 'https://evil.invalid/app.exe'; },
    info => { info.files[0].url = 'bubu-0.0.1-dev.2-data18-win-arm64.exe'; },
    info => { info.files[0].url = '../bubu-0.0.1-dev.2-data18-win-x64.exe'; },
    info => { info.packages = {}; }, info => { info.files = []; },
    info => { info.files[0].blockMapUrl = 'https://evil.invalid/a'; }]) {
    const info = { ...signedInfo(), tag: 'v0.0.1-dev.2' }; change(info);
    assert.throws(() => policyApi.validateOffer(info, policy));
  }
  assert.throws(() => policyApi.releasePolicy({ ...policy, schemaVersion: 19 }), /migration-required/);
});
test('real metadata path integrates with explicit cancel/retry/install and pending-work/data gates', async t => {
  const h = fixture(t); let busy = true, conversationSaved = false, storageGood = false;
  const state = { schemaVersion: 18, tasks: [{ id: 'preserved-task', title: 'fixture' }], focusSession: { status: 'idle' } };
  const before = JSON.stringify(state);
  const updates = createApplicationUpdates({ stateRepository: { snapshot: () => state, get: () => ({ autoCheckUpdates: false }),
    authoritativeWrites: { verify: () => ({ ok: storageGood }) } }, appHost: { whenReady: () => new Promise(() => {}) },
    requestScope: { canRestart: () => !busy }, sessions: { canRestart: () => conversationSaved },
    createTransport: () => h.configuration });
  t.after(() => updates.close());
  await updates.check(); assert.equal(updates.read().channel, 'testing');
  const pending = updates.download(); await tickUntil(() => h.downloads() === 1);
  h.progress(39.8); assert.equal(updates.read().percent, 39);
  assert.equal(updates.cancel().ok, true); assert.equal((await pending).reason, 'cancelled');
  h.progress(90); assert.equal(updates.read().percent, 0);
  const retry = updates.download(); await tickUntil(() => h.downloads() === 2); h.finish(); await retry;
  assert.equal(h.installs(), 0); assert.equal(updates.install().reason, 'active-provider-request');
  busy = false; assert.equal(updates.install().reason, 'unsaved-conversation');
  conversationSaved = true; assert.equal(updates.install().reason, 'storage-unavailable');
  storageGood = true; assert.equal(updates.install().ok, true); assert.equal(h.installs(), 1);
  assert.equal(updates.install().ok, false); assert.equal(JSON.stringify(state), before);
});

test('synthetic schema-18 SQLite facts, preferences and profile identity survive the update flow and reopen', async t => {
  const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
  const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-update-profile-'));
  const now = Date.parse('2026-10-09T10:00:00Z');
  let repository = createSqliteStateAdapter({ userDataPath: profile, now: () => now });
  t.after(() => { repository.close(); fs.rmSync(profile, { recursive: true, force: true }); });
  const state = normalizePersistedState({ ...repository.snapshot(), tasks: [{ id: 'task-before-update', title: 'Keep this task', createdAt: now, steps: [] }] }, { now });
  state.settings.autoCheckUpdates = false;
  repository.commit(state, { now });
  const before = repository.snapshot(), revision = repository.revision();
  const h = fixture(t);
  const runtime = createApplicationUpdates({ stateRepository: repository, appHost: { whenReady: () => new Promise(() => {}) }, createTransport: () => h.configuration });
  await runtime.check(); const download = runtime.download(); await tickUntil(() => h.downloads() === 1); h.finish(); await download;
  assert.equal(runtime.install().ok, true); assert.deepEqual(repository.snapshot(), before); assert.equal(repository.revision(), revision);
  runtime.close(); repository.close();
  repository = createSqliteStateAdapter({ userDataPath: profile, now: () => now });
  assert.deepEqual(repository.snapshot(), before); assert.equal(repository.revision(), revision);
  assert.equal(repository.get('schemaVersion'), 18); assert.equal(repository.get('settings').autoCheckUpdates, false);
  const next = fixture(t, { version: '0.0.1-dev.2' });
  assert.equal((await next.configuration.transport.check()).available, false);
});

test('schema epoch is bound by signed payload names; neither unsigned labels nor altered names authorize schema19', async t => {
  const { createUpdateManifestSignatures } = require('builder-util');
  const { signingFixtureKey } = require('./fixtures/update-channel');
  for (const resign of [false, true]) {
    const info = signedInfo(); info.files[0].url = info.files[0].url.replace('-data18-', '-data19-');
    info.schemaVersion = 18; // An unsigned extra label cannot override the signed path.
    if (resign) {
      info.signatures = createUpdateManifestSignatures(info, [signingFixtureKey]); info.signature = info.signatures[0].signature;
    }
    const h = fixture(t, { info });
    await assert.rejects(h.configuration.transport.check(), /signature verification failed|artifacts-invalid/);
    assert.equal(h.downloads(), 0);
  }
  for (const size of [undefined, 0, -1, 512 * 1024 * 1024 + 1, Infinity]) {
    const info = { ...signedInfo(), tag: 'v0.0.1-dev.2' }; info.files[0].size = size;
    const policy = policyApi.releasePolicy({ version: '0.0.1-dev.1', track: 'testing', platform: 'win32', arch: 'x64' });
    assert.throws(() => policyApi.validateOffer(info, policy), /artifacts-invalid/);
  }
});
test('official rotation accepts either embedded trusted key and never adopts a remote trust list', async t => {
  const { createPrivateKey, createPublicKey } = require('node:crypto');
  const { createUpdateManifestSignatures } = require('builder-util');
  const { publicKey, signingFixtureKey } = require('./fixtures/update-channel');
  // Public RFC8032 TEST 2 seed, for rotation fixtures only.
  const nextKey = createPrivateKey({ key: Buffer.from('302e020100300506032b6570042204204ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', 'hex'), format: 'der', type: 'pkcs8' });
  const nextPublicKey = createPublicKey(nextKey).export({ format: 'pem', type: 'spki' }).toString();
  for (const key of [signingFixtureKey, nextKey]) {
    const info = signedInfo(); info.signatures = createUpdateManifestSignatures(info, [key]); info.signature = info.signatures[0].signature;
    const h = fixture(t, { info, feedPatch: { updateManifestPublicKey: [publicKey, nextPublicKey] } });
    assert.equal((await h.configuration.transport.check()).available, true);
  }
  const info = signedInfo(); info.signatures = createUpdateManifestSignatures(info, [nextKey]); info.signature = info.signatures[0].signature;
  info.updateManifestPublicKey = nextPublicKey;
  const foreign = fixture(t, { info });
  await assert.rejects(foreign.configuration.transport.check(), /signature verification failed/);
  assert.equal(foreign.downloads(), 0);
});

// Reproduce the public Windows API ordering: scheduled app.quit remains possible
// even if the NSIS spawn promise reports an error after quitAndInstall returns.
test('Windows delayed spawn failure never reopens work before its already scheduled quit', async t => {
  const h = fixture(t), { createUpdateAdmission, createDesktopUpdates } = require('../src/capabilities/app-maintenance').desktopUpdates;
  const admission = createUpdateAdmission(); let scheduledQuit, quit = false, prompted = 0;
  h.updater.quitAndInstall = () => { scheduledQuit = () => { quit = true; }; };
  const api = createDesktopUpdates({ ...h.configuration, now: () => 1, canInstall: () => ({ ok: true }),
    prepareInstall: () => admission.acquire(), onHandoffUnknown: () => { prompted++; } });
  t.after(api.dispose); await api.check(); const download = api.download();
  await tickUntil(() => h.downloads() === 1); h.finish(); await download;
  assert.equal(api.install().ok, true); assert.equal(admission.isBlocked(), true);
  h.updater.emit('error', new Error('delayed spawn failed'));
  assert.equal(api.read().phase, 'handoff-unknown'); assert.equal(prompted, 1);
  assert.equal(admission.isBlocked(), true); assert.throws(admission.beginOperation, /application-updating/);
  scheduledQuit(); assert.equal(quit, true); assert.equal(admission.isBlocked(), true);
});
