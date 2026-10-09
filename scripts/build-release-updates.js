'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { updateReleaseConfig } = require('./update-release-config');
const { run: verifyArtifacts } = require('./verify-update-artifacts');

async function run() {
  const pkg = require('../package.json');
  // Fail before checks/build when version, track, schema or approved signing inputs are absent.
  const config = updateReleaseConfig({ pkg, platform: process.platform, arch: process.arch, env: process.env });
  const root = path.resolve(__dirname, '..');
  const command = (file, args) => {
    const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', shell: false });
    if (result.error || result.status !== 0) throw new Error(`release prerequisite failed: ${path.basename(file)}`);
  };
  // Never upload, sign in, provision credentials or create a Release as a build side effect.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run via npm run release:updates');
  for (const script of ['check', 'test:integration']) command(process.execPath, [npm, 'run', script]);
  command(process.execPath, [path.join(root, 'scripts/make-icon.js')]);
  if (process.platform === 'darwin') {
    command('/usr/bin/xcrun', ['--find', 'notarytool']);
    command(process.execPath, [path.join(root, 'scripts/build-activity-probe.js'), `--arch=${process.arch}`]);
  }
  const { build, Platform, Arch } = require('electron-builder');
  const platform = process.platform === 'darwin' ? Platform.MAC : Platform.WINDOWS;
  await build({ config, publish: 'never', targets: platform.createTarget(undefined, Arch[process.arch]) });
  verifyArtifacts();
  if (process.platform === 'darwin') {
    const app = path.join(root, 'dist/mac-arm64/小步.app');
    for (const [file, args] of [['/usr/bin/codesign', ['--verify', '--deep', '--strict', app]],
      ['/usr/bin/xcrun', ['stapler', 'validate', app]], ['/usr/sbin/spctl', ['--assess', '--type', 'execute', app]]]) command(file, args);
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
