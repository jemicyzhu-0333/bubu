'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAppHost } = require('../src/platform/electron/app-host');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { createSecureCredentialStore } = require('../src/platform/providers');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('packaging, installer and storage use the bubu identity', () => {
  assert.equal(pkg.name, 'bubu');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(pkg.productName, '小步');
  assert.equal(pkg.build.productName, pkg.productName);
  assert.equal(pkg.version, '0.0.2-dev.4');
  assert.equal(pkg.build.appId, 'com.bubu.app');
  assert.equal(pkg.build.artifactName, 'bubu-${version}-${os}-${arch}.${ext}');
  assert.equal(pkg.build.mac.artifactName, 'bubu-${version}-mac-${arch}-adhoc-test.${ext}');
  assert.deepEqual(pkg.build.mac.sign, { hardenedRuntime: false, identity: '-' });
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.win.executableName, 'bubu');
  assert.equal(pkg.build.linux.executableName, 'bubu');
  assert.equal(pkg.repository.url, 'https://github.com/jemicyzhu-0333/bubu.git');
  assert.equal(pkg.homepage, 'https://jemicyzhu-0333.github.io/bubu/');
  assert.equal(pkg.bugs.url, 'https://github.com/jemicyzhu-0333/bubu/issues');
});

for (const visibleName of ['小步', 'bubu']) test(`${visibleName} reopens its own seeded SQL profile and encrypted credential file`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-branding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const established = path.join(root, 'bubu');
  const now = () => Date.parse('2026-10-09T09:00:00Z');
  const initial = createSqliteStateAdapter({ userDataPath: established, now });
  initial.update(state => { state.settings.dnd = true; }, { now: now() });
  const snapshot = initial.snapshot(), revision = initial.revision(); initial.close();
  const credential = Buffer.from('synthetic-existing-encrypted-value');
  const credentialPath = path.join(established, 'ai-credential.bin');
  fs.writeFileSync(credentialPath, credential, { mode: 0o600 });
  const before = Object.fromEntries(fs.readdirSync(established).map(name => [name, fs.readFileSync(path.join(established, name))]));
  const app = new EventEmitter(), names = [];
  const paths = { userData: path.join(root, visibleName), sessionData: path.join(root, visibleName) };
  Object.assign(app, {
    getPath: name => paths[name], setPath: (name, value) => { paths[name] = value; },
    setName: name => names.push(name), isReady: () => false, whenReady: () => Promise.resolve(),
    quit() {}, getLoginItemSettings: () => ({}), setLoginItemSettings() {},
    requestSingleInstanceLock: () => { assert.equal(paths.userData, established); assert.equal(paths.sessionData, established); return true; }
  });
  const host = createAppHost({ app });
  assert.equal(host.acquireSingleInstanceLock(), true);
  assert.deepEqual(names, ['bubu']);
  assert.deepEqual(fs.readdirSync(root), ['bubu'], 'both current display names resolve to the same bubu profile');
  for (const [name, bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(established, name)), bytes);
  const reopened = createSqliteStateAdapter({ userDataPath: host.userDataPath(), now });
  try { assert.deepEqual(reopened.snapshot(), snapshot); assert.equal(reopened.revision(), revision); }
  finally { reopened.close(); }
  // A deterministic fake tests filename and byte preservation only, not OS Keychain permissions.
  const store = createSecureCredentialStore({ userDataPath: host.userDataPath(), safeStorage: {
    isEncryptionAvailable: () => true, encryptString: () => assert.fail('must not rewrite existing credentials'),
    decryptString: bytes => { assert.deepEqual(bytes, credential); return 'synthetic-readable-key'; }
  } });
  assert.equal(store.filePath, credentialPath);
  assert.equal(store.get(), 'synthetic-readable-key');
  assert.deepEqual(fs.readFileSync(credentialPath), credential);
});
