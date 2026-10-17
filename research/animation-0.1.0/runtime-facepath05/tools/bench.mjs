import {
  performance
}
from 'node:perf_hooks';
import {
  mkdir, writeFile
}
from 'node:fs/promises';
import {
  SkinnedMesh
}
from 'three';
import {
  preparePack
}
from '../src/pack-loader.mjs';
import {
  createSuite
}
from '../src/suite.mjs';
import {
  ResourceCache
}
from '../src/resource-cache.mjs';
import {
  localPackReader
}
from './read-local-pack.mjs';
const p=await preparePack(localPackReader(new URL('../fixtures/', import.meta.url).pathname)), cache=new ResourceCache(), s=await createSuite(p, cache);
let reads=0;
const original=SkinnedMesh.prototype.getVertexPosition;
SkinnedMesh.prototype.getVertexPosition=function(...a) {
  reads++;
  return original.apply(this, a);
};
let t=0;
for(let i=0;
i<2000;
i++) {
  if(i%60===0)s.enqueue({
    time:t, type:'play', segment:i%120?'raise':'turn'
  });
  s.advance(t);
  t+=1/240;
}
const batches=[];
reads=0;
for(let b=0;
b<20;
b++) {
  const start=performance.now();
  for(let i=0;
  i<2000;
  i++) {
    if(i%60===0)s.enqueue({
      time:t, type:'play', segment:i%120?'raise':'turn'
    });
    s.advance(t);
    t+=1/240;
  }
  batches.push((performance.now()-start)/2000);
}
SkinnedMesh.prototype.getVertexPosition=original;
batches.sort((a, b)=>a-b);
s.dispose();
const result= {
  scope:'CPU mechanical fixture only; includes canonical sampling, quaternion writes, face mapping and matrix updates; no WebGL draw or browser input', node:process.version, fixture:p.budget, measuredTicks:40000, millisecondsPerTickBatchMean: {
    median:batches[10], p95:batches[18], max:batches[19]
  }, normalTickSkinnedVertexReads:reads, allocationClaim:'No full vertex scans; channel arrays/maps/quaternion scratch preallocated. JS heap/GC allocations not proven zero.', cacheAfterDispose:cache.stats
};
await mkdir(new URL('../evidence/', import.meta.url), {
  recursive:true
});
await writeFile(new URL('../evidence/cpu-benchmark.json', import.meta.url), JSON.stringify(result, null, 2)+'\n');
console.log(result);
