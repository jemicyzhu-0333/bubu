'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { createDisposableProfile, readDisposableProfile, removeDisposableProfile } = require('../tools/dev-bench/profile-fixture');
const { localDayKey } = require('../src/core/calendar');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function waitForOutcome(completion, milliseconds) {
  let timer;
  return Promise.race([completion, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function requestQuit(child, installed, execFile) {
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0, 'installed process identity is required');
  // AppKit targets the exact launched PID and checks its executable. A bundle-ID
  // quit request could instead reach an unrelated daily instance of this app.
  const executable = path.join(installed, 'Contents/MacOS/I’m ADHDer');
  const script = `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid});
    if (!app || app.isTerminated || app.executableURL.path.js !== ${JSON.stringify(executable)}) throw new Error('installed process changed');
    if (!app.terminate) throw new Error('installed app refused graceful quit');`;
  execFile('osascript', ['-l', 'JavaScript', '-e', script], { stdio: 'pipe', timeout: 5000 });
}
async function closeInstalledChild(child, completion, installed, { execFile = execFileSync, wait = waitForOutcome } = {}) {
  requestQuit(child, installed, execFile);
  const outcome = await wait(completion, 5000);
  if (!outcome) {
    child.kill('SIGKILL');
    await wait(completion, 5000);
    throw new Error('installed app did not quit cleanly; persistence acceptance not run');
  }
  assert.ifError(outcome.error);
  assert.equal(outcome.code, 0, 'installed app must exit successfully before SQL verification');
  assert.equal(outcome.signal, null, 'a killed process is not a clean shutdown');
}

async function verifyInstall({ platform = process.platform, argv = process.argv, now = Date.now(),
  execFile = execFileSync, spawnChild = spawn, wait = waitForOutcome,
  createProfile = createDisposableProfile, readProfile = readDisposableProfile,
  removeProfile = removeDisposableProfile, log = console.log } = {}) {
  assert.equal(platform, 'darwin', 'installation verification requires macOS');
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const dmg = path.resolve(argv[2] || path.join(root, `dist/I’m ADHDer-${version}-arm64.dmg`));
  const fixture = createProfile({ scenario: 'all', purpose: 'install', now });
  const mount = path.join(fixture.root, 'volume');
  const installed = path.join(fixture.root, 'Applications/I’m ADHDer.app');
  let attached = false;
  let child;
  let completion;
  let closed = false;
  let output = '';
  let report;
  try {
    fs.mkdirSync(mount);
    execFile('hdiutil', ['verify', dmg], { stdio: 'pipe' });
    execFile('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'pipe' });
    attached = true;
    execFile('ditto', [path.join(mount, 'I’m ADHDer.app'), installed]);
    const hash = sha256(path.join(installed, 'Contents/Resources/app.asar'));
    assert.equal(hash, sha256(path.join(mount, 'I’m ADHDer.app/Contents/Resources/app.asar')));
    child = spawnChild(path.join(installed, 'Contents/MacOS/I’m ADHDer'),
      [`--user-data-dir=${fixture.userDataPath}`, '--dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    completion = new Promise(resolve => {
      let error;
      child.once('error', caught => { error = caught; });
      child.once('close', (code, signal) => { closed = true; resolve({ code, signal, error }); });
    });
    const early = await wait(completion, 6000);
    assert.equal(early, null, `installed app exited before readiness: ${output}`);
    await closeInstalledChild(child, completion, installed, { execFile, wait });
    assert.equal(closed, true, 'the application owner must close before SQL verification');
    const { state: persisted, revision } = readProfile(fixture);
    const initial = fixture.initial;
    assert.ok(revision > fixture.revision, 'startup must commit to the seeded SQL authority');
    assert.deepEqual(persisted.tasks.map(task => [task.id, task.title]), initial.tasks.map(task => [task.id, task.title]));
    assert.equal(persisted.xp, initial.xp);
    assert.deepEqual(persisted.rewardLedger, initial.rewardLedger);
    assert.equal(persisted.tasks.find(task => task.seriesId).occurrenceDate, localDayKey(now));
    assert.doesNotMatch(output, /App threw an error|ReferenceError|TypeError|Uncaught/);
    report = {
      result: 'passed', dmg, dmgSha256: sha256(dmg), installed, profile: fixture.userDataPath,
      asarSha256: hash, persistedRevision: revision, preservedTasks: persisted.tasks.length, recurrenceCaughtUp: true,
      signingAcceptance: 'not asserted; separate release gate required'
    };
  } finally {
    // Failure cleanup may force-stop this exact child, but can never count as a
    // successful shutdown or trigger persistence assertions afterward.
    try {
      if (child && !closed) {
        if (Number.isSafeInteger(child.pid)) child.kill('SIGKILL');
        await wait(completion, 5000);
        assert.equal(closed, true, 'installed child is still running; preserve its temporary files');
      }
    } finally {
      if (attached) {
        execFile('hdiutil', ['detach', mount], { stdio: 'pipe' });
        attached = false;
      }
      if (!child || closed) removeProfile(fixture);
    }
  }
  log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) verifyInstall().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { sha256, waitForOutcome, closeInstalledChild, verifyInstall };
