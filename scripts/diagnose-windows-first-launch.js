'use strict';

// Manual, disposable-runner diagnosis. Baseline and candidate install serially
// because NSIS registers the same app identity; no real profile is consulted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createEmptyProfile, verifyProfileLaunch } = require('./installed-first-launch');
const { sha256 } = require('./verify-macos-install');
const BASELINE_SHA256 = 'af7b632eb87d5ff7cc6f2d728852fe1ebb220e56dba83b1f42aff7bb06ec52dd';
const BASELINE_BYTES = 136098078;

function profileManifest(profile) {
  const records = [];
  function visit(directory, prefix = '', depth = 0) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(records.length < 256 && depth < 8, 'synthetic residue manifest bound exceeded');
      const name = prefix + entry.name, file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
      records.push({ name, type, size: stat.size,
        sha256: type === 'file' && stat.size <= 32 * 1024 * 1024 ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null });
      if (type === 'directory') visit(file, name + '/', depth + 1);
    }
  }
  visit(profile.userDataPath);
  return records;
}
function install(installer, directory) {
  execFileSync(installer, ['/S', '/currentuser', `/D=${directory}`], { stdio: 'pipe', timeout: 120000, windowsVerbatimArguments: true });
  const executable = path.join(directory, 'bubu.exe');
  assert.ok(fs.statSync(executable).isFile());
  return executable;
}
function uninstall(directory) {
  const entries = fs.readdirSync(directory).filter(name => /^Uninstall .*\.exe$/i.test(name));
  assert.equal(entries.length, 1);
  // _?= suppresses the NSIS self-copy detachment, so this call waits until the
  // old registration is removed before a new version is installed.
  execFileSync(path.join(directory, entries[0]), ['/S', '/currentuser', `_?=${directory}`],
    { stdio: 'pipe', timeout: 120000, windowsVerbatimArguments: true });
}
function classifyStartupFailure(diagnostic) {
  return ['graceful-quit', 'closed-authority-verification'].includes(diagnostic?.stage)
    ? 'post-startup-validation-failed' : 'rejected';
}
async function observe(executable, fixture, fresh) {
  try {
    const result = await verifyProfileLaunch(executable, { fixture, fresh });
    return { status: 'started', result, residue: profileManifest(fixture) };
  } catch (error) {
    assert.equal(fixture.childClosed, true, 'failed child still running; stop serial diagnosis');
    const status = classifyStartupFailure(error.diagnostic);
    return { status, diagnostic: error.diagnostic || null, residue: profileManifest(fixture) };
  }
}
async function diagnose({ platform = process.platform, env = process.env, argv = process.argv } = {}) {
  assert.equal(platform, 'win32');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'diagnosis requires a disposable GitHub Actions runner');
  assert.ok(argv[2] && argv[3], 'supply exact downloaded r4 installer and candidate installer');
  const baseline = path.resolve(argv[2]), candidate = path.resolve(argv[3]);
  assert.equal(fs.statSync(baseline).size, BASELINE_BYTES);
  assert.equal(sha256(baseline), BASELINE_SHA256, 'r4 asset must match the reviewed official release');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-startup-diagnosis-'));
  const fixture = createEmptyProfile();
  const report = { sourceCommit: env.GITHUB_SHA || null, baselineSha256: BASELINE_SHA256, candidateSha256: sha256(candidate),
    acceptance: 'instrumented installed startup and synthetic residue only; no manual UI, SmartScreen or existing-user recovery assertion' };
  const output = path.resolve(__dirname, '../dist/windows-first-launch-diagnosis.json');
  try {
    const oldDirectory = path.join(root, 'baseline');
    report.baseline = await observe(install(baseline, oldDirectory), fixture, true);
    uninstall(oldDirectory);
    const candidateDirectory = path.join(root, 'candidate');
    const executable = install(candidate, candidateDirectory);
    report.candidateOnFailedProfile = await observe(executable, fixture, false);
    report.recoveryConclusion = report.candidateOnFailedProfile.status === 'started'
      ? 'candidate started the same synthetic baseline profile without reseeding'
      : 'same-profile startup/recovery not verified; inspect the recorded stage before drawing a rejection or recovery conclusion';
    const fresh = createEmptyProfile();
    try {
      report.candidateFresh = await observe(executable, fresh, true);
      if (report.candidateFresh.status === 'started') report.candidateFreshReopen = await observe(executable, fresh, false);
    } finally { if (fresh.childClosed) fs.rmSync(fresh.root, { recursive: true, force: true }); }
    uninstall(candidateDirectory);
    report.baselineStartupFailureObserved = report.baseline.status === 'rejected'
      && ['launch', 'production-window-readiness'].includes(report.baseline.diagnostic?.stage);
    // Windows native error dialogs may not echo their text to stderr. Never
    // turn a readiness failure into proof of a particular exception code.
    report.baselineSpecificCodeObserved = report.baseline.diagnostic?.startupCodes?.includes('config-profile-brand-required') === true;
    report.baselineCauseConclusion = report.baselineSpecificCodeObserved
      ? 'config-profile-brand-required appeared in exact child output'
      : 'specific native dialog error unconfirmed; startup outcome and residue do not alone prove the source-level cause';
    report.candidateFreshPassed = report.candidateFresh.status === 'started' && report.candidateFreshReopen?.status === 'started';
    assert.equal(report.baselineStartupFailureObserved, true, 'released startup did not fail; compare source-level regression evidence separately');
    assert.equal(report.candidateFreshPassed, true, 'candidate empty-profile startup and reopen did not pass');
    return report;
  } finally {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    // Only closed synthetic profiles are removed. Failure residue bytes are
    // represented by names/types/lengths/SHA-256, never uploaded as raw data.
    if (fixture.childClosed) fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}
if (require.main === module) diagnose().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { BASELINE_SHA256, BASELINE_BYTES, profileManifest, classifyStartupFailure, diagnose };
