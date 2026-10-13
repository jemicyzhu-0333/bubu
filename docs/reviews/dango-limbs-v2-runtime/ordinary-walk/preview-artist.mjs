import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
export async function createPreviewArtist(repo) {
  const url = relative => pathToFileURL(path.join(repo, relative)).href;
  const [{ createDangoRasterArtist }, { DANGO_RASTER }] = await Promise.all([
    import(url('src/capabilities/companion/presentation/dango-raster-art.mjs')),
    import(url('assets/companion/dango/raster/dango.raster.mjs'))
  ]);
  const backend = createRequire(path.join(repo, 'package.json'))('@napi-rs/canvas');
  const artist = createDangoRasterArtist({ manifest: DANGO_RASTER, walkPreview: { enabled: true },
    createSurface: backend.createCanvas, loadImage: url => backend.loadImage(fileURLToPath(url)) });
  return { artist, backend };
}
export function argumentsForPreview() {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!arg('repo')) throw new Error('Pass --repo=/absolute/path/to/bubu. Uses its existing @napi-rs/canvas; installs nothing.');
  return { repo: path.resolve(arg('repo')), out: path.resolve(arg('out') || 'walk-preview-evidence') };
}
