import { createHash } from 'node:crypto';
import { pixels, difference } from '../usagi-gallery/pixels.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const faceCall = call => /\/(eye[^/]*|mouth[^/]*)\.png$/.test(call.src || '');
export const clothCall = call => /\/wardrobe\/scarf-.*visible-cloth\.png$/.test(call.src || '');

export function traceFrame(driver, at) {
  const context = driver.body.getContext('2d'), original = context.drawImage, calls = [];
  context.drawImage = function(image, ...rect) {
    const m = this.getTransform();
    calls.push({ image, src: typeof image.src === 'string' ? image.src.split('?')[0] : null,
      rect, matrix: [m.a, m.b, m.c, m.d, m.e, m.f], alpha: this.globalAlpha,
      smoothing: this.imageSmoothingEnabled });
    return original.call(this, image, ...rect);
  };
  let result;
  try { result = driver.draw(at); } finally { context.drawImage = original; }
  return { result, calls };
}

export function makeOverlapMeasure(backend, width, height) {
  const canvases = [backend.createCanvas(width, height), backend.createCanvas(width, height)];
  return {
    sample(calls) {
      const masks = [faceCall, clothCall].map((predicate, index) => {
        const context = canvases[index].getContext('2d');
        context.resetTransform(); context.clearRect(0, 0, width, height);
        for (const call of calls.filter(predicate)) {
          context.setTransform(...call.matrix); context.globalAlpha = call.alpha;
          context.imageSmoothingEnabled = call.smoothing; context.drawImage(call.image, ...call.rect);
        }
        return context.getImageData(0, 0, width, height).data;
      });
      let overlap = 0, face = 0, cloth = 0;
      for (let i = 3; i < masks[0].length; i += 4) {
        const f = masks[0][i] >= 16, c = masks[1][i] >= 16;
        face += f; cloth += c; overlap += f && c;
      }
      return { facePixels: face, clothPixels: cloth, faceClothOverlap: overlap };
    },
    dispose() { for (const canvas of canvases) { canvas.width = 1; canvas.height = 1; } }
  };
}

export function makeFrameMetrics() {
  let previous = null, previousCenter = null;
  return (driver, trace, at) => {
    const sampled = pixels(driver.body), body = trace.calls.find(call => !call.src);
    if (!body) throw Error(`No production body draw at ${at}`);
    const m = body.matrix;
    const bodyCenter = [(m[0] * 33 + m[2] * 33 + m[4]) / 2, (m[1] * 33 + m[3] * 33 + m[5]) / 2];
    const scarf = trace.calls.filter(call => /\/wardrobe\/scarf-/.test(call.src || ''));
    const record = { at, phase: trace.result.phase.label, expression: driver.state.currentExprId,
      expressionStart: driver.state.exprStartAnimNow, channel: driver.state.renderChannel,
      hash: sampled.hash, occupied: sampled.occupied, edge: sampled.edge, bounds: sampled.bounds,
      bodyCenter, bodyMatrix: m, bodyCenterStepCss: previousCenter ? Math.hypot(...bodyCenter.map((v, i) => v - previousCenter[i])) : 0,
      difference: difference(previous?.image, sampled.image),
      eyeMask: driver.state.currentRenderedEyeMask,
      eyeSprites: trace.calls.filter(faceCall).map(call => call.src.split('/').at(-1)),
      scarfLayers: scarf.length,
      maxScarfBodyMatrixDifference: Math.max(0, ...scarf.flatMap(call => call.matrix.map((v, i) => Math.abs(v - m[i])))) };
    previous = sampled; previousCenter = bodyCenter;
    return record;
  };
}

export function summarizeCase(key, records, transitions, diagnostic) {
  const phaseIds = [...new Set(records.map(record => record.phase))];
  return { key, frames: records.length, retainedChannel: new Set(records.map(record => record.channel)).size === 1,
    transitions, blankFrames: records.filter(record => !record.occupied).length,
    clippedFrames: records.filter(record => record.edge).length,
    maxScarfBodyMatrixDifference: Math.max(...records.map(record => record.maxScarfBodyMatrixDifference)),
    maxFaceClothOverlap: Math.max(0, ...diagnostic.map(record => record.faceClothOverlap)),
    phases: phaseIds.map(phase => {
      const rows = records.filter(record => record.phase === phase);
      return { phase, frames: rows.length, uniqueFrames: new Set(rows.map(record => record.hash)).size,
        eyeMasks: [...new Set(rows.map(record => record.eyeMask))],
        closedFrames: rows.filter(record => record.eyeMask === 'closed').length,
        minScarfLayers: Math.min(...rows.map(record => record.scarfLayers)),
        maxScarfLayers: Math.max(...rows.map(record => record.scarfLayers)),
        maxBodyCenterStepCss: Math.max(...rows.map(record => record.bodyCenterStepCss)) };
    }), diagnostic };
}
