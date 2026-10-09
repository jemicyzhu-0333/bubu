'use strict';
const { createPrivateKey, createPublicKey, createHash, sign } = require('node:crypto');
const { canonicalizeForSigning } = require('builder-util-runtime');
const { updateReleasePolicy: { releasePolicy, UPDATER_VERSION } } = require('../../src/capabilities/app-maintenance');

// Public RFC 8032 section 7.1 TEST 1 seed. Deliberately public fixture material,
// never a release key, account credential, generated key, or persisted secret.
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const privateKey = createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex'), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
function identity(platform = 'win32', arch = 'x64', track = 'testing') {
  return { track, platform, arch, schemaVersion: 18, updaterVersion: UPDATER_VERSION };
}
function feed(platform = 'win32', track = 'testing') {
  return { provider: 'github', owner: 'jemicyzhu-0333', repo: 'bubu', private: false,
    channel: track === 'testing' ? 'dev' : 'latest', updaterCacheDirName: 'bubu-updater',
    ...(platform === 'win32' ? { publisherName: ['Fixture Publisher'] } : {}), updateManifestPublicKey: publicKey };
}
function signedInfo({ version = '0.0.1-dev.2', platform = 'win32', arch = 'x64', track = 'testing' } = {}) {
  const policy = releasePolicy({ version, platform, arch, track });
  const files = policy.artifactNames.map(url => {
    const content = Buffer.from(`synthetic full package fixture ${url}`);
    return { url, sha512: createHash('sha512').update(content).digest('base64'), size: content.length };
  });
  const info = { version, files };
  info.signature = sign(null, Buffer.from(canonicalizeForSigning(info)), privateKey).toString('base64');
  return info;
}
const releaseEnv = Object.freeze({ RELEASE_REPOSITORY: 'jemicyzhu-0333/bubu', RELEASE_CHANNEL: 'stable',
  RELEASE_PREVIOUS_VERSION: '0.9.0', CSC_NAME: 'Developer ID Application: Fixture', WINDOWS_PUBLISHER_NAME: 'Fixture Publisher',
  ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE: '/fixture/not-a-real-key.pem', APPLE_KEYCHAIN_PROFILE: 'fixture-not-a-real-profile' });
module.exports = { signingFixtureKey: privateKey, publicKey, identity, feed, signedInfo, releaseEnv };
