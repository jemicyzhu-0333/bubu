import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CAPTURE_LIMITS, canonicalCaptureJSON, validateCapturePayload } from './report.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** One gzip JSON envelope, not an archive with executable paths or extracted files. */
export function encodeCapturePackage(payload) {
  validateCapturePayload(payload);
  const payloadJSON = canonicalCaptureJSON(payload);
  const envelope = canonicalCaptureJSON({ packageVersion: 1, payloadSha256: digest(payloadJSON), payload });
  const compressed = gzipSync(Buffer.from(envelope));
  if (compressed.length > CAPTURE_LIMITS.compressedBytes) throw new RangeError('Capture compressed size exceeds limit');
  return compressed;
}

export function decodeCapturePackage(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('Capture package must be bytes');
  if (bytes.byteLength > CAPTURE_LIMITS.compressedBytes) throw new RangeError('Capture compressed size exceeds limit');
  const decoded = gunzipSync(bytes, { maxOutputLength: CAPTURE_LIMITS.decodedBytes });
  const utf8 = decoded.toString('utf8');
  if (!Buffer.from(utf8).equals(decoded)) throw new TypeError('Capture package is not valid UTF-8');
  const envelope = JSON.parse(utf8);
  if (!envelope || Object.getPrototypeOf(envelope) !== Object.prototype || envelope.packageVersion !== 1
    || Object.keys(envelope).sort().join(',') !== 'packageVersion,payload,payloadSha256'
    || !/^[a-f0-9]{64}$/.test(envelope.payloadSha256)) throw new TypeError('Invalid capture package envelope');
  validateCapturePayload(envelope.payload);
  if (digest(canonicalCaptureJSON(envelope.payload)) !== envelope.payloadSha256) throw new Error('Capture payload hash mismatch');
  return envelope.payload;
}
