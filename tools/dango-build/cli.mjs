import fs from 'node:fs';
import { compileDangoSvg, emitDangoModule } from './build.mjs';
const source = new URL('../../assets/companion/dango/dango.body.svg', import.meta.url);
const destination = new URL('../../src/content/companion/dango-body.mjs', import.meta.url);
const output = emitDangoModule(compileDangoSvg(fs.readFileSync(source, 'utf8')));
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) throw new Error('dango body module is stale; run node tools/dango-build/cli.mjs');
  console.log('dango SVG/grid/anchor source is synchronized');
} else { fs.writeFileSync(destination, output); console.log('compiled four dango views at 33×33 logical cells'); }
