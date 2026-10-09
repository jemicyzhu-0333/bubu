import { COMPOSITION, intent } from './painter.mjs';

export function renderLayers(backend, painter, options, selected) {
  const canvas = backend.createCanvas(438, 438), context = canvas.getContext('2d');
  context.scale(3, 3);
  const artwork = painter.compose(context, options, { selected });
  return { canvas, artwork, pixels: context.getImageData(0, 0, 438, 438).data };
}

export function auditDepth(backend, painter, { phases = 24 } = {}) {
  const records = [];
  for (const running of [false, true]) for (const requestedView of ['front', 'three-quarter', 'back']) {
    for (let phase = 0; phase < phases; phase++) {
      const at = (2 + phase / phases) * 950, options = intent(at, { running, view: requestedView });
      const layers = Object.fromEntries(['garment-back', 'body-and-roots', 'face', 'garment-front'].map(layer =>
        [layer, renderLayers(backend, painter, options, [layer]).pixels]));
      const whole = renderLayers(backend, painter, options, COMPOSITION);
      const withoutBack = renderLayers(backend, painter, options, COMPOSITION.filter(layer => layer !== 'garment-back'));
      let backPixels = 0, backOccludedByTorso = 0, facePixels = 0, clothFaceOverlap = 0, finalBackPixels = 0, edgePixels = 0;
      for (let i = 3; i < whole.pixels.length; i += 4) {
        if (layers['garment-back'][i] >= 16) {
          backPixels++;
          if (layers['body-and-roots'][i] >= 240) backOccludedByTorso++;
        }
        if (layers.face[i] >= 16) {
          facePixels++;
          if (layers['garment-front'][i] >= 16) clothFaceOverlap++;
        }
        if (whole.pixels.slice(i - 3, i + 1).some((channel, c) => Math.abs(channel - withoutBack.pixels[i - 3 + c]) > 8)) finalBackPixels++;
        const p = (i - 3) / 4, x = p % 438, y = Math.floor(p / 438);
        if ((x < 2 || y < 2 || x >= 436 || y >= 436) && whole.pixels[i] >= 16) edgePixels++;
      }
      records.push({ running, requestedView, actualView: whole.artwork.view, phase: phase / phases,
        runFootTiming: whole.artwork.runFootTiming, ready: whole.artwork.ready, clip: whole.artwork.clip,
        backPixels, backOccludedByTorso, finalBackPixels, facePixels, clothFaceOverlap, edgePixels });
    }
  }
  return { samples: records.length, maxClothFaceOverlap: Math.max(...records.map(r => r.clothFaceOverlap)),
    edgeTouchFrames: records.filter(r => r.edgePixels).length,
    minIdleTorsoOcclusionFraction: Math.min(...records.filter(r => !r.running).map(r => r.backOccludedByTorso / r.backPixels)),
    maxFinalHiddenReturnPixels: Math.max(...records.map(r => r.finalBackPixels)), records };
}

// Record actual production drawImage calls without replacing any painter.
export function traceProductionDraw(harness, at) {
  const context = harness.body.getContext('2d'), original = context.drawImage, calls = [];
  context.drawImage = function(image, ...rect) {
    const m = this.getTransform();
    calls.push({ src: typeof image.src === 'string' ? image.src.split('?')[0] : null,
      rect, matrix: [m.a, m.b, m.c, m.d, m.e, m.f] });
    return original.call(this, image, ...rect);
  };
  try { harness.draw(at); } finally { context.drawImage = original; }
  const scarf = calls.filter(call => call.src?.includes('/wardrobe/scarf-'));
  return { at, calls, scarf };
}
