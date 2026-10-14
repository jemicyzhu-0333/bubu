import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, out } from './qa-paths.mjs';

const names = ['full-natural-expiry', 'reduced-natural-expiry', 'low-stimulation-natural-expiry',
  'mode-switches', 'replace-retrigger', 'drag-cancel-retrigger', 'hide-menu-cancel-retrigger',
  'paper-replacement-handoff'];
const reports = [];
for (const name of names) {
  const log = fs.openSync(path.join(out, name + '.log'), 'w');
  const result = spawnSync(process.execPath, ['--max-old-space-size=384',
    fileURLToPath(new URL('./lifecycle/run.mjs', import.meta.url)), '--repo=' + root, '--out=' + out],
    { stdio: ['ignore', log, log], env: { ...process.env, WORKOUT_SCENARIO: name } });
  fs.closeSync(log);
  if (result.error || result.status !== 0) throw new Error(name + ' failed; inspect ' + path.join(out, name + '.log'));
  reports.push(JSON.parse(fs.readFileSync(path.join(out, name + '.json'), 'utf8')));
  console.log(name + ': passed');
}
const report = { scope: reports[0].scope, sourceKeys: reports[0].sourceKeys, dpr: 2,
  stageRaster: [438, 438], stageCSS: [219, 219],
  scenarios: reports.flatMap(r => r.scenarios), failures: reports.flatMap(r => r.failures),
  executionNotes: ['Every lifecycle scenario completed in its own process with exit 0.'] };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
