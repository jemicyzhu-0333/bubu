import fs from 'node:fs';
import path from 'node:path';

const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
export const root = fs.realpathSync(path.resolve(arg('repo') || process.env.WORKOUT_REPO || process.cwd()));
const destination = arg('out') || process.env.WORKOUT_OUT;
if (!destination) throw new Error('Pass --out=/external/evidence/directory; QA never writes bulk evidence into the repository.');
export const out = path.resolve(destination) + path.sep;
const relative = path.relative(root, out);
if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  throw new Error('QA output must be outside the repository.');
// Resolve existing ancestors before creating anything, so a symlink cannot
// redirect a seemingly external new directory into this checkout.
let ancestor = path.resolve(out);
const suffix = [];
while (!fs.existsSync(ancestor)) {
  suffix.unshift(path.basename(ancestor));
  ancestor = path.dirname(ancestor);
}
const effective = path.join(fs.realpathSync(ancestor), ...suffix);
const realRelative = path.relative(root, effective);
if (!realRelative || !realRelative.startsWith('..' + path.sep) && realRelative !== '..' && !path.isAbsolute(realRelative))
  throw new Error('QA output resolves inside the repository.');
fs.mkdirSync(out, { recursive: true });
