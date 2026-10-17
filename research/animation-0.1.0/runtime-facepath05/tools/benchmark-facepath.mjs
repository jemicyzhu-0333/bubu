/** Full reviewed face adapter pipeline. No renderer: CPU measurements only. */
import {performance} from 'node:perf_hooks';
import {cpus,platform,arch} from 'node:os';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareFacePack,sha256} from '../src/pack-loader.mjs';
import {preflightFaceGLB} from '../src/art-glb-preflight.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {localPackReader} from './read-local-pack.mjs';
import {SkinnedMesh,REVISION} from 'three';
const root=new URL('../',import.meta.url),out=process.argv[2]??fileURLToPath(new URL('evidence/facepath-cpu.json',root));
async function fingerprint(){const files={};for(const name of (await readdir(new URL('src/',root))).sort())if(name.endsWith('.mjs'))files['src/'+name]=await sha256(await readFile(new URL('src/'+name,root)));for(const name of ['manifest.json','profile.json','asset.glb']){const p='fixtures/face-slice7/'+name;files[p]=await sha256(await readFile(new URL(p,root)));}files['tools/benchmark-facepath.mjs']=await sha256(await readFile(new URL('tools/benchmark-facepath.mjs',root)));return files;}
const before=await fingerprint();let vertexReads=0;const original=SkinnedMesh.prototype.getVertexPosition;SkinnedMesh.prototype.getVertexPosition=function(...args){vertexReads++;return original.apply(this,args);};
const face=(time,id)=>({type:'face',time,id,amount:1,fadeOutSec:.28,fadeInSec:.42});
const cases=[];
try{for(const count of [1,2,4]){
 const iterations=[];
 for(let run=0;run<6;run++){
  const read=localPackReader(fileURLToPath(new URL('fixtures/face-slice7/',root))),bytes=await read('asset.glb',12*1024*1024);
  let t=performance.now();preflightFaceGLB(bytes);const preflightMs=performance.now()-t;
  t=performance.now();const pack=await prepareFacePack(read);const prepareMs=performance.now()-t;
  const pool=new ActorPool({limits:{vertices:250000,deformedVertices:1500000}}),actors=[];
  try{
   t=performance.now();actors.push(await pool.create(pack));const coldCreateMs=performance.now()-t;
   t=performance.now();for(let i=1;i<count;i++)actors.push(await pool.create(pack));const cachedCloneGroupMs=performance.now()-t;
   t=performance.now();for(let i=0;i<10000;i++)for(const a of actors)a.advance(i/10000);const idleAdvanceBatchMs=performance.now()-t;
   t=performance.now();for(let i=0;i<100;i++)for(const a of actors)a.enqueue(face(2+i*.8,i%2?'N3':'04'));const enqueueBatchMs=performance.now()-t;
   const batches=[];let changedGroupCalls=0;
   for(let b=0;b<8;b++){t=performance.now();for(let k=0;k<512;k++){const time=2+(b*512+k)/60;for(const a of actors)if(a.advance(time))changedGroupCalls++;}batches.push((performance.now()-t)/512);}
   const singleCalls=[];for(let k=0;k<128;k++){const time=2+(4096+k)/60;t=performance.now();for(const a of actors)a.advance(time);singleCalls.push(performance.now()-t);}
   t=performance.now();for(const a of actors)a.advance(100);const largeJumpEndGroupMs=performance.now()-t;
   for(const a of actors){a.assertCurrent();if(a.isAnimating()||a.nextDeadline()!==Infinity)throw Error('Unfinished benchmark clock');}
   const verification=actors[0].verification,admission=pool.stats;
   t=performance.now();for(const a of actors)a.dispose();const disposeGroupMs=performance.now()-t;
   const zero=['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'].every(k=>pool.stats[k]===0)&&pool.stats.cache.live===0;if(!zero)throw Error('Outstanding owned counters');
   iterations.push({warmup:run===0,preflightMs,prepareMs,coldCreateMs,cachedCloneGroupMs,idleAdvanceBatchMs,idleCallsPerActor:10000,enqueueBatchMs,queuedEventsPerActor:100,activeGroupBatchMeanMs:batches,activeBatchCalls:512,activeIndividualGroupCallMs:singleCalls,changedActorCalls:changedGroupCalls,largeJumpEndGroupMs,disposeGroupMs,allOwnedCountersZero:zero,verification,admission});
  }finally{actors.forEach(a=>a.dispose());pool.dispose();}
 }
 cases.push({actors:count,iterations});
}}finally{SkinnedMesh.prototype.getVertexPosition=original;}
const after=await fingerprint(),result={scope:'Node CPU real seven-slot shared-source actor pipeline; no WebGL, GPU, FPS, visual or interaction acceptance',environment:{node:process.version,three:REVISION,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},method:{warmupPerCase:1,measuredRuns:5,units:'milliseconds; active batches are per group tick means, individual samples are group call latency',active:'shared body static, eight layers x56 influences; sequential 0.8s cue spacing, all canonical clock events processed',prepare:'read, copy, hash, preflight, profile validation',coldCreate:'GLTF parse, source numeric/material/rest parity and first clone',cachedClone:'only remaining actor clones, zero for actor count1',gc:'No forced GC; cloud noise applies',memory:'source bytes, reserved decoded backing, measured actual backing and theoretical renderer texture estimates are separate; no total heap/VRAM claim'},sourceBefore:before,sourceAfter:after,sourceUnchanged:JSON.stringify(before)===JSON.stringify(after),skinVertexCalls:vertexReads,cases};
await mkdir(new URL('evidence/',root),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,cases:cases.length,sourceUnchanged:result.sourceUnchanged,skinVertexCalls:vertexReads}));
