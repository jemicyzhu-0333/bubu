import test from 'node:test';import assert from 'node:assert/strict';import {ShaderLib} from 'three';import {createHash} from 'node:crypto';
import {prepareD2FacePack,prepareFullFacePack} from '../src/pack-loader.mjs';import {localPackReader} from '../tools/read-local-pack.mjs';import {ActorPool} from '../src/actor-pool.mjs';import {FULL_FACE_SLOT_IDS as ids} from '../src/face-contract.mjs';import {N3_CAVITY_MASK,n3CavityGate} from '../src/n3-cavity-mask.mjs';import {D2_MASK_SHA256} from '../src/approved-d2-face-source.mjs';import {geometryBackingBytes} from '../src/geometry-accounting.mjs';
const reader=name=>localPackReader(new URL('../fixtures/'+name+'/',import.meta.url).pathname),pack=await prepareD2FacePack(reader('face-d2'));
const compile=material=>{const shader={vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader,uniforms:{}};material.onBeforeCompile(shader);return shader;};
const gate=m=>compile(m).uniforms.bubuD2CavityGate;
const cue=(time,id,amount=1)=>({type:'face',time,id,amount,fadeInSec:.1,fadeOutSec:.1});
const zero=p=>{for(const k of ['actors','sourceBytes','decodedArrayBytes','deformedVertices','pending','active'])assert.equal(p.stats[k],0,k);};
test('D2 static mask hash, exact black rim, clone reservation and explicit source boundary',async()=>{
 assert.equal(createHash('sha256').update(Buffer.from(new Float32Array(N3_CAVITY_MASK).buffer)).digest('hex'),D2_MASK_SHA256);assert.equal(N3_CAVITY_MASK.filter(x=>x===0).length,64);assert.equal(pack.budget.decodedArrayReservation,40685900);
 await assert.rejects(prepareFullFacePack(reader('face-d2')));await assert.rejects(prepareD2FacePack(reader('face-full18')));
 const pool=new ActorPool({limits:{decodedArrayBytes:40685899}});await assert.rejects(pool.create(pack),{code:'GLOBAL_BUDGET'});assert.equal(pool.stats.cache.loads,0);zero(pool);
});
test('D2 private material/uniform, immutable source geometry and final-lease disposal',async()=>{
 const pool=new ActorPool({limits:{deformedVertices:1568280}}),a=await pool.create(pack),b=await pool.create(pack);let materialDisposals=0,geometryDisposals=0;
 const am=a.root.getObjectByName('A_mouth_ring'),bm=b.root.getObjectByName('A_mouth_ring'),eye=a.root.getObjectByName('A_eye_L'),au=gate(am.material),bu=gate(bm.material),color=eye.material.color.toArray();
 assert.equal(am.geometry,bm.geometry);assert.notEqual(am.material,bm.material);assert.notEqual(am.material,eye.material);assert.notEqual(au,bu);assert.equal(geometryBackingBytes(a.root),21002000);assert.equal(pool.stats.decodedArrayBytes,40685900);assert.equal(pool.stats.cache.loads,1);
 am.material.addEventListener('dispose',()=>materialDisposals++);am.geometry.addEventListener('dispose',()=>geometryDisposals++);
 const before=am.geometry.morphAttributes.position.map(v=>Buffer.from(v.array.buffer.slice(0))),mask=am.geometry.getAttribute('bubuD2CavityMask').array.slice();
 try{let time=0;for(const id of ids)for(const amount of [0,.1,.374999,.375,.375001,.5,.625,.75,.999999,1]){a.enqueue(cue(time,id,amount));time+=1;a.advance(time);a.assertCurrent();b.assertCurrent();assert.equal(au.value,n3CavityGate(id,amount));assert.equal(bu.value,0);assert.deepEqual(eye.material.color.toArray(),color);assert.deepEqual(am.material.color.toArray(),color);}
 for(let i=0;i<before.length;i++)assert.deepEqual(Buffer.from(am.geometry.morphAttributes.position[i].array.buffer),before[i]);assert.deepEqual(am.geometry.getAttribute('bubuD2CavityMask').array,mask);
 a.dispose();assert.equal(materialDisposals,1);assert.equal(geometryDisposals,0);assert.equal(au.value,0);b.enqueue(cue(0,'N3'));b.advance(1);b.assertCurrent();assert.equal(bu.value,1);b.dispose();assert.equal(geometryDisposals,1);assert.equal(bu.value,0);zero(pool);
 }finally{a.dispose();b.dispose();pool.dispose();}
});
test('D2 shader uses pinned chunks and source black plus local additive cavity only',async()=>{
 const pool=new ActorPool(),a=await pool.create(pack);try{const material=a.root.getObjectByName('A_mouth_ring').material,shader=compile(material);assert(shader.vertexShader.includes('vBubuD2CavityMask = bubuD2CavityMask;'));assert(shader.fragmentShader.includes('diffuseColor.rgb += vec3('));assert(shader.fragmentShader.includes('* bubuD2CavityGate * vBubuD2CavityMask;'));assert.throws(()=>material.onBeforeCompile({vertexShader:'invalid',fragmentShader:'invalid',uniforms:{}}),{code:'STYLE_SHADER'});assert.equal(shader.uniforms.bubuD2CavityGate.value,0);assert.equal(material.roughness,.20000000298023224);assert.equal(material.ior,1.2000000476837158);}finally{a.dispose();zero(pool);}
});
test('D2 interrupted N3 withdrawal, cross-face Basis and cancellation continuously gate from actual clock amount',async()=>{
 const pool=new ActorPool(),a=await pool.create(pack),u=gate(a.root.getObjectByName('A_mouth_ring').material);try{a.enqueue(cue(0,'N3'));a.advance(.1);assert.equal(u.value,1);a.enqueue(cue(.1,'T05'));let last=1;for(let i=1;i<=50;i++){a.advance(.1+i*.002);a.assertCurrent();const expected=n3CavityGate(a.state.path,a.state.value);assert.equal(u.value,expected);assert(u.value<=last+1e-12);last=u.value;}a.advance(.5);assert.equal(a.state.path,'T05');assert.equal(u.value,0);a.enqueue(cue(.5,'N3'));a.advance(1);assert.equal(u.value,1);a.enqueue({type:'cancel',time:1,fadeOutSec:.1});a.advance(2);assert.equal(u.value,0);}finally{a.dispose();zero(pool);}
});
test('D2 source never decorates original gold source; their actor geometries/materials remain separate',async()=>{
 const plain=await prepareFullFacePack(reader('face-full18')),pool=new ActorPool({limits:{deformedVertices:1568280,sourceBytes:40000000,decodedArrayBytes:90000000}}),a=await pool.create(pack),b=await pool.create(plain);try{const x=a.root.getObjectByName('A_mouth_ring'),y=b.root.getObjectByName('A_mouth_ring');assert.notEqual(x.geometry,y.geometry);assert.equal(y.geometry.getAttribute('bubuD2CavityMask'),undefined);assert.notEqual(x.material,y.material);a.enqueue(cue(0,'N3'));a.advance(1);b.assertCurrent();assert.equal(geometryBackingBytes(b.root),20999184);}finally{a.dispose();b.dispose();zero(pool);}
});
test('D2 malformed shader patch inside owner draw fails stopped and cleans source and private material',async()=>{
 const {ExpressionOwner}=await import('../src/expression-owner.mjs'),{APPROVED_D2_FACE_SOURCE,D2_FACE_PROFILE_SHA256}=await import('../src/approved-d2-face-source.mjs');
 let frame=null,now=0,o,materialDisposals=0;const scheduler={now:()=>now,requestFrame:fn=>(frame=fn,1),cancelFrame:()=>{frame=null;},setTimer:()=>2,clearTimer:()=>{}};
 const pool=new ActorPool(),policy={format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:APPROVED_D2_FACE_SOURCE.sha256,profileSha256:D2_FACE_PROFILE_SHA256,candidates:[{key:'N3',faceId:'N3',amount:1,enterSec:.1,exitSec:.1,holdSec:.5,gapSec:.1}]};
 o=new ExpressionOwner({pool,pack,policy,visibilityPolicy:'freeze',scheduler,draw:()=>o.root.getObjectByName('A_mouth_ring').material.onBeforeCompile({vertexShader:'wrong pinned shader',fragmentShader:'',uniforms:{}})});await o.ready;o.root.getObjectByName('A_mouth_ring').material.addEventListener('dispose',()=>materialDisposals++);o.wake();const callback=frame;callback();assert.equal(o.status,'faulted');assert.equal(o.root,null);assert.equal(materialDisposals,1);zero(pool);o.dispose();assert.equal(materialDisposals,1);
});
test('D2 and original weighted policies cannot cross source/profile pairs before loading',async()=>{
 const {ADMISSION}=await import('../../expression-scheduler-p1/src/p0-binding.mjs'),{APPROVED_D2_FACE_SOURCE,D2_FACE_PROFILE_SHA256}=await import('../src/approved-d2-face-source.mjs');
 const plain=await prepareFullFacePack(reader('face-full18')),pool=new ActorPool(),policy={format:'bubu-expression-scheduler',version:'0.1.0-p1',sourceSha256:ADMISSION.sourceSha256,profileSha256:ADMISSION.profileSha256,rng:{algorithm:'xorshift32-split-v1',seed:42},candidates:[{key:'N3',faceId:'N3',amount:1,selectionWeight:1,enterSec:.1,exitSec:.1,hold:{kind:'fixed',sec:.2},gap:{kind:'fixed',sec:.2},cooldownSec:0,sources:['test']}],contexts:[{key:'test',candidates:['N3'],excludeRecent:0}]},initialFacts={context:'test',source:'test',enabled:true,interactionOwned:false};
 assert.throws(()=>pool.createWeighted(pack,policy,{initialFacts}),/mismatch/);const d2={...policy,sourceSha256:APPROVED_D2_FACE_SOURCE.sha256,profileSha256:D2_FACE_PROFILE_SHA256};assert.throws(()=>pool.createWeighted(plain,d2,{initialFacts}),/mismatch/);assert.equal(pool.stats.cache.loads,0);zero(pool);
});
