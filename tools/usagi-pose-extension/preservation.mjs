import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource, createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';

const [before, after, output, outfit = 'bare', rawDpr = '2', scope = 'approved', rawCases] = process.argv.slice(2);
const dpr = Number(rawDpr), require = createRequire(import.meta.url);
const backend = require(process.env.USAGI_CANVAS_PACKAGE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
installOffscreenImages(backend);
globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement() { return backend.createCanvas(1, 1); } };
globalThis.window = { devicePixelRatio: dpr };
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href);
const sources = [];
for (const root of [before, after]) sources.push(await loadSource(pathToFileURL(root).href, {
  interactions: await load(root, 'src/content/interactions.js'),
  interactionPlayback: await load(root, 'src/surfaces/pet/interaction-playback.mjs')
}));
const { USAGI_OUTFIT_SETS } = await load(after, 'src/content/companion/usagi-wardrobe.mjs');
const { COMPANION_ACTIVITY_STORIES } = await load(after, 'src/content/companion/activity-stories.mjs');
const outfitIds = outfit === 'bare' ? false : USAGI_OUTFIT_SETS.find(set => set.id === outfit).itemIds;
const views = ['front', 'three-quarter', 'profile', 'back'];
const inventory = scope === 'catalogue', continuous = scope === 'continuous';
const ordinary = inventory ? Object.keys(sources[1].behaviors.PET_ACTIONS) : scope === 'approved' ? ['yawn', 'sneeze', 'high-five']
  : ['catch-star', 'dance', 'moonwalk', 'photo-pose'];
const cases = ordinary.flatMap(id => (inventory ? ['auto'] : views).map(view => ({ kind: 'action', id, view })));
if (!inventory && scope !== 'approved') {
  cases.push(...['click-2', 'click-20', 'click-30', 'longPress'].map(id => ({ kind: 'interaction', id, view: 'auto' })));
  cases.push(...views.map(view => ({ kind: 'expression', id: 'life.idle', view })));
  let start = 0;
  const phases = COMPANION_ACTIVITY_STORIES['rest-nap'].stages.flatMap(stage => {
    const list = [.04, .5, .96].map(t => start + (stage.until - start) * t);
    start = stage.until; return list;
  });
  cases.push(...views.map(view => ({ kind: 'session', id: 'rest-nap', view, phases })));
}
if (rawCases) cases.splice(0, cases.length, ...JSON.parse(rawCases));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const files = JSON.parse(fs.readFileSync(new URL('r1-baseline-hashes.json', import.meta.url)));
const sourceSeals = [before, after].map(root => hash(JSON.stringify(Object.fromEntries(Object.keys(files)
  .filter(file => /^(src|assets)\//.test(file)).map(file => [file, hash(fs.readFileSync(path.join(root, file)))])))));
const results = [];
for (const item of cases) for (const facing of inventory || continuous ? [1] : [-1, 1]) for (const calm of inventory || continuous ? [false] : [false, true]) {
  const pair = sources.map(source => createRenderHarness(source, { skin: 'usagi', dpr, outfit: outfitIds, view: item.view, facing: item.facing || facing, calm }));
  pair.forEach(h => h.select(item.kind, item.id));
  if (continuous && item.frameIndices?.[0]) {
    for (let index = 0; index < item.frameIndices[0]; index++) pair.forEach(h => h.draw(index * 1000 / 30));
  }
  for (const [index, phase] of (item.phases || (inventory ? [.12, .5, .88] : [0, .04, .12, .25, .5, .75, .88, .96, .999])).entries()) {
    const frames = pair.map(h => h.draw(item.frameIndices ? item.frameIndices[index] * 1000 / 30 : phase * h.current.duration));
    const components = ['body', 'scene', 'overlay'].map(key => {
      const pixels = frames.map(frame => frame[key].getContext('2d').getImageData(0, 0, frame[key].width, frame[key].height).data);
      let different = 0;
      for (let i = 0; i < pixels[0].length; i += 4) if (pixels[0][i] !== pixels[1][i]
        || pixels[0][i + 1] !== pixels[1][i + 1] || pixels[0][i + 2] !== pixels[1][i + 2]
        || pixels[0][i + 3] !== pixels[1][i + 3]) different++;
      return { key, different, before: hash(pixels[0]), after: hash(pixels[1]) };
    });
    const effectiveView = sources[1].formArt.resolveView(pair[1].form, item.kind === 'interaction' ? 'auto' : item.view,
      { action: frames[1].state.currentRenderedAction, state: frames[1].state.state });
    results.push({ ...item, phases: undefined, frameIndices: undefined, requestedView: item.view, effectiveView, facing: item.facing || facing, calm, phase, components });
  }
  pair.forEach(h => h.dispose());
}
const changed = results.filter(result => result.components.some(component => component.different));
const allowed = new Set(['wave','stretch','read-book','take-note','type-keyboard','sip-tea','knit-scarf','drum-solo',
  'build-blocks','tiny-chef','sweep','umbrella-dance','snack-picnic','bubble-blow','sing','plant-water','stuck-corner','magic-trick']);
const failed = inventory ? changed.filter(result => !allowed.has(result.id)) : changed;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ before, after, sourceSeals, outfit, dpr, scope, samples: results.length,
  failures: failed.length, changedActions: [...new Set(changed.map(row => row.id))], results }, null, 2) + '\n');
console.log(JSON.stringify({ output, outfit, dpr, scope, samples: results.length, failures: failed.length }));
if (failed.length) process.exitCode = 1;
