'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { installedElectronEnvironment } = require('../scripts/installed-electron-environment');
const { createEmptyProfile, verifyProfileLaunch } = require('../scripts/installed-first-launch');
const { createUpgradeFixture } = require('../scripts/installed-upgrade-profile');
const { verifyPendingLock, runUpgradeChild } = require('../scripts/verify-installed-upgrade');
const { summarizeStartupOutput } = require('../scripts/verify-macos-install');
function assertPreservedEntries(source, actual) {
  // process.env lookups are case-insensitive on Windows; a cloned plain object
  // preserves the enumerated spelling instead. Compare actual keys and values.
  const expected = Object.entries(source).filter(([name]) => name.toUpperCase() !== 'ELECTRON_RUN_AS_NODE');
  // A failure must not print unrelated live CI environment values.
  assert.equal(Object.keys(actual).length, expected.length, 'preserved environment key count');
  for (const [name, value] of expected) {
    assert.equal(Object.hasOwn(actual, name), true, `preserved environment key: ${name}`);
    assert.equal(actual[name] === value, true, `preserved environment value for key: ${name}`);
  }
}

for (const value of ['', '1', '0']) test(`native Electron env omits all Node-mode casing aliases with value ${JSON.stringify(value)}`, () => {
  const original = Object.freeze({ ELECTRON_RUN_AS_NODE: value, electron_run_as_node: value, Electron_Run_As_Node: value,
    PATH: '/retained/path', SystemRoot: 'C:\\Windows', NODE_OPTIONS: '--retained-option', ordinary: '' });
  const result = installedElectronEnvironment(original);
  assert.deepEqual(result, { PATH: '/retained/path', SystemRoot: 'C:\\Windows', NODE_OPTIONS: '--retained-option', ordinary: '' });
  assert.equal(original.ELECTRON_RUN_AS_NODE, value); assert.notEqual(result, original);
});
test('an absent Node-mode variable remains absent without changing any unrelated env key', () => {
  const original = { Path: 'preserve exact key casing', ELECTRON_ENABLE_LOGGING: '1', HOME: '/owned/home' };
  assert.deepEqual(installedElectronEnvironment(original), original);
});
for (const [pathKey, rootKey, nodeKey] of [
  ['PATH', 'SYSTEMROOT', 'ELECTRON_RUN_AS_NODE'],
  ['Path', 'SystemRoot', 'Electron_Run_As_Node'],
  ['pAtH', 'systemroot', 'electron_run_as_node']
]) test(`enumerated ${pathKey}/${rootKey} keys survive Windows-style case-insensitive source lookups`, () => {
  const raw = { [pathKey]: 'C:\\synthetic\\bin', [rootKey]: 'C:\\Windows', [nodeKey]: '', NODE_OPTIONS: '--retained', ordinary: '' };
  const before = { ...raw };
  const find = name => typeof name === 'string' ? Object.keys(raw).find(key => key.toUpperCase() === name.toUpperCase()) : undefined;
  const source = new Proxy(raw, {
    get(target, name) { return target[find(name)]; },
    getOwnPropertyDescriptor(target, name) { return Object.getOwnPropertyDescriptor(target, find(name)); }
  });
  // Reproduce the original failing assumption on Linux as well as Windows:
  // PATH is a supported source alias, but only its enumerated spelling is copied.
  assert.equal(Object.hasOwn(source, 'PATH'), true); assert.equal(source.PATH, raw[pathKey]);
  const result = installedElectronEnvironment(source);
  assertPreservedEntries(source, result);
  assert.equal(Object.hasOwn(result, pathKey), true); assert.equal(result[pathKey], raw[pathKey]);
  if (pathKey !== 'PATH') assert.equal(Object.hasOwn(result, 'PATH'), false);
  assert.equal(Object.keys(result).some(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'), false);
  assert.deepEqual(raw, before);
  const dropped = { ...result }; delete dropped[pathKey];
  assert.throws(() => assertPreservedEntries(source, dropped));
  assert.throws(() => assertPreservedEntries(source, { ...result, [pathKey]: 'changed' }));
});
test('CLI failure diagnostics admit known option names without raw arguments, paths or secrets', () => {
  const report = summarizeStartupOutput('C:\\private\\secret.exe: bad option: --user-data-dir=C:\\private\\profile\n' +
    'bad option: --inspect=127.0.0.1:1234\nbad option: --inspect-brk=private-value\n' +
    'bad option: --user-data-dir-extra=TOKEN\nbad option: --secret=real-key\n' +
    'ELECTRON_RUN_AS_NODE=credential-looking-value\n\u001b[31mPRIVATE_CONTROL_TEXT\u001b[0m');
  assert.deepEqual(report.rejectedCliOptions, ['--user-data-dir', '--inspect', '--inspect-brk']);
  assert.doesNotMatch(JSON.stringify(report), /private|secret|TOKEN|real-key|credential-looking|PRIVATE_CONTROL_TEXT|\u001b|127\.0\.0\.1|1234/);
});
test('all installed verifier child paths omit inherited Node mode and retain exact GUI arguments', async t => {
  const key = 'eLeCtRoN_rUn_As_NoDe', previous = process.env[key]; process.env[key] = '1';
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const fresh = createEmptyProfile(), upgrade = createUpgradeFixture();
  t.after(() => { fs.rmSync(fresh.root, { recursive: true, force: true }); fs.rmSync(upgrade.root, { recursive: true, force: true }); });
  const captured = [];
  function spawnChild(executable, args, options) {
    assert.equal(executable, '/owned/bubu');
    assert.equal(Object.keys(options.env).some(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'), false);
    assertPreservedEntries(process.env, options.env);
    captured.push(args);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0, null)); return child;
  }
  const wait = async completion => completion;
  await assert.rejects(verifyProfileLaunch('/owned/bubu', { fixture: fresh, spawnChild, wait }), /exited before inspector readiness/);
  assert.equal((await verifyPendingLock('/owned/bubu', upgrade, { spawnChild, wait })).secondaryNormalExit, true);
  await assert.rejects(runUpgradeChild('/owned/bubu', upgrade, false, { spawnChild, wait }), /exited before debugger/);
  assert.deepEqual(captured, [
    [`--user-data-dir=${fresh.userDataPath}`, '--inspect=127.0.0.1:0'],
    [`--user-data-dir=${upgrade.userDataPath}`],
    [`--user-data-dir=${upgrade.userDataPath}`, '--inspect-brk=127.0.0.1:0']
  ]);
  assert.equal(fs.readdirSync(fresh.userDataPath).length, 0);
});
test('early exit9 preserves safe CLI classification and exit facts in the install diagnostic', async t => {
  const f = createEmptyProfile(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  await assert.rejects(verifyProfileLaunch('/owned/bubu', {
    fixture: f,
    spawnChild() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => assert.fail('already closed');
      queueMicrotask(() => { child.stderr.emit('data', '/private/bubu: bad option: --user-data-dir=/private/credential-like-value\n'); child.emit('close', 9, null); });
      return child;
    },
    wait: async completion => completion
  }), error => {
    assert.equal(error.diagnostic.exitCode, 9); assert.equal(error.diagnostic.exitSignal, null);
    assert.equal(error.diagnostic.electronRunAsNodePresent, false); assert.equal(error.diagnostic.childClosedAfterCleanup, true);
    assert.deepEqual(error.diagnostic.output.rejectedCliOptions, ['--user-data-dir']);
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /private|credential-like-value/); return true;
  });
});
