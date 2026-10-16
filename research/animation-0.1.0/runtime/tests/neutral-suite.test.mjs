import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNeutralPack,sha256,preparedAdmission} from '../src/pack-loader.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
import {DemandLoop} from '../src/demand-loop.mjs';
import {pack as mechanicalPack} from './helpers.mjs';
const reader=id=>localPackReader(new URL('../fixtures/neutral-'+id+'/',import.meta.url).pathname);
const load=id=>prepareNeutralPack(reader(id));
const zero=pool=>{for(const k of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'])assert.equal(pool.stats[k],0,k);assert.equal(pool.stats.cache.live,0);};
const edit=async(id,change)=>{
  const read=reader(id),m=JSON.parse(new TextDecoder().decode(await read('manifest.json',65536)));
  const profile=JSON.parse(new TextDecoder().decode(await read('profile.json',131072)));
  change(m,profile);
  const pb=new TextEncoder().encode(JSON.stringify(profile));
  const pa=m.assets.find(a=>a.kind==='profile');pa.bytes=pb.length;pa.sha256=await sha256(pb);
  const mb=new TextEncoder().encode(JSON.stringify(m));
  return (path,max,signal)=>path==='manifest.json'?mb:path==='profile.json'?pb:read(path,max,signal);
};
for(const id of ['static05','r6'])test('real hash-locked '+id+' loads exact rest, geometry and materials without motion API',async()=>{
  const p=await load(id),pool=new ActorPool(),a=await pool.create(p);
  try {
    assert.equal(a.assertNeutral(),true);assert.equal(a.enqueue,undefined);assert.equal(a.play,undefined);assert.equal(a.face,undefined);
    assert.equal(a.advance(1e9),false);assert.equal(a.isAnimating(),false);assert.equal(a.nextDeadline(),Infinity);
    assert.equal(a.verification.webglVerified,false);
    assert.equal(a.verification.decodedArrayBytes,id==='r6'?8044044:2337048);
    assert.equal(a.verification.normalizedSkinScalars,id==='r6'?25:0);
    assert(a.verification.maxWeightDelta<=5.961e-8);
    assert.equal(a.readiness.engine,'neutral-load-only');
    a.root.traverse(o=>{for(const value of o.morphTargetInfluences??[])assert.equal(value,0);});
  } finally {a.dispose();a.dispose();zero(pool);}
  assert.throws(()=>a.advance(0),{code:'DISPOSED'});
});
test('neutral source geometry is shared, actor skeletons and morph arrays are isolated',async()=>{
  const p=await load('r6'),pool=new ActorPool(),[a,b]=await Promise.all([pool.create(p),pool.create(p)]);
  try {
    const am=a.root.getObjectByName('A_eye_L'),bm=b.root.getObjectByName('A_eye_L');
    assert.equal(am.geometry,bm.geometry);assert.notEqual(am.skeleton,bm.skeleton);assert.notEqual(am.morphTargetInfluences,bm.morphTargetInfluences);
    assert.equal(pool.stats.cache.loads,1);assert.equal(pool.stats.sourceBytes,8155940);
    assert.equal(pool.stats.decodedArrayBytes,p.budget.decodedArrayReservation);
    am.morphTargetInfluences[0]=.1;
    assert.throws(()=>a.assertNeutral(),{code:'NEUTRAL_ONLY'});assert.equal(b.assertNeutral(),true);
    am.morphTargetInfluences[0]=0;a.dispose();assert.equal(b.assertNeutral(),true);
  } finally {a.dispose();b.dispose();zero(pool);}
});
test('one application budget includes pending/active mechanical and neutral actors',async()=>{
  const [p,m]=await Promise.all([load('r6'),mechanicalPack()]);
  const pool=new ActorPool({limits:{actors:1}}),pending=pool.create(p);
  assert.equal(pool.stats.pending,1);assert.equal(pool.stats.actors,1);
  await assert.rejects(pool.create(m),{code:'GLOBAL_BUDGET'});
  const actor=await pending;actor.dispose();const mech=await pool.create(m);mech.dispose();zero(pool);
});
test('decoded reservation is enforced before async parse and shared by source identity',async()=>{
  const p=await load('r6'),cost=preparedAdmission(p).sources[0].decodedBytes;
  assert.equal(cost,16200432);
  const denied=new ActorPool({limits:{decodedArrayBytes:cost-1}});
  await assert.rejects(denied.create(p),{code:'GLOBAL_BUDGET'});assert.equal(denied.stats.cache.loads,0);zero(denied);
  const pool=new ActorPool({limits:{decodedArrayBytes:cost}});
  const a=await pool.create(p),b=await pool.create(p);assert.equal(pool.stats.decodedArrayBytes,cost);
  a.dispose();assert.equal(pool.stats.decodedArrayBytes,cost);b.dispose();zero(pool);
});
test('neutral cancellation/late parse keeps reservation until cleanup',async()=>{
  const p=await load('r6'),pool=new ActorPool(),c=new AbortController();
  const pending=pool.create(p,{signal:c.signal});c.abort(new Error('test cancellation'));
  await assert.rejects(pending,/test cancellation/);
  for(let i=0;i<20&&pool.stats.sourceBytes;i++)await new Promise(r=>setTimeout(r,5));
  zero(pool);pool.dispose();await assert.rejects(pool.create(p),{code:'DISPOSED'});
});
test('prepared neutral metadata and copy-on-read source cannot mutate admission',async()=>{
  const p=await load('r6');assert.throws(()=>p.manifest.budgets.vertices=1);assert.throws(()=>p.profile.faces.pop());
  const bytes=p.data.get('body');bytes.fill(0);
  const pool=new ActorPool(),a=await pool.create(p);assert.equal(a.assertNeutral(),true);a.dispose();zero(pool);
});
test('approved hash cannot be replaced by arbitrary assets or self-approved profile',async()=>{
  const r=await edit('r6',m=>m.assets[0].sha256='0'.repeat(64));
  await assert.rejects(prepareNeutralPack(r),{code:'UNAPPROVED_ASSET'});
  const r2=await edit('r6',(_,p)=>p.readiness.engine='expression-single-path');
  await assert.rejects(prepareNeutralPack(r2),{code:'UNSUPPORTED'});
});
test('neutral profile rejects omitted face, synthetic knee and wrong static/skin role',async()=>{
  for(const change of [(_,p)=>p.faces.pop(),(_,p)=>p.joints.knee='Hip_L',(_,p)=>p.rig='static'])await assert.rejects(prepareNeutralPack(await edit('r6',change)));
});
test('neutral manifest rejects motion, equipment and budget escalation',async()=>{
  for(const change of [m=>m.motion='foo',m=>m.equipment=[],m=>m.budgets.vertices=100000])await assert.rejects(prepareNeutralPack(await edit('r6',change)));
  await assert.rejects(prepareNeutralPack(await edit('r6',m=>m.budgets.decodedArrayBytes=8000000)),{code:'LIMIT'});
});
test('real static actor demand scheduler draws on explicit wake and stays idle',async()=>{
  const p=await load('static05'),pool=new ActorPool(),actor=await pool.create(p);
  let callback=null,requests=0,draws=0;
  const loop=new DemandLoop({runtime:actor,draw:()=>draws++,now:()=>1,requestFrame:fn=>(callback=fn,++requests),cancelFrame:()=>{callback=null;},setTimer:()=>assert.fail('No neutral timers'),clearTimer:()=>{}});
  loop.invalidate();callback();assert.equal(draws,1);assert.equal(loop.frame,null);assert.equal(requests,1);
  loop.invalidate();callback();assert.equal(draws,2);assert.equal(requests,2);
  loop.dispose();actor.dispose();zero(pool);
});
test('source checker requires material vertex colors, not merely a COLOR_0 array',async()=>{
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {preflightArtGLB}=await import('../src/art-glb-preflight.mjs');
  const {verifyNeutralSource}=await import('../src/neutral-source-check.mjs');
  const bytes=Uint8Array.from(await reader('static05')('asset.glb',12*1024*1024)),audit=preflightArtGLB(bytes);
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer,'');
  try {
    assert.equal(gltf.scene.getObjectByName('A_mochi_skin').material.vertexColors,true);
    gltf.scene.getObjectByName('A_mochi_skin').material.vertexColors=false;
    assert.throws(()=>verifyNeutralSource(bytes,audit,gltf,16*1024*1024),{code:'SOURCE_PARITY'});
  } finally {
    const geometries=new Set(),materials=new Set();gltf.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
});
