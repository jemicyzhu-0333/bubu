'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Read-only diagnostic, deliberately separate from code-integrity acceptance.
// A local CI assessment cannot reproduce a browser download/Finder launch.
function assessDistribution(appPath, { platform = process.platform, run = spawnSync } = {}) {
  assert.equal(platform, 'darwin', 'distribution assessment requires macOS');
  assert.ok(path.isAbsolute(appPath), 'app bundle path must be absolute');
  const invoke = args => {
    const result = run('/usr/sbin/spctl', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 65536 });
    if (result.error || result.signal || !Number.isInteger(result.status)) throw new Error('Gatekeeper assessment tool unavailable');
    return result;
  };
  const status = invoke(['--status']);
  const policyEnabled = status.status === 0 && `${status.stdout || ''}\n${status.stderr || ''}`.trim() === 'assessments enabled';
  const report = { policyEnabled, browserDownloadAndFinderAcceptance: 'not-tested',
    quarantineChanges: 'none', developerIdAndNotarization: 'not-established' };
  if (!policyEnabled) return { ...report, decision: 'not-assessed', reason: 'runner policy is not confirmed enabled' };
  const result = invoke(['--assess', '--type', 'execute', '--verbose=4', appPath]);
  return { ...report, decision: result.status === 0 ? 'accepted-by-local-spctl' : 'not-accepted-by-local-spctl',
    exitCode: result.status, details: `${result.stdout || ''}\n${result.stderr || ''}`.trim() };
}

if (require.main === module) {
  try {
    const app = path.resolve(process.argv[2] || 'dist/mac-arm64/小步.app');
    console.log(JSON.stringify(assessDistribution(app), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assessDistribution };
