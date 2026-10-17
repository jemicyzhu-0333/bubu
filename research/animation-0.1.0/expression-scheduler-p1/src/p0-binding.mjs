import {WeightedScheduler,LIMITS} from './scheduler.mjs';
import {ExpressionDirector} from '../../runtime-facepath05/src/director.mjs';
import {APPROVED_FULL_FACE_SOURCE,FULL_FACE_PROFILE_SHA256} from '../../runtime-facepath05/src/approved-full-face-source.mjs';
export const ADMISSION=Object.freeze({sourceSha256:APPROVED_FULL_FACE_SOURCE.sha256,profileSha256:FULL_FACE_PROFILE_SHA256,faceIds:APPROVED_FULL_FACE_SOURCE.slotIds});
const IDLE='p1_idle';
function exact(x,keys){if(!x||Object.getPrototypeOf(x)!==Object.prototype)throw TypeError('plain input');const d=Object.getOwnPropertyDescriptors(x),ks=Reflect.ownKeys(x);if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))throw TypeError('exact data fields');}
function id(x){if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(x)||x===IDLE)throw TypeError('identifier');}
/** Reference binding: all face writes remain inside the unmodified P0 Director. */
export class P0SchedulerBinding {
 #scheduler;#director;#facts;#queue=[];#time=0;#sealed=-Infinity;#last=-Infinity;#next=0;#release=Infinity;#intent=null;#idleLifetime=null;#interaction=null;#records=[];#pending=null;#progress={complete:true,reached:0,target:0,steps:0};#busy=false;#hostLifetime=0;#gapUntil=0;
 constructor(policy,initialFacts,apply){
  this.#scheduler=new WeightedScheduler(policy,ADMISSION);this.#facts=this.#scheduler.validateFacts(initialFacts);
  const p=this.#scheduler.policy;if(p.candidates.length===0)throw RangeError('binding requires explicit candidates; an empty production policy must remain unbound');
  this.#director=new ExpressionDirector({format:'bubu-expression-policy-p0',version:'0.1.0-p0',sourceSha256:p.sourceSha256,profileSha256:p.profileSha256,candidates:p.candidates.length?p.candidates.map(c=>({key:c.key,faceId:c.faceId,amount:c.amount,enterSec:c.enterSec,exitSec:c.exitSec,holdSec:3600,gapSec:.001})):[]},apply);
 }
 get state(){return Object.freeze({time:this.#time,facts:this.#facts,scheduler:this.#scheduler.state,director:this.#director.state});}
 get progress(){return Object.freeze({...this.#progress});}
 drainRecords(){const out=this.#records;this.#records=[];return out;}
 #log(type,extra={}){if(this.#records.length>=2048)this.#records.shift();this.#records.push(Object.freeze({time:this.#time,type,...extra}));}
 submit(batch){
  if(this.#busy||this.#pending!==null)throw Error('finish advance first');exact(batch,['time','facts','events']);if(!Number.isFinite(batch.time)||batch.time<0||batch.time>LIMITS.maxTime||batch.time<=this.#sealed||batch.time<=this.#last)throw RangeError('batch time');if(!Array.isArray(batch.events)||Object.getPrototypeOf(batch.events)!==Array.prototype||Reflect.ownKeys(batch.events).length!==batch.events.length+1||Array.from({length:batch.events.length},(_,i)=>i).some(i=>!Object.hasOwn(Object.getOwnPropertyDescriptor(batch.events,String(i))??{},'value'))||batch.events.length>30||this.#queue.length>=128)throw RangeError('batch capacity');
  let hostLifetime=this.#hostLifetime;const facts=this.#scheduler.validateFacts(batch.facts),events=batch.events.map(e=>{const type=Object.getOwnPropertyDescriptor(e??{},'type')?.value;
   if(type==='request'){exact(e,['type','owner','requestId','lifetime','candidate','holdMode']);id(e.owner);id(e.requestId);if(!Number.isSafeInteger(e.lifetime)||e.lifetime<=hostLifetime)throw RangeError('host lifetime must increase');hostLifetime=e.lifetime;if(!this.#scheduler.policy.candidates.some(c=>c.key===e.candidate)||!['keep','restart'].includes(e.holdMode)||!facts.interactionOwned)throw RangeError('interaction request');}
   else if(type==='release'){exact(e,['type','owner','requestId','lifetime']);id(e.owner);id(e.requestId);if(!Number.isSafeInteger(e.lifetime)||e.lifetime<1)throw RangeError('host lifetime');}
   else if(type==='reset'){exact(e,['type','exitSec']);if(!Number.isFinite(e.exitSec)||e.exitSec<.04||e.exitSec>2)throw RangeError('exitSec');}
   else throw TypeError('event type');return Object.freeze({...e});});
  this.#queue.push({time:batch.time,facts,events});this.#last=batch.time;this.#hostLifetime=hostLifetime;return this;
 }
 #deadline(){return Math.min(this.#queue[0]?.time??Infinity,this.#next,this.#release,this.#director.nextDeadline());}
 nextDeadline(){return this.#pending!==null?this.#time:this.#deadline();}
 isAnimating(){return this.#pending!==null||this.#director.isAnimating();}
 advance(target,maxSteps=128){
  if(this.#busy)throw Error('reentrant binding');if(!Number.isFinite(target)||target<this.#time||target>LIMITS.maxTime||(this.#pending!==null&&target<this.#pending)||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>4096)throw RangeError('advance bounds');this.#busy=true;let steps=0,changed=false;
  try{
   while(this.#deadline()<=target&&steps<maxSteps){
    const at=this.#deadline();this.#time=at;const before=this.#director.state;let events=[],external=false;const input=this.#queue[0]?.time===at?this.#queue.shift():null;
    if(input){this.#facts=input.facts;external=input.events.some(e=>e.type==='request'||e.type==='reset');if(external)this.#gapUntil=0;for(const e of input.events){if(e.type==='request'){const lifetime=this.#director.maxAdmittedLifetime+events.filter(e=>e.type==='request').length+1;this.#interaction={owner:e.owner,requestId:e.requestId,lifetime,hostLifetime:e.lifetime};events.push({...e,lifetime,priority:'interaction'});}else if(e.type==='release'){if(this.#interaction?.owner===e.owner&&this.#interaction.requestId===e.requestId&&this.#interaction.hostLifetime===e.lifetime){events.push({...e,lifetime:this.#interaction.lifetime});this.#interaction=null;}}else{events.push(e);this.#interaction=null;}}
     if(this.#intent&&(!this.#scheduler.isAllowed(this.#intent.key,this.#facts)||external)){
      events.push({type:'release',owner:IDLE,requestId:IDLE,lifetime:this.#idleLifetime});this.#scheduler.lose(at);this.#log('interrupted',{key:this.#intent.key});this.#intent=null;this.#release=Infinity;this.#next=Infinity;
     }
     if(!this.#intent&&!this.#facts.interactionOwned&&this.#facts.enabled)this.#next=Math.max(at,this.#gapUntil);
    }
    // At an input timestamp, external intents win before autonomous decision/RNG.
    if(this.#release===at&&this.#intent){events.push({type:'release',owner:IDLE,requestId:IDLE,lifetime:this.#idleLifetime});this.#release=Infinity;this.#log('hold-ended',{key:this.#intent.key});}
    if(this.#next===at){this.#next=Infinity;
     if(!external&&this.#facts.enabled&&!this.#facts.interactionOwned&&!this.#intent&&(before.phase==='idle'||before.phase==='gap')){
      if(before.phase==='gap'&&before.owner!==IDLE)events.push({type:'release',owner:before.owner,requestId:before.requestId,lifetime:this.#director.activeLifetime});
      const result=this.#scheduler.decide(at,this.#facts,intent=>{this.#idleLifetime=this.#director.maxAdmittedLifetime+1;events.push({type:'request',owner:IDLE,requestId:IDLE,lifetime:this.#idleLifetime,priority:'idle',candidate:intent.key,holdMode:'restart'});this.#intent=intent;this.#log('selected',{...intent});return true;});if(!result.accepted)this.#next=result.nextDeadline;
     }
    }
    if(events.length)this.#director.submit({time:at,events});changed=this.#director.advance(at)||changed;const after=this.#director.state;
    if(this.#intent&&after.owner===IDLE){
     if(after.phase==='hold'&&before.phase!=='hold'){this.#release=after.logicalArrival+this.#intent.holdSec;this.#log('arrival',{key:this.#intent.key,actualArrival:after.logicalArrival,releaseAt:this.#release});}
     if(after.phase==='gap'&&before.phase!=='gap'){const intent=this.#intent;this.#scheduler.lose(at);this.#next=at+intent.gapSec;this.#gapUntil=this.#next;this.#intent=null;this.#log('gap-start',{key:intent.key,nextAt:this.#next});}
    }
    // After interrupted/real exits, resume from current facts only, after Basis.
    if(!this.#intent&&!this.#facts.interactionOwned&&this.#facts.enabled&&this.#next===Infinity&&after.phase==='gap'&&before.phase!=='gap')this.#next=after.deadline;
    this.#sealed=at;steps++;
   }
   const complete=this.#deadline()>target;if(complete){changed=this.#director.advance(target)||changed;this.#time=target;this.#sealed=target;this.#pending=null;}else this.#pending=target;this.#progress={complete,reached:this.#time,target,steps};return changed;
  }finally{this.#busy=false;}
 }
}
