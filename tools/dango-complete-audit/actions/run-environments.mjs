import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENES } from '../../../src/content/scenes.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(arg('out') || 'dist/dango-complete-audit/actions/environment');
const items = [...Object.keys(SCENES).map(id => ({ kind: 'scene', id })),
  ...['hungry', 'coffee'].map(id => ({ kind: 'status', id })),
  ...['focused', 'resting'].map(id => ({ kind: 'room', id })), { kind: 'particles', id: 'all-28' }];
const entries = [];
for (const item of items) {
  const destination = path.join(out, item.kind, item.id);
  const result = spawnSync(process.execPath, [path.join(here, 'capture-environment.mjs'), `--kind=${item.kind}`, `--id=${item.id}`,
    `--out=${destination}`, `--canvas-package=${arg('canvas-package')}`], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`environment capture ${item.kind}/${item.id} failed: ${result.status || result.signal}`);
  entries.push(JSON.parse(fs.readFileSync(path.join(destination, 'record.json'), 'utf8')));
}
fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'ledger.json'), JSON.stringify({ entries }, null, 2));
