// Sequential, reproducible capture of the finite declared Dango catalogue.
// Capturing evidence does not automatically mark it visually reviewed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canvas = arg('canvas-package') || process.env.DANGO_CANVAS_PACKAGE;
if (!canvas) throw Error('Pass --canvas-package or DANGO_CANVAS_PACKAGE for an existing Skia backend');
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-complete-audit'));
const jobs = [
  ['actions', 'actions/run.mjs', 'actions'],
  ['wardrobe', 'wardrobe/capture.mjs', 'wardrobe'],
  ['environments', 'actions/run-environments.mjs', 'actions/environment'],
  ['materials', 'materials.mjs', 'materials']
];
if (arg('only') && !jobs.some(([id]) => id === arg('only'))) throw Error('Unknown capture stage');
for (const [id, script, directory] of jobs) {
  if (arg('only') && id !== arg('only')) continue;
  const args = [path.join(root, 'tools/dango-complete-audit', script), `--canvas-package=${canvas}`, `--out=${path.join(out, directory)}`];
  if (process.argv.includes('--resume') && ['actions', 'wardrobe'].includes(id)) args.push('--resume');
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw Error(`${id} capture failed: ${result.status ?? result.signal}`);
}
console.log(`Evidence captured at ${out}. Inspect each item before marking visual review complete.`);
