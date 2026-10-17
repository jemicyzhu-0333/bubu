import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {prepareFullFacePack} from '../src/pack-loader.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {geometryBackingBytes,decodedArrayPlan} from '../src/geometry-accounting.mjs';
import {FULL_FACE_SLOT_IDS as ids} from '../src/face-contract.mjs';
import {localPackReader} from './read-local-pack.mjs';
const read=localPackReader(new URL('../fixtures/face-full18/',import.meta.url).pathname),runs=[];
for(let trial=-1;trial<5;trial++){
 let t=performance.now();const pack=await prepareFullFacePack(read),prepareMs=performance.now()-t,pool=new ActorPool({limits:{deformedVertices:1568280}});
 t=performance.now();const a=await pool.create(pack),coldCreateMs=performance.now()-t;
 t=performance.now();const b=await pool.create(pack),cloneMs=performance.now()-t;
 const calls=[];for(let i=0;i<180;i++){const now=i*.031;a.enqueue({type:'face',time:now,id:ids[i%ids.length],amount:1,fadeInSec:.1,fadeOutSec:.1});t=performance.now();a.advance(now+.03);calls.push((performance.now()-t)*1000);a.assertCurrent();b.assertCurrent();}
 calls.sort((a,b)=>a-b);const resident=pool.stats,geometryBytes=geometryBackingBytes(a.root),plan=decodedArrayPlan(pack.manifest.assets[0].bytes,pack.audits.get('body').document);
 t=performance.now();a.dispose();b.dispose();const disposeMs=performance.now()-t;const after=pool.stats;
 if(trial>=0)runs.push({prepareMs,coldCreateMs,cloneMs,disposeMs,tickMicroseconds:{p50:calls[90],p95:calls[171],max:calls.at(-1)},geometryBytes,plan,resident,after});
}
const report={scope:'CPU only; one warmup + five measured runs in shared cloud process; opt-in 2-actor deformation budget; no renderer, GPU, heap-peak, input-latency, or visual certification',packedMorphStagingUnpaddedEstimateBytes:5091*144*32,profile:'full18-opt-in',runs};
await writeFile(new URL('../FULL18-CPU-MEASUREMENTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
