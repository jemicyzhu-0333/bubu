/** Real approved neutral packs, full prepare/parse-parity/clone/dispose CPU only. */
import {performance} from 'node:perf_hooks';
import {cpus,platform,arch} from 'node:os';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareNeutralPack,sha256} from '../src/pack-loader.mjs';
import {preflightArtGLB} from '../src/art-glb-preflight.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {localPackReader} from './read-local-pack.mjs';
import {SkinnedMesh,REVISION} from 'three';
const root=new URL('../',import.meta.url),out=process.argv[2]??fileURLToPath(new URL('evidence/neutral-cpu.json',root));
async function fingerprint(){const files={};for(const name of (await readdir(new URL('src/',root))).sort())if(name.endsWith('.mjs'))files['src/'+name]=await sha256(await readFile(new URL('src/'+name,root)));for(const id of ['static05','r6'])for(const name of ['manifest.json','profile.json','asset.glb']){const p='fixtures/neutral-'+id+'/'+name;files[p]=await sha256(await readFile(new URL(p,root)));}files['tools/benchmark-neutral.mjs']=await sha256(await readFile(new URL('tools/benchmark-neutral.mjs',root)));return files;}
const before=await fingerprint();let vertexReads=0;const original=SkinnedMesh.prototype.getVertexPosition;SkinnedMesh.prototype.getVertexPosition=function(...args){vertexReads++;return original.apply(this,args);};
const cases=[];
for(const id of ['static05','r6'])for(const count of [1,4]){
  const iterations=[];
  for(let run=0;run<6;run++){
    const read=localPackReader(fileURLToPath(new URL('fixtures/neutral-'+id+'/',root))),bytes=await read('asset.glb',12*1024*1024);
    let t=performance.now();preflightArtGLB(bytes);const preflightMs=performance.now()-t;
    t=performance.now();const pack=await prepareNeutralPack(read);const prepareMs=performance.now()-t;
    const pool=new ActorPool({limits:{vertices:250000}}),actors=[];
    t=performance.now();actors.push(await pool.create(pack));const coldCreateMs=performance.now()-t;
    t=performance.now();for(let i=1;i<count;i++)actors.push(await pool.create(pack));const cachedCloneGroupMs=performance.now()-t;
    t=performance.now();for(let n=0;n<10000;n++)for(const a of actors)a.advance(n/60);const idleAdvanceBatchMs=performance.now()-t;
    const verification=actors[0].verification,admission=pool.stats;
    t=performance.now();for(const a of actors)a.dispose();const disposeGroupMs=performance.now()-t;
    const zero=['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'].every(k=>pool.stats[k]===0)&&pool.stats.cache.live===0;
    if(!zero)throw Error('Owned counters did not return to zero');
    iterations.push({warmup:run===0,preflightMs,prepareMs,coldCreateMs,cachedCloneGroupMs,idleAdvanceBatchMs,idleAdvanceCalls:10000*count,disposeGroupMs,allOwnedCountersZero:zero,verification,admission});
  }
  cases.push({asset:id,actors:count,iterations});
}
SkinnedMesh.prototype.getVertexPosition=original;
const after=await fingerprint();const result={scope:'Node CPU real neutral assets; no renderer, GPU, FPS, animation, expression sampling or visual approval',environment:{node:process.version,three:REVISION,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},method:{warmupPerCase:1,measuredRuns:5,units:'milliseconds per named operation/group; idleAdvanceBatch is 10000 calls per actor, a static no-op not rendered ticks',gc:'No forced GC; shared cloud noise applies',prepare:'disk read, own snapshot, hash, art preflight, profile binding',coldCreate:'GLTFLoader parse plus all-array/material/rest parity and clone',cachedClone:'remaining actors only; empty group for count=1',decodedAccounting:'reserved geometry backing allowance separate from measured array buffers; excludes runtime JS, per-actor skin matrices, morph texture staging/GPU'},sourceBefore:before,sourceAfter:after,sourceUnchanged:JSON.stringify(before)===JSON.stringify(after),skinVertexCalls:vertexReads,cases};
await mkdir(new URL('evidence/',root),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,cases:cases.length,sourceUnchanged:result.sourceUnchanged,skinVertexCalls:vertexReads}));
