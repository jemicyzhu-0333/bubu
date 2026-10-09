import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createPlanningPreferences } = require('../../src/bootstrap/planning-preferences');
const { planningFixture, repositoryFixture, NOW } = require('../../test-support/planning-guidance-fixture');
const fixture = repositoryFixture(planningFixture({ sufficient: true }));
const service = createPlanningPreferences({ ...fixture, readSnapshot: fixture.snapshot });
const routes = new Map(); service.register((channel, handler) => routes.set(channel, handler));
const view = service.get();
const trial = routes.get('planning:trial-preview')({}, { parameter: 'chronotypeShift', to: 6, scope: 'today' });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let html = await readFile(path.join(root, 'src/renderer/popover.html'), 'utf8');
html = html.replaceAll('href="../surfaces/', 'href="../src/surfaces/')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('<title>小步</title>', '<title>Planning · synthetic production UI fixture</title>')
  .replace('</body>', '<script type="module" src="../tools/planning-preview/fixture.mjs"></script></body>');
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/planning-preview.html'), html);
await writeFile(path.join(root, 'dist/planning-preview-data.json'), JSON.stringify({ now: NOW, view, trial }));
console.log('Built production HTML/CSS planning fixture with synthetic domain-generated preview; no user data or Provider calls.');
