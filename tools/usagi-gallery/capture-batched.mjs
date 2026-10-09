// Bounded-process capture keeps native Skia allocations from accumulating across
// a whole catalog. Completed entry/variant records are checkpointed for resume.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
import { EXPRESSIONS } from '../../src/content/expressions.mjs';
import { SCENES } from '../../src/content/scenes.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const out = path.resolve(arg('out') || 'dist/usagi-gallery-offscreen'); fs.mkdirSync(out, { recursive: true });
const target = path.join(out, 'manifest.json');
let manifest = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { entries: [], errors: [] };
const catalog = { action: Object.values(PET_ACTIONS), session: Object.values(SESSION_ACTIVITIES), expression: EXPRESSIONS, scene: Object.values(SCENES) };
function modulePaths(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const file = `${relative}/${entry.name}`;
    return entry.isDirectory() ? modulePaths(file) : /\.(?:m?js)$/.test(entry.name) ? [file] : [];
  });
}
const digestPaths = ['src/surfaces/pet/renderer.mjs','src/capabilities/companion/presentation/face-choreography.mjs',
  'src/capabilities/companion/presentation/expression-phrases.mjs','src/capabilities/companion/presentation/activity-playback.mjs',
  'src/content/companion/activity-stories.mjs','assets/companion/usagi/rig/usagi.rig.mjs',
  'src/capabilities/companion/presentation/rig/motions.mjs','src/capabilities/companion/presentation/rig/props.mjs','src/capabilities/companion/presentation/usagi-body-motion.mjs',
  'src/core/pet-action-contact.mjs','src/core/pet-action-tools.mjs','src/content/companion/dango-body.mjs','src/content/companion/dango-tools.mjs',
  'src/core/pet-action-art.mjs','src/core/pet-anatomy-art.mjs','src/core/pet-appearance-art.mjs','src/core/pet-session-motion.mjs',
  'src/capabilities/companion/presentation/dango-performance.mjs','src/content/companion/dango-appearance.mjs',
  'src/core/dango-view-policy.mjs','src/content/companion/dango-action-views.mjs',
  'src/core/pet-action-vector.mjs','src/core/pet-action-vector-poses.mjs','src/core/pet-action-vector-details.mjs','src/core/pet-running-pose.mjs',
  'src/core/pet-action-particles.mjs',
  'src/core/pet-vector-paint.mjs','src/content/companion/dango-vector.mjs','src/content/companion/dango-form.mjs',
  'src/content/companion/dango-vector-appearance.mjs',
  'src/capabilities/companion/presentation/dango-art.mjs','src/capabilities/companion/presentation/dango-face.mjs',
  'src/capabilities/companion/presentation/dango-appearance.mjs',
  ...modulePaths('src/capabilities/companion/presentation'),
  'assets/companion/dango/raster/dango.raster.mjs',
  'assets/companion/usagi/wardrobe/usagi.wardrobe.mjs'];
manifest.sourceSha256 = Object.fromEntries(digestPaths.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const dango = arg('form') === 'dango';
const variantIds = (arg('variants') || (dango ? 'baseline,current' : 'dango,baseline,current')).split(',');
const selectedKinds = arg('kinds')?.split(',') || Object.keys(catalog);
const selectedIds = arg('ids')?.split(',');
const requestedCategories = Object.fromEntries(selectedKinds.map(kind => [kind,
  catalog[kind].filter(item => !selectedIds || selectedIds.includes(item.id)).length]));
const expected = Object.values(requestedCategories).reduce((sum, count) => sum + count, 0) * variantIds.length;
for (const [kind, items] of Object.entries(catalog)) {
  if (arg('kinds') && !arg('kinds').split(',').includes(kind)) continue;
  const pending = items.filter(item => (!arg('ids') || arg('ids').split(',').includes(item.id))
    && (process.argv.includes('--refresh') || variantIds.some(variant => !manifest.entries.some(e => e.kind === kind && e.id === item.id && e.variant === variant))));
  const batchSize = Math.max(1, Math.min(4, Number(arg('batch-size') || (kind === 'session' ? 1 : 4))));
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize), batchOut = path.join(out, '.batches', `${kind}-${i}`);
    const command = [ '--expose-gc', path.join(here, 'capture-offscreen.mjs'),
      `--canvas-package=${arg('canvas-package')}`, `--baseline=${arg('baseline') || root}`,
      `--kinds=${kind}`, `--variants=${variantIds.join(',')}`, `--ids=${batch.map(item => item.id).join(',')}`, '--dense', `--out=${batchOut}` ];
    for (const option of ['form', 'skin', 'view', 'scene', 'dpr', 'frames', 'outfit-ids', 'baseline-ref', 'baseline-commit']) {
      if (arg(option)) command.push(`--${option}=${arg(option)}`);
    }
    for (const option of ['bare', 'calm']) if (process.argv.includes(`--${option}`)) command.push(`--${option}`);
    const child = spawn(process.execPath, command, { stdio: 'inherit' });
    const [code, signal] = await once(child, 'exit'); if (code !== 0) throw new Error(`Capture batch ${kind}:${i} failed: ${signal || code}`);
    const part = JSON.parse(fs.readFileSync(path.join(batchOut, 'manifest.json'), 'utf8'));
    for (const entry of part.entries) {
      manifest.entries = manifest.entries.filter(old => !(old.kind === entry.kind && old.id === entry.id && old.variant === entry.variant));
      manifest.entries.push(entry);
      const relative = `${entry.kind}/${entry.id}-${entry.variant}.png`;
      fs.mkdirSync(path.join(out, entry.kind), { recursive: true }); fs.copyFileSync(path.join(batchOut, relative), path.join(out, relative));
    }
    manifest.form = part.form; manifest.errors.push(...part.errors); manifest.renderer = part.renderer; manifest.backend = part.backend;
    manifest.baselineCommit = part.baselineCommit; manifest.baselineRef = part.baselineRef;
    manifest.generatedAt = new Date().toISOString();
    const captured = manifest.entries.filter(entry => selectedKinds.includes(entry.kind)
      && (!selectedIds || selectedIds.includes(entry.id)) && variantIds.includes(entry.variant)).length;
    manifest.coverage = { expectedEntryVariants: expected, capturedEntryVariants: captured,
      totalStoredEntryVariants: manifest.entries.length, complete: captured === expected,
      categories: requestedCategories, requestedVariants: variantIds };
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
    console.log(`CHECKPOINT ${captured}/${expected}`);
  }
}
