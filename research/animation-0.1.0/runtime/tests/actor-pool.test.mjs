import test from 'node:test';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ActorPool} from '../src/actor-pool.mjs';
import {preparedAdmission,preparePack,sha256} from '../src/pack-loader.mjs';
import {pack,read} from './helpers.mjs';
const flush=()=>new Promise(r=>setImmediate(r));

test('global actor budget reserves before asynchronous creation and release is idempotent',async()=>{
  const p=await pack(), pool=new ActorPool({limits:{actors:1}});
  const first=pool.create(p);
  assert.equal(pool.stats.actors,1);
  assert.equal(pool.stats.pending,1);
  await assert.rejects(pool.create(p),{code:'GLOBAL_BUDGET'});
  const a=await first;
  assert.equal(pool.stats.cache.loads,2);
  a.dispose();a.dispose();
  assert.equal(pool.stats.actors,0);
  assert.equal(pool.stats.sourceBytes,0);
  const b=await pool.create(p);b.dispose();pool.dispose();
  await assert.rejects(pool.create(p),{code:'DISPOSED'});
});
test('shared sources count once while render work counts for every actor',async()=>{
  const p=await pack(), cost=preparedAdmission(p), bytes=cost.sources.reduce((n,s)=>n+s.bytes,0);
  const pool=new ActorPool({limits:{vertices:cost.vertices*2,sourceBytes:bytes}});
  const [a,b]=await Promise.all([pool.create(p),pool.create(p)]);
  assert.equal(pool.stats.vertices,296);assert.equal(pool.stats.sourceBytes,bytes);
  await assert.rejects(pool.create(p),{code:'GLOBAL_BUDGET'});
  a.dispose();assert.equal(pool.stats.sourceBytes,bytes);
  b.dispose();assert.equal(pool.stats.sourceBytes,0);
  assert.equal(pool.stats.cache.retainedReferences,0);pool.dispose();
});
test('every aggregate complexity limit rejects before acquiring a source',async()=>{
  const p=await pack(), c=preparedAdmission(p);
  for(const key of ['vertices','nodes','deformedVertices']) {
    const pool=new ActorPool({limits:{[key]:c[key]-1}});
    await assert.rejects(pool.create(p),{code:'GLOBAL_BUDGET'});
    assert.equal(pool.stats.cache.loads,0);assert.equal(pool.stats.actors,0);pool.dispose();
  }
  const pool=new ActorPool({limits:{sourceBytes:1}});
  await assert.rejects(pool.create(p),{code:'GLOBAL_BUDGET'});assert.equal(pool.stats.cache.loads,0);pool.dispose();
});
test('prepared accounting and assembly metadata cannot mutate after validation',async()=>{
  const p=await pack();
  assert.throws(()=>p.budget.vertices=0);
  assert.throws(()=>p.manifest.equipment.push({...p.manifest.equipment[0],id:'extra'}));
  assert.throws(()=>p.profile.joints[0].node='Missing');
  assert.throws(()=>p.audits.get('body').document.nodes.push({}));
  assert.equal(p.data.set,undefined);
  const bytes=p.data.get('body'),before=bytes[0];bytes[0]^=255;
  assert.equal(p.data.get('body')[0],before);
  const pool=new ActorPool({limits:{vertices:100}});
  await assert.rejects(pool.create(p),{code:'GLOBAL_BUDGET'});
  await assert.rejects(pool.create({...p}),{code:'BINDING'});
  assert.equal(pool.stats.actors,0);pool.dispose();
});
test('binding failure rolls back actor and source reservations',async()=>{
  const profile=JSON.parse(new TextDecoder().decode(await read('character-profile.json',100000)));
  profile.joints[0].node='MissingBone';
  const bytes=new TextEncoder().encode(JSON.stringify(profile)),hash=await sha256(bytes);
  const p=await preparePack(async(name,max)=>{
    if(name==='character-profile.json')return bytes;
    const b=await read(name,max);
    if(name!=='manifest.json')return b;
    const m=JSON.parse(new TextDecoder().decode(b)),a=m.assets.find(x=>x.kind==='profile');a.bytes=bytes.length;a.sha256=hash;
    return new TextEncoder().encode(JSON.stringify(m));
  });
  const pool=new ActorPool();
  await assert.rejects(pool.create(p),{code:'BINDING'});
  assert.equal(pool.stats.actors,0);assert.equal(pool.stats.sourceBytes,0);
  assert.equal(pool.stats.cache.retainedReferences,0);pool.dispose();
});
test('abort keeps late parse source bytes charged until completion disposes them',async()=>{
  const p=await pack(), pool=new ActorPool(), ac=new AbortController();
  const original=GLTFLoader.prototype.parseAsync;
  let proceed,started;
  const begun=new Promise(r=>started=r);
  GLTFLoader.prototype.parseAsync=function(...args){
    const loader=this;started();
    return new Promise(resolve=>proceed=()=>resolve(original.apply(loader,args)));
  };
  try {
    const creating=pool.create(p,{signal:ac.signal});
    await begun;ac.abort();await assert.rejects(creating);
    assert.equal(pool.stats.actors,0);assert(pool.stats.sourceBytes>0);
    proceed();await flush();await flush();
    assert.equal(pool.stats.sourceBytes,0);assert.equal(pool.stats.cache.live,0);
  } finally {GLTFLoader.prototype.parseAsync=original;pool.dispose();}
});
test('pool disposal cancels pending instances and active actors without resurrection',async()=>{
  const p=await pack(), pool=new ActorPool(), a=await pool.create(p);
  const pending=pool.create(p);pool.dispose();pool.dispose();
  await assert.rejects(pending);await flush();
  assert(a.disposed);assert.equal(pool.stats.actors,0);assert.equal(pool.stats.active,0);
  assert.equal(pool.stats.pending,0);assert.equal(pool.stats.sourceBytes,0);
});
test('global limits are strict and cannot exceed hard ceilings',()=>{
  for(const limits of [{actors:0},{actors:1.5},{actors:33},{sourceBytes:Infinity},{bogus:1}])assert.throws(()=>new ActorPool({limits}));
});
test('reader-owned Buffer mutation after hash cannot change the prepared snapshot',async()=>{
  let readerOwnedBody;
  const p=await preparePack(async(name,max)=>{
    const bytes=Buffer.from(await read(name,max));
    if(name==='mechanical-character.glb')readerOwnedBody=bytes;
    else if(readerOwnedBody)readerOwnedBody[readerOwnedBody.length-1]^=255;
    return bytes;
  });
  const body=p.manifest.assets.find(a=>a.id==='body');
  assert.equal(await sha256(p.data.get('body')),body.sha256);
  const pool=new ActorPool(),actor=await pool.create(p);actor.dispose();pool.dispose();
});
