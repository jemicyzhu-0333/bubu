'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('./verify-macos-install');
const { verifyFreshLaunch } = require('./installed-first-launch');
const { verifyInstalledUpgrade } = require('./verify-installed-upgrade');
const { verifyWindowsDefaultProfile } = require('./verify-windows-default-profile');

async function verifyWindowsInstall({ platform = process.platform, env = process.env,
  argv = process.argv, execFile = execFileSync, launch = verifyFreshLaunch, upgrade = verifyInstalledUpgrade,
  defaultProfile = verifyWindowsDefaultProfile, log = console.log } = {}) {
  assert.equal(platform, 'win32', 'NSIS installed verification requires Windows');
  // Installation registers an application. Only run on a disposable hosted CI
  // machine; never install/uninstall over a person's daily application.
  assert.equal(env.GITHUB_ACTIONS, 'true', 'NSIS verification requires a disposable GitHub Actions runner');
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const installer = path.resolve(argv[2] || path.join(root, `dist/bubu-${version}-win-x64.exe`));
  assert.ok(fs.statSync(installer).isFile(), 'built NSIS installer is required');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-nsis-'));
  const installed = path.join(temporary, 'app');
  const diagnosticFile = path.join(root, 'dist/windows-install-diagnostic.json');
  let stage = 'install';
  let success = false;
  try {
    // NSIS requires /D last and unquoted as a single argument. windowsVerbatimArguments
    // preserves its parser's convention even when the temporary path has spaces.
    execFile(installer, ['/S', '/currentuser', `/D=${installed}`], {
      stdio: 'pipe', timeout: 120000, windowsVerbatimArguments: true
    });
    const executable = path.join(installed, 'bubu.exe');
    const asar = path.join(installed, 'resources/app.asar');
    assert.ok(fs.statSync(executable).isFile(), 'installed executable missing');
    assert.ok(fs.statSync(asar).isFile(), 'installed production ASAR missing');
    stage = 'installed-first-launch-and-reopen';
    const launches = await launch(executable);
    stage = 'installed-default-profile-and-runtime-residue';
    const defaultProfiles = await defaultProfile(executable, { platform, env });
    stage = 'installed-explicit-preferences-upgrade';
    const preferencesUpgrade = await upgrade(executable);
    const report = { result: 'passed', sourceCommit: env.GITHUB_SHA || null,
      installerSha256: sha256(installer), installedAsarSha256: sha256(asar), ...launches, defaultProfiles, preferencesUpgrade,
      trustAcceptance: 'not asserted; unsigned installer and OS warning acceptance are separate checks' };
    stage = 'uninstall';
    const uninstallers = fs.readdirSync(installed).filter(name => /^Uninstall .*\.exe$/i.test(name));
    assert.equal(uninstallers.length, 1, 'exact owned uninstall entry required');
    execFile(path.join(installed, uninstallers[0]), ['/S', '/currentuser', `_?=${installed}`],
      { stdio: 'pipe', timeout: 120000, windowsVerbatimArguments: true });
    success = true;
    log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    fs.mkdirSync(path.dirname(diagnosticFile), { recursive: true });
    fs.writeFileSync(diagnosticFile, JSON.stringify({ stage, startup: error.diagnostic || null, defaultProfile: error.defaultProfileDiagnostic || null,
      errorCode: typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : null }, null, 2) + '\n');
    throw error;
  } finally {
    // Preserve failed installation for diagnostics; never recursively remove an
    // installation while a startup child may still be holding its authority.
    if (success) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) verifyWindowsInstall().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { verifyWindowsInstall };
