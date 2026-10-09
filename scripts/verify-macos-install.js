'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { createDisposableProfile, readDisposableProfile, removeDisposableProfile } = require('../tools/dev-bench/profile-fixture');
const { localDayKey } = require('../src/core/calendar');
const { verifyCodeSignature } = require('./macos-code-signature');

// Child output is untrusted even for a synthetic profile. Publish only bounded,
// allowlisted diagnostic facts, never arbitrary log lines or environment values.
function summarizeStartupOutput(output) {
  const errorKinds = [...new Set(output.match(/\b(?:TypeError|ReferenceError|SyntaxError|RangeError|Uncaught|UnhandledPromiseRejectionWarning|ENOTDIR|ENOENT|EACCES|EPERM|ERR_[A-Z_]+)\b/g) || [])].slice(0, 20);
  const missingModules = [...output.matchAll(/Cannot find module ['"]([@a-zA-Z0-9_.\/-]+)['"]/g)]
    .map(match => match[1]).filter(name => !name.startsWith('/') && !name.includes('..')).slice(0, 10);
  const stackFrames = [...output.matchAll(/app\.asar\/(src\/[a-zA-Z0-9_./-]+:\d+:\d+)/g)]
    .map(match => match[1]).slice(0, 20);
  const factStoreTiers = [...output.matchAll(/\[fact-store\] tier=(sqlite|jsonl|none)\b/g)].map(match => match[1]);
  return { errorKinds, missingModules, stackFrames, factStoreTiers,
    appThrewError: output.includes('App threw an error'),
    outputCharacters: output.length, outputSha256: crypto.createHash('sha256').update(output).digest('hex') };
}

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
  const executable = path.join(installed, 'Contents/MacOS/小步');
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
  removeProfile = removeDisposableProfile, log = console.log, diagnosticFile = null, freshLaunch = null, upgradeLaunch = null } = {}) {
  assert.equal(platform, 'darwin', 'installation verification requires macOS');
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const dmg = path.resolve(argv[2] || path.join(root, `dist/bubu-${version}-mac-arm64-adhoc-test.dmg`));
  const fixture = createProfile({ scenario: 'all', purpose: 'install', now });
  const mount = path.join(fixture.root, 'volume');
  const installed = path.join(fixture.root, 'Applications/小步.app');
  let attached = false;
  let child;
  let completion;
  let closed = false;
  let output = '';
  let omittedOutputCharacters = 0;
  let stage = 'verify-dmg';
  let persistedRevision = null;
  const captureOutput = data => {
    const text = String(data);
    const remaining = Math.max(0, 65536 - output.length);
    output += text.slice(0, remaining);
    omittedOutputCharacters += Math.max(0, text.length - remaining);
  };
  let report;
  try {
    fs.mkdirSync(mount);
    execFile('hdiutil', ['verify', dmg], { stdio: 'pipe' });
    execFile('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'pipe' });
    attached = true;
    execFile('ditto', [path.join(mount, '小步.app'), installed]);
    const hash = sha256(path.join(installed, 'Contents/Resources/app.asar'));
    assert.equal(hash, sha256(path.join(mount, '小步.app/Contents/Resources/app.asar')));
    const codeSignature = verifyCodeSignature(installed, { platform, execFile });
    // Match a normal packaged launch. --dev also enables source hot reload,
    // which cannot watch an immutable ASAR; profile isolation comes solely
    // from Electron's explicit user-data-dir switch, not developer mode.
    stage = 'launch-installed-app';
    child = spawnChild(path.join(installed, 'Contents/MacOS/小步'),
      [`--user-data-dir=${fixture.userDataPath}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', captureOutput);
    child.stderr.on('data', captureOutput);
    completion = new Promise(resolve => {
      let error;
      child.once('error', caught => { error = caught; });
      child.once('close', (code, signal) => { closed = true; resolve({ code, signal, error }); });
    });
    const early = await wait(completion, 6000);
    assert.equal(early, null, 'installed app exited before readiness');
    stage = 'graceful-shutdown';
    await closeInstalledChild(child, completion, installed, { execFile, wait });
    assert.equal(closed, true, 'the application owner must close before SQL verification');
    stage = 'application-startup-output';
    assert.equal(/App threw an error|ReferenceError|TypeError|Uncaught|UnhandledPromiseRejection/.test(output), false, 'installed app reported a startup error');
    assert.equal(omittedOutputCharacters, 0, 'installed app output exceeded diagnostic bound; startup cannot be accepted');
    stage = 'read-seeded-sql-authority';
    const { state: persisted, revision } = readProfile(fixture);
    persistedRevision = revision;
    stage = 'verify-startup-commit';
    const initial = fixture.initial;
    assert.ok(revision > fixture.revision, 'startup must commit to the seeded SQL authority');
    assert.deepEqual(persisted.tasks.map(task => [task.id, task.title]), initial.tasks.map(task => [task.id, task.title]));
    assert.equal(persisted.xp, initial.xp);
    assert.deepEqual(persisted.rewardLedger, initial.rewardLedger);
    assert.equal(persisted.tasks.find(task => task.seriesId).occurrenceDate, localDayKey(now));
    assert.equal(/App threw an error|ReferenceError|TypeError|Uncaught|UnhandledPromiseRejection/.test(output), false, 'installed app reported a startup error');
    stage = 'empty-profile-first-launch-and-reopen';
    const freshProfile = freshLaunch ? await freshLaunch(path.join(installed, 'Contents/MacOS/小步')) : null;
    stage = 'installed-explicit-preferences-upgrade';
    assert.ok(!upgradeLaunch || freshProfile, 'empty-profile launch must pass before upgrade coverage');
    const preferencesUpgrade = upgradeLaunch ? await upgradeLaunch(path.join(installed, 'Contents/MacOS/小步')) : null;
    report = {
      freshProfile, preferencesUpgrade,
      result: 'passed', sourceCommit: process.env.GITHUB_SHA || null,
      dmg, dmgSha256: sha256(dmg), installed, profile: fixture.userDataPath,
      asarSha256: hash, persistedRevision: revision, preservedTasks: persisted.tasks.length, recurrenceCaughtUp: true,
      codeSignature,
      launchAcceptance: 'production-mode direct executable launch from disposable DMG copy; no Internet quarantine added or removed',
      gatekeeperAcceptance: 'not asserted; Developer ID and notarization are separate distribution requirements'
    };
  } catch (error) {
    // This verifier launches only its own synthetic, disposable profile. Keep
    // bounded child diagnostics on failure: a surviving Electron error dialog
    // is not evidence that application startup or the SQL owner was ready.
    const diagnostic = { freshStartup: error.diagnostic || null, stage, seedRevision: fixture.revision, persistedRevision,
      childClosed: closed, omittedOutputCharacters,
      fixtureFiles: Object.fromEntries(['config.sqlite', 'config.sqlite.identity.sqlite', 'bubu.sqlite', 'Preferences', 'Local State'].map(name => [name, fs.existsSync(path.join(fixture.userDataPath, name))])),
      childOutput: summarizeStartupOutput(output) };
    if (diagnosticFile) fs.writeFileSync(diagnosticFile, JSON.stringify(diagnostic, null, 2) + '\n');
    throw new Error(`${error.message}\nInstaller diagnostic: ${JSON.stringify(diagnostic)}`, { cause: error });
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

if (require.main === module) verifyInstall({ diagnosticFile: path.resolve(__dirname, '../dist/macos-install-diagnostic.json'),
  freshLaunch: executable => require('./installed-first-launch').verifyFreshLaunch(executable),
  upgradeLaunch: executable => require('./verify-installed-upgrade').verifyInstalledUpgrade(executable) }).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { summarizeStartupOutput, sha256, waitForOutcome, closeInstalledChild, verifyInstall };
