'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load } = require('js-yaml');
const { verifyManifestSignatures, normalizePublicKeyList } = require('builder-util-runtime');
const { updateReleasePolicy: { releasePolicy, validateEmbeddedPolicy, validateFeed, validateOffer } } = require('../src/capabilities/app-maintenance');

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Update artifacts must be regular files');
  return stat;
}
function readYaml(file) {
  if (regularFile(file).size > 128 * 1024) throw new Error('Update metadata is too large');
  return load(fs.readFileSync(file, 'utf8'));
}
function verifyUpdateArtifacts({ directory, policy, feed }) {
  validateFeed(feed, policy);
  const file = path.join(directory, policy.metadataName);
  const metadata = readYaml(file);
  validateOffer({ ...metadata, tag: `v${metadata.version}` }, policy);
  if (metadata.version !== policy.version) throw new Error('Update metadata version does not match release');
  const signed = verifyManifestSignatures(metadata, normalizePublicKeyList(feed.updateManifestPublicKey));
  if (!signed.ok) throw new Error('Update manifest signature is missing or invalid');
  const artifacts = metadata.files.map(entry => {
    const absolute = path.join(directory, entry.url);
    const stat = regularFile(absolute);
    const bytes = fs.readFileSync(absolute);
    const digest = createHash('sha512').update(bytes).digest('base64');
    if (digest !== entry.sha512 || entry.size != null && entry.size !== stat.size) throw new Error('Update artifact digest or size mismatch');
    return { file: entry.url, bytes: stat.size, sha512: digest };
  });
  return { ok: true, version: policy.version, track: policy.track, platform: policy.platform, arch: policy.arch,
    schemaVersion: policy.schemaVersion, metadata: policy.metadataName, keyId: signed.keyId, artifacts };
}
function run({ directory = path.resolve(__dirname, '../dist'), env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const policy = releasePolicy({ version: env.RELEASE_VERSION, track: env.RELEASE_CHANNEL, platform, arch });
  const resources = platform === 'darwin' ? path.join(directory, 'mac-arm64/小步.app/Contents/Resources')
    : path.join(directory, 'win-unpacked/resources');
  const feed = readYaml(path.join(resources, 'app-update.yml'));
  const report = verifyUpdateArtifacts({ directory, policy, feed });
  const { extractFile } = require('@electron/asar');
  const pkg = JSON.parse(extractFile(path.join(resources, 'app.asar'), 'package.json').toString('utf8'));
  validateEmbeddedPolicy(pkg.bubuUpdate, { version: pkg.version, platform, arch });
  if (pkg.version !== policy.version || pkg.bubuUpdate?.track !== policy.track || pkg.bubuUpdate?.schemaVersion !== policy.schemaVersion
      || pkg.bubuUpdate?.platform !== platform || pkg.bubuUpdate?.arch !== arch) throw new Error('Packaged update identity mismatch');
  fs.writeFileSync(path.join(directory, `update-verification-${platform}-${arch}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (require.main === module) {
  try { console.log(JSON.stringify(run(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { readYaml, verifyUpdateArtifacts, run };
