'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function releasePrerequisites({ platform, env, identities, notarytoolAvailable }) {
  const failures = [];
  if (platform !== 'darwin') failures.push('macOS is required for signed release verification');
  if (!env.CSC_NAME || !String(identities).split('\n').some(line => line.includes('Developer ID Application:') && line.includes(env.CSC_NAME))) {
    failures.push('CSC_NAME must select an installed Developer ID Application identity');
  }
  const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every(key => Boolean(env[key]));
  const apiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(key => Boolean(env[key]));
  if (!env.APPLE_KEYCHAIN_PROFILE && !appleId && !apiKey) failures.push('notarization credentials or APPLE_KEYCHAIN_PROFILE are required');
  if (!notarytoolAvailable) failures.push('Xcode notarytool is required');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

function signedBuildArgs(env) {
  return ['--mac', '--arm64', '--publish', 'never', '--config.forceCodeSigning=true',
    `--config.mac.sign.identity=${env.CSC_NAME}`, '--config.mac.sign.hardenedRuntime=true', '--config.mac.notarize=true'];
}

function run() {
  const root = path.resolve(__dirname, '..');
  const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  const notary = spawnSync('xcrun', ['--find', 'notarytool'], { encoding: 'utf8' });
  const result = releasePrerequisites({
    platform: process.platform, env: process.env,
    identities: identities.status === 0 ? identities.stdout : '', notarytoolAvailable: notary.status === 0
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) return 1;
  if (!process.argv.includes('--build')) return 0;
  const build = spawnSync(path.join(root, 'node_modules/.bin/electron-builder'), signedBuildArgs(process.env),
    { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) return build.status || 1;
  const app = path.join(root, 'dist/mac-arm64/I’m ADHDer.app');
  for (const [command, args] of [
    ['codesign', ['--verify', '--deep', '--strict', app]],
    ['xcrun', ['stapler', 'validate', app]],
    ['spctl', ['--assess', '--type', 'execute', '--verbose=2', app]]
  ]) {
    if (spawnSync(command, args, { stdio: 'inherit' }).status !== 0) return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = run();
module.exports = { releasePrerequisites, signedBuildArgs };
