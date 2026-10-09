'use strict';

// Compiles the macOS helper shipped by ARCHITECTURE「活动镜像」.
// Windows ships PowerShell sources and Linux has no native activity helper.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function probeArchitecture(arch, argv) {
  const target = argv.length === 0 ? arch : argv[0]?.replace(/^--arch=/, '');
  if (argv.length > 1 || (argv.length === 1 && !/^--arch=(x64|arm64)$/.test(argv[0])) || !['x64', 'arm64'].includes(target)) {
    throw new Error('activity probe: use --arch=x64 or --arch=arm64');
  }
  return target;
}

function run({ platform = process.platform, arch = process.arch, argv = process.argv.slice(2),
  root = path.resolve(__dirname, '..'), mkdir = fs.mkdirSync, exec = execFileSync, log = console.log } = {}) {
  if (platform !== 'darwin') {
    log('activity probe: nothing to build on this platform');
    return;
  }
  const target = probeArchitecture(arch, argv);
  const source = path.join(root, 'native', 'macos', 'ActivityProbe.swift');
  const output = path.join(root, 'build', 'native', 'darwin', 'activity-probe');
  mkdir(path.dirname(output), { recursive: true });
  exec('xcrun', ['swiftc', '-O', '-target', `${target === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.2`,
    '-framework', 'AppKit', '-framework', 'CoreAudio', source, '-o', output], { stdio: 'inherit' });
  log(`activity probe: ${path.relative(root, output)}`);
}

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { probeArchitecture, run };
