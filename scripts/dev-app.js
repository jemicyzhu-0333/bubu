'use strict';

// Development launch preparation only. Never installs a toolchain or changes a
// production bundle; unavailable music detection retains foreground-only probing.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn: spawnProcess } = require('node:child_process');
const { constants: osConstants } = require('node:os');
const { run: buildProbe } = require('./build-activity-probe');
const DISABLE_AUDIO = 'BUBU_DEV_DISABLE_ACTIVITY_AUDIO';

function supportsAudioProbe(version) {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(String(version).trim());
  return Boolean(match && (Number(match[1]) > 14 || (Number(match[1]) === 14 && Number(match[2]) >= 2)));
}

function reusableProbe({ root, arch, stat = fs.statSync, read = fs.readFileSync, access = fs.accessSync }) {
  const file = path.join(root, 'build/native/darwin/activity-probe');
  const cpu = { arm64: 0x0100000c, x64: 0x01000007 }[arch];
  if (!cpu) return false;
  try {
    const metadata = stat(file);
    if (!metadata.isFile()) return false;
    access(file, fs.constants.X_OK);
    const header = read(file);
    // The repository compiler emits a thin 64-bit Mach-O for one selected arch.
    if (header.length < 8 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu) return false;
    return ['native/macos/ActivityProbe.swift', 'scripts/build-activity-probe.js', 'scripts/dev-app.js']
      .every(source => metadata.mtimeMs >= stat(path.join(root, source)).mtimeMs);
  } catch { return false; }
}

function prepareProbe({ platform = process.platform, arch = process.arch, root = path.resolve(__dirname, '..'),
  spawn = spawnSync, reuse = reusableProbe, build = buildProbe, access = fs.accessSync, warn = console.warn } = {}) {
  if (platform !== 'darwin') return true;
  try {
    const version = spawn('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5_000 });
    if (version.status !== 0 || !supportsAudioProbe(version.stdout)) throw new Error('macOS 14.2 or later is required');
    if (reuse({ root, arch })) return true;
    // Check an existing developer directory before invoking xcrun, so this path
    // never triggers the developer-tools installation flow.
    const developer = spawn('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', timeout: 5_000 });
    if (developer.status !== 0 || !String(developer.stdout || '').trim()) throw new Error('an existing Xcode command-line toolchain is unavailable');
    access(String(developer.stdout).trim(), fs.constants.R_OK);
    const compiler = spawn('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8', timeout: 5_000 });
    if (compiler.status !== 0 || !String(compiler.stdout || '').trim()) throw new Error('an existing Swift compiler is unavailable');
    access(String(compiler.stdout).trim(), fs.constants.X_OK);
    build({ platform, arch, argv: [], root });
    if (!reuse({ root, arch })) throw new Error('the compiled audio helper could not be verified');
    return true;
  } catch (error) {
    warn(`bubu dev: music detection unavailable (${error.message}). Foreground app detection remains available; no extra permissions or tools were installed.`);
    return false;
  }
}

async function run({ platform = process.platform, arch = process.arch, root = path.resolve(__dirname, '..'),
  argv = process.argv.slice(2), env = process.env, prepare = prepareProbe, spawn = spawnProcess, signals = process,
  electron = () => require('electron'), warn = console.warn } = {}) {
  const audio = prepare({ platform, arch, root, warn });
  const childEnv = { ...env };
  delete childEnv[DISABLE_AUDIO];
  if (!audio) childEnv[DISABLE_AUDIO] = '1';
  return new Promise(resolve => {
    let child;
    const forwards = new Map();
    let settled = false;
    function finish(code) {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of forwards) signals.removeListener(signal, handler);
      resolve(code);
    }
    try { child = spawn(electron(), ['.', '--dev', ...argv], { cwd: root, env: childEnv, stdio: 'inherit', shell: false }); }
    catch (error) { warn(`bubu dev: ${error.message}`); finish(1); return; }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => { try { child.kill(signal); } catch {} };
      forwards.set(signal, handler);
      signals.on(signal, handler);
    }
    child.once('error', error => { warn(`bubu dev: ${error.message}`); finish(1); });
    child.once('close', (code, signal) => finish(signal ? 128 + (osConstants.signals[signal] || 0) : code ?? 1));
  });
}

if (require.main === module) run().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`bubu dev: ${error.message}`); process.exitCode = 1;
});
module.exports = { DISABLE_AUDIO, supportsAudioProbe, reusableProbe, prepareProbe, run };
