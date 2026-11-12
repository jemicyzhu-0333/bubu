// Re-run the F2 acceptance-B analyzer v2 over the committed raw renderer logs.
// Usage (from research/animation-0.1.0): node grok-regression-v2/acceptance/reanalyse-f2.mjs [dir] [--details]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseF2 } from './f2-analyzer.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? path.join(here, 'evidence/f2-straight-20261112');
const details = process.argv.includes('--details');
// variant -> contract it is expected to obey (baseline is also checked against 64/76)
const plan = { 'baseline-3751977': ['threshold', 'hysteresis'], 'dot-r3-4eb3377': ['hysteresis'] };
for (const variant of fs.readdirSync(dir).sort()) {
  for (const file of fs.readdirSync(path.join(dir, variant)).filter(f => /^f2-renderer-log-\d+\.json$/.test(f)).sort()) {
    const log = JSON.parse(fs.readFileSync(path.join(dir, variant, file), 'utf8'));
    for (const contract of plan[variant] ?? ['hysteresis']) {
      const { details: d, ...a } = analyseF2(log, { contract });
      console.log(JSON.stringify({ variant, file, ...a, ...(details ? { details: d } : {}) }));
    }
  }
}
