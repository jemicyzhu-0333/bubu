// Offscreen production renderer evidence, not native-desktop acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { createRenderHarness, loadSource } from '../usagi-gallery/runtime-harness.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = createRequire(import.meta.url)(arg('canvas-package'));
const out = path.resolve(arg('out') || path.join(root, 'dist/dango-mirror-review'));
fs.mkdirSync(out, { recursive: true });
installOffscreenImages(backend); globalThis.Path2D = backend.Path2D;
globalThis.document = { createElement: () => backend.createCanvas(1, 1) };
globalThis.window = { devicePixelRatio: 2 };
const source = await loadSource(pathToFileURL(root).href);
// The diagnostic catalogue admits mirrors; it does not change production IDs.
source.sessions = { ...source.sessions, SESSION_ACTIVITIES: { ...source.sessions.SESSION_ACTIVITIES,
  ...source.sessions.MIRROR_ACTIVITIES } };
const sheet = backend.createCanvas(1200, 1280), context = sheet.getContext('2d');
context.fillStyle = '#f4f1e8'; context.fillRect(0, 0, sheet.width, sheet.height);
const records = [];
let index = 0;
for (const id of ['mirror-music', 'mirror-ai']) for (const view of ['front', 'three-quarter']) for (const dressed of [false, true]) {
  const outfit = dressed ? ['milestone.sunhat', 'milestone.scarf', 'milestone.boots'] : [];
  const driver = createRenderHarness(source, { skin: 'pink', view, outfit, blink: false, dpr: 2 });
  driver.select('session', id);
  for (const at of [0, 1500]) driver.draw(at);
  const x = index % 4 * 300, y = Math.floor(index / 4) * 600;
  context.fillStyle = '#334044'; context.font = '15px sans-serif';
  context.fillText(`${id} / ${view}`, x + 12, y + 22);
  context.fillText(dressed ? 'Existing hat + scarf + two boots' : 'Bare approved body', x + 12, y + 43);
  context.drawImage(driver.body, x + 40, y + 40, 219, 219);
  context.save(); context.beginPath(); context.rect(x, y + 260, 300, 335); context.clip();
  context.drawImage(driver.body, x - 75, y + 170, 438, 438); context.restore();
  fs.writeFileSync(path.join(out, `${id}-${view}-${dressed ? 'dressed' : 'bare'}.png`), driver.body.toBuffer('image/png'));
  records.push({ id, view, outfit, displayBodyWidth: [99, 198], actualRaster: [driver.body.width, driver.body.height] });
  driver.dispose(); index++;
}
fs.writeFileSync(path.join(out, 'native-and-2x.png'), sheet.toBuffer('image/png'));
fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ renderer: 'production', backend: 'offscreen Skia', records }, null, 2));
console.log(out);
