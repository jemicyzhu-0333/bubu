'use strict';
const { updateReleasePolicy: { REPOSITORY, SCHEMA_VERSION, UPDATER_VERSION, releasePolicy, validVersion } } = require('../src/capabilities/app-maintenance');
const { PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');

function increasingVersion(previous, version, track) {
  if (!validVersion(previous, track) && !(track === 'testing' && previous === '0.0.1-dev')) return false;
  const split = value => value.split(/[.-]/).filter(part => part !== 'dev').map(part => BigInt(part));
  const before = split(previous), after = split(version);
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if ((after[i] ?? 0n) !== (before[i] ?? 0n)) return (after[i] ?? 0n) > (before[i] ?? 0n);
  }
  return false;
}
function updateReleaseConfig({ pkg, platform, arch, env }) {
  if (env.RELEASE_REPOSITORY !== `${REPOSITORY.owner}/${REPOSITORY.repo}`) throw new Error('RELEASE_REPOSITORY must be jemicyzhu-0333/bubu');
  const version = env.RELEASE_VERSION || pkg.version;
  const track = env.RELEASE_CHANNEL || 'stable';
  const policy = releasePolicy({ version, track, platform, arch, schemaVersion: PERSISTED_SCHEMA_VERSION });
  if (!increasingVersion(env.RELEASE_PREVIOUS_VERSION, version, track)) throw new Error('RELEASE_PREVIOUS_VERSION must be an earlier version in this track');
  if (pkg.dependencies?.['electron-updater'] !== UPDATER_VERSION) throw new Error('Pinned compatible electron-updater required');
  if (platform === 'darwin' && (!env.CSC_NAME || !env.CSC_NAME.startsWith('Developer ID Application: '))) throw new Error('CSC_NAME must select a Developer ID Application signing identity');
  if (platform === 'win32' && !env.WINDOWS_PUBLISHER_NAME?.trim()) throw new Error('WINDOWS_PUBLISHER_NAME must match the signing certificate');
  if (!env.ELECTRON_BUILDER_UPDATE_SIGN_KEY && !env.ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE) throw new Error('Approved update-manifest signing key is required; this command does not create keys');
  if (pkg.build?.appId !== 'com.bubu.app') throw new Error('The first signed baseline must use the bubu application identity');
  if (platform === 'darwin' && !env.APPLE_KEYCHAIN_PROFILE
      && !['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every(key => env[key])
      && !['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(key => env[key])) throw new Error('Approved Apple notarization configuration is required');
  const config = structuredClone(pkg.build);
  config.forceCodeSigning = true;
  config.artifactName = 'bubu-${version}-data18-${os}-${arch}.${ext}';
  config.generateUpdatesFilesForAllChannels = false;
  config.detectUpdateChannel = false;
  config.electronUpdaterCompatibility = `>=${UPDATER_VERSION}`;
  config.updateManifest = {};
  config.extraMetadata = { ...config.extraMetadata, version,
    bubuUpdate: { track, platform, arch, schemaVersion: SCHEMA_VERSION, updaterVersion: UPDATER_VERSION } };
  config.publish = [{ provider: 'github', ...REPOSITORY, private: false, releaseType: 'draft',
    channel: policy.channel, tagNamePrefix: 'v' }];
  config.mac = { ...config.mac, target: [{ target: 'dmg', arch: [arch] }, { target: 'zip', arch: [arch] }],
    artifactName: config.artifactName,
    notarize: true, sign: { ...config.mac?.sign, hardenedRuntime: true, identity: env.CSC_NAME || undefined } };
  config.win = { ...config.win, target: [{ target: 'nsis', arch: [arch] }], verifyUpdateCodeSignature: true,
    sign: { type: 'signtool', publisherName: env.WINDOWS_PUBLISHER_NAME || undefined } };
  config.nsis = { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false };
  return config;
}
module.exports = { updateReleaseConfig, increasingVersion };
