export const LIMITS=Object.freeze({candidates:32,contexts:32,maxDuration:3600,maxWeight:0xffffffff,maxTime:99990000});
function exact(x,keys){if(!x||typeof x!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(x)))throw TypeError('plain record required');const ds=Object.getOwnPropertyDescriptors(x),ks=Reflect.ownKeys(x);if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))throw TypeError('exact data fields required');}
function list(x,max){if(!Array.isArray(x)||Object.getPrototypeOf(x)!==Array.prototype||x.length>max)throw TypeError('array bounds');const ds=Object.getOwnPropertyDescriptors(x);if(Reflect.ownKeys(x).length!==x.length+1||Array.from({length:x.length},(_,i)=>i).some(i=>!Object.hasOwn(ds[i]??{},'value')))throw TypeError('dense data array required');}
function number(x,lo,hi){if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)throw RangeError('number bounds');return x;}
function integer(x,lo,hi){number(x,lo,hi);if(!Number.isInteger(x))throw RangeError('integer required');return x;}
function id(x){if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(x))throw TypeError('identifier');return x;}
function duration(x){const kind=Object.getOwnPropertyDescriptor(x??{},'kind')?.value;if(kind==='fixed'){exact(x,['kind','sec']);number(x.sec,.001,LIMITS.maxDuration);}else if(kind==='uniform'){exact(x,['kind','minSec','maxSec']);number(x.minSec,.001,LIMITS.maxDuration);number(x.maxSec,x.minSec,LIMITS.maxDuration);if(x.maxSec===x.minSec)throw RangeError('use fixed for degenerate range');}else throw TypeError('duration kind');return Object.freeze({...x});}
export function validatePolicy(p,admission){
 exact(admission,['sourceSha256','profileSha256','faceIds']);list(admission.faceIds,64);admission.faceIds.forEach(id);
 exact(p,['format','version','sourceSha256','profileSha256','rng','candidates','contexts']);
 if(p.format!=='bubu-expression-scheduler'||p.version!=='0.1.0-p1'||p.sourceSha256!==admission.sourceSha256||p.profileSha256!==admission.profileSha256)throw RangeError('policy admission mismatch');
 for(const h of [p.sourceSha256,p.profileSha256])if(typeof h!=='string'||!/^[0-9a-f]{64}$/.test(h))throw TypeError('digest');
 exact(p.rng,['algorithm','seed']);if(p.rng.algorithm!=='xorshift32-split-v1')throw RangeError('rng algorithm');integer(p.rng.seed,1,0xffffffff);
 list(p.candidates,LIMITS.candidates);list(p.contexts,LIMITS.contexts);const keys=new Set();let sum=0;
 const candidates=p.candidates.map(c=>{exact(c,['key','faceId','amount','selectionWeight','enterSec','exitSec','hold','gap','cooldownSec','sources']);id(c.key);id(c.faceId);if(keys.has(c.key)||!admission.faceIds.includes(c.faceId))throw RangeError('candidate identity');keys.add(c.key);number(c.amount,Number.MIN_VALUE,1);integer(c.selectionWeight,0,LIMITS.maxWeight);sum+=c.selectionWeight;if(sum>LIMITS.maxWeight)throw RangeError('total weight');number(c.enterSec,.04,2);number(c.exitSec,.04,2);number(c.cooldownSec,0,LIMITS.maxDuration);list(c.sources,32);c.sources.forEach(id);if(new Set(c.sources).size!==c.sources.length)throw RangeError('duplicate source');return Object.freeze({...c,hold:duration(c.hold),gap:duration(c.gap),sources:Object.freeze([...c.sources])});});
 const contexts=new Set();const compiled=p.contexts.map(c=>{exact(c,['key','candidates','excludeRecent']);id(c.key);if(contexts.has(c.key))throw RangeError('duplicate context');contexts.add(c.key);list(c.candidates,LIMITS.candidates);if(new Set(c.candidates).size!==c.candidates.length||c.candidates.some(k=>!keys.has(k)))throw RangeError('context candidate reference');integer(c.excludeRecent,0,LIMITS.candidates);return Object.freeze({...c,candidates:Object.freeze([...c.candidates])});});
 return Object.freeze({...p,rng:Object.freeze({...p.rng}),candidates:Object.freeze(candidates),contexts:Object.freeze(compiled)});
}
function stream(seed,salt){let s=(seed^salt)>>>0;if(!s)s=0x6d2b79f5;return {state:s,draws:0};}
function draw(r){let x=r.state;x^=x<<13;x^=x>>>17;x^=x<<5;r.state=x>>>0;r.draws++;return r.state;}
// xorshift32 has a 2^32-1 nonzero output domain; map it to 0..2^32-2 first.
function bounded(r,n){const domain=0xffffffff,limit=domain-domain%n;let v;do{v=draw(r)-1;}while(v>=limit);return v%n;}
function sample(r,d){return d.kind==='fixed'?d.sec:d.minSec+(draw(r)-1)/0xffffffff*(d.maxSec-d.minSec);}
export class WeightedScheduler {
 #policy;#rng;#cooldowns=new Map();#recent=[];#active=null;#time=0;#decisions=0;#busy=false;
 constructor(policy,admission){this.#policy=validatePolicy(policy,admission);this.#rng={selection:stream(policy.rng.seed,0x9e3779b9),hold:stream(policy.rng.seed,0x243f6a88),gap:stream(policy.rng.seed,0xb7e15162)};}
 get policy(){return this.#policy;}
 get state(){return Object.freeze({decisions:this.#decisions,active:this.#active?.key??null,recent:this.#recent.map(r=>Object.freeze({...r})),rng:Object.fromEntries(Object.entries(this.#rng).map(([k,v])=>[k,{...v}]))});}
 #at(t){number(t,0,LIMITS.maxTime);if(t<this.#time)throw RangeError('monotonic time');this.#time=t;}
 validateFacts(f){exact(f,['context','source','enabled','interactionOwned']);id(f.context);id(f.source);if(!this.#policy.contexts.some(c=>c.key===f.context)||typeof f.enabled!=='boolean'||typeof f.interactionOwned!=='boolean')throw TypeError('facts');return Object.freeze({...f});}
 isAllowed(key,f){const c=this.#policy.candidates.find(c=>c.key===key),ctx=this.#policy.contexts.find(c=>c.key===f.context);return Boolean(f.enabled&&!f.interactionOwned&&c&&ctx.candidates.includes(key)&&c.sources.includes(f.source));}
 decide(time,facts,accept){
  if(this.#busy)throw Error('reentrant scheduler');this.#busy=true;try{
  const f=this.validateFacts(facts);if(typeof accept!=='function')throw TypeError('accept callback');this.#at(time);
  if(this.#active||!f.enabled||f.interactionOwned)return Object.freeze({accepted:false,nextDeadline:Infinity,reason:'owned-or-disabled'});
  const ctx=this.#policy.contexts.find(c=>c.key===f.context),recent=ctx.excludeRecent?this.#recent.slice(-ctx.excludeRecent):[];let next=Infinity;const eligible=[];
  for(const key of ctx.candidates){const c=this.#policy.candidates.find(c=>c.key===key);if(!c.selectionWeight||!c.sources.includes(f.source)||(ctx.excludeRecent&&recent.some(r=>r.key===key||r.faceId===c.faceId)))continue;const until=this.#cooldowns.get(c.faceId)??0;if(until>time){next=Math.min(next,until);continue;}eligible.push(c);}
  if(!eligible.length)return Object.freeze({accepted:false,nextDeadline:next,reason:'empty'});
  const rng=Object.fromEntries(Object.entries(this.#rng).map(([k,v])=>[k,{...v}]));let ticket=bounded(rng.selection,eligible.reduce((s,c)=>s+c.selectionWeight,0));let c=eligible.at(-1);for(const entry of eligible){if(ticket<entry.selectionWeight){c=entry;break;}ticket-=entry.selectionWeight;}
  const intent=Object.freeze({key:c.key,faceId:c.faceId,amount:c.amount,enterSec:c.enterSec,exitSec:c.exitSec,holdSec:sample(rng.hold,c.hold),gapSec:sample(rng.gap,c.gap)});
  const accepted=accept(intent);if(typeof accepted!=='boolean')throw TypeError('accept must return boolean');if(!accepted)return Object.freeze({accepted:false,nextDeadline:Infinity,reason:'rejected'});
  this.#rng=rng;this.#active=c;this.#decisions++;this.#recent.push({key:c.key,faceId:c.faceId});if(this.#recent.length>LIMITS.candidates)this.#recent.shift();return Object.freeze({accepted:true,nextDeadline:Infinity,intent});
  }finally{this.#busy=false;}
 }
 lose(time){if(this.#busy)throw Error('reentrant scheduler');this.#at(time);if(this.#active){const c=this.#active;this.#cooldowns.set(c.faceId,Math.max(this.#cooldowns.get(c.faceId)??0,time+c.cooldownSec));this.#active=null;}}
}
