import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = 'runtime-facepath05/tools/approved-d2-source.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const abort = signal => { if (signal?.aborted) throw Object.assign(new Error('D2 materialization interrupted'), { code: 'ABORT_ERR' }); };
function checkContract(contract) {
  if (contract?.schemaVersion !== 1) throw new Error('Unsupported approved D2 source contract');
  for (const key of ['archive', 'output']) {
    const item = contract[key];
    if (!item || typeof item.path !== 'string' || !item.path || item.path.length > 256
      || path.isAbsolute(item.path) || item.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')
      || item.path.includes(':') || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 32 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid approved D2 source contract');
  }
  if (contract.archive.path === contract.output.path) throw new Error('D2 archive and output must differ');
  return structuredClone(contract);
}
async function inspectParents(root, relative, create = false) {
  const absolute = path.resolve(root), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of path.relative(parsed.root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('D2 symbolic-link or non-directory parent rejected');
  }
  for (const part of path.dirname(relative).split('/').filter(part => part !== '.')) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode: 0o700 }); stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('D2 symbolic-link or non-directory parent rejected');
  }
}
async function readExact(file, expected, signal) {
  abort(signal);
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expected.bytes) throw new Error('D2 asset size/type mismatch');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('D2 file identity changed');
    const buffer = Buffer.alloc(expected.bytes + 1); let count = 0;
    while (count < buffer.length) {
      abort(signal);
      const { bytesRead } = await handle.read(buffer, count, Math.min(1024 * 1024, buffer.length - count), count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    abort(signal);
    const after = await fs.lstat(file);
    if (count !== expected.bytes || after.dev !== before.dev || after.ino !== before.ino || after.size !== count
      || hash(buffer.subarray(0, count)) !== expected.sha256) throw new Error('D2 asset hash/identity mismatch');
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}

/** Test seam for small fixed-root gzip fixtures; never exposed through the CLI. */
export function createD2Materializer({ contract, link = fs.link.bind(fs), checkpoint = () => {} }) {
  const approved = checkContract(contract);
  return async function materialize({ root, signal } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('An absolute fixed contract root is required');
    const check = async stage => { abort(signal); await checkpoint(stage); abort(signal); };
    const archive = path.join(root, approved.archive.path), target = path.join(root, approved.output.path);
    const result = status => ({ asset: approved.output.path, sha256: approved.output.sha256, bytes: approved.output.bytes, status });
    await check('start');
    try {
      // Missing output directories are created only after the archive has verified.
      await inspectParents(root, approved.output.path, false);
      await fs.lstat(target);
      await readExact(target, approved.output, signal); await check('existing-verified');
      return result('already-verified');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await check('before-archive'); await inspectParents(root, approved.archive.path);
    const encoded = await readExact(archive, approved.archive, signal);
    await check('before-decode');
    const decoded = await new Promise((resolve, reject) => gunzip(encoded,
      { maxOutputLength: approved.output.bytes + 1 }, (error, value) => error ? reject(error) : resolve(value)));
    await check('decoded');
    if (decoded.length !== approved.output.bytes || hash(decoded) !== approved.output.sha256) throw new Error('Expanded D2 asset size/hash mismatch');
    await inspectParents(root, approved.output.path, true); await check('before-staging');
    const temporary = path.join(path.dirname(target), '.asset.glb.materializing-node');
    let handle = null, owned = null;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); owned = await handle.stat();
      await handle.writeFile(decoded); await handle.sync(); await handle.close(); handle = null;
      await check('before-publish'); await inspectParents(root, approved.output.path);
      // Atomic no-overwrite publication. POSIX rename could replace a target created concurrently.
      await link(temporary, target);
      return result('materialized-and-verified');
    } finally {
      await handle?.close();
      if (owned) {
        const current = await fs.lstat(temporary);
        if (current.dev !== owned.dev || current.ino !== owned.ino || current.isSymbolicLink()) throw new Error('D2 staging ownership changed');
        await fs.unlink(temporary);
      }
    }
  };
}

export async function materializeD2({ root = ROOT, signal } = {}) {
  abort(signal);
  const research = path.join(root, 'research/animation-0.1.0');
  await inspectParents(research, CONTRACT);
  const file = path.join(research, CONTRACT), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Approved D2 contract file rejected');
  const contract = JSON.parse(await fs.readFile(file, { encoding: 'utf8', signal }));
  return createD2Materializer({ contract })({ root: research, signal });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { console.error('D2 materializer accepts no arguments'); process.exitCode = 2; }
  else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    materializeD2({ signal: controller.signal }).then(value => console.log(JSON.stringify(value)))
      .catch(error => { console.error(error.code === 'ABORT_ERR' ? 'D2 materialization interrupted' : 'D2 materialization failed: ' + error.message); process.exitCode = 2; })
      .finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  }
}
