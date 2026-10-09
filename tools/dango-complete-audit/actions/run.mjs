import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { catalog } from './catalog.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(arg('out') || 'dist/dango-complete-audit/actions');
fs.mkdirSync(out, { recursive: true });
const selected = catalog.filter(value => (!arg('kind') || value.kind === arg('kind')) && (!arg('ids') || arg('ids').split(',').includes(value.id)));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const captureHash = sha(path.join(here, 'capture-item.mjs'));
for (const entry of selected) {
  const destination = path.join(out, entry.kind, entry.id);
  const recordPath = path.join(destination, 'record.json');
  if (process.argv.includes('--resume') && fs.existsSync(recordPath)) {
    const prior = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const current = prior.captureToolSha256 === captureHash && prior.durationMs === entry.durationMs && prior.fps === Number(arg('fps') || 30)
      && prior.checks.checkedFrames === prior.frameCount && !prior.sourcesChangedDuringCapture?.length
      && Object.entries(prior.sourceHashes).every(([file, hash]) => sha(path.resolve(file)) === hash);
    if (current) continue;
  }
  const result = spawnSync(process.execPath, ['--expose-gc', path.join(here, 'capture-item.mjs'), `--kind=${entry.kind}`,
    `--id=${entry.id}`, `--out=${destination}`, `--canvas-package=${arg('canvas-package')}`, `--fps=${arg('fps') || 30}`], { stdio: 'inherit' });
  if (result.status !== 0) { console.error(`Capture failed ${entry.kind}/${entry.id}: ${result.status} ${result.signal}`); process.exit(result.status || 1); }
}
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify({ counts: { actions: 43, sessions: 12, expressions: 32 },
  source: 'Production content tables; no mirror-music, mirror-coding, mirror-ai or ai-chat activity exists in this branch',
  entries: catalog.map(({ item, ...entry }) => entry) }, null, 2));
