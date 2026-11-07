import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sanitizeDiagnosticText } from './supervisor.mjs';
import { encodeCapturePackage, decodeCapturePackage } from './package.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SOURCE_FILES = Object.freeze([
  ...['run.mjs', 'diagnostics.mjs', 'collect.mjs', 'electron-main.cjs', 'window-port.cjs', 'options.mjs', 'supervisor.mjs', 'report.mjs', 'package.mjs', 'evidence.mjs', 'materialize-d2.mjs', 'fixture-policy.cjs', 'handoff.cjs'].map(name => `tools/pet-realtime-capture/${name}`),
  'tools/dev-bench/orchestration.js', 'tools/dev-bench/profile-fixture.js', 'tools/dev-bench/scenarios.js',
  'src/platform/electron/dev/fixture-isolation.js',
  'research/animation-0.1.0/runtime-facepath05/tools/approved-d2-source.json',
  'package.json', 'package-lock.json', 'research/animation-0.1.0/package-lock.json',
  'src/surfaces/pet/realtime/entry.mjs', 'src/surfaces/pet/realtime/surface.mjs',
  'src/surfaces/pet/realtime/three-stage.mjs', 'src/surfaces/pet/realtime/frame-metrics.mjs',
  'src/surfaces/pet/realtime/startup-metrics.mjs', 'src/surfaces/pet/realtime/error-journal.mjs', 'src/surfaces/pet/realtime/runtime/actor-backend.mjs',
  'research/animation-0.1.0/animation-foundation-v1/integration/foundation-runtime.mjs',
  'research/animation-0.1.0/animation-foundation-v1/body-runtime/pointer-host.mjs',
  'research/animation-0.1.0/animation-foundation-v1/body-runtime/pointer-coordinates.mjs',
  'src/platform/electron/windows/pet-renderer-selection.js', 'src/bootstrap/renderer-ipc.js',
  'research/animation-0.1.0/runtime-facepath05/fixtures/face-d2/asset.glb',
  'research/animation-0.1.0/original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'
]);
export function sourceIdentity(root, { files = SOURCE_FILES, exec = execFileSync } = {}) {
  const result = { commit: null, tree: null, dirty: null, criticalDigest: null, criticalFiles: {} };
  try {
    const git = args => exec('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    result.commit = git(['rev-parse', 'HEAD']); result.tree = git(['rev-parse', 'HEAD^{tree}']);
    result.dirty = Boolean(git(['status', '--porcelain', '--untracked-files=no']));
  } catch { result.gitUnavailable = true; }
  let total = 0;
  for (const relative of files) {
    if (!relative || relative.includes('..') || path.isAbsolute(relative)) throw new Error('source-path-rejected');
    let cursor = root;
    for (const part of relative.split('/')) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('source-symlink-rejected'); }
    const target = path.join(root, relative), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024 || (total += stat.size) > 64 * 1024 * 1024)
      throw new Error('source-file-limit-or-type');
    result.criticalFiles[relative] = hash(fs.readFileSync(target));
  }
  result.criticalDigest = hash(JSON.stringify(result.criticalFiles));
  result.digestScope = 'explicit critical source/lock/model allowlist; Git identifies other tracked source';
  return result;
}
export function hostMetadata() {
  const cpus = os.cpus();
  return { platform: process.platform, arch: process.arch, release: os.release(),
    cpuModel: cpus[0]?.model?.slice(0, 160) ?? null, logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(), versions: { node: process.versions.node, electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null, v8: process.versions.v8 } };
}
export function safeMessage(error) {
  const code = ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EEXIST', 'ABORT_ERR', 'ETIMEDOUT'].includes(error?.code) ? error.code : 'capture-error';
  return { code, message: sanitizeDiagnosticText(String(error?.message ?? error).slice(0, 65536)).replace(/(?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^\r\n"']+/g, '[path]')
    .replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/gi, '[redacted]').slice(0, 512) };
}
export function writePrivateJSON(file, value) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw new Error('partial-report-too-large');
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
/** Exclusive output admission: never replace an earlier run or follow an output symlink. */
export function saveCapture(file, payload) {
  const bytes = encodeCapturePackage(payload);
  decodeCapturePackage(bytes);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    // Same-directory hard link publishes complete bytes atomically and refuses an existing target.
    fs.linkSync(temporary, file);
  } finally { fs.unlinkSync(temporary); }
  return { bytes: bytes.length, sha256: hash(bytes) };
}
