// Transfer a reviewed, source-preserved depth revision into runtime assets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateRasterSprite } from '../../src/capabilities/companion/presentation/raster/schema.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wardrobe = path.join(root, 'assets/companion/usagi/wardrobe');
const revision = path.resolve(arg('source') || '');
if (!revision.startsWith(path.join(wardrobe, 'sources') + path.sep)) throw new Error('depth revision must be in preserved wardrobe sources');
const specName = arg('spec');
if (!/^[a-z0-9-]+\.json$/.test(specName || '')) throw new Error('provide a plain --spec=revision-name.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const prototype = JSON.parse(fs.readFileSync(path.join(revision, 'records/prototype-manifest.json'), 'utf8'));
const originals = {};
for (const filename of fs.readdirSync(path.join(wardrobe, 'source-specs')).filter(name => name.endsWith('.json'))) {
  const spec = JSON.parse(fs.readFileSync(path.join(wardrobe, 'source-specs', filename), 'utf8'));
  if (!spec.replaces) Object.assign(originals, spec.appearance);
}
const fragment = { sourceRevision: path.basename(revision), replaces: {}, appearance: {} }, writes = [];
for (const [id, entry] of Object.entries(prototype.appearance)) {
  const match = Object.entries(originals).find(([, value]) => value.itemId === id);
  if (!match) throw new Error(`depth revision cannot create a new wardrobe identity: ${id}`);
  const [key, original] = match;
  fragment.replaces[key] = hash(JSON.stringify(original));
  const updated = { itemId: id, slot: original.slot, allowedViews: original.allowedViews,
    wrapsBody: original.slot !== 'usagi.sidebag',
    depthReference: `sources/${path.basename(revision)}/records/prototype-manifest.json`, views: {} };
  for (const [view, layers] of Object.entries(entry.views)) {
    if (!original.allowedViews.includes(view)) throw new Error(`unapproved garment view: ${view}`);
    updated.views[view] = { back: [], front: [] };
    for (const layer of ['back', 'front']) for (const [index, sprite] of layers[layer].entries()) {
      const source = path.resolve(revision, sprite.src);
      if (!source.startsWith(revision + path.sep)) throw new Error('garment source escaped revision');
      const bytes = fs.readFileSync(source);
      if (hash(bytes) !== sprite.sha256) throw new Error(`garment source changed: ${source}`);
      const relative = `items-depth-v2/${id}/${view}-${layer}-${index}.png`;
      const result = { src: relative, bone: sprite.bone, layer, rect: sprite.rect,
        sourceRect: sprite.sourceRect, depthRole: sprite.depthRole, sha256: sprite.sha256 };
      validateRasterSprite(result, `${key}/${view}/${layer}`);
      updated.views[view][layer].push(result);
      writes.push({ destination: path.join(wardrobe, relative), bytes });
    }
  }
  if (original.allowedViews.some(view => !updated.views[view])) throw new Error('depth revision omitted an authored view');
  fragment.appearance[key] = updated;
}
for (const { destination, bytes } of writes) {
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
}
fs.writeFileSync(path.join(wardrobe, 'source-specs', specName), JSON.stringify(fragment, null, 2) + '\n');
console.log(JSON.stringify({ garments: Object.keys(fragment.appearance).length, sprites: writes.length, spec: specName }));
