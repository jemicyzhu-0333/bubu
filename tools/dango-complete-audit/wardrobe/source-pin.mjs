import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const shared = ['src/surfaces/pet/renderer.mjs', 'src/surfaces/pet/frame-context.mjs', 'src/surfaces/pet/compositor.mjs',
  'src/core/pet-action-vector.mjs', 'src/core/pet-running-pose.mjs', 'src/core/pet-appearance.mjs',
  'src/content/appearance.mjs', 'src/content/behaviors.mjs', 'src/content/session-activities.mjs',
  'src/content/expressions.mjs', 'src/content/companion/activity-stories.mjs',
  'src/capabilities/companion/presentation/activity-playback.mjs',
  'assets/companion/dango/raster/dango.raster.mjs', 'tools/usagi-gallery/runtime-harness.mjs'];
// Added after the first completed wardrobe audit. Old records retain their
// original subset; the assembler must never pretend these were guarded then.
const expandedDependencies = [
  'src/core/pet-action-contact.mjs', 'src/core/pet-action-art.mjs', 'src/core/pet-stage.mjs',
  'src/core/pet-art.mjs', 'src/core/pet-scene-art.mjs', 'src/core/pet-face.mjs', 'src/core/pet-motion.mjs',
  'src/core/pet-sprite.mjs', 'src/core/pet-expression.mjs', 'src/core/pet-effect-visuals.mjs',
  'src/surfaces/pet/action-playback.mjs', 'src/surfaces/pet/effect-origin.mjs',
  'src/surfaces/pet/sleep-transition.mjs', 'src/surfaces/pet/scene.mjs', 'src/surfaces/pet/effects.mjs',
  'src/capabilities/companion/form-registry.mjs', 'src/capabilities/companion/presentation/form-art.mjs',
  'src/capabilities/companion/presentation/face-choreography.mjs',
  'src/capabilities/companion/presentation/rig/pose.mjs', 'src/capabilities/companion/presentation/rig/motions.mjs',
  'src/capabilities/companion/presentation/rig/face.mjs', 'src/capabilities/companion/presentation/raster/schema.mjs',
  'src/capabilities/companion/presentation/raster/source.mjs', 'src/capabilities/companion/presentation/raster/paint.mjs',
  'src/capabilities/companion/presentation/raster/palette.mjs', 'src/content/scenes.mjs', 'src/skins.mjs',
  'tools/dango-complete-audit/inventory.mjs', 'tools/dango-complete-audit/actions/catalog.mjs',
  'tools/dango-complete-audit/wardrobe/capture.mjs', 'tools/dango-complete-audit/wardrobe/metrics.mjs',
  'tools/dango-complete-audit/wardrobe/source-pin.mjs', 'tools/usagi-gallery/offscreen-images.mjs',
  'tools/usagi-gallery/pixels.mjs', 'tools/dango-frequency-audit/audit.mjs',
  'tools/dango-state-cycle-preview/metrics.mjs'
];
export function pinSources(root) {
  const files = [...shared, ...expandedDependencies];
  for (const directory of ['src/core', 'src/content/companion', 'src/capabilities/companion/presentation']) {
    for (const name of fs.readdirSync(path.join(root, directory))) if (name.startsWith('dango-') && name.endsWith('.mjs')) files.push(`${directory}/${name}`);
  }
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
}
export function changedSources(root, pin) {
  return Object.entries(pin).filter(([file, hash]) => sha256(fs.readFileSync(path.join(root, file))) !== hash).map(([file]) => file);
}
