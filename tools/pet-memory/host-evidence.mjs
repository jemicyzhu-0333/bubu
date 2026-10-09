import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function sourceIdentity(root) {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    const full = path.join(root, relative), stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else { hash.update(relative.replaceAll(path.sep, '/')); hash.update('\0'); hash.update(fs.readFileSync(full)); }
  }
  for (const entry of ['src', 'assets', 'tools/pet-memory', 'package.json', 'package-lock.json']) visit(entry);
  let git = { commit: null, dirty: null };
  try { git = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) }; } catch {}
  return { git, sourceDigest: hash.digest('hex'), digestScope: 'src, assets, tools/pet-memory, package.json, package-lock.json' };
}

export function hostMetadata() {
  return { platform: process.platform, arch: process.arch, release: os.release(), version: os.version(),
    cpu: os.cpus()[0]?.model || null, logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(),
    versions: { electron: process.versions.electron || null, chrome: process.versions.chrome || null,
      node: process.versions.node, v8: process.versions.v8 } };
}

export function processEvidence(metric) {
  if (!metric) return null;
  const workingSetBytes = Number.isFinite(metric.memory?.workingSetSize) ? metric.memory.workingSetSize * 1024 : null;
  let rssBytes = process.platform === 'win32' ? workingSetBytes : null;
  let rssSource = process.platform === 'win32' ? 'Electron workingSetSize (KiB converted to bytes)' : null;
  if (process.platform !== 'win32') {
    try {
      const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(metric.pid)], { encoding: 'utf8' }).trim());
      if (Number.isFinite(kb) && kb > 0) { rssBytes = kb * 1024; rssSource = 'OS ps RSS (KiB converted to bytes)'; }
    } catch {}
  }
  return { pid: metric.pid, type: metric.type, creationTime: metric.creationTime,
    name: metric.name || null, cpu: metric.cpu, sandboxed: metric.sandboxed ?? null,
    rssBytes, rssSource, workingSetBytes,
    privateBytes: Number.isFinite(metric.memory?.privateBytes) ? metric.memory.privateBytes * 1024 : null,
    rawElectronMemoryKiB: metric.memory };
}

export function writeReport(out, report) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'report.json'), temporary = path.join(out, 'report.json.tmp');
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, file);
}
