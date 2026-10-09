import fs from 'node:fs';
import { compileDangoAppearance, emitDangoAppearance } from './appearance-build.mjs';
const source = new URL('../../assets/companion/dango/dango.appearance.svg', import.meta.url);
const output = new URL('../../src/content/companion/dango-appearance.mjs', import.meta.url);
const data = compileDangoAppearance(fs.readFileSync(source, 'utf8'));
const module = emitDangoAppearance(data);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== module) throw new Error('Dango wardrobe output is stale; rebuild it');
} else fs.writeFileSync(output, module);
console.log(`Dango wardrobe v${data.version}: ${Object.keys(data.items).length} items, four authored views, integer pixel scanlines`);
