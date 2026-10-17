import test from 'node:test';
import assert from 'node:assert/strict';
import {ExpressionOwner} from '../src/expression-owner.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {prepareD2FacePack} from '../src/pack-loader.mjs';
import {localPackReader} from '../tools/read-local-pack.mjs';
import {APPROVED_D2_FACE_SOURCE,D2_FACE_PROFILE_SHA256 as PROFILE_SHA256} from '../src/approved-d2-face-source.mjs';
const SOURCE_SHA256=APPROVED_D2_FACE_SOURCE.sha256;
import {FULL_FACE_SLOT_IDS as FACE_SLOT_IDS,FACE_ROSTER} from '../src/face-contract.mjs';
const pack=await prepareD2FacePack(localPackReader(new URL('../fixtures/face-d2/',import.meta.url).pathname));
const policy=()=>({format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:SOURCE_SHA256,profileSha256:PROFILE_SHA256,candidates:FACE_SLOT_IDS.map(faceId=>({key:faceId,faceId,amount:1,enterSec:.25,exitSec:.25,holdSec:.5,gapSec:.25}))});
const request=(lifetime=1,candidate='R0',priority='interaction')=>({type:'request',owner:'pointer',requestId:'r'+lifetime,lifetime,candidate,priority,holdMode:'keep'});
const release=(lifetime=1)=>({type:'release',owner:'pointer',requestId:'r'+lifetime,lifetime});
const batch=(o,wallTime,...events)=>({wallTime,epoch:o.epoch,events});
const make=async(opts={})=>{const pool=opts.pool??new ActorPool();const o=new ExpressionOwner({pool,pack,policy:policy(),visibilityPolicy:'freeze',...opts});await o.ready;return {o,pool};};
const zero=p=>{for(const key of ['actors','active','pending','sourceBytes','decodedArrayBytes'])assert.equal(p.stats[key],0,key);};
const settled=async p=>{for(let i=0;i<100&&p.stats.sourceBytes;i++)await new Promise(r=>setTimeout(r,5));zero(p);};
function scheduler(){let id=0,now=0;const frames=new Map(),timers=new Map();return {frames,timers,setNow(t){now=t;},now:()=>now,requestFrame(fn){frames.set(++id,fn);return id;},cancelFrame(id){frames.delete(id);},setTimer(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimer(id){timers.delete(id);},runFrame(t){now=t;const [key,fn]=frames.entries().next().value;frames.delete(key);fn();}};}

test('production admitted full eighteen slots use one director writer on eight layers; no legacy enqueue',async()=>{
 const {o,pool}=await make();const root=o.root;let t=0;
 try{assert.equal(o.enqueue,undefined);assert.equal(o.timeline,undefined);assert.equal(o.actor,undefined);for(const [i,id] of FACE_SLOT_IDS.entries()){
  o.completeBatch(batch(o,t,request(i+1,id)));o.advance(t+.25);assert.equal(o.state.path,id);assert.equal(o.state.amount,1);o.assertCurrent();
  for(const name of FACE_ROSTER){const m=root.getObjectByName(name);assert.equal(m.morphTargetInfluences.filter(x=>x!==0).length,1);}
  o.advance(t+1.25);assert.equal(o.state.path,null);o.assertCurrent();t+=2;
 }}finally{o.dispose();o.dispose();zero(pool);}assert.equal(o.root,null);assert.equal(root.children.length,0);assert.throws(()=>o.advance(t));assert.throws(()=>o.completeBatch(batch(o,t,request(9))));
});
test('same-time entire batch goes before advance; late same stamp rejects without mutation',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request()));o.advance(.25);o.completeBatch(batch(o,.75,release(),request(2,'N3')));assert.equal(o.state.requestId,'r2');const state=o.state;assert.throws(()=>o.completeBatch(batch(o,.75,request(3))),/sealed/);assert.deepEqual(o.state,state);assert.equal(o.maxAdmittedLifetime,2);}finally{o.dispose();zero(pool);}
});
test('whole batch lifetime validation atomic across retired epochs',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request(4)));o.suspend(.1);const e=o.epoch;o.resume(50);assert.equal(o.completeBatch({wallTime:0,epoch:e-1,events:[request(999)]}).accepted,false);assert.equal(o.maxAdmittedLifetime,4);assert.throws(()=>o.completeBatch(batch(o,50,request(5),request(4))),/lifetime/);assert.equal(o.maxAdmittedLifetime,4);o.completeBatch(batch(o,50,request(5)));o.assertCurrent();}finally{o.dispose();zero(pool);}
});
for(const [phase,time] of [['enter',.1],['hold',.3],['exit',.8],['gap',1.1]])test('hidden '+phase+' retires interaction immediately; old release cannot touch resumed lifetime',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request()));o.advance(time);assert.equal(o.state.phase,phase);const epoch=o.epoch;o.suspend(time);assert.equal(o.epoch,epoch+1);assert.equal(o.state.phase,'idle');assert.equal(o.state.path,null);o.assertCurrent();assert.equal(o.invalidate(epoch),false);o.suspend(time);assert.equal(o.epoch,epoch+1);o.resume(time);o.completeBatch(batch(o,time,request(2,'N3')));const state=o.state;assert.equal(o.completeBatch({wallTime:time,epoch,events:[release()]}).accepted,false);assert.deepEqual(o.state,state);assert.equal(o.logicalTime,time);}finally{o.dispose();zero(pool);}
});
test('pure decoration hold freezes logical clock and wall-hidden duration does not consume hold',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request(1,'R0','idle')));o.advance(.3);const epoch=o.epoch;o.suspend(.3);o.advance(100);assert.equal(o.logicalTime,.3);o.resume(200);o.advance(200.1);assert(Math.abs(o.state.time-.4)<1e-10);assert.equal(o.state.phase,'hold');assert.equal(o.epoch,epoch);o.advance(200.5);assert.equal(o.state.phase,'exit');}finally{o.dispose();zero(pool);}
});
test('queued future interaction invalidates even while current decorative face holds',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request(1,'R0','idle')));o.advance(.3);
 const old=o.epoch;o.completeBatch(batch(o,2,request(2)),1);assert.equal(o.state.owner,'pointer');assert.equal(o.state.queued,1);o.suspend(2);assert.equal(o.epoch,old+1);assert.equal(o.state.queued,0);const e=o.epoch;assert.equal(o.invalidate(e),true);assert.equal(o.state.path,null);assert.throws(()=>o.completeBatch(batch(o,5,request(2))),/Paused/);o.resume(5);o.completeBatch(batch(o,5,request(3)));}finally{o.dispose();zero(pool);}
});
test('visible release follows normal exit duration; hidden invalidation cannot be used visibly',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request()));o.advance(.25);assert.throws(()=>o.invalidate(o.epoch),/Visible/);o.completeBatch(batch(o,.3,release()));assert.equal(o.state.phase,'exit');assert.equal(o.state.amount,1);o.advance(.4);assert(o.state.amount>0&&o.state.amount<1);o.advance(.6);assert.equal(o.state.path,null);}finally{o.dispose();zero(pool);}
});
test('observer throws do not corrupt actual face or owner; reentrant dispose is rejected in observer',async()=>{
 let o,calls=0;const made=await make({onRecord(){calls++;o.dispose();}});o=made.o;
 try{o.completeBatch(batch(o,0,request()));assert.equal(calls,1);assert.equal(o.status,'ready');assert.equal(o.observerStatus.enabled,false);o.advance(.4);o.assertCurrent();o.suspend(.4);o.resume(10);o.completeBatch(batch(o,10,request(2)));o.advance(11.5);assert.equal(calls,1);o.assertCurrent();}finally{o.dispose();zero(made.pool);}
});
test('core binding failure fail-stops, clears reference and lease, refuses all subsequent inputs',async()=>{
 const {o,pool}=await make();const root=o.root;o.completeBatch(batch(o,0,request()));root.getObjectByName(FACE_ROSTER[0]).morphTargetInfluences.fill=()=>{throw Error('sink failure');};assert.throws(()=>o.advance(.1),/sink failure/);assert.equal(o.status,'faulted');assert.equal(o.root,null);zero(pool);assert.throws(()=>o.resume(10));assert.throws(()=>o.completeBatch(batch(o,10,request(2))));o.dispose();
});
test('Basis reset sink failure also fail-stops and releases actor',async()=>{
 const {o,pool}=await make();o.completeBatch(batch(o,0,request()));o.advance(.1);o.root.getObjectByName(FACE_ROSTER[0]).morphTargetInfluences.fill=()=>{throw Error('reset sink');};assert.throws(()=>o.suspend(.1),/reset sink/);assert.equal(o.status,'faulted');zero(pool);
});
test('dispose during async load and pool close during load clean late parses exactly once',async()=>{
 for(const closePool of [false,true]){const pool=new ActorPool(),o=new ExpressionOwner({pool,pack,policy:policy(),visibilityPolicy:'freeze'});const ready=o.ready;closePool?pool.dispose():o.dispose();o.dispose();await assert.rejects(ready);await settled(pool);assert.equal(o.root,null);assert.throws(()=>o.advance(0));}
});
test('pool close owns ready actor shutdown and makes owner a lightweight tombstone',async()=>{
 const {o,pool}=await make();pool.dispose();assert.equal(o.status,'closed');assert.equal(o.root,null);o.dispose();zero(pool);
});
test('demand callbacks cancel on hidden/dispose; already dequeued old callback cannot write or draw',async()=>{
 const s=scheduler();let draws=0;const {o,pool}=await make({scheduler:s,draw(){draws++;}});o.completeBatch(batch(o,0,request()));o.wake();const old=[...s.frames.values()][0];s.runFrame(.25);assert.equal(draws,1);assert.equal(s.timers.size,1);const timer=[...s.timers.values()][0].fn;o.suspend(.25);assert.equal(s.timers.size,0);o.resume(100);o.completeBatch(batch(o,100,request(2)));old();timer();assert.equal(draws,1);assert.equal(s.frames.size,1);o.wake();const late=[...s.frames.values()][0];o.dispose();late();assert.equal(draws,1);assert.equal(s.frames.size,0);zero(pool);
});
test('scheduled draw faults stop scheduling and release admitted resources',async()=>{
 const s=scheduler();const {o,pool}=await make({scheduler:s,draw(){throw Error('renderer fault');}});o.wake();s.runFrame(0);assert.equal(o.status,'faulted');assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);zero(pool);
});
test('browser lifecycle combines hidden and context loss, owns listener teardown',async()=>{
 let wall=.1;class Tracked extends EventTarget {count=0;addEventListener(...a){this.count++;return super.addEventListener(...a);}removeEventListener(...a){this.count--;return super.removeEventListener(...a);}}
 const canvas=new Tracked(),visibilityTarget=new Tracked();visibilityTarget.hidden=false;
 const {o,pool}=await make();o.completeBatch(batch(o,0,request()));o.bindLifecycle({canvas,visibilityTarget,now:()=>wall});
 const event=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(o.paused,true);assert.equal(o.state.path,null);visibilityTarget.hidden=true;visibilityTarget.dispatchEvent(new Event('visibilitychange'));wall=50;canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(o.paused,true);visibilityTarget.hidden=false;visibilityTarget.dispatchEvent(new Event('visibilitychange'));assert.equal(o.paused,false);o.completeBatch(batch(o,wall,request(2)));o.dispose();assert.equal(canvas.count,0);assert.equal(visibilityTarget.count,0);canvas.dispatchEvent(new Event('webglcontextlost'));zero(pool);
});
test('pending budget must be drained before another input; no accepted lifetime or batch is lost',async()=>{
 const {o,pool}=await make();try{o.completeBatch(batch(o,0,request()));o.advance(2,1);assert.equal(o.state.phase,'hold');assert.throws(()=>o.completeBatch(batch(o,2.1,request(2))),/pending/);assert.equal(o.maxAdmittedLifetime,1);for(let i=0;i<4;i++)o.advance(2,1);assert.equal(o.state.phase,'idle');o.completeBatch(batch(o,2.1,request(2)));o.assertCurrent();}finally{o.dispose();zero(pool);}
});
test('policy snapshots are immutable before async load and across retirement',async()=>{
 for(const direct of [false,true]){const pool=new ActorPool(),p=policy();let a;
 if(direct){const pending=pool.createDirected(pack,p);p.candidates[0].holdSec=100;a=await pending;a.submit({time:0,events:[request()]});a.advance(.25);assert.equal(a.state.deadline,.75);p.candidates[0].holdSec=200;a.retire();a.submit({time:0,events:[request(2)]});a.advance(.25);assert.equal(a.state.deadline,.75);a.dispose();}
 else{a=new ExpressionOwner({pool,pack,policy:p,visibilityPolicy:'freeze'});p.candidates[0].holdSec=100;await a.ready;a.completeBatch(batch(a,0,request()));a.advance(.25);assert.equal(a.state.deadline,.75);p.candidates[0].holdSec=200;a.suspend(.25);a.resume(10);a.completeBatch(batch(a,10,request(2)));a.advance(10.25);assert.equal(a.state.deadline,1);a.dispose();}zero(pool);}
});
test('throwing scheduler cancellation still invalidates callbacks and releases resources',async()=>{
 const s=scheduler(),oldCancel=s.cancelFrame;s.cancelFrame=id=>{oldCancel(id);throw Error('cancel fault');};const {o,pool}=await make({scheduler:s});o.wake();const late=[...s.frames.values()][0];assert.throws(()=>o.suspend(0),/cancel fault/);assert.equal(o.status,'faulted');late();zero(pool);
});
test('decorative hold resumes scheduled drawing and deadline without new input',async()=>{
 const s=scheduler();let draws=0;const {o,pool}=await make({scheduler:s,draw(){draws++;}});let wall=0;const canvas=new EventTarget(),visibilityTarget=new EventTarget();visibilityTarget.hidden=false;o.bindLifecycle({canvas,visibilityTarget,now:()=>wall});o.completeBatch(batch(o,0,request(1,'R0','idle')));o.wake();s.runFrame(.3);wall=.3;assert.equal(s.timers.size,1);visibilityTarget.hidden=true;visibilityTarget.dispatchEvent(new Event('visibilitychange'));assert.equal(s.timers.size,0);wall=100;visibilityTarget.hidden=false;visibilityTarget.dispatchEvent(new Event('visibilitychange'));assert.equal(s.frames.size,1);s.runFrame(100);assert.equal(o.state.phase,'hold');assert.equal(draws,2);const timer=[...s.timers.values()][0].fn;s.timers.clear();timer();s.runFrame(100.5);assert.equal(o.state.phase,'exit');s.runFrame(101);assert.equal(o.state.phase,'idle');assert.equal(s.frames.size,0);assert.equal(s.timers.size,0);o.dispose();zero(pool);
});
test('owner preserves strict bounded data records without executing getters or iterators',async()=>{
 const {o,pool}=await make();let reads=0;try{
 const events=[request()];Object.defineProperty(events,'0',{get(){reads++;return request();}});assert.throws(()=>o.completeBatch({wallTime:0,epoch:o.epoch,events}),/dense/);
 const iterator=[request()];iterator[Symbol.iterator]=function*(){reads++;yield request();};assert.throws(()=>o.completeBatch({wallTime:0,epoch:o.epoch,events:iterator}),/dense/);
 const outer={epoch:o.epoch,events:[request()]};Object.defineProperty(outer,'wallTime',{get(){reads++;return 0;},enumerable:true});assert.throws(()=>o.completeBatch(outer),/data/);
 assert.throws(()=>o.completeBatch(batch(o,0,...Array.from({length:33},(_,i)=>request(i+1)))),/bounds/);
 const sparse=[];sparse.length=1e8;assert.throws(()=>o.completeBatch({wallTime:0,epoch:o.epoch,events:sparse}),/bounds/);
 assert.equal(reads,0);assert.equal(o.maxAdmittedLifetime,0);o.completeBatch(batch(o,0,request()));o.assertCurrent();
 }finally{o.dispose();zero(pool);}
});
test('non-enumerable data fields reject before spread-copy can silently discard requests',async()=>{
 const {o,pool}=await make();try{
 const e=request();Object.defineProperty(e,'type',{value:'request',enumerable:false});assert.throws(()=>o.completeBatch(batch(o,0,e)),/data/);assert.equal(o.maxAdmittedLifetime,0);
 const events=[request()];Object.defineProperty(events,'0',{value:events[0],enumerable:false});assert.throws(()=>o.completeBatch({wallTime:0,epoch:o.epoch,events}),/dense/);
 const outer=batch(o,0,request());Object.defineProperty(outer,'wallTime',{value:0,enumerable:false});assert.throws(()=>o.completeBatch(outer),/data/);
 const p=policy();Object.defineProperty(p.candidates[0],'key',{value:'R0',enumerable:false});assert.throws(()=>pool.createDirected(pack,p),/data/);
 o.completeBatch(batch(o,0,request()));assert.equal(o.state.owner,'pointer');
 }finally{o.dispose();zero(pool);}
});
test('replacing a timer revokes an already dequeued old callback without losing the new handle',async()=>{
 const s=scheduler();let draws=0;const {o,pool}=await make({scheduler:s,draw(){draws++;}});o.completeBatch(batch(o,0,request(1,'R0','idle')));o.wake();s.runFrame(.3);const old=[...s.timers.values()][0].fn;o.wake();assert.equal(s.timers.size,0);s.runFrame(.4);assert.equal(s.timers.size,1);const fresh=[...s.timers.keys()][0];const before=draws;old();assert.equal(draws,before);assert.equal(s.frames.size,0);assert.equal(s.timers.size,1);assert(s.timers.has(fresh));o.dispose();assert.equal(s.timers.size,0);zero(pool);
});
