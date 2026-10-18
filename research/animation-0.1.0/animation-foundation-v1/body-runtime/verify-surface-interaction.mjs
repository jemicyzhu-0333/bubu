import {fixture} from './fixture.mjs';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const f=await fixture(),times=[],slow=[];
try{
 const point=f.point();f.emit('pointerdown',.01,point);f.tick(.01);f.tick(.7);assert.equal(f.h.state.mode,'petting');
 for(let i=1;i<=180;i++){
  const t=.7+i/60,p={...point,clientX:point.clientX+Math.sin(i*.2),clientY:point.clientY+Math.cos(i*.2)};
  f.emit('pointermove',t,p);const start=performance.now();f.tick(t);const ms=performance.now()-start;times.push(ms);if(ms>16.667)slow.push({frame:i,ms});assert.equal(f.h.state.mode,'petting');
 }
 times.sort((a,b)=>a-b);
 const report={scope:'CPU-only actual longpress with continuous sub-drag-threshold pointer movement; not GPU',samples:times.length,p50:times[90],p95:times[171],max:times.at(-1),over16ms:slow.length,surface:{...f.h.diagnostics.surface}};
 fs.writeFileSync(new URL('./surface-interaction-evidence.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
}finally{f.h.dispose()}
