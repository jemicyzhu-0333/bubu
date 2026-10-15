'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { observeNativePermission } = require('./helpers/native-permission-observation.cjs');
const { verifyProbePermissions, verifyWindowsProbePermissions, createProbeWaitBudget, ACL_PROGRAM } =
  require('../src/platform/persistence/sqlite/config-admission-permissions');
const SID = 'S-1-5-21-100-200-300-1001';
const report = JSON.stringify({ sid: SID, entries: [{ index: 0, owner: SID, nullDacl: false, reparse: false,
  directory: true, aces: [{ sid: SID, type: 'AccessAllowed', flags: 0 }] }] });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acl-observation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('observation forwards original arguments and result by identity without retrying', () => {
  const args = ['fixed.exe', ['fixed'], { timeout: 15000, input: 'private path' }];
  const result = { status: 0, signal: null, stdout: 'private ACL', stderr: '' };
  let calls = 0, tick = 0;
  const observation = observeNativePermission(run => {
    const observed = run(...args);
    assert.equal(observed, result);
    return observed;
  }, { now: () => ++tick, run(...actual) {
    calls++; actual.forEach((value, index) => assert.equal(value, args[index])); return result;
  } });
  assert.equal(calls, 1); assert.equal(observation.failed, false); assert.equal(observation.value, result);
  assert.deepEqual(observation.report.processes[0], {
    enterOffsetMs: 1, returnOffsetMs: 2, elapsedMs: 1, timeoutMs: 15000,
    didReturn: true, status: 0, signal: null, errorCode: null, stage: null, stdoutBytes: 11, stderrBytes: 0
  });
  assert.doesNotMatch(JSON.stringify(observation.report), /private|fixed\.exe/);
});

test('observation retains thrown error identity and sanitizes unknown metadata', () => {
  const error = Object.assign(Error('private account and path'), { code: 'PRIVATE', diagnostic: 'private stage' });
  const observation = observeNativePermission(run => run('private.exe', [], { timeout: 15000 }), {
    run() { throw error; }
  });
  assert.equal(observation.failed, true); assert.equal(observation.error, error);
  assert.equal(observation.report.gateStage, 'other');
  assert.equal(observation.report.processes[0].didReturn, false);
  assert.equal(observation.report.processes[0].errorCode, 'other');
  assert.doesNotMatch(JSON.stringify(observation.report), /private|PRIVATE/);
});

test('ETIMEDOUT remains distinct from a successful process rejected by the unchanged shared budget', t => {
  const directory = fixture(t);
  for (const lateSuccess of [false, true]) {
    let tick = 0, calls = 0, caught;
    const budget = createProbeWaitBudget({ now: () => tick });
    const raw = lateSuccess
      ? { status: 0, signal: null, stdout: report, stderr: '' }
      : { status: null, signal: 'SIGTERM', error: Object.assign(Error('private timeout'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' };
    const observation = observeNativePermission(run => {
      try {
        verifyWindowsProbePermissions(directory, [], { run, waitBudget: budget, environment: { SystemRoot: 'C:\\Windows' } });
      } catch (error) { caught = error; throw error; }
    }, { now: () => tick, run(executable, args, options) {
      calls++; assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_PROGRAM]);
      assert.equal(options.timeout, 15000); assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true); assert.equal(options.maxBuffer, 65536);
      tick += 15037; return raw;
    } });
    assert.equal(calls, 1); assert.equal(observation.failed, true); assert.equal(observation.error, caught);
    assert.equal(observation.error.diagnostic, 'timeout');
    assert.equal(observation.report.gateStage, 'timeout');
    assert.equal(observation.report.processes[0].status, lateSuccess ? 0 : null);
    assert.equal(observation.report.processes[0].errorCode, lateSuccess ? null : 'ETIMEDOUT');
    assert.equal(observation.report.processes[0].elapsedMs, 15037);
    assert.throws(() => budget.run(() => assert.fail('exhausted gate must not run another process')), error => error.diagnostic === 'timeout');
    assert.doesNotMatch(JSON.stringify(observation.report), /private|S-1-/);
  }
});

test('known modules stage survives while arbitrary native stderr never leaks', () => {
  for (const stderr of ['config-admission-acl:modules', 'private account and path', '#< CLIXML private']) {
    const observation = observeNativePermission(run => run('unused', [], { timeout: 15000 }), {
      run: () => ({ status: 1, signal: 'private signal', stdout: 'private stdout', stderr })
    });
    assert.equal(observation.report.processes[0].stage, stderr === 'config-admission-acl:modules' ? 'modules' : null);
    assert.equal(observation.report.processes[0].signal, 'other');
    assert.doesNotMatch(JSON.stringify(observation.report), /private|CLIXML/);
  }
});

test('native verifier still rejects a valid report returned on the exact 15000ms boundary', t => {
  const directory = fixture(t); let tick = 0;
  const budget = createProbeWaitBudget({ now: () => tick });
  const observation = observeNativePermission(run => verifyWindowsProbePermissions(directory, [], {
    run, waitBudget: budget, environment: { SystemRoot: 'C:\\Windows' }
  }), { now: () => tick, run() { tick += 15000; return { status: 0, signal: null, stdout: report, stderr: '' }; } });
  assert.equal(observation.failed, true); assert.equal(observation.report.gateStage, 'timeout');
  assert.equal(observation.report.processes[0].status, 0);
});

test('full host verification retains filesystem and membership checks around the same Windows gate', t => {
  const directory = fixture(t); let calls = 0;
  const observation = observeNativePermission(run => verifyProbePermissions(directory, [], {
    platform: 'win32', verifyWindows(dir, members, controls) {
      return verifyWindowsProbePermissions(dir, members, { ...controls, run, environment: { SystemRoot: 'C:\\Windows' } });
    }
  }), { run() {
    calls++; fs.writeFileSync(path.join(directory, 'unexpected'), 'synthetic');
    return { status: 0, signal: null, stdout: report, stderr: '' };
  } });
  assert.equal(calls, 1); assert.equal(observation.failed, true);
  assert.ok(['file-drift', 'membership'].includes(observation.report.gateStage));
  assert.equal(observation.report.processes[0].status, 0);
});

test('non-Windows invocations need no synthetic native process', () => {
  const observation = observeNativePermission(() => 'complete', { run() { assert.fail('must not spawn'); } });
  assert.equal(observation.failed, false); assert.equal(observation.value, 'complete');
  assert.equal(observation.report.nativeCalls, 0);
});

test('post-failure diagnostic recognizes modules without exposing native output', () => {
  const { summarize } = require('../scripts/diagnose-windows-acl-startup.cjs');
  const value = summarize({ elapsedMs: 12, status: 1, stdout: 'stage:modules', stderr: 'private module path' });
  assert.equal(value.stage, 'modules'); assert.equal(value.stderrPresent, true);
  assert.doesNotMatch(JSON.stringify(value), /private/);
});
