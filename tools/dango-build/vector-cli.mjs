import fs from 'node:fs';
import { compileDangoVector, emitDangoVector } from './vector-build.mjs';
const source = new URL('../../assets/companion/dango/dango.vector.svg', import.meta.url);
const destination = new URL('../../src/content/companion/dango-vector.mjs', import.meta.url);
const output = emitDangoVector(compileDangoVector(fs.readFileSync(source, 'utf8')));
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) throw new Error('dango vector source is stale; run node tools/dango-build/vector-cli.mjs');
  console.log('dango vector paths, materials and anchors are synchronized');
} else { fs.writeFileSync(destination, output); console.log('compiled dango native vector body and expressions'); }
