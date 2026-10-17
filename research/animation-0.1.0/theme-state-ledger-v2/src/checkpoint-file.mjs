/** Reference local-file checkpoint adapter. Single-writer trusted directory only.
 * Not connected to production outbox, and not a general transactional database.
 */
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { restoreLedger, validateSnapshot, ContractError } from './ledger.mjs';
const digest = text => createHash('sha256').update(text).digest('hex');
const check = (value, code) => { if (!value) throw new ContractError(code); };
function cursor(value) {check(typeof value === 'string' && value.trim().length > 0 && value.length <= 512, 'CHECKPOINT_CURSOR');}
function fields(value, keys) {check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'CHECKPOINT_SHAPE');}
export async function writeCheckpoint(path, snapshot, upstreamCursor) {
  // restore performs strict deep validation before JSON.stringify can invoke input code.
  const validated = validateSnapshot(snapshot);
  cursor(upstreamCursor); check(validated.sourceCursor === upstreamCursor, 'CHECKPOINT_CURSOR_MISMATCH');
  const payload = {snapshot:validated, upstreamCursor};
  const encoded = JSON.stringify(payload);
  const content = JSON.stringify({formatVersion:1,sha256:digest(encoded),payload})+'\n';
  const temporary = join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`);
  let file, published = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(content, 'utf8'); await file.sync(); await file.close(); file = null;
    await rename(temporary,path); published = true;
    const dir = await open(dirname(path),'r'); try { await dir.sync(); } finally { await dir.close(); }
    return {published:true,upstreamCursor};
  } catch (error) {
    if(file) await file.close().catch(()=>{});
    if(!published) await unlink(temporary).catch(()=>{});
    // A directory fsync error after rename is an ambiguous commit; caller must read.
    error.checkpointMayBePublished = published; throw error;
  }
}
export const CHECKPOINT_MAX_BYTES = 128*1024*1024;
// Exported for deterministic size-race testing with an injected read-only handle.
export async function readBounded(handle, maxBytes = CHECKPOINT_MAX_BYTES) {
  check(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= CHECKPOINT_MAX_BYTES, 'CHECKPOINT_SIZE_LIMIT');
  const before = await handle.stat();
  check(before.isFile() && before.size <= maxBytes, 'CHECKPOINT_SIZE');
  const chunks = []; let total = 0;
  for (;;) {
    // Read one extra byte to detect a file that grew after the initial stat.
    const buffer = Buffer.alloc(Math.min(65536, maxBytes-total+1));
    const {bytesRead} = await handle.read(buffer,0,buffer.length,null);
    if (bytesRead === 0) break;
    total += bytesRead; check(total <= maxBytes, 'CHECKPOINT_SIZE');
    chunks.push(buffer.subarray(0,bytesRead));
  }
  const after = await handle.stat();
  check(after.isFile() && after.size === total && before.size === after.size && before.mtimeMs === after.mtimeMs, 'CHECKPOINT_CHANGED_DURING_READ');
  return Buffer.concat(chunks,total).toString('utf8');
}
export async function readCheckpoint(path, now, expected) {
  const handle = await open(path,'r');
  let text; try {text = await readBounded(handle);} finally {await handle.close();}
  let envelope; try {envelope=JSON.parse(text);} catch {throw new ContractError('CHECKPOINT_JSON');}
  fields(envelope,['formatVersion','sha256','payload']);check(envelope.formatVersion===1,'CHECKPOINT_VERSION');
  fields(envelope.payload,['snapshot','upstreamCursor']);cursor(envelope.payload.upstreamCursor);
  check(typeof envelope.sha256==='string' && envelope.sha256 === digest(JSON.stringify(envelope.payload)), 'CHECKPOINT_CHECKSUM');
  check(envelope.payload.snapshot.sourceCursor === envelope.payload.upstreamCursor,'CHECKPOINT_CURSOR_MISMATCH');
  return {ledger:restoreLedger(envelope.payload.snapshot,now,expected),upstreamCursor:envelope.payload.upstreamCursor};
}
