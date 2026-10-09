'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { updateReleaseConfig } = require('./update-release-config');
async function run() {
  const pkg = require('../package.json');
  const config = updateReleaseConfig({ pkg, platform: process.platform, arch: process.arch, env: process.env });
  const root = path.resolve(__dirname, '..');
  // Never upload or create a Release as a side effect of building.
  for (const args of [['run', 'check'], ['run', 'make-icon'], ['run', 'native:build']]) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`release prerequisite failed: ${args[1]}`);
  }
  const { build, Platform, Arch } = require('electron-builder');
  const platform = process.platform === 'darwin' ? Platform.MAC : Platform.WINDOWS;
  await build({ config, publish: 'never', targets: platform.createTarget(undefined, Arch[process.arch]) });
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
