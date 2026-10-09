'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { load, dump } = require('js-yaml');
const { Platform, Arch } = require('app-builder-lib');
const { createUpdateInfoTasks, writeUpdateInfoFiles } = require('app-builder-lib/internal');
const { createUpdateManifestSignatures } = require('builder-util');
const { updateReleaseConfig } = require('../scripts/update-release-config');
const { verifyUpdateArtifacts } = require('../scripts/verify-update-artifacts');
const { updateReleasePolicy: { releasePolicy } } = require('../src/capabilities/app-maintenance');
const { feed, signedInfo, releaseEnv, signingFixtureKey } = require('./fixtures/update-channel');
const pkg = require('../package.json');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-update-assets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
test('installed builder produces exact dev/dev-mac manifests, merged full payloads and official signatures', async t => {
  for (const [platform, arch, host] of [['win32', 'x64', Platform.WINDOWS], ['darwin', 'arm64', Platform.MAC]]) {
    const directory = temporary(t), version = '0.0.1-dev.2';
    const policy = releasePolicy({ platform, arch, version, track: 'testing' });
    const config = updateReleaseConfig({ pkg, platform, arch, env: { ...releaseEnv, RELEASE_CHANNEL: 'testing',
      RELEASE_VERSION: version, RELEASE_PREVIOUS_VERSION: '0.0.1-dev.1' } });
    const emitted = [];
    const packager = { platform: host, platformOptions: config[host.buildConfigurationKey], config,
      appInfo: { version }, getResource: async () => null,
      requireUpdateSigningKeys: async () => [signingFixtureKey], emitArtifactCreated: async event => emitted.push(event) };
    const tasks = [];
    for (const name of policy.artifactNames) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, `synthetic full package fixture ${name}`);
      tasks.push(...await createUpdateInfoTasks({ packager, file, target: { outDir: directory }, arch: Arch[arch], updateInfo: {
        sha512: createHash('sha512').update(fs.readFileSync(file)).digest('base64'), size: fs.statSync(file).size } }, config.publish));
    }
    await writeUpdateInfoFiles(tasks, packager);
    const metadata = load(fs.readFileSync(path.join(directory, policy.metadataName), 'utf8'));
    assert.equal(metadata.files.length, platform === 'darwin' ? 2 : 1);
    assert.equal(metadata.signatures.length, 1); assert.ok(metadata.signature);
    const result = verifyUpdateArtifacts({ directory, policy, feed: feed(platform) });
    assert.equal(result.ok, true); assert.equal(result.version, version);
    assert.deepEqual(emitted.map(item => path.basename(item.file)), [policy.metadataName]);
    assert.equal(fs.existsSync(path.join(directory, 'latest.yml')), false);
    fs.appendFileSync(path.join(directory, policy.artifactNames[0]), 'tamper');
    assert.throws(() => verifyUpdateArtifacts({ directory, policy, feed: feed(platform) }), /digest|size/);
  }
});
test('artifact publication gate refuses missing signatures, wrong versions and payload redirection', t => {
  const directory = temporary(t), policy = releasePolicy({ platform: 'win32', arch: 'x64', version: '0.0.1-dev.2', track: 'testing' });
  const file = path.join(directory, policy.metadataName), info = signedInfo();
  fs.writeFileSync(path.join(directory, info.files[0].url), `synthetic full package fixture ${info.files[0].url}`);
  const missing = { ...info }; delete missing.signature;
  fs.writeFileSync(file, dump(missing)); assert.throws(() => verifyUpdateArtifacts({ directory, policy, feed: feed() }), /signature/);
  const other = signedInfo({ version: '0.0.1-dev.3' }); fs.writeFileSync(file, dump(other));
  assert.throws(() => verifyUpdateArtifacts({ directory, policy, feed: feed() }), /version/);
  const redirect = { ...info, files: [{ ...info.files[0], url: 'https://evil.invalid/full.exe' }] };
  const signatures = createUpdateManifestSignatures(redirect, [signingFixtureKey]);
  fs.writeFileSync(file, dump({ ...redirect, signature: signatures[0].signature, signatures }));
  assert.throws(() => verifyUpdateArtifacts({ directory, policy, feed: feed() }), /artifacts/);
});
