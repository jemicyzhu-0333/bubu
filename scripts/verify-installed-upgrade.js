'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { waitForOutcome, summarizeStartupOutput } = require('./verify-macos-install');
const { verifyProfileLaunch } = require('./installed-first-launch');
const { createUpgradeFixture, verifyUnchanged, verifyApproved, verifyReopened } = require('./installed-upgrade-profile');
const { openSession, interceptInstalledEntry, responseExpression, ELECTRON, STATE } = require('./installed-upgrade-inspector');

async function verifyPendingLock(executable, fixture, { spawnChild = spawn, wait = waitForOutcome } = {}) {
  const child = spawnChild(executable, [`--user-data-dir=${fixture.userDataPath}`],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  fixture.secondaryChildClosed = false;
  let output = '', exceeded = false, closed = false;
  const capture = data => { const text = String(data); exceeded ||= output.length + text.length > 65536; output += text.slice(0, Math.max(0, 65536 - output.length)); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const completion = new Promise(resolve => {
    let error; child.once('error', caught => { error = caught; });
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal, error }); });
  });
  try {
    const outcome = await wait(completion, 15000);
    assert.ok(outcome, 'second same-profile process did not exit while consent holds the lock');
    assert.ifError(outcome.error); assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
    assert.equal(exceeded, false); assert.equal(/App threw an error|Uncaught|UnhandledPromiseRejection/.test(output), false);
    return { secondaryNormalExit: true };
  } finally {
    if (!closed) { child.kill('SIGKILL'); await wait(completion, 5000); }
    fixture.secondaryChildClosed = closed;
    assert.equal(closed, true, 'second instance still running; retain fixture');
  }
}
async function runUpgradeChild(executable, fixture, approved, { spawnChild = spawn, connect = openSession,
  intercept = interceptInstalledEntry, unchanged = verifyUnchanged, upgraded = verifyApproved, secondary = verifyPendingLock, wait = waitForOutcome } = {}) {
  let child, session, closed = false, completion, stage = 'launch-upgrade-child', output = '', omitted = 0;
  const capture = data => { const value = String(data), remaining = Math.max(0, 65536 - output.length); output += value.slice(0, remaining); omitted += Math.max(0, value.length - remaining); };
  try {
    child = spawnChild(executable, [`--user-data-dir=${fixture.userDataPath}`, '--inspect-brk=127.0.0.1:0'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    completion = new Promise(resolve => {
      let error;
      child.once('error', caught => { error = caught; });
      child.once('close', (code, signal) => { closed = true; resolve({ code, signal, error }); });
    });
    for (let attempt = 0; attempt < 40 && !session; attempt++) {
      assert.equal(await wait(completion, 250), null, 'upgrade child exited before debugger');
      const url = output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/)?.[1];
      if (url) session = await connect(url);
    }
    assert.ok(session, 'upgrade loopback inspector unavailable');
    stage = 'intercept-verified-installed-entry';
    const entrySha256 = await intercept(session, fixture.userDataPath);
    async function waitPhase(phase) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const state = await session.evaluate(`(() => { const s = globalThis.${STATE}; return s ? { phase: s.phase, error: s.error, calls: s.calls, relaunches: s.relaunches } : null; })()`);
        assert.ok(state, 'upgrade interception state absent');
        assert.equal(state.error, null, `upgrade dialog interception failed: ${state.error}`);
        if (state.phase === phase) return state;
        assert.equal(await wait(completion, 250), null, 'upgrade child exited before expected dialog');
      }
      throw new Error('upgrade native admission/dialog deadline exceeded');
    }
    stage = 'before-consent';
    const confirm = await waitPhase('confirm');
    assert.deepEqual(confirm.calls, ['confirm']); assert.equal(confirm.relaunches, 0);
    unchanged(fixture);
    stage = 'consent-source-lock-retained';
    const lock = await secondary(executable, fixture, { spawnChild, wait });
    unchanged(fixture);
    const sourceBeforeSha256 = createHash('sha256').update(JSON.stringify(Object.entries(fixture.before).map(([name, value]) => [name, value.sha256, value.mtimeNs]))).digest('hex');
    stage = approved ? 'approved-native-upgrade' : 'declined-native-upgrade';
    assert.equal(await session.evaluate(responseExpression(approved)), true);
    let upgradeResult = null;
    if (approved) {
      const report = await waitPhase('report');
      assert.deepEqual(report.calls, ['confirm', 'report']); assert.equal(report.relaunches, 0);
      stage = 'before-restart-verification';
      upgradeResult = upgraded(fixture);
      assert.equal(await session.evaluate(responseExpression(false, true)), true);
    }
    // Detach before waiting so Node's debugger does not hold an otherwise normal exit.
    session.close(); session = null;
    stage = 'normal-upgrade-process-exit';
    const outcome = await wait(completion, 15000);
    assert.ok(outcome, 'upgrade child failed to quit normally'); assert.ifError(outcome.error);
    assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
    assert.equal(omitted, 0, 'upgrade output exceeds diagnostic bound');
    assert.equal(/App threw an error|Uncaught|UnhandledPromiseRejection/.test(output), false);
    const relaunches = (output.match(/BUBU_UPGRADE_TEST_RELAUNCH/g) || []).length;
    assert.equal(relaunches, approved ? 1 : 0, 'test must record the exact production relaunch request');
    if (!approved) unchanged(fixture);
    return { entrySha256, sourceBeforeSha256, lock, beforeConsentBytesAndMtimesUnchanged: true,
      declinedBytesAndMtimesUnchanged: !approved, normalExit: true, relaunchRequestedButSuppressed: approved, upgrade: upgradeResult };
  } catch (error) {
    error.diagnostic = { stage, approved, childClosed: closed, omitted,
      startupCodes: [...new Set(output.match(/config-(?:upgrade-[a-z-]+|admission-permissions-unavailable|profile-brand-required)/g) || [])].slice(0, 12),
      output: summarizeStartupOutput(output) };
    throw error;
  } finally {
    if (session && !closed) {
      try { await session.call('Debugger.resume'); } catch (_) { /* may already be running */ }
      try { await session.evaluate(`setTimeout(() => ${ELECTRON}.app.quit(), 100); true`); } catch (_) { /* failure cleanup only */ }
      session.close(); session = null;
      await wait(completion, 5000);
    }
    if (child && !closed) { child.kill('SIGKILL'); await wait(completion, 5000); }
    fixture.childClosed = (!child || closed) && fixture.secondaryChildClosed !== false;
  }
}
async function verifyInstalledUpgrade(executable, { createFixture = createUpgradeFixture, run = runUpgradeChild, reopen = verifyProfileLaunch } = {}) {
  const fixtures = [];
  try {
    const cancel = createFixture(); fixtures.push(cancel);
    const approve = createFixture(); fixtures.push(approve);
    const declined = await run(executable, cancel, false);
    const upgraded = await run(executable, approve, true);
    const reopened = await reopen(executable, { fixture: approve, fresh: false, readProfile: () => verifyReopened(approve) });
    return { result: 'passed', declined, upgraded, reopened,
      acceptance: 'actual installed native runtime, SQLite, filesystem and permission checks with synthetic BUBU18 WAL/SHM fixtures; exact consent/report ports automated; production relaunch request recorded and suppressed; separate installed-executable persistence reopen',
      notAsserted: ['manual consent dialog input', 'native automatic relaunch', 'accessibility', 'real credentials', 'OS trust warnings'] };
  } finally {
    for (const fixture of fixtures) if (fixture.childClosed) fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}
module.exports = { verifyPendingLock, runUpgradeChild, verifyInstalledUpgrade };
