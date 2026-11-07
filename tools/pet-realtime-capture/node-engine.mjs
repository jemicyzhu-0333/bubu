import fs from 'node:fs';
// Single source of truth: the project's package.json "engines.node" (>=MAJOR.MINOR.PATCH).
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const MIN_NODE = (/>=\s*(\d+)\.(\d+)\.(\d+)/.exec(pkg.engines?.node || '') || [0, 22, 12, 0]).slice(1, 4).map(Number);
export function nodeSatisfiesEngine(version, min = MIN_NODE) {
  const v = String(version).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((v[i] || 0) !== min[i]) return (v[i] || 0) > min[i]; }
  return true;
}
