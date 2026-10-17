import test from 'node:test';
import assert from 'node:assert/strict';
import {WeightedExpressionOwner,ExpressionOwner} from '../src/expression-owner.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {prepareFullFacePack,prepareFacePack} from '../src/pack-loader.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
import {FULL_FACE_SLOT_IDS as ids,FACE_ROSTER} from '../src/face-contract.mjs';
import {ADMISSION} from '../../expression-scheduler-p1/src/p0-binding.mjs';
const pack=await prepareFullFacePack(localPackReader(new URL('../fixtures/face-full18/',import.meta.url).pathname));
const fixed=sec=>({kind:'fixed',sec});
const policy=()=>({format:'bubu-expression-scheduler',version:'0.1.0-p1',sourceSha256:ADMISSION.sourceSha256,profileSha256:ADMISSION.profileSha256,rng:{algorithm:'xorshift32-split-v1',seed:42},candidates:ids.map(faceId=>({key:faceId,faceId,amount:1,selectionWeight:1,enterSec:.1,exitSec:.1,hold:fixed(.2),gap:fixed(.3),cooldownSec:0,sources:['testfixture']})),contexts:[{key:'all',candidates:[...ids],excludeRecent:1},{key:'none',candidates:[],excludeRecent:0},...ids.map(key=>({key,candidates:[key],excludeRecent:0}))]});
const facts=(over={})=>({context:'R0',source:'testfixture',enabled:true,interactionOwned:false,...over});
const request=(lifetime=1,candidate='D1')=>({type:'request',owner:'interaction',requestId:'r'+lifetime,lifetime,candidate,holdMode:'restart'});
const release=(lifetime=1)=>({type:'release',owner:'interaction',requestId:'r'+lifetime,lifetime});
const batch=(o,wallTime,f=facts(),events=[])=>({wallTime,epoch:o.epoch,facts:f,events});
const zero=p=>{for(const k of ['actors','active','pending','sourceBytes','decodedArrayBytes','deformedVertices'])assert.equal(p.stats[k],0,k);};
const late=async p=>{for(let i=0;i<100&&p.stats.sourceBytes;i++)await new Promise(r=>setTimeout(r,5));zero(p);};
async function make(over={}){const pool=over.pool??new ActorPool(),o=new WeightedExpressionOwner({pool,pack,policy:policy(),initialFacts:facts(),visibilityPolicy:'freeze',...over});await o.ready;return {o,pool};}

test('weighted full18 actual actor drives every approved path through one P1 Director and eight layers',async()=>{
 const records=[];const {o,pool}=await make({initialFacts:facts({enabled:false}),onRecord:r=>records.push(r)});try{assert.equal(o.actor,undefined);assert.equal(o.timeline,undefined);assert.equal(o.enqueue,undefined);let t=0;
 for(const id of ids){o.completeBatch(batch(o,t,facts({context:id})));o.advance(t+.15);assert.equal(o.state.path,id);assert.equal(o.state.amount,1);o.assertCurrent();for(const name of FACE_ROSTER){const mesh=o.root.getObjectByName(name);assert.equal(mesh.morphTargetInfluences.length,144);assert.equal(mesh.morphTargetInfluences.filter(x=>x!==0).length,1);}o.completeBatch(batch(o,t+.18,facts({enabled:false})));o.advance(t+1);assert.equal(o.state.path,null);o.assertCurrent();t+=2;}
 assert.equal(records.filter(r=>r.type==='selected').length,18);assert.equal(records.filter(r=>r.type==='arrival').length,18);assert.equal(o.weightedState.scheduler.decisions,18);assert.equal(o.maxAdmittedLifetime,0);assert.equal(pool.stats.decodedArrayBytes,38211404);
 }finally{o.dispose();zero(pool);}
});
test('same-time real interaction preempts autonomous RNG; release returns through Basis and current facts',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,facts({interactionOwned:true}),[request()]));assert.equal(o.weightedState.scheduler.decisions,0);assert.equal(o.state.owner,'interaction');o.advance(.15);o.assertCurrent();o.completeBatch(batch(o,.2,facts(),[release()]));assert.equal(o.state.phase,'exit');o.advance(.6);assert(o.weightedState.scheduler.decisions>=1);o.assertCurrent();o.completeBatch(batch(o,.7,facts({interactionOwned:true}),[request(2,'T05')]));o.completeBatch(batch(o,.8,facts({interactionOwned:true}),[release(1)]));assert.equal(o.state.requestId,'r2');assert.equal(o.maxAdmittedLifetime,2);o.assertCurrent();}finally{o.dispose();zero(pool);}
});
test('weighted hidden retirement preserves RNG/history/cooldown/global lifetime and requires fresh facts',async()=>{
 const p=policy();p.candidates[0].cooldownSec=1;const {o,pool}=await make({policy:p});try{o.completeBatch(batch(o,0));o.advance(.1);o.completeBatch(batch(o,.15,facts({interactionOwned:true}),[request()]));o.advance(.2);const rng=o.weightedState.scheduler.rng,recent=o.weightedState.scheduler.recent,epoch=o.epoch;o.suspend(.2);assert.equal(o.epoch,epoch+1);assert.equal(o.state.path,null);assert.equal(o.weightedState.facts.enabled,false);assert.deepEqual(o.weightedState.scheduler.rng,rng);assert.deepEqual(o.weightedState.scheduler.recent,recent);assert.equal(o.maxAdmittedLifetime,1);assert.equal(o.completeBatch({wallTime:0,epoch,facts:facts(),events:[release()]}).accepted,false);o.resume(100);o.completeBatch(batch(o,100));o.advance(100.94);assert.equal(o.weightedState.scheduler.decisions,1);o.advance(100.96);assert.equal(o.weightedState.scheduler.decisions,2);assert.throws(()=>o.completeBatch(batch(o,101,facts({interactionOwned:true}),[request(1)])),/lifetime/);o.completeBatch(batch(o,101,facts({interactionOwned:true}),[request(2)]));o.assertCurrent();}finally{o.dispose();zero(pool);}
});
test('pure weighted decorative hold freezes without a random redraw or retirement',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0));o.advance(.15);const rng=o.weightedState.scheduler.rng,epoch=o.epoch;o.suspend(.15);o.advance(50);assert.equal(o.logicalTime,.15);o.resume(100);o.advance(100.1);assert.equal(o.state.phase,'hold');assert.equal(o.epoch,epoch);assert.deepEqual(o.weightedState.scheduler.rng,rng);o.assertCurrent();}finally{o.dispose();zero(pool);}
});
test('weighted observer exception and reentry disable observation without corrupting real layers',async()=>{
 let o,calls=0;const made=await make({onRecord(){calls++;o.dispose();}});o=made.o;try{o.completeBatch(batch(o,0));o.advance(.15);assert.equal(calls,1);assert.equal(o.observerStatus.enabled,false);o.assertCurrent();o.completeBatch(batch(o,.2,facts({interactionOwned:true}),[request()]));o.suspend(.21);o.resume(50);o.completeBatch(batch(o,50));o.advance(50.15);assert.equal(calls,1);assert.equal(o.observerStatus.enabled,false);o.assertCurrent();}finally{o.dispose();zero(made.pool);}
});
test('weighted core sink failure and retirement Basis failure fail-stop and release',async()=>{
 for(const retire of [false,true]){const {o,pool}=await make();o.completeBatch(batch(o,0,facts({interactionOwned:retire}),retire?[request()]:[]));o.advance(.05);o.root.getObjectByName(FACE_ROSTER[0]).morphTargetInfluences.fill=()=>{throw Error('weighted sink');};assert.throws(()=>retire?o.suspend(.05):o.advance(.1),/weighted sink/);assert.equal(o.status,'faulted');assert.equal(o.root,null);assert.throws(()=>o.completeBatch(batch(o,1)));o.dispose();zero(pool);}
});
test('weighted pending load disposal and pool close clean late completions and ready actors',async()=>{
 for(const closePool of [false,true]){const pool=new ActorPool(),o=new WeightedExpressionOwner({pool,pack,policy:policy(),initialFacts:facts(),visibilityPolicy:'freeze'}),ready=o.ready;closePool?pool.dispose():o.dispose();o.dispose();await assert.rejects(ready);await late(pool);assert.equal(o.root,null);}
 const {o,pool}=await make();pool.dispose();assert.equal(o.status,'closed');assert.equal(o.root,null);zero(pool);
});
test('weighted immutable async configuration and strict explicit capability reject before admission',async()=>{
 const p=policy(),f=facts(),pool=new ActorPool(),o=new WeightedExpressionOwner({pool,pack,policy:p,initialFacts:f,visibilityPolicy:'freeze'});p.candidates[0].amount=.1;f.enabled=false;await o.ready;try{o.completeBatch(batch(o,0));o.advance(.15);assert.equal(o.state.amount,1);o.assertCurrent();}finally{o.dispose();zero(pool);}
 const slice=await prepareFacePack(localPackReader(new URL('../fixtures/face-slice7/',import.meta.url).pathname));assert.throws(()=>pool.createWeighted(slice,policy(),{initialFacts:facts()}),/full18/);assert.equal(pool.stats.cache.loads,1);
 const empty=policy();empty.candidates=[];empty.contexts=[{key:'none',candidates:[],excludeRecent:0}];const p2=new ActorPool();assert.throws(()=>p2.createWeighted(pack,empty,{initialFacts:facts({context:'none'})}),/empty/);zero(p2);assert.equal(p2.stats.cache.loads,0);
});
test('weighted facts-only and 30-event input bounds preserve atomicity and suppress getters',async()=>{
 const {o,pool}=await make();let reads=0;try{const events=[];events.length=1e8;assert.throws(()=>o.completeBatch(batch(o,0,facts(),events)),/bounds/);const getter=batch(o,0);Object.defineProperty(getter,'facts',{get(){reads++;return facts();},enumerable:true});assert.throws(()=>o.completeBatch(getter),/data/);assert.equal(reads,0);assert.throws(()=>o.completeBatch(batch(o,0,facts({interactionOwned:true}),Array.from({length:31},(_,i)=>request(i+1)))),/bounds/);assert.equal(o.maxAdmittedLifetime,0);o.completeBatch(batch(o,0,facts({interactionOwned:true}),Array.from({length:30},(_,i)=>request(i+1))));assert.equal(o.maxAdmittedLifetime,30);assert.equal(o.state.requestId,'r30');o.assertCurrent();}finally{o.dispose();zero(pool);}
});
test('weighted pending budget rejects unaccepted batch without losing host lifetime or P1 facts',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0));o.advance(3,1);assert.throws(()=>o.completeBatch(batch(o,3.1,facts({interactionOwned:true}),[request()])),/finish/);assert.equal(o.maxAdmittedLifetime,0);for(let i=0;i<40;i++)o.advance(3,1);o.completeBatch(batch(o,3.1,facts({interactionOwned:true}),[request()]));assert.equal(o.state.owner,'interaction');o.assertCurrent();}finally{o.dispose();zero(pool);}
});
function clock(){let n=0,wall=0;const frames=new Map(),timers=new Map();return {frames,timers,now:()=>wall,requestFrame(fn){frames.set(++n,fn);return n;},cancelFrame(id){frames.delete(id);},setTimer(fn,ms){timers.set(++n,{fn,ms});return n;},clearTimer(id){timers.delete(id);},frame(t){wall=t;const [id,fn]=frames.entries().next().value;frames.delete(id);fn();}};}
test('weighted host resumes drawing and guards late RAF/timers across hidden retirement and dispose',async()=>{
 const s=clock();let draws=0;const {o,pool}=await make({scheduler:s,draw(){draws++;}});try{o.completeBatch(batch(o,0));o.wake();s.frame(.1);assert.equal(s.timers.size,1);const old=[...s.timers.values()][0].fn;o.completeBatch(batch(o,.15,facts({interactionOwned:true}),[request()]));o.suspend(.15);assert.equal(s.timers.size,0);o.resume(100);o.completeBatch(batch(o,100,facts({enabled:false})));const lateFrame=[...s.frames.values()][0];old();assert.equal(s.frames.size,1);s.frame(100);assert.equal(o.state.path,null);assert.equal(s.timers.size,0);assert.equal(s.frames.size,0);assert.equal(draws,2);o.dispose();lateFrame();old();assert.equal(draws,2);zero(pool);}finally{o.dispose();}
});
test('weighted observer timestamps stay on continuous owner logical time after epoch retirement',async()=>{
 const records=[];const {o,pool}=await make({onRecord:r=>records.push(r)});try{o.completeBatch(batch(o,0,facts({interactionOwned:true}),[request()]));o.advance(.3);o.suspend(.3);o.resume(100);o.completeBatch(batch(o,100));o.advance(100.11);const selected=records.find(r=>r.type==='selected'),arrival=records.find(r=>r.type==='arrival');assert.equal(selected.time,.3);assert.equal(selected.epoch,o.epoch);assert(Math.abs(arrival.actualArrival-.4)<1e-10);assert(Math.abs(arrival.releaseAt-.6)<1e-10);assert.equal(arrival.time,arrival.actualArrival);o.assertCurrent();}finally{o.dispose();zero(pool);}
});
