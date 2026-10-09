'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLATFORMS = { win32: 'win', darwin: 'mac', linux: 'linux' };

// Packaging tooling owns generated artifacts only; it never opens an application profile.
function buildPlan({ platform, arch, argv = [] }) {
  let target = PLATFORMS[platform];
  let targetArch = arch;
  let directory = false;
  let selectedPlatform = false;
  let selectedArch = false;
  for (const arg of argv) {
    if (/^--platform=(win|mac|linux)$/.test(arg) && !selectedPlatform) {
      target = arg.slice('--platform='.length);
      selectedPlatform = true;
    } else if (['--x64', '--arm64'].includes(arg) && !selectedArch) {
      targetArch = arg.slice(2);
      selectedArch = true;
    } else if (arg === '--dir' && !directory) directory = true;
    else throw new Error(`Unsupported or repeated build option: ${arg}`);
  }
  if (!PLATFORMS[platform]) throw new Error(`Unsupported build host: ${platform}`);
  if (!['x64', 'arm64'].includes(targetArch)) throw new Error(`Unsupported architecture: ${targetArch}; use --x64 or --arm64`);
  if (target === 'mac' && platform !== 'darwin') {
    throw new Error('macOS builds require a macOS host (including the Swift activity probe). Run build:mac on a Mac.');
  }
  return {
    target,
    arch: targetArch,
    prepare: [
      ['scripts/make-icon.js'],
      ...(target === 'mac' ? [['scripts/build-activity-probe.js', `--arch=${targetArch}`]] : [])
    ],
    builderArgs: [`--${target}`, `--${targetArch}`, ...(directory ? ['--dir'] : []), '--publish', 'never']
  };
}

function run({ platform = process.platform, arch = process.arch, argv = process.argv.slice(2),
  root = path.resolve(__dirname, '..'), execPath = process.execPath, spawn = spawnSync,
  resolveBuilder = () => path.resolve(path.dirname(require.resolve('electron-builder')), '..', 'cli.js'), report = message => console.error(message) } = {}) {
  try {
    const plan = buildPlan({ platform, arch, argv });
    let builder;
    try { builder = resolveBuilder(); }
    catch { throw new Error('electron-builder is missing. Install the project devDependencies before packaging.'); }
    // Invoke the JS CLI through Node, not a .bin/.cmd shell shim (Windows and paths with spaces).
    const steps = [...plan.prepare.map(([script, ...args]) => [path.join(root, script), ...args]),
      [builder, ...plan.builderArgs]];
    for (const args of steps) {
      const result = spawn(execPath, args, { cwd: root, stdio: 'inherit', shell: false });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        report(`Build step failed: ${path.basename(args[0])}${result.signal ? ` (${result.signal})` : ''}`);
        return result.status || 1;
      }
    }
    return 0;
  } catch (error) {
    report(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = run();
module.exports = { buildPlan, run };
