'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Verify integrity, including nested code. This does not establish Developer ID,
// notarization or Gatekeeper acceptance of an Internet-downloaded application.
function verifyCodeSignature(appPath, { platform = process.platform, execFile = execFileSync } = {}) {
  assert.equal(platform, 'darwin', 'code signature verification requires macOS');
  assert.ok(path.isAbsolute(appPath), 'app bundle path must be absolute');
  execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'pipe', timeout: 60000 });
  return { integrity: 'codesign-deep-strict-verified', developerIdentityAndNotarization: 'not-asserted' };
}

module.exports = { verifyCodeSignature };
