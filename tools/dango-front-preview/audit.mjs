import { makeMetrics, replay, frontCall, headCall, wardrobeCall } from '../dango-wardrobe-preview/metrics.mjs';
import { faceCall } from '../dango-state-cycle-preview/metrics.mjs';

export function makeFrontAudit(backend, outfit) {
  const metrics = makeMetrics(backend);
  const canvases = Array.from({ length: 6 }, () => backend.createCanvas(438, 438));
  function measure(trace, driver, at, diagnostic) {
    const row = metrics.measure(trace, driver.body, at, outfit.key, diagnostic);
    const calls = trace.calls, eyes = calls.filter(c => /\/eye[^/]*\.png$/.test(c.src || ''));
    const mouths = calls.filter(c => /\/mouth[^/]*\.png$/.test(c.src || ''));
    Object.assign(row, { phase: trace.result.phase.label, expression: driver.state.currentExprId,
      eyeMask: driver.state.currentRenderedEyeMask, channel: driver.state.renderChannel,
      expressionStart: driver.state.exprStartAnimNow, eyeCount: eyes.length, mouthCount: mouths.length });
    const expectedLayers = outfit.key === 'bare' ? 0 : 4;
    row.incompleteGroup = row.wardrobeLayers !== expectedLayers;
    if (diagnostic) {
      const root = calls.find(c => !c.src);
      const returns = calls.filter(c => /hidden-return\.png$/.test(c.src || ''));
      const headRoots = calls.filter(c => /hidden-root\.png$/.test(c.src || ''));
      const groups = [[eyes[0]], [eyes[1]], [root], returns, headRoots,
        calls.filter(c => !wardrobeCall(c) || !/hidden-return\.png$/.test(c.src || ''))];
      const data = groups.map((g, i) => {
        replay(canvases[i].getContext('2d'), g.filter(Boolean));
        return canvases[i].getContext('2d').getImageData(0, 0, 438, 438).data;
      });
      const heights = [0, 1].map(k => {
        let top = 438, bottom = -1;
        for (let i = 3; i < data[k].length; i += 4) if (data[k][i] >= 16) {
          const y = Math.floor((i - 3) / 4 / 438);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return bottom - top + 1;
      });
      let returnPixels = 0, returnHidden = 0, rootPixels = 0, rootHidden = 0;
      for (let i = 3; i < data[0].length; i += 4) {
        if (data[3][i] >= 16) { returnPixels++; returnHidden += data[2][i] >= 240; }
        if (data[4][i] >= 16) { rootPixels++; rootHidden += data[2][i] >= 240; }
      }
      Object.assign(row, { eyeHeights: heights, eyeHeightRatio: heights[0] / heights[1],
        returnPixels, returnHidden, headRootPixels: rootPixels, headRootHidden: rootHidden });
    }
    if (!row.occupied || row.edge || row.incompleteGroup || !row.layerOrderCorrect
      || row.maxRootMatrixDifference > .00001 || row.faceFrontOverlap || row.faceHeadOverlap
      || row.headFootOverlap || row.eyeCount !== 2 || row.mouthCount !== 1) {
      throw Error(`Front sample failed: ${JSON.stringify(row)}`);
    }
    return row;
  }
  return { measure, dispose() { metrics.dispose(); for (const c of canvases) { c.width = 1; c.height = 1; } } };
}
export function summarize(rows) {
  const diagnostics = rows.filter(row => row.eyeHeights);
  return {
    frames: rows.length, diagnosticSamples: diagnostics.length,
    retainedChannel: new Set(rows.map(row => row.channel)).size === 1,
    blankFrames: rows.filter(row => !row.occupied).length,
    clippedFrames: rows.filter(row => row.edge).length,
    incompleteGroups: rows.filter(row => row.incompleteGroup).length,
    faceCountFailures: rows.filter(row => row.eyeCount !== 2 || row.mouthCount !== 1).length,
    layerOrderFailures: rows.filter(row => !row.layerOrderCorrect).length,
    maxRootMatrixDifference: Math.max(0, ...rows.map(row => row.maxRootMatrixDifference)),
    maxFaceFrontOverlap: Math.max(0, ...diagnostics.map(row => row.faceFrontOverlap)),
    maxFaceHeadOverlap: Math.max(0, ...diagnostics.map(row => row.faceHeadOverlap)),
    maxHeadFootOverlap: Math.max(0, ...diagnostics.map(row => row.headFootOverlap)),
    minHiddenReturnFraction: Math.min(1, ...diagnostics.filter(row => row.returnPixels).map(row => row.returnHidden / row.returnPixels)),
    minHiddenHeadRootFraction: Math.min(1, ...diagnostics.filter(row => row.headRootPixels).map(row => row.headRootHidden / row.headRootPixels)),
    minEyeHeightRatio: Math.min(...diagnostics.map(row => row.eyeHeightRatio)),
    maxEyeHeightRatio: Math.max(...diagnostics.map(row => row.eyeHeightRatio)),
    phases: [...new Set(rows.map(row => row.phase))].map(phase => {
      const selected = rows.filter(row => row.phase === phase);
      return { phase, frames: selected.length, eyeMasks: [...new Set(selected.map(row => row.eyeMask))],
        closedFrames: selected.filter(row => row.eyeMask === 'closed').length,
        uniqueFrames: new Set(selected.map(row => row.hash)).size };
    })
  };
}
