#!/usr/bin/env node
// npm run rig:build | rig:check | rig:demo | rig:preview  (docs/PET_RIG.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileRig, emitModule } from './build.mjs';
import { coverageReport } from './coverage.mjs';
import { PET_FORMS } from '../../src/capabilities/companion/form-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SVG = 'assets/companion/usagi/rig/usagi.rig.svg';
const DEFAULT_OUT = 'assets/companion/usagi/rig/usagi.rig.mjs';
const DEMO_SVG = 'tools/rig-build/examples/sprout.rig.svg';
const DEMO_OUT = 'tools/rig-build/out/sprout.rig.mjs';
const PLACEHOLDER = `// Placeholder. \`npm run rig:build\` replaces this file with the rig compiled
// from assets/companion/usagi/rig/usagi.rig.svg (layers you supply yourself;
// see docs/PET_RIG.md). A null rig is absent; it does not load retired artwork.
export default null;
`;

function parseArgs(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { options._.push(arg); continue; }
    const [key, inline] = arg.slice(2).split('=');
    options[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return options;
}

const abs = file => path.resolve(ROOT, file);
const rel = file => path.relative(ROOT, file) || '.';

function compileFile(svgPath, options = {}) {
  if (!fs.existsSync(svgPath)) {
    throw new Error(`${rel(svgPath)} not found. Draw your layered SVG there (see docs/PET_RIG.md), `
      + `or try the demo: npm run rig:demo`);
  }
  const result = compileRig(fs.readFileSync(svgPath, 'utf8'), {
    sourceName: path.basename(svgPath),
    form: typeof options.form === 'string' ? options.form : undefined,
    version: options.version ? Number(options.version) : undefined
  });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`error: ${error}`);
    throw new Error(`${rel(svgPath)} did not produce a valid rig`);
  }
  return result;
}

function report(result) {
  const form = PET_FORMS[result.doc.form];
  console.log(coverageReport(result.doc, form, { bounds: result.bounds }).text);
}

function build(options) {
  const out = abs(options.out || DEFAULT_OUT);
  if (options.clear) {
    fs.writeFileSync(out, PLACEHOLDER);
    console.log(`reset ${rel(out)} to the placeholder; the pet uses its other art sources again`);
    return;
  }
  const svg = abs(options.in || options._[0] || DEFAULT_SVG);
  const result = compileFile(svg, options);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, emitModule(result.doc, result.source));
  console.log(`wrote ${rel(out)} (${result.doc.id}@${result.doc.version}, ${fs.statSync(out).size} bytes)`);
  report(result);
}

function check(options) {
  const svg = abs(options.in || options._[0] || DEFAULT_SVG);
  report(compileFile(svg, options));
}

function demo() {
  const result = compileFile(abs(DEMO_SVG));
  const out = abs(DEMO_OUT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, emitModule(result.doc, result.source));
  console.log(`wrote ${rel(out)} from the original demo character 芽芽`);
  report(result);
  console.log(`\npreview it:   npm run rig:preview -- --in ${DEMO_SVG}`);
  console.log(`use it in-app: npm run rig:build -- --in ${DEMO_SVG}   (undo: npm run rig:build -- --clear)`);
}

async function preview(options) {
  const { startPreviewServer } = await import('./preview/server.mjs');
  const svg = abs(options.in || options._[0] || DEFAULT_SVG);
  const port = Number(options.port) || 4178;
  const server = await startPreviewServer({ root: ROOT, svgPath: svg, port, compile: file => compileFile(file, options) });
  console.log(`rig preview for ${rel(svg)}: http://127.0.0.1:${server.address().port}/`);
  console.log('edit and save the SVG, then reload the page. Ctrl+C to stop.');
}

const [command = 'build', ...rest] = process.argv.slice(2);
const options = parseArgs(rest);
const commands = { build, check, demo, preview };
try {
  if (!commands[command]) throw new Error(`unknown command ${command}; use build, check, demo or preview`);
  await commands[command](options);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
