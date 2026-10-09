// Serial final evidence pipeline; do not run alongside another heavy capture.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const here = path.dirname(fileURLToPath(import.meta.url)), canvas = `--canvas-package=${arg('canvas-package')}`;
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(args[0])} failed: ${result.status || result.signal}`);
};
run(process.execPath, [path.join(here, 'run.mjs'), canvas, '--resume']);
for (const [id, view, facing] of [
  ['carry-energy', 'three-quarter', 1], ['bubble-blow', 'front', 1], ['bubble-blow', 'three-quarter', -1],
  ['sweep', 'front', 1], ['tail-wiggle', 'back', 1], ['build-blocks', 'front', 1]
]) run(process.execPath, [path.join(here, 'capture-item.mjs'), canvas, '--kind=action', `--id=${id}`, `--view=${view}`,
  `--facing=${facing}`, `--out=dist/dango-complete-audit/actions/repairs/final-${id}-${view}-${facing}`]);
run(process.execPath, [path.join(here, 'verify-repairs.mjs')]);
run(process.execPath, [path.join(here, 'run-environments.mjs'), canvas]);
run(process.execPath, [path.join(here, '../materials.mjs'), canvas]);
run(process.execPath, [path.join(here, 'supplement-static-views.mjs'), canvas]);
run(process.execPath, [path.join(here, 'finish.mjs'), '--decode']);
run('python', [path.join(here, 'composite-review.py')]);
