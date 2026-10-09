'use strict';

// ARCHITECTURE「桌面更新」: installed track and profile schema are build identities,
// never a renderer preference, remote URL, or a migration permission.
const REPOSITORY = Object.freeze({ owner: 'jemicyzhu-0333', repo: 'bubu' });
const SCHEMA_VERSION = 18;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const UPDATER_VERSION = '7.0.0-alpha.9';
const NUMBER = '(0|[1-9][0-9]*)';
const STABLE_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`);
const TESTING_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}-dev\\.([1-9][0-9]*)$`);
const TARGETS = Object.freeze({ win32: Object.freeze({ arch: 'x64', os: 'win', extensions: ['exe'] }),
  darwin: Object.freeze({ arch: 'arm64', os: 'mac', extensions: ['zip', 'dmg'] }) });
function validVersion(version, track) {
  return typeof version === 'string' && version.length <= 80
    && (track === 'testing' ? TESTING_VERSION : track === 'stable' ? STABLE_VERSION : /$a/).test(version);
}
function releasePolicy({ version, track, platform, arch, schemaVersion = SCHEMA_VERSION }) {
  const target = TARGETS[platform];
  if (!target || target.arch !== arch) throw new Error('unsupported-update-target');
  if (!validVersion(version, track)) throw new Error('update-version-invalid');
  if (schemaVersion !== SCHEMA_VERSION) throw new Error('update-schema-migration-required');
  const channel = track === 'testing' ? 'dev' : 'latest';
  return Object.freeze({ version, track, platform, arch, schemaVersion, channel,
    metadataName: `${channel}${platform === 'darwin' ? '-mac' : ''}.yml`,
    artifactNames: Object.freeze(target.extensions.map(ext => `bubu-${version}-data${schemaVersion}-${target.os}-${arch}.${ext}`)) });
}
function validateEmbeddedPolicy(policy, context) {
  if (!policy || Object.keys(policy).sort().join(',') !== 'arch,platform,schemaVersion,track,updaterVersion'
      || policy.updaterVersion !== UPDATER_VERSION || policy.platform !== context.platform || policy.arch !== context.arch) {
    throw new Error('signed-release-required');
  }
  return releasePolicy({ ...context, track: policy.track, schemaVersion: policy.schemaVersion });
}
function validateFeed(config, policy) {
  const allowed = ['provider', 'owner', 'repo', 'private', 'channel', 'updaterCacheDirName', 'publisherName',
    'updateManifestPublicKey', 'releaseType', 'tagNamePrefix'];
  if (!config || Object.keys(config).some(key => !allowed.includes(key)) || config.provider !== 'github'
      || config.owner !== REPOSITORY.owner || config.repo !== REPOSITORY.repo || config.private !== false
      || config.channel !== policy.channel || config.tagNamePrefix != null && config.tagNamePrefix !== 'v') throw new Error('update-feed-untrusted');
  const keys = Array.isArray(config.updateManifestPublicKey) ? config.updateManifestPublicKey : [config.updateManifestPublicKey];
  if (!keys.length || keys.length > 4 || keys.some(key => typeof key !== 'string' || !key.trim() || key.length > 4096)) {
    throw new Error('update-signature-unconfigured');
  }
  const publishers = Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName];
  if (policy.platform === 'win32' && (!publishers.length || publishers.some(name => typeof name !== 'string' || !name.trim()))) {
    throw new Error('update-publisher-unconfigured');
  }
  return true;
}
function validateOffer(info, policy) {
  if (!info || !validVersion(info.version, policy.track) || info.tag !== `v${info.version}`
      || info.packages != null || info.stagingPercentage != null) throw new Error('update-offer-incompatible');
  const offer = releasePolicy({ ...policy, version: info.version });
  if (!Array.isArray(info.files) || info.files.length !== offer.artifactNames.length) throw new Error('update-artifacts-invalid');
  const names = new Set();
  for (const file of info.files) {
    if (!file || !offer.artifactNames.includes(file.url) || names.has(file.url)
        || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '') || file.blockMapUrl != null
        || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PACKAGE_BYTES) throw new Error('update-artifacts-invalid');
    names.add(file.url);
  }
  return true;
}
module.exports = { MAX_PACKAGE_BYTES, REPOSITORY, SCHEMA_VERSION, UPDATER_VERSION, releasePolicy, validVersion, validateEmbeddedPolicy, validateFeed, validateOffer };
