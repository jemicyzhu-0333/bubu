'use strict';
function updateReleaseConfig({ pkg, platform, arch, env }) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Build updates on macOS or Windows');
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported release architecture');
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Set a stable semver version before releasing');
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/.exec(env.RELEASE_REPOSITORY || '');
  if (!match || ['.', '..'].includes(match[2])) throw new Error('RELEASE_REPOSITORY must name the approved public binary repository');
  if (platform === 'darwin' && !env.CSC_NAME) throw new Error('CSC_NAME must select the signing identity');
  if (platform === 'win32' && !env.WINDOWS_PUBLISHER_NAME) throw new Error('WINDOWS_PUBLISHER_NAME must match the signing certificate');
  const config = structuredClone(pkg.build);
  config.forceCodeSigning = true;
  config.artifactName = '${productName}-${version}-${os}-${arch}.${ext}';
  config.publish = [{ provider: 'github', owner: match[1], repo: match[2], private: false,
    releaseType: 'draft', channel: `latest-${arch}` }];
  config.mac = { ...config.mac, target: [{ target: 'dmg', arch: [arch] }, { target: 'zip', arch: [arch] }],
    hardenedRuntime: true, notarize: true, identity: env.CSC_NAME || undefined };
  config.win = { ...config.win, target: [{ target: 'nsis', arch: [arch] }], verifyUpdateCodeSignature: true,
    signtoolOptions: { publisherName: env.WINDOWS_PUBLISHER_NAME || undefined } };
  config.nsis = { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false };
  return config;
}
module.exports = { updateReleaseConfig };
