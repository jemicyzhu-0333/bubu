import path from 'node:path';

export const LIMITS = Object.freeze({
  preparationMs: 300_000,
  collectionMs: 180_000,
  decodedBytes: 16 * 1024 * 1024,
  compressedBytes: 8 * 1024 * 1024,
  frames: 18_000,
  events: 512,
  errors: 64,
  screenshots: 6,
  maxLogsBytes: 65_536,
});

/** Closed capture CLI. The launcher alone creates and owns the output/profile. */
export function parseCaptureOptions(argv = []) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw new TypeError('Capture arguments must be strings');
  const result = { prepare: false, out: null, screenshots: true, help: false };
  const seen = new Set();
  for (const arg of argv) {
    const flag = arg.startsWith('--out=') ? '--out' : arg;
    if (!['--prepare', '--out', '--no-screenshots', '--help'].includes(flag) || arg === '--out')
      throw new Error('Unsupported capture option');
    if (seen.has(flag)) throw new Error('Duplicate capture option');
    seen.add(flag);
    if (flag === '--prepare') result.prepare = true;
    else if (flag === '--no-screenshots') result.screenshots = false;
    else if (flag === '--help') result.help = true;
    else {
      const value = arg.slice('--out='.length);
      if (!value.trim() || /[\0\r\n]/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) || /^[/\\]{2}/.test(value))
        throw new Error('Capture output must be a local file path');
      result.out = path.resolve(value);
    }
  }
  return Object.freeze(result);
}
