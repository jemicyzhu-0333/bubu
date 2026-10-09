import { pixels } from '../usagi-gallery/pixels.mjs';
import { faceCall } from '../dango-state-cycle-preview/metrics.mjs';
export const wardrobeCall = call => /\/wardrobe\/(scarf|sunhat|sprout)-/.test(call.src || '');
export const frontCall = call => /\/scarf-.*visible-cloth\.png$/.test(call.src || '');
export const headCall = call => /\/wardrobe\/(sunhat|sprout)-/.test(call.src || '');
export const footCall = call => /\/(attached-run-)?foot-(left|right)(-fill)?\.png$/.test(call.src || '');
export function replay(context, calls) {
  context.resetTransform();context.clearRect(0,0,438,438);
  for (const c of calls) {context.setTransform(...c.matrix);context.globalAlpha=c.alpha;
    context.imageSmoothingEnabled=c.smoothing;context.drawImage(c.image,...c.rect);}
}
export function makeMetrics(backend) {
  const masks=Array.from({length:5},()=>backend.createCanvas(438,438));
  function measure(trace, body, at, key, diagnostic=false) {
    const calls=trace.calls, bodyIndex=calls.findIndex(c=>!c.src), root=calls[bodyIndex];
    const wardrobe=calls.filter(wardrobeCall), front=calls.filter(frontCall), head=calls.filter(headCall);
    const face=calls.filter(faceCall), sampled=pixels(body);
    const row={at,key,occupied:sampled.occupied,edge:sampled.edge,bounds:sampled.bounds,hash:sampled.hash,
      wardrobeLayers:wardrobe.length,headLayers:head.length,scarfLayers:wardrobe.length-head.length,
      maxRootMatrixDifference:Math.max(0,...wardrobe.flatMap(c=>c.matrix.map((v,i)=>Math.abs(v-root.matrix[i])))),
      layerOrderCorrect:wardrobe.every(c=>frontCall(c)?calls.indexOf(c)>bodyIndex&&face.every(f=>calls.indexOf(f)<calls.indexOf(c)):calls.indexOf(c)<bodyIndex),
      observedView:wardrobe[0]?.src.match(/\/scarf-(.+)-(hidden-return|visible-cloth)\.png$/)?.[1],
      eyeSprites:face.map(c=>c.src.split('/').at(-1)),bodyMatrix:root.matrix};
    if(diagnostic) {
      const groups=[face,front,head,[root],calls.filter(footCall)];
      const data=groups.map((g,i)=>{replay(masks[i].getContext('2d'),g);return masks[i].getContext('2d').getImageData(0,0,438,438).data;});
      let faceFrontOverlap=0,faceHeadOverlap=0,headPixels=0,visibleHeadPixels=0,headFootOverlap=0;
      let headBottom=-1,footTop=438;
      for(let i=3;i<data[0].length;i+=4) {
        const a=data.map(d=>d[i]>=16),y=Math.floor((i-3)/4/438);
        faceFrontOverlap+=a[0]&&a[1];faceHeadOverlap+=a[0]&&a[2];headFootOverlap+=a[2]&&a[4];
        headPixels+=a[2];visibleHeadPixels+=a[2]&&data[3][i]<240;
        if(a[2])headBottom=Math.max(headBottom,y);if(a[4])footTop=Math.min(footTop,y);
      }
      Object.assign(row,{faceFrontOverlap,faceHeadOverlap,headPixels,visibleHeadPixels,headFootOverlap,
        headFootVerticalGapCss:(footTop-headBottom-1)/2});
    }
    return row;
  }
  return {measure,dispose(){for(const c of masks){c.width=1;c.height=1;}}};
}
export function summarize(rows) {
 return {frames:rows.length,blankFrames:rows.filter(r=>!r.occupied).length,edgeFrames:rows.filter(r=>r.edge).length,
  incompleteGroups:rows.filter(r=>r.wardrobeLayers!==4||r.headLayers!==2||r.scarfLayers!==2).length,
  layerOrderFailures:rows.filter(r=>!r.layerOrderCorrect).length,
  maxRootMatrixDifference:Math.max(0,...rows.map(r=>r.maxRootMatrixDifference)),
  diagnosticSamples:rows.filter(r=>r.headPixels!==undefined).length,
  maxFaceFrontOverlap:Math.max(0,...rows.map(r=>r.faceFrontOverlap||0)),
  maxFaceHeadOverlap:Math.max(0,...rows.map(r=>r.faceHeadOverlap||0)),
  maxHeadFootOverlap:Math.max(0,...rows.map(r=>r.headFootOverlap||0)),
  minVisibleHeadPixels:Math.min(...rows.filter(r=>r.headPixels!==undefined).map(r=>r.visibleHeadPixels)),
  minHeadFootVerticalGapCss:Math.min(...rows.filter(r=>r.headPixels!==undefined).map(r=>r.headFootVerticalGapCss)),
  observedViews:[...new Set(rows.map(r=>r.observedView))]};
}
