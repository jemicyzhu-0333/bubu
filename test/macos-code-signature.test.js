'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { verifyCodeSignature } = require('../scripts/macos-code-signature');

test('macOS code-integrity gate verifies nested code strictly without claiming Gatekeeper trust', () => {
  const app = path.resolve('synthetic app/小步.app'), calls = [];
  const result = verifyCodeSignature(app, { platform: 'darwin', execFile: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app],
    { stdio: 'pipe', timeout: 60000 }]]);
  assert.equal(result.integrity, 'codesign-deep-strict-verified');
  assert.equal(result.developerIdentityAndNotarization, 'not-asserted');
});
test('failed code signature is a hard error with no repair or security override', () => {
  let calls = 0;
  assert.throws(() => verifyCodeSignature(path.resolve('bad.app'), { platform: 'darwin', execFile() {
    calls++; throw Error('invalid sealed resource');
  } }), /invalid sealed resource/);
  assert.equal(calls, 1);
});
test('signature verification rejects unsupported platforms before any command', () => {
  assert.throws(() => verifyCodeSignature(path.resolve('app'), { platform: 'linux', execFile: () => assert.fail() }), /macOS/);
});

test('distribution diagnostic preserves a rejection and never changes policy or quarantine', () => {
  const { assessDistribution } = require('../scripts/assess-macos-distribution');
  const app = path.resolve('synthetic.app'), calls = [];
  const result = assessDistribution(app, { platform: 'darwin', run(command, args) {
    calls.push([command, args]);
    return args[0] === '--status' ? { status: 0, stdout: 'assessments enabled\n', stderr: '' }
      : { status: 3, stdout: '', stderr: 'rejected\nsource=no usable signature' };
  } });
  assert.equal(result.decision, 'not-accepted-by-local-spctl');
  assert.equal(result.browserDownloadAndFinderAcceptance, 'not-tested');
  assert.deepEqual(calls, [['/usr/sbin/spctl', ['--status']],
    ['/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]]]);
});
test('disabled or uncertain runner policy cannot be reported as Gatekeeper acceptance', () => {
  const { assessDistribution } = require('../scripts/assess-macos-distribution');
  let calls = 0;
  const result = assessDistribution(path.resolve('synthetic.app'), { platform: 'darwin', run() {
    calls++; return { status: 0, stdout: 'assessments disabled\n', stderr: '' };
  } });
  assert.equal(result.decision, 'not-assessed'); assert.equal(calls, 1);
});
test('local policy acceptance still does not claim browser/Finder download acceptance', () => {
  const { assessDistribution } = require('../scripts/assess-macos-distribution');
  const result = assessDistribution(path.resolve('synthetic.app'), { platform: 'darwin', run(_command, args) {
    return { status: 0, stdout: args[0] === '--status' ? 'assessments enabled' : 'accepted', stderr: '' };
  } });
  assert.equal(result.decision, 'accepted-by-local-spctl');
  assert.equal(result.browserDownloadAndFinderAcceptance, 'not-tested');
});
test('unavailable or interrupted distribution assessment fails instead of claiming rejection or trust', () => {
  const { assessDistribution } = require('../scripts/assess-macos-distribution');
  for (const result of [{ error: Error('missing tool') }, { status: null, signal: 'SIGTERM' }]) {
    assert.throws(() => assessDistribution(path.resolve('synthetic.app'), { platform: 'darwin', run: () => result }), /unavailable/);
  }
});
