import {APPROVED_FULL_FACE_SOURCE,FULL_FACE_PROFILE_SHA256} from './approved-full-face-source.mjs';
import {FaceTimeline} from './face-timeline.mjs';
import {APPROVED_FACE_SOURCE} from './approved-face-source.mjs';
export const SOURCE_SHA256=APPROVED_FACE_SOURCE.sha256;
export const PROFILE_SHA256='14b268270370477caac18cdbefa6a95a4a1d078c674527315f67f1b24e045997';
export const LIMITS=Object.freeze({maxTime:1e8,inputHeadroom:7207,maxCandidates:32,maxBatches:128,maxEvents:32,maxDuration:3600,maxSteps:4096});
function policyIds(p){return p.sourceSha256===APPROVED_FULL_FACE_SOURCE.sha256&&p.profileSha256===FULL_FACE_PROFILE_SHA256?APPROVED_FULL_FACE_SOURCE.slotIds:p.sourceSha256===SOURCE_SHA256&&p.profileSha256===PROFILE_SHA256?Object.keys(APPROVED_FACE_SOURCE.paths):null;}
export function validatePackPolicy(pack,policy){
 const p=validatePolicy(policy),m=pack.manifest;
 if(p.sourceSha256!==pack.profile.sourceSha256||p.profileSha256!==m.assets.find(a=>a.id===m.character.profile)?.sha256)throw new RangeError('policy and admitted pack mismatch');
 return p;
}
const rank=Object.freeze({idle:0,interaction:1});
function record(x,keys,label){
  if(!x||typeof x!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(x)))throw new TypeError(label+' must be a plain data record');
  const d=Object.getOwnPropertyDescriptors(x),own=Reflect.ownKeys(x);
  if(own.length!==keys.length||own.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))throw new TypeError(label+' must have exactly its data fields');
}
function array(x,min,max,label){
  if(!Array.isArray(x)||Object.getPrototypeOf(x)!==Array.prototype||x.length<min||x.length>max)throw new TypeError(label+' array bounds');
  const d=Object.getOwnPropertyDescriptors(x),k=Reflect.ownKeys(x);
  if(k.length!==x.length+1||k.some(key=>key!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(String(key))||Number(key)>=x.length||!Object.hasOwn(d[key],'value')||!d[key].enumerable)))throw new TypeError(label+' must be a dense data array');
}
function num(x,min,max,label){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw new RangeError(label+' bounds');return x;}
function integer(x,min,max,label){num(x,min,max,label);if(!Number.isInteger(x))throw new RangeError(label+' integer');return x;}
function id(x){if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(x))throw new TypeError('identifier');return x;}
export function validatePolicy(p){
  record(p,['format','version','sourceSha256','profileSha256','candidates'],'policy');
  if(p.format!=='bubu-expression-policy-p0'||p.version!=='0.1.0-p0'||!policyIds(p))throw new RangeError('policy version or approved source/profile mismatch');
  array(p.candidates,1,LIMITS.maxCandidates,'candidates');const seen=new Set(),ids=policyIds(p);
  const candidates=p.candidates.map(c=>{
    record(c,['key','faceId','amount','enterSec','exitSec','holdSec','gapSec'],'candidate');id(c.key);
    if(seen.has(c.key)||!ids.includes(c.faceId))throw new RangeError('duplicate key or unapproved face');seen.add(c.key);
    num(c.amount,Number.MIN_VALUE,1,'amount');num(c.enterSec,.04,2,'enterSec');num(c.exitSec,.04,2,'exitSec');num(c.holdSec,.001,LIMITS.maxDuration,'holdSec');num(c.gapSec,.001,LIMITS.maxDuration,'gapSec');
    return Object.freeze({...c});
  });
  return Object.freeze({...p,candidates:Object.freeze(candidates)});
}

/** Fixed one-shot policy director. It owns the clock; all future input stays here. */
export class ExpressionDirector {
  #clock;#policy;#candidates;#queue=[];#maxLifetime=0;#time=0;#sealed=-Infinity;#lastSubmitted=-Infinity;
  #active=null;#phase='idle';#deadline=Infinity;#logicalArrival=null;#token=0;
  #busy=false;#onRecord;#pendingRecords=[];#observerFailure=null;#pendingTarget=null;#progress={complete:true,reached:0,target:0,steps:0};
  constructor(policy,apply,onRecord=()=>{}){
    this.#policy=validatePolicy(policy);this.#candidates=new Map(this.#policy.candidates.map(c=>[c.key,c]));
    if(typeof apply!=='function'||typeof onRecord!=='function')throw new TypeError('callbacks must be functions');
    this.#onRecord=onRecord;this.#clock=new FaceTimeline(policyIds(this.#policy),apply);
  }
  get hasInteraction(){return this.#active?.priority==='interaction'||this.#queue.some(b=>b.events.some(e=>e.type==='request'&&e.priority==='interaction'));}
  get observerStatus(){return Object.freeze({enabled:this.#onRecord!==null,failure:this.#observerFailure});}
  get time(){return this.#time;}
  get policy(){return this.#policy;}
  get maxAdmittedLifetime(){return this.#maxLifetime;}
  get activeLifetime(){return this.#active?.lifetime??null;}
  get progress(){return Object.freeze({...this.#progress});}
  get state(){return Object.freeze({time:this.#time,phase:this.#phase,owner:this.#active?.owner??null,requestId:this.#active?.requestId??null,candidate:this.#active?.candidate??null,token:this.#token,logicalArrival:this.#logicalArrival,path:this.#clock.path,amount:this.#clock.value,clockArrival:this.#clock.arrivalTime,clockActualArrival:this.#clock.actualArrival,deadline:this.#deadline,queued:this.#queue.length});}
  #guard(){if(this.#busy)throw new Error('reentrant director mutation');}
  #log(type,extra={}){
    if(this.#onRecord===null)return;
    // At most request+arrival+exit or release+exit+gap at one boundary.
    if(this.#pendingRecords.length>=4)throw new Error('diagnostic boundary capacity invariant');
    this.#pendingRecords.push(Object.freeze({type,time:this.#time,token:this.#token,...extra}));
  }
  #disableObserver(kind,event){
    this.#observerFailure=Object.freeze({kind,eventType:event.type,time:event.time,token:event.token});
    this.#onRecord=null;this.#pendingRecords.length=0;
  }
  #deliverRecords(){
    while(this.#pendingRecords.length){
      const event=this.#pendingRecords.shift();
      try{
        const result=this.#onRecord(event);
        if(result instanceof Promise){
          // The supported observer is synchronous. Do not leak native async rejection.
          Promise.prototype.then.call(result,()=>undefined,()=>undefined);
          this.#disableObserver('async-return',event);
        }
      }catch{
        // Never inspect a thrown value: even .message may be a user-defined getter.
        this.#disableObserver('throw',event);
      }
    }
  }
  submit(batch){
    this.#guard();if(this.#pendingTarget!==null)throw new Error('finish pending advance before submitting');
    record(batch,['time','events'],'batch');num(batch.time,0,LIMITS.maxTime-LIMITS.inputHeadroom,'time');
    if(batch.time<=this.#sealed||batch.time<=this.#lastSubmitted)throw new RangeError('timestamp sealed or not strictly increasing');
    array(batch.events,1,LIMITS.maxEvents,'events');if(this.#queue.length>=LIMITS.maxBatches)throw new RangeError('batch queue capacity');
    let maxLifetime=this.#maxLifetime;
    const events=batch.events.map(e=>{
      // Inspect the type descriptor before reading it, so accessors never execute.
      const type=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'type')?.value:undefined;
      if(type==='request'){
        record(e,['type','owner','requestId','lifetime','priority','candidate','holdMode'],'request');id(e.owner);id(e.requestId);id(e.candidate);integer(e.lifetime,1,Number.MAX_SAFE_INTEGER,'lifetime');
        if(e.lifetime<=maxLifetime)throw new RangeError('request lifetime must be globally increasing');maxLifetime=e.lifetime;
        if(typeof e.priority!=='string'||!Object.hasOwn(rank,e.priority)||!['keep','restart'].includes(e.holdMode)||!this.#candidates.has(e.candidate))throw new RangeError('unsupported request');
      }else if(type==='release'){record(e,['type','owner','requestId','lifetime'],'release');id(e.owner);id(e.requestId);integer(e.lifetime,1,Number.MAX_SAFE_INTEGER,'lifetime');}
      else if(type==='reset'){record(e,['type','exitSec'],'reset');num(e.exitSec,.04,2,'reset exit');}
      else throw new TypeError('unsupported event');
      return Object.freeze({...e});
    });
    this.#queue.push(Object.freeze({time:batch.time,events:Object.freeze(events)}));this.#lastSubmitted=batch.time;this.#maxLifetime=maxLifetime;return this;
  }
  #next(){return Math.min(this.#queue[0]?.time??Infinity,this.#deadline);}
  nextDeadline(){return this.#pendingTarget!==null?this.#time:this.#next();}
  isAnimating(){return this.#pendingTarget!==null||this.#clock.isAnimating();}
  #cue(c,amount,out){this.#clock.enqueue({type:'face',time:this.#time,id:c.faceId,amount,fadeInSec:c.enterSec,fadeOutSec:out});return this.#clock.advance(this.#time);}
  #request(e){
    const prior=this.#active,oldPhase=this.#phase,oldArrival=this.#logicalArrival,oldDeadline=this.#deadline;
    const c=this.#candidates.get(e.candidate),out=prior?this.#candidates.get(prior.candidate).exitSec:c.exitSec;
    this.#active=e;this.#token++;this.#phase='enter';this.#logicalArrival=null;
    const settled=!this.#clock.isAnimating()&&this.#clock.path===c.faceId&&this.#clock.value===c.amount;
    const changed=settled?false:this.#cue(c,c.amount,out);
    this.#log('request',{owner:e.owner,requestId:e.requestId,lifetime:e.lifetime,candidate:e.candidate});
    if(!this.#clock.isAnimating()&&this.#clock.path===c.faceId&&this.#clock.value===c.amount){
      const keep=e.holdMode==='keep'&&prior?.owner===e.owner&&prior.candidate===e.candidate&&oldPhase==='hold';
      this.#phase='hold';this.#logicalArrival=keep?oldArrival:this.#time;this.#deadline=keep?oldDeadline:this.#time+c.holdSec;
      this.#log('arrival',{logicalArrival:this.#logicalArrival,clockActualArrival:this.#clock.actualArrival});
    }else this.#deadline=this.#clock.arrivalTime;
    return changed;
  }
  #exit(reason){
    const c=this.#candidates.get(this.#active.candidate);this.#phase='exit';this.#logicalArrival=null;
    const changed=this.#cue(c,0,c.exitSec);this.#deadline=this.#clock.arrivalTime;this.#log('exit-start',{reason});return changed;
  }
  #finish(){this.#log('done');this.#active=null;this.#phase='idle';this.#logicalArrival=null;this.#deadline=Infinity;}
  #batch(events){
    const resets=events.filter(e=>e.type==='reset');
    if(resets.length){
      const reset=resets.at(-1);this.#token++;this.#active=null;this.#phase='reset';this.#logicalArrival=null;
      this.#queue.length=0;this.#lastSubmitted=this.#time;
      this.#clock.enqueue({type:'cancel',time:this.#time,fadeOutSec:reset.exitSec});const changed=this.#clock.advance(this.#time);
      this.#deadline=this.#clock.arrivalTime;this.#log('reset');return changed;
    }
    const released=this.#active&&events.some(e=>e.type==='release'&&e.owner===this.#active.owner&&e.requestId===this.#active.requestId&&e.lifetime===this.#active.lifetime);
    let winner=null,best=released||!this.#active?-1:rank[this.#active.priority];
    for(const e of events)if(e.type==='request'&&rank[e.priority]>=best){winner=e;best=rank[e.priority];}
    if(winner)return this.#request(winner);
    if(released){
      this.#token++;this.#log('release',{owner:this.#active.owner,requestId:this.#active.requestId,lifetime:this.#active.lifetime});
      if(this.#phase==='gap'){this.#finish();return false;}
      if(this.#phase==='exit')return false;
      return this.#exit('release');
    }
    return false;
  }
  #boundary(){
    if(this.#phase==='enter'){
      const c=this.#candidates.get(this.#active.candidate);
      if(this.#clock.isAnimating()||this.#clock.path!==c.faceId||this.#clock.value!==c.amount||this.#clock.actualArrival===null)throw new Error('arrival invariant');
      this.#phase='hold';this.#logicalArrival=this.#time;this.#deadline=this.#time+c.holdSec;this.#log('arrival',{logicalArrival:this.#time,clockActualArrival:this.#clock.actualArrival});return false;
    }
    if(this.#phase==='hold')return this.#exit('hold-expired');
    if(this.#phase==='exit'){
      if(this.#clock.isAnimating()||this.#clock.path!==null)throw new Error('Basis arrival invariant');
      this.#phase='gap';this.#deadline=this.#time+this.#candidates.get(this.#active.candidate).gapSec;this.#log('gap-start');return false;
    }
    if(this.#phase==='gap'||this.#phase==='reset'){this.#finish();return false;}
    throw new Error('unexpected internal boundary');
  }
  advance(target,maxSteps=64){
    this.#guard();num(target,0,LIMITS.maxTime,'target');integer(maxSteps,1,LIMITS.maxSteps,'maxSteps');
    if(target<this.#time||(this.#pendingTarget!==null&&target<this.#pendingTarget))throw new RangeError('clock/target must be monotonic');
    this.#busy=true;let changed=false,steps=0;
    try{
      while(this.#next()<=target&&steps<maxSteps){
        const at=this.#next();if(at<this.#time)throw new Error('past internal boundary');
        changed=this.#clock.advance(at)||changed;this.#time=at;this.#sealed=at;
        if(this.#queue[0]?.time===at){const events=this.#queue.shift().events;changed=this.#batch(events)||changed;}
        // New intent wins before old expiry. A zero-distance exit may finish now.
        if(this.#deadline===at)changed=this.#boundary()||changed;
        // Deliver observations only after all core transitions at this timestamp commit.
        this.#deliverRecords();
        steps++;
      }
      const complete=this.#next()>target;
      if(complete){changed=this.#clock.advance(target)||changed;this.#time=target;this.#sealed=target;this.#pendingTarget=null;}
      else this.#pendingTarget=target;
      this.#progress={complete,reached:this.#time,target,steps};return changed;
    }finally{this.#busy=false;}
  }
}

// Shared strict data-boundary validators; owner must validate before inspecting batches.
export {record as assertDataRecord,array as assertDenseDataArray};
