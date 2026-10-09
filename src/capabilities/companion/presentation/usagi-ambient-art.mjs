'use strict';

import { DANGO_RASTER } from '../../../../assets/companion/dango/raster/dango.raster.mjs';
import { createRasterSource } from './raster/source.mjs';
import { createRasterPainter } from './raster/paint.mjs';
import { createRasterScenePainter } from './dango-raster-scenes.mjs';

// The approved ambient pack contains no character pixels. Reuse its rooms,
// outdoor scenes and particles without copying Dango's anatomy or action art.
function createUsagiAmbientArt({ manifest = DANGO_RASTER, loadImage, createSurface } = {}) {
  const source = createRasterSource({ baseUrl: manifest.baseUrl,
    versionKey: `${manifest.id}@${manifest.version}`, loadImage, maxEntries: 96, maxBytes: 36 * 1024 * 1024 });
  const painter = createRasterPainter({ source, createSurface, imageSmoothing: true });
  const sprites = [...Object.values(manifest.scenes || {}), ...Object.values(manifest.sessionScenes || {})]
    .flatMap(scene => scene.layers || []).concat(Object.values(manifest.sceneParticles || {}));
  return Object.freeze({ ...createRasterScenePainter({ manifest, painter }),
    ready: () => source.ready(sprites), subscribe: source.subscribe, cacheStats: source.stats,
    dispose() { painter.dispose(); source.dispose(); } });
}

export { createUsagiAmbientArt };
