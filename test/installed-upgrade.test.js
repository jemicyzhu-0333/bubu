'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createUpgradeFixture, captureFiles, verifyUnchanged, verifyApproved, verifyReopened } = require('../scripts/installed-upgrade-profile');
const { prepareConfigPreferencesUpgrade } = require('../src/platform/persistence/sqlite/sqlite-database');
const { openSession, dialogStubExpression, responseExpression, interceptInstalledEntry, CONFIRM, REPORT } = require('../scripts/installed-upgrade-inspector');
const { classifyStartupFailure } = require('../scripts/diagnose-windows-first-launch');
function fixture(t) { const f = createUpgradeFixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true })); return f; }
test('retained-WAL BUBU18 fixture stays unchanged before consent and has a complete private verified backup', t => {
  const f = fixture(t); verifyUnchanged(f);
  const upgrade = prepareConfigPreferencesUpgrade({ userDataPath: f.userDataPath });
  verifyUnchanged(f);
  upgrade.execute(upgrade.confirmation);
  assert.equal(verifyApproved(f).exactAdditiveBeforeRestart, true);
  assert.equal(verifyReopened(f).taskStepInboxPreserved, true);
});
test('consent evidence refuses any SQL, identity, WAL, SHM byte or mtime drift', t => {
  const f = fixture(t), file = path.join(f.userDataPath, 'config.sqlite-shm');
  const bytes = fs.readFileSync(file); bytes[0] ^= 1; fs.writeFileSync(file, bytes);
  assert.throws(() => verifyUnchanged(f), /consent\/cancel/);
});
test('baseline schema18 post-readiness verification mismatch is never startup rejection', () => {
  assert.equal(classifyStartupFailure({ stage: 'closed-authority-verification' }), 'post-startup-validation-failed');
  assert.equal(classifyStartupFailure({ stage: 'graceful-quit' }), 'post-startup-validation-failed');
  assert.equal(classifyStartupFailure({ stage: 'production-window-readiness' }), 'rejected');
});
function stubContext() {
  const e = { app: { isReady: () => false }, dialog: { showMessageBox() {} } };
  const context = vm.createContext({ process: { resourcesPath: '/owned/resources', getBuiltinModule: () => ({ createRequire: () => () => e }), stdout: { write() {} } }, setTimeout: fn => fn() });
  vm.runInContext(dialogStubExpression('/owned/profile'), context);
  return { e, context, run: expression => vm.runInContext(expression, context) };
}
const confirmation = { type: 'question', title: '小步 · bubu', message: CONFIRM, detail: '18 → 19 /owned/profile',
  buttons: ['退出 / Quit', '备份并升级 / Back up and upgrade'], defaultId: 0, cancelId: 0, noLink: true,
  checkboxLabel: '已了解需保留备份 / I understand the backup must be kept', checkboxChecked: false };
const report = { type: 'info', title: '小步 · bubu', message: REPORT, buttons: ['确定 / OK'], defaultId: 0, cancelId: 0, noLink: true };
for (const approve of [false, true]) test(`exact consent port uses explicit checked approval only when requested: ${approve}`, async () => {
  const s = stubContext(), pending = s.e.dialog.showMessageBox(confirmation);
  s.run(responseExpression(approve));
  const answer = await pending;
  assert.equal(answer.response, approve ? 1 : 0); assert.equal(answer.checkboxChecked, approve);
  if (approve) {
    const finished = s.e.dialog.showMessageBox(report); s.run(responseExpression(false, true)); await finished;
    s.e.app.relaunch({ args: ['--user-data-dir=/owned/profile'] });
    assert.equal(s.run('globalThis.__bubuInstalledUpgradeTest.relaunches'), 1);
  }
});
for (const change of [{ title: 'Other app' }, { message: 'Delete profile?' }, { checkboxChecked: true }, { defaultId: 1 }]) {
  test(`dialog stub refuses unapproved identifier/options: ${JSON.stringify(change)}`, () => {
    const s = stubContext(); assert.throws(() => s.e.dialog.showMessageBox({ ...confirmation, ...change }), /unexpected-dialog/);
  });
}
test('real debugger pauses exact entry and installs hook before first application statement', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-entry-test-'));
  const script = path.join(root, 'app.asar/src/main.js'); fs.mkdirSync(path.dirname(script), { recursive: true });
  const source = "if (globalThis.entryHook !== 'before-main') throw new Error('missing entry hook'); setInterval(() => {}, 1000);\n";
  fs.writeFileSync(script, source);
  const child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise(resolve => child.once('close', resolve));
  let session;
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('debugger URL timeout')), 5000);
      child.stderr.on('data', data => { const url = String(data).match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
      child.once('error', reject);
    });
    session = await openSession(url);
    const hash = await interceptInstalledEntry(session, '/synthetic', { source, hookExpression: "globalThis.entryHook = 'before-main'; true" });
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(await session.evaluate('globalThis.entryHook'), 'before-main');
  } finally { session?.close(); child.kill(); await completion; fs.rmSync(root, { recursive: true, force: true }); }
});
for (const approved of [false, true]) test(`upgrade child orchestration preserves consent lock and exits normally: ${approved}`, async t => {
  const { EventEmitter } = require('node:events');
  const { runUpgradeChild } = require('../scripts/verify-installed-upgrade');
  const f = fixture(t); let child, phase = 'confirm', secondaryChecked = false, reportChecked = false;
  const result = await runUpgradeChild('/owned/installed.exe', f, approved, {
    spawnChild(executable, args) {
      assert.equal(executable, '/owned/installed.exe'); assert.ok(args.includes('--inspect-brk=127.0.0.1:0'));
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => child.emit('close', null, 'SIGKILL');
      queueMicrotask(() => child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:1234/abcd-1234\n'));
      return child;
    },
    async connect() { return {
      async evaluate(expression) {
        if (expression.includes('calls: s.calls')) return { phase, error: null, calls: phase === 'report' ? ['confirm', 'report'] : ['confirm'], relaunches: 0 };
        if (phase === 'confirm' && approved) {
          assert.equal(secondaryChecked, true);
          const upgrade = prepareConfigPreferencesUpgrade({ userDataPath: f.userDataPath }); upgrade.execute(upgrade.confirmation);
          phase = 'report'; return true;
        }
        if (approved) { assert.equal(reportChecked, true); child.stdout.emit('data', 'BUBU_UPGRADE_TEST_RELAUNCH\n'); }
        queueMicrotask(() => child.emit('close', 0, null)); return true;
      }, close() {}, async call() {}
    }; },
    async intercept() { return 'synthetic-entry-hash'; },
    async secondary(executable, profile) { assert.equal(executable, '/owned/installed.exe'); assert.equal(profile, f); verifyUnchanged(f); secondaryChecked = true; return { secondaryNormalExit: true }; },
    upgraded(profile) { reportChecked = true; return verifyApproved(profile); },
    async wait(completion, milliseconds) { await Promise.resolve(); return milliseconds >= 5000 ? completion : null; }
  });
  assert.equal(result.normalExit, true); assert.equal(result.lock.secondaryNormalExit, true);
  assert.equal(result.relaunchRequestedButSuppressed, approved); assert.equal(f.childClosed, true);
});
test('unreaped secondary marks the shared fixture unsafe to remove', async t => {
  const { EventEmitter } = require('node:events');
  const { verifyPendingLock, verifyInstalledUpgrade } = require('../scripts/verify-installed-upgrade');
  const f = fixture(t), child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  await assert.rejects(verifyPendingLock('/owned/installed.exe', f, { spawnChild: () => child, wait: async () => null }), /still running/);
  assert.equal(f.secondaryChildClosed, false);
  const unused = fixture(t); let count = 0;
  await assert.rejects(verifyInstalledUpgrade('/owned/installed.exe', {
    createFixture: () => count++ === 0 ? f : unused,
    async run(executable, profile) { profile.childClosed = false; throw new Error('secondary unclosed'); }
  }), /secondary unclosed/);
  assert.equal(fs.existsSync(f.root), true);
  assert.equal(fs.existsSync(unused.root), false);
});
