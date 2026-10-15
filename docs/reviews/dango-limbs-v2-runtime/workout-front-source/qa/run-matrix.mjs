import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, out } from './qa-paths.mjs';

const heavy = ['milestone.sunhat', 'milestone.satchel', 'milestone.scarf',
  'milestone.halo', 'milestone.boots', 'milestone.cape'];
const groups = [
  ['bare-dpr1-facing1-full', 1, 1, false, false],
  ['bare-dpr1.25-facing-1-full', 1.25, -1, false, false],
  ['bare-dpr1.5-facing1-full', 1.5, 1, false, false],
  ['bare-dpr2-facing-1-full', 2, -1, false, false],
  ['boots-dpr1-facing1-full', 1, 1, false, ['milestone.boots']],
  ['boots-dpr2-facing-1-full', 2, -1, false, ['milestone.boots']],
  ['heavy-dpr2-facing1-full', 2, 1, false, heavy],
  ['heavy-dpr2-facing-1-calm', 2, -1, true, heavy]
];
const selected = process.argv.find(v => v.startsWith('--group='))?.slice(8);
if (selected && !groups.some(g => g[0] === selected)) throw new Error('Unknown matrix group: ' + selected);
for (const [tag, dpr, facing, calm, outfit] of groups) {
  if (selected && tag !== selected) continue;
  const log = fs.openSync(path.join(out, tag + '.log'), 'w');
  const result = spawnSync(process.execPath, ['--max-old-space-size=384', fileURLToPath(new URL('./audit-full-production.mjs', import.meta.url)),
    '--repo=' + root, '--out=' + out], { stdio: ['ignore', log, log], env: { ...process.env,
      WORKOUT_SMOKE: '0', WORKOUT_QA_TAG: tag, WORKOUT_DPR: String(dpr), WORKOUT_FACING: String(facing),
      WORKOUT_CALM: calm ? '1' : '0', WORKOUT_OUTFIT: JSON.stringify(outfit) } });
  fs.closeSync(log);
  if (result.error || result.status !== 0) throw new Error(tag + ' failed; inspect ' + path.join(out, tag + '.log'));
  console.log(tag + ': 510 frames passed');
}
