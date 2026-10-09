import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileDangoVectorAppearance, emitDangoVectorAppearance } from './appearance-vector-build.mjs';
const source = fileURLToPath(new URL('../../assets/companion/dango/dango.appearance.vector.svg', import.meta.url));
const target = fileURLToPath(new URL('../../src/content/companion/dango-vector-appearance.mjs', import.meta.url));
const data = compileDangoVectorAppearance(fs.readFileSync(source, 'utf8'));
const emitted = emitDangoVectorAppearance(data);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== emitted) throw new Error('native wardrobe data is stale');
} else fs.writeFileSync(target, emitted);
console.log(`Dango native wardrobe v${data.version}:16 items,3 authored views and maximum-turn profile alias`);
