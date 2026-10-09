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
    for (const name of ['PATH', 'Path', 'SystemRoot', 'NODE_OPTIONS']) {
      if (Object.hasOwn(process.env, name)) assert.equal(options.env[name], process.env[name]);
    }
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
