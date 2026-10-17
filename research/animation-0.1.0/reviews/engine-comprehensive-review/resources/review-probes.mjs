import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ActorPool, POOL_HARD_LIMITS, POOL_DEFAULT_LIMITS} from '../../bubu-runtime-0.1.0-facepath06-20261017/src/actor-pool.mjs';
import {preparePack,prepareFacePack,prepareNeutralPack,preparedAdmission} from '../../bubu-runtime-0.1.0-facepath06-20261017/src/pack-loader.mjs';
import {geometryBackingBytes} from '../../bubu-runtime-0.1.0-facepath06-20261017/src/geometry-accounting.mjs';
import {localPackReader} from '../../bubu-runtime-0.1.0-facepath06-20261017/tools/read-local-pack.mjs';
import {buildWorkload,WORKLOADS} from '../../bubu-runtime-0.1.0-facepath06-20261017/tools/build-workloads.mjs';
import {GLTFLoader} from '../../bubu-runtime-0.1.0-facepath06-20261017/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const runtime=new URL('../../bubu-runtime-0.1.0-facepath06-20261017/',import.meta.url);
const out={scope:'Independent Node-only resource/lifecycle probes. No browser, renderer or GPU.',node:process.version};
const hash=b=>createHash('sha256').update(b).digest('hex');
const encode=o=>new TextEncoder().encode(JSON.stringify(o));
async function fingerprints(){const all={};for(const f of (await readdir(new URL('src/',runtime))).sort())all['src/'+f]=hash(await readFile(new URL('src/'+f,runtime)));return all;}
const before=await fingerprints();
function zero(s){for(const k of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'])assert.equal(s[k],0,k);assert.equal(s.cache.live,0);}
const read=localPackReader(fileURLToPath(new URL('fixtures/',runtime)));
const base=await preparePack(read);
const face=await prepareFacePack(localPackReader(fileURLToPath(new URL('fixtures/face-slice7/',runtime))));
const neutral=await prepareNeutralPack(localPackReader(fileURLToPath(new URL('fixtures/neutral-static05/',runtime))));
const r6=await prepareNeutralPack(localPackReader(fileURLToPath(new URL('fixtures/neutral-r6/',runtime))));
out.capacity=[];
for(const [name,pack] of [['mechanical',base],['face7',face],['neutralStatic05',neutral],['neutralR6',r6]]){
 const cost=preparedAdmission(pack),sourceBytes=cost.sources.reduce((s,a)=>s+a.bytes,0),decodedArrayBytes=cost.sources.reduce((s,a)=>s+a.decodedBytes,0);
 const ceiling=limits=>Object.fromEntries(['actors','vertices','nodes','deformedVertices','clipKeyScalars'].map(k=>[k,k==='actors'?limits.actors:cost[k]?Math.floor(limits[k]/cost[k]):null]));
 out.capacity.push({name,cost,sourceBytes,decodedArrayBytes,defaultSamePackCeilings:ceiling(POOL_DEFAULT_LIMITS),hardSamePackCeilings:ceiling(POOL_HARD_LIMITS)});
}
for(const [label,limits,expected] of [['default',{},2],['allHard',POOL_HARD_LIMITS,11]]){
 const pool=new ActorPool({limits}),actors=[];for(let i=0;i<expected;i++)actors.push(await pool.create(face));
 const admitted=pool.stats;let rejection;try{await pool.create(face);}catch(e){rejection={code:e.code,message:e.message};}
 assert.equal(rejection?.code,'GLOBAL_BUDGET');assert.equal(pool.stats.actors,expected);
 actors.forEach(a=>a.dispose());zero(pool.stats);pool.dispose();
 (out.faceCapacityRuns??=[]).push({label,admitted,rejection,afterDispose:pool.stats});
}
// Bounded adversarial fixture: retain authentic attribute bytes but give each accessor
// its own overlapping whole-BIN bufferView. Only 512 KiB of encoded BIN is used.
const src=await read('mechanical-character.glb',8*1024*1024);
const dv=new DataView(src.buffer,src.byteOffset,src.byteLength),jsonLength=dv.getUint32(12,true);
const doc=JSON.parse(new TextDecoder().decode(src.subarray(20,20+jsonLength)));
const oldBin=src.subarray(28+jsonLength), bin=new Uint8Array(512*1024);bin.set(oldBin);
const originalViews=doc.bufferViews;
doc.bufferViews=doc.accessors.map(a=>{
 const old=originalViews[a.bufferView];a.byteOffset=(old.byteOffset??0)+(a.byteOffset??0);a.bufferView=0;
 return {buffer:0,byteOffset:0,byteLength:bin.length,...(old.byteStride?{byteStride:old.byteStride}:{})};
});
doc.accessors.forEach((a,i)=>a.bufferView=i);doc.buffers[0].byteLength=bin.length;
let jt=JSON.stringify(doc);while(new TextEncoder().encode(jt).length%4)jt+=' ';
const jb=new TextEncoder().encode(jt),gb=new Uint8Array(28+jb.length+bin.length),v=new DataView(gb.buffer);
[0x46546c67,2,gb.length,jb.length,0x4e4f534a].forEach((n,i)=>v.setUint32(i*4,n,true));gb.set(jb,20);v.setUint32(20+jb.length,bin.length,true);v.setUint32(24+jb.length,0x004e4942,true);gb.set(bin,28+jb.length);
const manifest=JSON.parse(new TextDecoder().decode(await read('manifest.json',65536))),asset=manifest.assets.find(a=>a.id==='body');asset.bytes=gb.length;asset.sha256=hash(gb);manifest.budgets.totalBytes=manifest.assets.reduce((s,a)=>s+a.bytes,0);
const attack=await preparePack(async(name,max,signal)=>name==='manifest.json'?encode(manifest):name==='mechanical-character.glb'?gb:read(name,max,signal));
await writeFile(new URL('overlapping-bufferViews.glb',import.meta.url),gb);await writeFile(new URL('overlapping-bufferViews-manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
const native=GLTFLoader.prototype.parseAsync;let observation;
GLTFLoader.prototype.parseAsync=async function(...args){const g=await native.apply(this,args);observation={decodedGeometryBackingBytes:geometryBackingBytes(g.scene)};return g;};
const attackedPool=new ActorPool();let rejection;
try{await attackedPool.create(attack);}catch(e){rejection={code:e.code,message:e.message};}finally{GLTFLoader.prototype.parseAsync=native;}
assert.equal(rejection?.code,'LIMIT');zero(attackedPool.stats);attackedPool.dispose();
const reservation=preparedAdmission(attack).sources.find(a=>a.key===`gltf-0.1.0:${hash(gb)}`).decodedBytes;
out.overlappingBufferViews={encodedGLBBytes:gb.length,bufferViewCount:doc.bufferViews.length,reservedBodyDecodedBytes:reservation,observedBeforeReservationCheck:observation,ratio:observation.decodedGeometryBackingBytes/reservation,rejection,afterFailure:attackedPool.stats};
assert(observation.decodedGeometryBackingBytes>10*reservation);
// Retained disposed mechanical handles remain strong owners of their model buffers.
const workload=WORKLOADS.find(w=>w.id==='combined-large');
await buildWorkload(fileURLToPath(new URL('retention-workload/',import.meta.url)),workload);
const retentionPack=await preparePack(localPackReader(fileURLToPath(new URL('retention-workload/',import.meta.url))));
const rp=new ActorPool(),retained=[];
for(let i=0;i<3;i++){const a=await rp.create(retentionPack);a.dispose();zero(rp.stats);retained.push(a);}
const meshes=retained.map(a=>a.model.getObjectByName('MechanicalGrid'));
out.disposedMechanicalRetention={cycles:retained.length,retainedModelChildren:retained.map(a=>a.model.children.length),reachableGeometryBytesPerHandle:retained.map(a=>geometryBackingBytes(a.model)),distinctGeometryObjects:new Set(meshes.map(m=>m.geometry)).size,distinctPositionBuffers:new Set(meshes.map(m=>m.geometry.attributes.position.array.buffer)).size,pool:rp.stats,scope:'Strong JS reachability through retained disposed actor handles. Does not claim a leak when callers drop the handles; GPU disposal is not tested.'};
assert.equal(out.disposedMechanicalRetention.distinctGeometryObjects,3);rp.dispose();
const after=await fingerprints();out.sourceBefore=before;out.sourceAfter=after;out.reviewedSourceUnchanged=JSON.stringify(before)===JSON.stringify(after);assert(out.reviewedSourceUnchanged);
await writeFile(new URL('probe-results.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({capacity:out.faceCapacityRuns,overlappingBufferViews:out.overlappingBufferViews,disposedMechanicalRetention:out.disposedMechanicalRetention,reviewedSourceUnchanged:out.reviewedSourceUnchanged},null,2));
