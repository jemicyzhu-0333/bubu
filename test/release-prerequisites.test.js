'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { releasePrerequisites, signedBuildArgs } = require('../scripts/release-macos');

test('signed macOS builder command retains explicit signing, hardening and notarization without publishing', () => {
  assert.deepEqual(signedBuildArgs({ CSC_NAME: 'Developer ID Application: Example' }), [
    '--mac', '--arm64', '--publish', 'never', '--config.forceCodeSigning=true',
    '--config.mac.artifactName=${productName}-${version}-${os}-${arch}.${ext}',
    '--config.mac.sign.identity=Developer ID Application: Example', '--config.mac.sign.hardenedRuntime=true',
    '--config.mac.notarize=true'
  ]);
});

test('release preflight rejects unsigned defaults and never serializes credentials', () => {
  const missing = releasePrerequisites({ platform: 'darwin', env: {}, identities: '0 valid identities found', notarytoolAvailable: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.failures.length, 2);
  const result = releasePrerequisites({ platform: 'darwin', env: { CSC_NAME: 'Example', APPLE_ID: 'private', APPLE_APP_SPECIFIC_PASSWORD: 'secret' }, identities: '', notarytoolAvailable: true });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
});

test('release requires installed Developer ID, notarization authentication and native tooling together', () => {
  const input = { platform: 'darwin', env: { CSC_NAME: 'Example', APPLE_KEYCHAIN_PROFILE: 'notary' }, identities: '1) ABC "Developer ID Application: Example (TEAM)"', notarytoolAvailable: true };
  assert.equal(releasePrerequisites(input).ok, true);
  assert.equal(releasePrerequisites({ ...input, notarytoolAvailable: false }).ok, false);
  assert.equal(releasePrerequisites({ ...input, platform: 'linux' }).ok, false);
});
