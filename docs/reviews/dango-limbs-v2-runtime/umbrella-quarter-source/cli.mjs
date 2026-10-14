import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Generated adapters, images and dense traces must remain outside the repository.
export function readPaths(argv = process.argv.slice(2)) {
  const allowed = new Set(['--repo', '--out']), values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Usage: node <audit>.mjs --repo /path/to/repo --out /external/output');
    }
    values[argv[i]] = argv[i + 1];
  }
  const root = fs.realpathSync(values['--repo'] || fileURLToPath(new URL('../../../../', import.meta.url)));
  if (!fs.existsSync(path.join(root, 'src/capabilities/companion/presentation/dango-raster-art.mjs'))) {
    throw new Error('The complete repository root is required.');
  }
  if (!values['--out']) throw new Error('--out is required and must be outside the repository.');
  const requested = path.resolve(values['--out']);
  let ancestor = requested;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const out = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, requested));
  const relative = path.relative(root, out);
  if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
    throw new Error('Output inside the repository is forbidden; choose /tmp or another external directory.');
  }
  fs.mkdirSync(out, { recursive: true });
  return { root, out };
}
