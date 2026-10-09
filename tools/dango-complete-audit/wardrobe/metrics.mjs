import { DANGO_RASTER } from '../../../assets/companion/dango/raster/dango.raster.mjs';
import { framePixels } from '../../dango-frequency-audit/audit.mjs';
import { faceCall } from '../../dango-state-cycle-preview/metrics.mjs';

const wardrobe = call => (call.src || '').includes('/wardrobe/');
export function makeWardrobeMetrics(backend, width = 438, height = 438) {
  const masks = Array.from({ length: 3 }, () => backend.createCanvas(width, height));
  function replay(calls, index) {
    const context = masks[index].getContext('2d');
    context.resetTransform(); context.clearRect(0, 0, width, height);
    for (const call of calls) {
      context.setTransform(...call.matrix); context.globalAlpha = call.alpha;
      context.imageSmoothingEnabled = call.smoothing; context.drawImage(call.image, ...call.rect);
    }
    return context.getImageData(0, 0, width, height).data;
  }
  function measure(trace, body, items, view, action = null, diagnostic = true) {
    const calls = trace.calls, bodyIndex = calls.findIndex(call => !call.src);
    const descriptors = items.flatMap(item => {
      if (item.exclusiveGroup === 'headwear' && ['headband', 'sleep-cap'].includes(action?.prop)) return [];
      const entry = DANGO_RASTER.appearance[item.renderKey].views[view];
      return ['back', 'front'].flatMap(layer => entry[layer].map(sprite => ({ itemId: item.id, layer, sprite })));
    });
    const drawn = calls.filter(wardrobe), face = calls.filter(faceCall);
    const sampled = framePixels(body);
    const descriptorFor = call => descriptors.find(value => call.src.endsWith(`/${value.sprite.src}`));
    const front = drawn.filter(call => descriptorFor(call)?.layer === 'front');
    const back = drawn.filter(call => descriptorFor(call)?.layer === 'back');
    const row = { hash: sampled.hash, occupied: sampled.occupied, edge: sampled.edge, bounds: sampled.bounds,
      wardrobeLayers: drawn.length, expectedLayers: descriptors.length,
      suppressed: items.filter(item => item.exclusiveGroup === 'headwear' && ['headband', 'sleep-cap'].includes(action?.prop)).map(item => item.id),
      missing: descriptors.filter(value => !drawn.some(call => call.src.endsWith(`/${value.sprite.src}`))).map(value => value.sprite.src),
      unexpected: drawn.filter(call => !descriptorFor(call)).map(call => call.src.split('/').at(-1)),
      layerOrderCorrect: back.every(call => calls.indexOf(call) < bodyIndex) && front.every(call => calls.indexOf(call) > bodyIndex),
      faceSprites: face.map(call => call.src.split('/').at(-1)) };
    if (diagnostic) {
      const [f, c, b] = [replay(face, 0), replay(front, 1), replay(back, 2)];
      let faceFrontOverlap = 0, facePixels = 0, frontPixels = 0, backPixels = 0;
      for (let i = 3; i < f.length; i += 4) {
        const ff = f[i] >= 16, cc = c[i] >= 16;
        facePixels += ff; frontPixels += cc; backPixels += b[i] >= 16;
        faceFrontOverlap += ff && cc;
      }
      Object.assign(row, { faceFrontOverlap, facePixels, frontPixels, backPixels });
    }
    row.numericStatus = !row.occupied || row.edge || row.missing.length || row.unexpected.length
      || !row.layerOrderCorrect || row.faceFrontOverlap > 0 ? 'flagged' : 'checked';
    return row;
  }
  return { measure, dispose() { for (const mask of masks) { mask.width = 1; mask.height = 1; } } };
}

export function summarize(rows) {
  return { frames: rows.length, uniqueFrames: new Set(rows.map(row => row.hash)).size,
    blankFrames: rows.filter(row => !row.occupied).length, edgeFrames: rows.filter(row => row.edge).length,
    missingLayerFrames: rows.filter(row => row.missing.length || row.unexpected.length).length,
    layerOrderFailures: rows.filter(row => !row.layerOrderCorrect).length,
    diagnosticFrames: rows.filter(row => row.faceFrontOverlap !== undefined).length,
    maxFaceFrontOverlap: Math.max(0, ...rows.map(row => row.faceFrontOverlap || 0)),
    flaggedFrames: rows.filter(row => row.numericStatus === 'flagged').length };
}
