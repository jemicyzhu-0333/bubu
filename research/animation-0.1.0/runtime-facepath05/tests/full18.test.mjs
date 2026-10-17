import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareFullFacePack,prepareFacePack,sha256} from '../src/pack-loader.mjs';
import {preflightFullFaceGLB,preflightFaceGLB} from '../src/art-glb-preflight.mjs';
import {ActorPool,POOL_DEFAULT_LIMITS} from '../src/actor-pool.mjs';
import {bindFacePaths} from '../src/face-binding.mjs';
import {FULL_FACE_SLOT_IDS as ids,FACE_ROSTER} from '../src/face-contract.mjs';
import {APPROVED_FULL_FACE_SOURCE as source,FULL_FACE_PROFILE_SHA256} from '../src/approved-full-face-source.mjs';
import {SOURCE_SHA256,PROFILE_SHA256,validatePolicy} from '../src/director.mjs';
import {decodedArrayPlan,geometryBackingBytes} from '../src/geometry-accounting.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
const reader=localPackReader(new URL('../fixtures/face-full18/',import.meta.url).pathname);
const pack=await prepareFullFacePack(reader);
const policy=()=>({format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:source.sha256,profileSha256:FULL_FACE_PROFILE_SHA256,candidates:ids.map(faceId=>({key:faceId,faceId,amount:1,enterSec:.1,exitSec:.1,holdSec:.2,gapSec:.1}))});
const zero=pool=>{for(const key of ['actors','active','pending','sourceBytes','decodedArrayBytes','deformedVertices'])assert.equal(pool.stats[key],0,key);};
const cue=(time,id,amount=1)=>({type:'face',time,id,amount,fadeInSec:.1,fadeOutSec:.1});
const edited=async f=>{const m=JSON.parse(await readFile(new URL('../fixtures/face-full18/manifest.json',import.meta.url)));f(m);return async(p,...args)=>p==='manifest.json'?new TextEncoder().encode(JSON.stringify(m)):reader(p,...args);};
test('full18 scoped CPU reservation and exact source counts, default slice remains closed',async()=>{
 assert.deepEqual(ids,['R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5']);
 assert.equal(pack.budget.deformedVertices,784140);assert.equal(pack.budget.decodedArrayReservation,38211404);assert.equal(pack.budget.nodes,20);
 const bytes=await reader('asset.glb',20000000);assert.equal(await sha256(bytes),source.sha256);assert.throws(()=>preflightFaceGLB(bytes));await assert.rejects(prepareFacePack(reader));
 const audit=preflightFullFaceGLB(bytes),plan=decodedArrayPlan(bytes.length,audit.document);assert.equal(plan.viewBytes,16389416);assert.equal(plan.denseBytes,4954392);assert.equal(plan.loadedBufferViews,2109);assert.equal(plan.loadedAccessors,2351);
 for(const [key,value] of Object.entries({decodedArrayBytes:38211404,deformedVertices:784140,vertices:51036,nodes:20}))await assert.rejects(prepareFullFacePack(await edited(m=>m.budgets[key]=value-1)),{code:'LIMIT'});
 assert.equal(POOL_DEFAULT_LIMITS.deformedVertices,1000000);
});
test('full18 every 257 intensities/slot on all real layers; immutable geometry and neutral clone',async()=>{
 const pool=new ActorPool({limits:{deformedVertices:1568280}}),a=await pool.create(pack),b=await pool.create(pack),binding=bindFacePaths(a.root,pack.profile);
 const buffers=new Map();a.root.traverse(o=>{if(o.geometry){for(const attrs of [Object.values(o.geometry.attributes),...Object.values(o.geometry.morphAttributes)])for(const v of attrs)buffers.set(v.array,Buffer.from(v.array.buffer.slice(0)));}});
 try{
 assert.equal(geometryBackingBytes(a.root),20999184);assert.equal(pool.stats.cache.loads,1);assert.equal(pool.stats.cache.hits,1);assert.equal(pool.stats.decodedArrayBytes,38211404);
 for(const id of ids)for(const amount of [Number.MIN_VALUE,...Array.from({length:257},(_,i)=>i/256),1-Number.EPSILON]){
  binding.apply(id,amount);binding.assertCurrent(id,amount);b.assertCurrent();
  for(const name of FACE_ROSTER){const m=a.root.getObjectByName(name),n=b.root.getObjectByName(name);assert.equal(m.geometry,n.geometry);assert.notEqual(m.morphTargetInfluences,n.morphTargetInfluences);assert.equal(m.morphTargetInfluences.length,144);const allowed=pack.profile.paths.find(p=>p.id===id).knots.map(k=>m.morphTargetDictionary[k.target]);assert(m.morphTargetInfluences.every((v,i)=>v===0||allowed.includes(i)));assert(m.morphTargetInfluences.filter(v=>v!==0).length<=2);}
 }
 binding.apply(null,0);for(const name of FACE_ROSTER)assert(a.root.getObjectByName(name).morphTargetInfluences.every(x=>x===0));
 for(const [array,bytes] of buffers)assert.deepEqual(Buffer.from(array.buffer),bytes);
 assert.throws(()=>binding.apply('05',1));assert.notDeepEqual(source.paths.T05.targets,source.paths.T5.targets);
 }finally{binding.dispose();a.dispose();b.dispose();zero(pool);}
});
test('full18 default rejects second actor atomically; explicit clone budget shares only source',async()=>{
 const pool=new ActorPool(),a=await pool.create(pack),prior=pool.stats;await assert.rejects(pool.create(pack),{code:'GLOBAL_BUDGET'});assert.deepEqual(pool.stats,prior);a.dispose();zero(pool);
 for(const [key,value] of Object.entries({sourceBytes:16867596,decodedArrayBytes:38211404,deformedVertices:784140,vertices:51036,nodes:20})){const p=new ActorPool({limits:{[key]:value-1}});await assert.rejects(p.create(pack),{code:'GLOBAL_BUDGET'});zero(p);assert.equal(p.stats.cache.loads,0);p.dispose();}
});
test('full18 profile-policy pairing rejects cross capability before admission and preserves IDs',async()=>{
 const p=policy();for(const id of ['05','5','1','Face05','Face05_01']){const bad=structuredClone(p);bad.candidates[0].faceId=id;assert.throws(()=>validatePolicy(bad));}
 const pool=new ActorPool(),slice=await prepareFacePack(localPackReader(new URL('../fixtures/face-slice7/',import.meta.url).pathname));
 assert.throws(()=>pool.createDirected(slice,p),/mismatch/);const old={...p,sourceSha256:SOURCE_SHA256,profileSha256:PROFILE_SHA256,candidates:[{...p.candidates[0],faceId:'R0'}]};assert.throws(()=>pool.createDirected(pack,old),/mismatch/);zero(pool);assert.equal(pool.stats.cache.loads,0);
});
test('full18 interruption all slots and all-layer retirement',async()=>{
 const pool=new ActorPool(),a=await pool.create(pack);try{let t=0;for(const id of [...ids,...ids].reverse()){a.enqueue(cue(t,id));a.advance(t+.037);a.assertCurrent();t+=.037;}a.enqueue({type:'cancel',time:t,fadeOutSec:.1});a.advance(t+1);a.assertCurrent();assert.equal(a.state.path,null);}finally{a.dispose();zero(pool);}
});
