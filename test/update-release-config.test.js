'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateReleaseConfig, increasingVersion } = require('../scripts/update-release-config');
const base = require('../package.json');
const { releaseEnv } = require('./fixtures/update-channel');
const pkg = { ...base, version: '1.0.0' };
const input = { pkg, platform: 'darwin', arch: 'arm64', env: releaseEnv };
test('signed builds pin official repository, complete packages, manual publication and platform trust', () => {
  const mac = updateReleaseConfig(input);
  assert.deepEqual(mac.mac.target.map(item => item.target), ['dmg', 'zip']);
  assert.equal(mac.mac.sign.hardenedRuntime, true); assert.equal(mac.mac.notarize, true);
  assert.equal(mac.mac.sign.identity, releaseEnv.CSC_NAME);
  assert.equal(mac.mac.artifactName, mac.artifactName); assert.doesNotMatch(mac.mac.artifactName, /adhoc/);
  assert.equal(mac.forceCodeSigning, true); assert.equal(mac.publish[0].private, false);
  assert.equal(mac.publish[0].releaseType, 'draft'); assert.equal(mac.appId, base.build.appId);
  assert.equal(mac.publish[0].channel, 'latest'); assert.equal(mac.generateUpdatesFilesForAllChannels, false);
  assert.deepEqual(mac.updateManifest, {});
  const win = updateReleaseConfig({ ...input, platform: 'win32', arch: 'x64' });
  assert.equal(win.win.target[0].target, 'nsis'); assert.equal(win.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(win.win.sign, { type: 'signtool', publisherName: releaseEnv.WINDOWS_PUBLISHER_NAME });
  assert.equal(win.nsis.deleteAppDataOnUninstall, false);
  assert.equal(JSON.stringify(win).includes('not-a-real-key'), false, 'signing private input is never embedded');
});
test('testing packages get an actual increasing version and explicit dev metadata without changing source version', () => {
  const env = { ...releaseEnv, RELEASE_CHANNEL: 'testing', RELEASE_VERSION: '0.0.1-dev.2', RELEASE_PREVIOUS_VERSION: '0.0.1-dev.1' };
  const before = JSON.stringify(base);
  const result = updateReleaseConfig({ ...input, pkg: base, env });
  assert.equal(result.extraMetadata.version, '0.0.1-dev.2'); assert.equal(result.publish[0].channel, 'dev');
  assert.equal(result.extraMetadata.bubuUpdate.track, 'testing'); assert.equal(result.extraMetadata.bubuUpdate.schemaVersion, 18);
  assert.equal(JSON.stringify(base), before); assert.equal(base.version, '0.0.1-dev');
  assert.equal(increasingVersion('0.0.1-dev', '0.0.1-dev.1', 'testing'), true);
  for (const version of ['0.0.1-dev', '0.0.1-dev.1', '0.0.1-dev.0', '0.0.1-dev.01', '0.0.1-dev.2+changed', '0.0.1-beta.2', '0.0.1']) {
    assert.throws(() => updateReleaseConfig({ ...input, pkg: base, env: { ...env, RELEASE_VERSION: version } }));
  }
});
test('release build gates reject alternate repositories, unsigned prerequisites and unsupported targets', () => {
  for (const patch of [{ platform: 'linux' }, { platform: 'win32', arch: 'arm64' }, { arch: 'x64' },
    { pkg: { ...pkg, version: '1.0.0-dev' } }, { pkg: { ...pkg, build: { ...pkg.build, appId: 'foreign' } } },
    { env: { ...releaseEnv, RELEASE_REPOSITORY: 'example/releases' } },
    { env: { ...releaseEnv, ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE: '' } },
    { env: { ...releaseEnv, CSC_NAME: '-' } }, { env: { ...releaseEnv, APPLE_KEYCHAIN_PROFILE: '' } },
    { env: { ...releaseEnv, RELEASE_PREVIOUS_VERSION: '1.0.0' } }]) assert.throws(() => updateReleaseConfig({ ...input, ...patch }));
});
