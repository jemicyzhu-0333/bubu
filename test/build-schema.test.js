'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const { updateReleaseConfig } = require('../scripts/update-release-config');

test('installed builder validates development and signed-release configuration against its actual schema', async () => {
  // This is configuration validation only: no signing, credentials, packaging,
  // downloads or publishing. It must use npm ci's real pinned builder package.
  const { validateConfiguration } = require('app-builder-lib/internal');
  const logger = { isEnabled: false };
  assert.deepEqual(pkg.build.mac.sign, { hardenedRuntime: false, identity: '-' });
  assert.equal(pkg.build.mac.artifactName, 'bubu-${version}-mac-${arch}-adhoc-test.${ext}');
  await validateConfiguration(pkg.build, logger);
  const env = { RELEASE_REPOSITORY: 'example/releases', CSC_NAME: 'Developer ID Application: Example',
    WINDOWS_PUBLISHER_NAME: 'Example' };
  for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) {
    const config = updateReleaseConfig({ pkg: { ...pkg, version: '1.0.0' }, platform, arch, env });
    await validateConfiguration(config, logger);
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.mac.sign.hardenedRuntime, true);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
  }
  for (const key of ['identity', 'hardenedRuntime', 'gatekeeperAssess']) {
    const invalid = structuredClone(pkg.build); invalid.mac[key] = key === 'identity' ? null : false;
    await assert.rejects(validateConfiguration(invalid, logger), undefined, `legacy mac.${key} must fail`);
  }
  const invalid = structuredClone(pkg.build); invalid.win.signtoolOptions = { publisherName: 'Example' };
  await assert.rejects(validateConfiguration(invalid, logger));
});
