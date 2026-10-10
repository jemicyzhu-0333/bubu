'use strict';

// Structural and code-integrity verifier for a macOS arm64 test bundle.
// Inspecting these bytes does not prove installation, real input or VoiceOver.
// This script verifies target architecture,
// package identity, ASAR scope and absence of restricted upstream markers in shipped code.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { buildPlan } = require('./build-app');
const { verifyCodeSignature } = require('./macos-code-signature');

const ROOT = path.resolve(__dirname, '..');
const ARM64_CPU_TYPE = 0x0100000c;
const RESTRICTED_MARKERS = Object.freeze([
  'aora-bot',
  'emotion-ball',
  'emotion ball',
  'sam70361',
  'dreamcall520',
  'xiaotu22',
  'cpt-kenvie'
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function detectMachArchitectures(header) {
  if (!Buffer.isBuffer(header) || header.length < 8) return [];
  const thinMagic = 0xfeedfacf;
  if (header.readUInt32LE(0) === thinMagic) return [header.readUInt32LE(4)];
  if (header.readUInt32BE(0) === thinMagic) return [header.readUInt32BE(4)];

  const magic = header.readUInt32BE(0);
  const fat32 = magic === 0xcafebabe;
  const fat64 = magic === 0xcafebabf;
  if (!fat32 && !fat64) return [];
  const count = header.readUInt32BE(4);
  const stride = fat64 ? 32 : 20;
  if (count === 0 || count > 64 || header.length < 8 + count * stride) return [];
  const architectures = [];
  for (let index = 0; index < count; index++) {
    architectures.push(header.readUInt32BE(8 + index * stride));
  }
  return architectures;
}

function walk(root) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(absolute);
    }
  }
  visit(root);
  return files.sort();
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readGitHead() {
  try {
    const gitDir = path.join(ROOT, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    const looseRef = path.join(gitDir, ref);
    if (fs.existsSync(looseRef)) return fs.readFileSync(looseRef, 'utf8').trim();
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const match = packed.split('\n').find(line => line.endsWith(` ${ref}`));
    return match ? match.split(' ')[0] : 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function gitIdentity() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    return { commit, clean: status.length === 0 };
  } catch (_) {
    // Some managed sandboxes permit reading .git but deny child_process. Preserve a
    // useful commit identity and report cleanliness as unknown instead of false.
    return { commit: readGitHead(), clean: null };
  }
}

function validateBuildConfig(pkg) {
  invariant(pkg.version === '0.0.2-dev.2', `expected development version 0.0.2-dev.2, got ${pkg.version}`);
  invariant(pkg.build?.mac?.sign?.identity === '-', 'development macOS bundle must request ad-hoc signing');
  invariant(pkg.main === 'src/main.js', `unexpected main entry: ${pkg.main}`);
  const targets = pkg.build && pkg.build.mac && pkg.build.mac.target;
  invariant(Array.isArray(targets), 'build.mac.target must be an array');
  const dmg = targets.find(target => target === 'dmg' || (target && target.target === 'dmg'));
  // A string target inherits the CLI architecture; an explicit target must admit arm64.
  invariant(dmg && (typeof dmg === 'string' || dmg.arch === undefined
    || (Array.isArray(dmg.arch) && dmg.arch.includes('arm64'))),
  'build.mac.target must include an arm64 DMG');
  const scripts = pkg.scripts || {};
  invariant(scripts.pack === 'node scripts/build-app.js --dir',
    'npm run pack must use the host-local build entrypoint');
  invariant(scripts['pack:mac'] === 'node scripts/build-app.js --platform=mac --dir',
    'npm run pack:mac must use the macOS build entrypoint');
  invariant(scripts['validate:mac'] === 'npm run check && npm run pack:mac -- --arm64 && npm run verify:mac-app',
    'npm run validate:mac must explicitly pack and verify macOS arm64');
  const plan = buildPlan({ platform: 'darwin', arch: 'x64', argv: ['--platform=mac', '--dir', '--arm64'] });
  invariant(JSON.stringify(plan.builderArgs) === JSON.stringify(['--mac', '--arm64', '--dir', '--publish', 'never']),
    'macOS verification must build arm64 without publishing');
  invariant(plan.prepare.some(step => step[0] === 'scripts/build-activity-probe.js' && step[1] === '--arch=arm64'),
    'macOS activity probe must match the arm64 bundle');
}

function findAppBundle(explicitPath) {
  if (explicitPath) return path.resolve(ROOT, explicitPath);
  const candidates = [
    path.join(ROOT, 'dist', 'mac-arm64', '小步.app'),
    path.join(ROOT, 'dist', 'mac', '小步.app')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function verifyBundleIdentity(appPath, pkg, readKey = (plist, key) => (
  execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4096
  }).trim()
)) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const expected = {
    CFBundleDisplayName: pkg.build.productName,
    CFBundleName: pkg.build.productName,
    CFBundleExecutable: pkg.build.mac.executableName || pkg.build.productName,
    CFBundleIdentifier: pkg.build.appId
  };
  for (const [key, value] of Object.entries(expected)) {
    invariant(readKey(plist, key) === value, `bundle ${key} must match ${value}`);
  }
  return expected;
}

function verifyAsar(archivePath, expectedPackage) {
  const entries = asar.listPackage(archivePath).map(entry => entry.replaceAll('\\', '/'));
  for (const required of ['/package.json', '/src/main.js']) {
    invariant(entries.includes(required), `app.asar is missing ${required}`);
  }
  for (const excluded of ['/test/', '/docs/', '/scripts/', '/diagrams/']) {
    invariant(!entries.some(entry => entry.startsWith(excluded)),
      `app.asar unexpectedly ships ${excluded}`);
  }

  const bundledPackage = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
  invariant(bundledPackage.name === expectedPackage.name, 'bundled package name does not match source');
  invariant(bundledPackage.version === expectedPackage.version, 'bundled package version does not match source');
  invariant(bundledPackage.main === expectedPackage.main, 'bundled main entry does not match source');

  const ownedTextEntries = entries.filter(entry =>
    /^\/(?:src|assets)\//.test(entry) && /\.(?:m?js|json|html|css|svg|txt)$/i.test(entry));
  const restrictedHits = [];
  for (const entry of ownedTextEntries) {
    const text = asar.extractFile(archivePath, entry.slice(1)).toString('utf8').toLowerCase();
    for (const marker of RESTRICTED_MARKERS) {
      if (text.includes(marker)) restrictedHits.push(`${entry}: ${marker}`);
    }
  }
  invariant(restrictedHits.length === 0,
    `restricted upstream markers found in shipped files: ${restrictedHits.join(', ')}`);
  return { entries: entries.length, ownedTextEntries: ownedTextEntries.length };
}

function verifyAppBundle(appPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  validateBuildConfig(pkg);
  invariant(fs.statSync(appPath).isDirectory(), `macOS app bundle not found: ${appPath}`);

  const executable = path.join(appPath, 'Contents', 'MacOS', '小步');
  const archive = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  invariant(fs.existsSync(executable), `bundle executable not found: ${executable}`);
  invariant(fs.existsSync(archive), `bundle archive not found: ${archive}`);
  const bundleIdentity = verifyBundleIdentity(appPath, pkg);

  const machFiles = [];
  for (const file of walk(appPath)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size < 8) continue;
    const descriptor = fs.openSync(file, 'r');
    const header = Buffer.alloc(Math.min(4096, stat.size));
    try {
      fs.readSync(descriptor, header, 0, header.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    const architectures = detectMachArchitectures(header);
    if (architectures.length === 0) continue;
    invariant(architectures.every(cpuType => cpuType === ARM64_CPU_TYPE),
      `${path.relative(appPath, file)} contains a non-arm64 Mach-O slice: ${architectures.join(', ')}`);
    machFiles.push(path.relative(appPath, file));
  }
  invariant(machFiles.length > 0, 'bundle contains no recognizable Mach-O binaries');

  const archiveResult = verifyAsar(archive, pkg);
  const codeSignature = verifyCodeSignature(appPath);
  return {
    ...gitIdentity(),
    artifact: path.relative(ROOT, appPath),
    version: pkg.version,
    bundleIdentity,
    codeSignature,
    machOBinaries: machFiles.length,
    asarEntries: archiveResult.entries,
    inspectedOwnedTextEntries: archiveResult.ownedTextEntries,
    executableSha256: sha256File(executable),
    asarSha256: sha256File(archive)
  };
}

if (require.main === module) {
  try {
    const result = verifyAppBundle(findAppBundle(process.argv[2]));
    process.stdout.write(`macOS arm64 app verification passed\n${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`macOS app verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ARM64_CPU_TYPE,
  RESTRICTED_MARKERS,
  detectMachArchitectures,
  validateBuildConfig,
  verifyBundleIdentity,
  verifyAsar,
  verifyAppBundle
};
