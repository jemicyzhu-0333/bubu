import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFacePack,prepareNeutralPack,preparedAdmission,sha256} from '../src/pack-loader.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
import {FACE_ROSTER,FACE_SLOT_IDS} from '../src/face-contract.mjs';
import {preflightFaceGLB,preflightArtGLB} from '../src/art-glb-preflight.mjs';
import {SkinnedMesh} from 'three';
import {readFile} from 'node:fs/promises';
import {bindFacePaths} from '../src/face-binding.mjs';
const reader=()=>localPackReader(new URL('../fixtures/face-slice7/',import.meta.url).pathname);
const load=()=>prepareFacePack(reader());
const zero=pool=>{for(const k of ['actors','vertices','nodes','deformedVertices','sourceBytes','decodedArrayBytes','clipKeyScalars','active','pending'])assert.equal(pool.stats[k],0,k);assert.equal(pool.stats.cache.live,0);};
async function edited(change){const read=reader(),m=JSON.parse(new TextDecoder().decode(await read('manifest.json',65536))),p=JSON.parse(new TextDecoder().decode(await read('profile.json',131072)));change(m,p);const pb=new TextEncoder().encode(JSON.stringify(p)),a=m.assets.find(a=>a.kind==='profile');a.bytes=pb.length;a.sha256=await sha256(pb);const mb=new TextEncoder().encode(JSON.stringify(m));return(path,max,signal)=>path==='manifest.json'?mb:path==='profile.json'?pb:read(path,max,signal);}
const cue=(time,id,amount=1)=>({type:'face',time,id,amount,fadeOutSec:.2,fadeInSec:.4});
test('reviewed seven-slot source starts at original Basis, complete numeric parity, no body/interaction API',async()=>{
 const p=await load(),pool=new ActorPool(),a=await pool.create(p);
 try{assert.equal(a.assertCurrent(),true);assert.equal(a.state.path,null);assert.equal(a.state.value,0);assert.equal(p.profile.semanticDefault,'R0');assert.equal(a.play,undefined);assert.equal(a.setPose,undefined);assert.equal(a.drag,undefined);assert.equal(a.verification.webglVerified,false);assert.equal(a.verification.normalizedSkinScalars,25);assert.equal(p.budget.vertices,51036);assert.equal(p.budget.deformedVertices,336132);assert.equal(p.profile.faceMeshes.length,8);assert.equal(a.advance(0),false);assert.equal(a.isAnimating(),false);assert.equal(a.nextDeadline(),Infinity);}finally{a.dispose();zero(pool);}
});
test('every real slot/knot/interior clears unrelated brows, tongue and all other semantics',async()=>{
 const p=await load(),pool=new ActorPool(),a=await pool.create(p);let t=0;
 try{for(const id of FACE_SLOT_IDS)for(const amount of [0,.001,.125,.1875,.5,.625,.875,1]){a.enqueue(cue(t,id,amount));t+=1;a.advance(t);assert.equal(a.assertCurrent(),true);for(const name of FACE_ROSTER){const mesh=a.root.getObjectByName(name),active=mesh.morphTargetInfluences.map((value,index)=>({value,index})).filter(x=>x.value!==0);assert(active.length<=2);const allowed=p.profile.paths.find(x=>x.id===id).knots.map(k=>mesh.morphTargetDictionary[k.target]);assert(active.every(x=>allowed.includes(x.index)));}}}finally{a.dispose();zero(pool);}
});
test('all 1799 model-authored mapping fixtures agree on the actual eight-layer geometry',async()=>{
 const fixtures=JSON.parse(await readFile(new URL('../fixtures/face-slice7/mapping-fixtures.json',import.meta.url),'utf8'));
 assert.equal(fixtures.subsetSampleCount,1799);const p=await load(),pool=new ActorPool(),a=await pool.create(p),binding=bindFacePaths(a.root,p.profile);
 try{for(const f of fixtures.fixtures){binding.apply(f.state,f.intensity);for(const name of FACE_ROSTER){const mesh=a.root.getObjectByName(name);for(const [target,index]of Object.entries(mesh.morphTargetDictionary))assert.equal(mesh.morphTargetInfluences[index],f.nonzero[target]??0);}}binding.apply(null,0);a.assertCurrent();}finally{binding.dispose();a.dispose();zero(pool);}
});
test('face actors share immutable source geometry but keep weights, skeletons and clocks isolated',async()=>{
 const p=await load(),pool=new ActorPool(),[a,b]=await Promise.all([pool.create(p),pool.create(p)]);
 try{const am=a.root.getObjectByName('A_eye_L'),bm=b.root.getObjectByName('A_eye_L');assert.equal(am.geometry,bm.geometry);assert.notEqual(am.morphTargetInfluences,bm.morphTargetInfluences);assert.notEqual(am.skeleton,bm.skeleton);assert.equal(pool.stats.cache.loads,1);a.enqueue(cue(0,'N3'));a.advance(.4);assert.equal(a.state.path,'N3');assert.equal(b.state.path,null);assert.equal(b.assertCurrent(),true);a.dispose();b.enqueue(cue(0,'N2'));b.advance(.4);assert.equal(b.assertCurrent(),true);}finally{a.dispose();b.dispose();zero(pool);}
});
test('actual bound paths are equal across cadence and one large jump',async()=>{
 const p=await load(),results=[];
 for(const hz of [24,30,60,120,240,0]){const pool=new ActorPool(),a=await pool.create(p);try{for(const event of [cue(.1,'04'),cue(.25,'N3'),cue(.33,'A7'),cue(1.1,'N2'),cue(1.25,'N2',.3)])a.enqueue(event);if(hz)for(let i=0;i<Math.floor(1.53*hz);i++)a.advance(i/hz);a.advance(1.53);a.assertCurrent();results.push({state:a.state,weights:FACE_ROSTER.map(n=>[...a.root.getObjectByName(n).morphTargetInfluences])});}finally{a.dispose();zero(pool);}}
 for(const result of results.slice(1))assert.deepEqual(result,results[0]);
});
test('source-layer audit detects host mutations; next valid path update resets all facial weights',async()=>{
 const p=await load(),pool=new ActorPool(),a=await pool.create(p);
 try{a.enqueue(cue(0,'04'));a.advance(.4);a.root.getObjectByName('A_tongue').morphTargetInfluences[0]=.2;assert.throws(()=>a.assertCurrent(),{code:'FACE_INVARIANT'});a.enqueue(cue(.4,'R0'));a.advance(1.1);a.assertCurrent();a.root.getObjectByName('Hip_L').position.x+=.01;assert.throws(()=>a.assertCurrent(),{code:'FACE_INVARIANT'});}finally{a.dispose();zero(pool);}
});
test('cancel wins same timestamp, returns all layers to Basis, and invalidates old future cues',async()=>{
 const p=await load(),pool=new ActorPool(),a=await pool.create(p);
 try{a.enqueue(cue(0,'N3'));a.enqueue(cue(.2,'N2'));a.enqueue({type:'cancel',time:.2,fadeOutSec:.2});a.enqueue(cue(1,'A7'));a.advance(2);assert.equal(a.state.path,null);assert.equal(a.state.value,0);assert.equal(a.nextDeadline(),Infinity);a.assertCurrent();a.enqueue(cue(2,'R0'));a.advance(2.4);assert.equal(a.state.path,'R0');assert.equal(a.state.value,1);}finally{a.dispose();zero(pool);}
});
test('new purpose cannot enter neutral adapter and neutral parser caps remain independent',async()=>{
 const read=reader(),bytes=await read('asset.glb',12*1024*1024);assert.equal(preflightFaceGLB(bytes).indices,303882);assert.throws(()=>preflightArtGLB(bytes));await assert.rejects(prepareNeutralPack(read),{code:'VERSION'});
});
test('face profile rejects incomplete roster, synthetic rig, raw weights, altered knots and semantic relabeling',async()=>{
 for(const change of [(_,p)=>p.faceMeshes.pop(),(_,p)=>p.hiddenBasisLayers.pop(),(_,p)=>p.joints.knee='Hip_L',(_,p)=>p.paths[0].knots[0].at=.2,(_,p)=>p.paths[0].meaning='invented',(_,p)=>p.paths[0].knots[0].target='Face07_08',(_,p)=>p.paths.push(p.paths[0]),(_,p)=>p.weights=[1],(_,p)=>p.readiness.engine='drag-and-pet',(_,p)=>p.basis='R0'])await assert.rejects(prepareFacePack(await edited(change)));
});
test('face manifest refuses unauthorized sources, parallel motion and raised ceilings',async()=>{
 for(const change of [m=>m.assets[0].sha256='0'.repeat(64),m=>m.motion='anything',m=>m.equipment=[],m=>m.budgets.morphTargets=144,m=>m.budgets.indices=400000,m=>m.budgets.decodedArrayBytes=1000000])await assert.rejects(prepareFacePack(await edited(change)));
});
test('shared application pool admits all purposes and reserves decoded bytes before parsing',async()=>{
 const p=await load(),cost=preparedAdmission(p).sources[0];const denied=new ActorPool({limits:{decodedArrayBytes:cost.decodedBytes-1}});await assert.rejects(denied.create(p),{code:'GLOBAL_BUDGET'});assert.equal(denied.stats.cache.loads,0);zero(denied);
 const neutral=await prepareNeutralPack(localPackReader(new URL('../fixtures/neutral-static05/',import.meta.url).pathname));
 const pool=new ActorPool({limits:{actors:1}}),pending=pool.create(p);assert.equal(pool.stats.pending,1);await assert.rejects(pool.create(neutral),{code:'GLOBAL_BUDGET'});const a=await pending;assert.equal(pool.stats.sourceBytes,8509100);a.dispose();zero(pool);const b=await pool.create(neutral);b.assertNeutral();b.dispose();zero(pool);
});
test('owned prepared bytes and profile cannot diverge from admitted costs',async()=>{
 const p=await load();assert.throws(()=>p.profile.paths[0].knots.pop());assert.throws(()=>p.manifest.budgets.vertices=1);p.data.get('body').fill(0);const pool=new ActorPool(),a=await pool.create(p);a.assertCurrent();a.dispose();zero(pool);
});
test('aborted face load and pool disposal release every late owned source',async()=>{
 const p=await load(),pool=new ActorPool(),c=new AbortController(),pending=pool.create(p,{signal:c.signal});c.abort(new Error('face abort'));await assert.rejects(pending,/face abort/);for(let i=0;i<40&&pool.stats.sourceBytes;i++)await new Promise(r=>setTimeout(r,5));zero(pool);pool.dispose();await assert.rejects(pool.create(p),{code:'DISPOSED'});
});
test('steady facial ticks do not call CPU skin vertices; held faces sleep and disposed handles reject',async()=>{
 const p=await load(),pool=new ActorPool(),a=await pool.create(p),old=SkinnedMesh.prototype.getVertexPosition;let calls=0;SkinnedMesh.prototype.getVertexPosition=function(...args){calls++;return old.apply(this,args);};
 try{a.enqueue(cue(0,'N3'));for(let i=0;i<=60;i++)a.advance(i/60);assert.equal(calls,0);assert.equal(a.isAnimating(),false);assert.equal(a.advance(2),false);assert.equal(a.nextDeadline(),Infinity);}finally{SkinnedMesh.prototype.getVertexPosition=old;a.dispose();a.dispose();zero(pool);}
 assert.throws(()=>a.advance(2),{code:'DISPOSED'});assert.throws(()=>a.enqueue(cue(2,'04')),{code:'DISPOSED'});assert.throws(()=>a.state,{code:'DISPOSED'});assert.equal(a.root.children.length,0);
});
