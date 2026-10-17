import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger,restoreLedger} from '../bubu-theme-state-ledger-v1-20261017/src/ledger.mjs';
import {T,config,event,revise} from '../bubu-theme-state-ledger-v1-20261017/fixtures/fixtures.mjs';
const clone = structuredClone;
const theme = (l,n=T) => l.project(n).themes[0];
const active = (l,n=T) => l.project(n).sources.filter(x=>x.active);
function rejectAtomic(l, fn, code) { const before=l.snapshot(); assert.throws(fn,e=>!code||e.code===code); assert.deepEqual(l.snapshot(),before); }
function rev(e, overrides={}) { return revise(e,{committedAt:T+1000,receivedAt:T+1000,...overrides}); }
function revoke(e,overrides={}) {return rev(e,{operation:'revoke',completionState:'revoked',revokeReason:'fixture:undo',...overrides});}
function fresh(i,overrides={}) {return event({entityId:`fixture:${i}`,completionOrdinal:i,eventId:`fixture:e${i}`,transactionId:`fixture:t${i}`,...overrides});}

test('long/short union both arrival orders, independent reversal and precise boundaries',()=>{
  for(const order of [0,1]) {
    const l=createLedger(config()), long=fresh(1), short=fresh(2,{sourceKind:'feed'});
    l.applyBatch(order?[short,long]:[long,short],T);
    assert.equal(theme(l).expiresAt,T+600000); assert.equal(theme(l).sourceIds.length,2);
    assert.equal(active(l,T+29999).length,2); assert.equal(active(l,T+30000).length,1);
    assert.equal(theme(l,T+599999).expiresAt,T+600000); assert.equal(l.project(T+600000).themes.length,0);
  }
  const l=createLedger(config()),a=fresh(1),b=fresh(2,{sourceKind:'feed'}); l.applyBatch([a,b],T);
  l.applyBatch([revoke(a)],T+1000); assert.equal(theme(l,T+1000).expiresAt,T+30000);
  assert.equal(l.project(T+30000).themes.length,0);
});
test('short revoke preserves long and simultaneous expiry removes entire union',()=>{
 const l=createLedger(config()),a=fresh(1),b=fresh(2,{sourceKind:'feed'});l.applyBatch([a,b],T);l.applyBatch([revoke(b)],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+600000);
 const q=createLedger(config());q.applyBatch([fresh(1),fresh(2)],T);assert.equal(active(q,T+599999).length,2);assert.equal(active(q,T+600000).length,0);
});
test('two true completions union deadlines never accumulate',()=>{
 const l=createLedger(config());l.applyBatch([fresh(1)],T);l.applyBatch([fresh(2,{occurredAt:T+5000})],T+5000);assert.equal(theme(l,T+5000).expiresAt,T+605000);
});
test('same semantic identity remains idempotent across event ID and delivery receive time',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);
 assert.equal(l.applyBatch([{...e,eventId:'new-delivery',receivedAt:T+2000}],T+2000).results[0],'duplicate');
 assert.equal(theme(l,T+2000).expiresAt,T+600000);assert.equal(l.snapshot().records.length,1);
 rejectAtomic(l,()=>l.applyBatch([{...e,transactionId:'different'}],T+2000),'REVISION_CONFLICT');
});
test('revoke-first, edit-first, correction-first never gain admission via older or newer completion',()=>{
 for(const operation of ['revoke','edit','correct']) {
  const l=createLedger(config()),e=event();const later=operation==='revoke'?revoke(e):rev(e,{operation});l.applyBatch([later],T+1000);l.applyBatch([e],T+1000);
  l.applyBatch([rev(later,{revision:3,operation:'complete',completionState:'completed',revokeReason:null})],T+1000); assert.equal(active(l,T+1000).length,0);
 }
});
test('ordinary out of order revoke and same-generation recomplete preserve original deadline',()=>{
 const l=createLedger(config()),e=event(),r=revoke(e);l.applyBatch([e],T);l.applyBatch([r],T+1000);l.applyBatch([e],T+1000);assert.equal(active(l,T+1000).length,0);
 const c=rev(r,{revision:3,operation:'complete',completionState:'completed',revokeReason:null,occurredAt:T+1000});l.applyBatch([c],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+600000);
});
test('occurrence slot reused for genuine new generation is independent, old revoke cannot hit new',()=>{
 const l=createLedger(config()),a=event(),b=event({completionGeneration:'fixture:g2',completionOrdinal:2,occurredAt:T+2000});l.applyBatch([a],T);l.applyBatch([revoke(a),b],T+2000);
 assert.equal(active(l,T+2000).length,1);assert.equal(theme(l,T+2000).expiresAt,T+602000); l.applyBatch([a],T+2000);assert.equal(active(l,T+2000).length,1);
});
test('ordinal collision and identity ordinal mutation reject atomically',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);
 rejectAtomic(l,()=>l.applyBatch([fresh(2,{completionOrdinal:1})],T),'ORDINAL_IDENTITY_CONFLICT');
 rejectAtomic(l,()=>l.applyBatch([{...e,completionOrdinal:2}],T),'IDENTITY_ORDINAL_CONFLICT');
});
test('edit and correction cannot extend, earlier correction shortens even after out-of-order delivery',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);
 const edit=rev(e,{operation:'edit',occurredAt:T+1000});l.applyBatch([edit],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+600000);
 const early=rev(edit,{operation:'correct',occurredAt:T-10000,deadlineOccurredAt:T-10000});l.applyBatch([early],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+590000);
 const later=rev(early,{operation:'edit',occurredAt:T+1000});l.applyBatch([later],T+1000);l.applyBatch([edit],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+590000);
 rejectAtomic(l,()=>l.applyBatch([rev(later,{deadlineOccurredAt:T})],T+1000),'DEADLINE_EXTENSION');
});
for(const origin of ['historical_backfill','history_edit','recovery_sync']) test(`${origin} cannot initially activate or be promoted`,()=>{
 const l=createLedger(config()),e=event({origin,original:{...event().original,origin}});l.applyBatch([e],T);assert.equal(active(l).length,0);
 l.applyBatch([rev(e,{origin:'live_completion'})],T+1000);assert.equal(active(l,T+1000).length,0);
 rejectAtomic(l,()=>l.applyBatch([rev(e,{revision:3,original:event().original})],T+1000),'ORIGINAL_CHANGED');
});
for(const [label,change,code] of [
 ['uncommitted',{postCommit:false},'NOT_POSTCOMMIT'],['feed replay receipt',{sourceKind:'feed',replayed:true},'REPLAY_RECEIPT_NOT_EVENT'],
 ['failed operation',{operation:'failed'},'ENUM_INVALID'],['cancelled operation',{operation:'cancelled'},'ENUM_INVALID'],['pending operation',{operation:'pending'},'ENUM_INVALID'],
 ['untrusted UTC',{timeDomain:'local'},'UNTRUSTED_TIME'],['future receive',{receivedAt:T+1},'TIME_ORDER'],
 ['unknown namespace',{namespace:'unknown'},'UNKNOWN_NAMESPACE']]) test(`${label} rejected without partial mutation`,()=>{const l=createLedger(config());rejectAtomic(l,()=>l.applyBatch([fresh(2),event(change)],T),code);});
test('feed transaction durable duplicate versus true second feed',()=>{
 const l=createLedger(config()),e=event({sourceKind:'feed'});l.applyBatch([e],T);l.applyBatch([{...e,eventId:'redelivered',receivedAt:T+5000}],T+5000);assert.equal(theme(l,T+5000).expiresAt,T+30000);
 l.applyBatch([fresh(2,{sourceKind:'feed',occurredAt:T+5000})],T+5000);assert.equal(theme(l,T+5000).expiresAt,T+35000);
});
for(const sec of [undefined,600,601,750,899,900])test(`routine fixed duration ${sec??'default'}`,()=>{const c=config();if(sec!==undefined)c.mappings[0].durationSec=sec;const l=createLedger(c);l.applyBatch([event()],T);assert.equal(theme(l).expiresAt,T+(sec??600)*1000);});
for(const sec of [0,-1,599,901,600.1,NaN,Infinity,Number.MAX_SAFE_INTEGER])test(`invalid routine duration ${sec}`,()=>{const c=config();c.mappings[0].durationSec=sec;assert.throws(()=>createLedger(c));});
for(const sec of [29,31,600])test(`feed duration ${sec} rejected`,()=>{const c=config();c.mappings[1].durationSec=sec;assert.throws(()=>createLedger(c));});
for(const mode of ['missing','unapproved','unready','unknowncap','wrongtitle'])test(`mapping gate ${mode} pins noneligible`,()=>{
 const c=config(),e=event();if(mode==='missing')c.mappings=[];if(mode==='unapproved')c.mappings[0].approved=false;if(mode==='unready')c.capabilities[0].runtimeReady=false;if(mode==='unknowncap')c.mappings[0].requiredCapabilities=['unknown'];if(mode==='wrongtitle')e.original.definitionId='coffee';
 const l=createLedger(c);l.applyBatch([e],T);assert.equal(active(l).length,0);
 // External registry mutation cannot change a previously accepted fact.
 c.mappings=config().mappings;c.capabilities=config().capabilities;l.applyBatch([rev(e)],T+1000);assert.equal(active(l,T+1000).length,0);
});
test('hidden elapsed facts expire and restored facts retain only original remaining time',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);const s=l.snapshot();
 const r=restoreLedger(s,T+599999);assert.equal(theme(r,T+599999).expiresAt,T+600000);assert.equal(active(r,T+600000).length,0);
 const expired=restoreLedger(s,T+900000);assert.equal(active(expired,T+900000).length,0);assert.equal(active(l,T+900000).length,0);
});
test('delayed event after TTL is remembered without activation; before TTL gets remainder',()=>{
 for(const delay of [500000,600000,900000]){const l=createLedger(config());l.applyBatch([event({receivedAt:T+delay})],T+delay);assert.equal(active(l,T+delay).length,delay<600000?1:0);assert.equal(l.snapshot().records.length,1);}
});
test('UTC rollback fails closed, forward jumps expire, exact zero is valid',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);rejectAtomic(l,()=>l.project(T-1),'CLOCK_ROLLBACK');assert.throws(()=>restoreLedger(l.snapshot(),T-1),e=>e.code==='CLOCK_ROLLBACK');
 assert.equal(active(l,T+10000000).length,0);rejectAtomic(l,()=>l.applyBatch([event()],T),'CLOCK_ROLLBACK');
 const z=createLedger(config());z.applyBatch([event({occurredAt:0})],0);assert.equal(theme(z,0).expiresAt,600000);
});
for(const n of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,{}])test(`unsafe now ${String(n)} rejected`,()=>{const l=createLedger(config());rejectAtomic(l,()=>l.project(n));});
test('maximum event time overflow rejected, safe endpoint accepted',()=>{
 const l=createLedger(config()),t=Number.MAX_SAFE_INTEGER-900000;l.applyBatch([event({occurredAt:t})],t);assert.equal(theme(l,t).expiresAt,t+600000);
 const q=createLedger(config());rejectAtomic(q,()=>q.applyBatch([event({occurredAt:t+1})],t+1),'TIME_OVERFLOW');
});
test('source namespace isolation; switch does not retarget prior source; only matching invalidation',()=>{
 const l=createLedger(config()),a=event(),b=event({namespace:'fixture:account-b'});l.applyBatch([a,b],T);assert.equal(active(l).length,2);l.applyBatch([revoke(a)],T+1000);assert.equal(active(l,T+1000)[0].namespace,'fixture:account-b');
});
test('detection/focus inputs cannot mutate ledger and projection never claims visuals',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);for(const extra of [{detectionEnabled:false},{focusBackground:'anything'},{visible:true},{durationSec:999}])rejectAtomic(l,()=>l.applyBatch([{...event(),...extra}],T),'UNKNOWN_FIELD');
 for(const p of [...l.project(T).sources,...l.project(T).themes])for(const k of ['selected','visible','performing'])assert.equal(p[k],false);
});
test('capacity exhaustion atomic, no eviction; seals refuse live range and preserve replay rejection',()=>{
 const c=config();c.maxRecords=2;const l=createLedger(c);l.applyBatch([fresh(1),fresh(2)],T);
 rejectAtomic(l,()=>l.applyBatch([fresh(3)],T),'CAPACITY_REQUIRES_SEAL');rejectAtomic(l,()=>l.seal('fixture:account-a',2,'cp1',T),'SEAL_LIVE_RANGE');
 assert.equal(l.seal('fixture:account-a',1,'cp1',T+600000).removed,1);l.applyBatch([fresh(3,{occurredAt:T+600000})],T+600000);
 rejectAtomic(l,()=>l.applyBatch([fresh(1)],T+600000),'SEALED_HISTORY');rejectAtomic(l,()=>l.applyBatch([fresh(9,{completionOrdinal:1})],T+600000),'SEALED_HISTORY');
 const r=restoreLedger(l.snapshot(),T+600000);rejectAtomic(r,()=>r.applyBatch([fresh(1)],T+600000),'SEALED_HISTORY');assert.equal(r.snapshot().records.length,2);
});
test('revoked original-eligible range cannot seal before original expiry',()=>{const l=createLedger(config()),e=event();l.applyBatch([e],T);l.applyBatch([revoke(e)],T+1000);rejectAtomic(l,()=>l.seal(e.namespace,1,'cp',T+1000),'SEAL_LIVE_RANGE');l.seal(e.namespace,1,'cp',T+600000);assert.equal(l.snapshot().records.length,0);});
test('seal is namespace scoped and monotonic, unseen lower identity permanently closed',()=>{
 const l=createLedger(config());l.seal('fixture:account-a',20,'cp',T);rejectAtomic(l,()=>l.seal('fixture:account-a',20,'cp',T),'SEAL_NOT_ADVANCING');rejectAtomic(l,()=>l.applyBatch([fresh(15)],T),'SEALED_HISTORY');l.applyBatch([fresh(1,{namespace:'fixture:account-b'})],T);assert.equal(active(l).length,1);
});
test('bounded 200 cycles of capacity/expiry/seal/restore with no replay resurrection',()=>{
 const c=config();c.maxRecords=3;let l=createLedger(c);let now=T;
 for(let i=1;i<=200;i++){const e=fresh(i,{occurredAt:now});l.applyBatch([e],now);assert.ok(l.snapshot().records.length<=3);now+=600000;l.seal(e.namespace,i,`cp${i}`,now);l=restoreLedger(l.snapshot(),now);rejectAtomic(l,()=>l.applyBatch([e],now),'SEALED_HISTORY');assert.equal(l.snapshot().records.length,0);}
 assert.equal(l.snapshot().seals.length,2);
});
test('snapshots, input events, config and projection are isolated copies',()=>{
 const c=config(),l=createLedger(c),e=event();l.applyBatch([e],T);e.original.occurredAt=0;c.mappings[0].durationSec=900;const s=l.snapshot();s.records[0].latest.deadlineOccurredAt=0;s.config.mappings[0].durationSec=900;
 const p=l.project(T);p.sources[0].expiresAt=1;p.themes[0].sourceIds.push('fake');assert.equal(theme(l).expiresAt,T+600000);assert.equal(theme(l).sourceIds.length,1);
 const restoreInput=l.snapshot(),r=restoreLedger(restoreInput,T);restoreInput.records=[];assert.equal(active(r).length,1);
});
test('invalid last batch element cannot partially add or advance clock',()=>{const l=createLedger(config());rejectAtomic(l,()=>l.applyBatch([fresh(1),fresh(2,{postCommit:false})],T+1000),'NOT_POSTCOMMIT');assert.equal(l.snapshot().lastNow,0);});
test('snapshot invariants reject malformed last entry without mutating original',()=>{
 const l=createLedger(config());l.applyBatch([fresh(1),fresh(2)],T);const s=l.snapshot(),before=clone(s);
 for(const mutate of [s=>s.records[1].latest.original.definitionId='x',s=>s.records[1].latest.completionOrdinal=999,s=>s.records[1].latest.revision=0,s=>s.records[1].latest.namespace='fixture:account-b',s=>s.records.push(clone(s.records[0])),s=>s.seals[0].throughOrdinal=2,s=>s.records[1].latest.receivedAt=T+1,s=>s.records[1].first.original.occurredAt=T+1]){const bad=clone(s);mutate(bad);assert.throws(()=>restoreLedger(bad,T));assert.deepEqual(l.snapshot(),before);}
});
const hostileCases={
 getter(x,hit){Object.defineProperty(x,'eventId',{enumerable:true,get(){hit();return 'evil';}})},
 nestedGetter(x,hit){Object.defineProperty(x.original,'definitionId',{enumerable:true,get(){hit();return 'evil';}})},
 symbol(x){x[Symbol('hidden')]=1},nonenumerable(x){Object.defineProperty(x,'hidden',{value:1})},
 prototype(x){Object.setPrototypeOf(x,{inherited:true})},nullPrototype(x){Object.setPrototypeOf(x,null)},
 nestedSymbol(x){x.original[Symbol('hidden')]=1},nestedNonenumerable(x){Object.defineProperty(x.original,'hidden',{value:1})},
 toJSON(x,hit){x.toJSON=()=>{hit();return {}}},unsafeProto(x){Object.defineProperty(x,'__proto__',{value:1,enumerable:true})}
};
for(const [name,mutate] of Object.entries(hostileCases))test(`strict event boundary ${name}, no user code execution`,()=>{const l=createLedger(config()),e=event();let hits=0;mutate(e,()=>hits++);rejectAtomic(l,()=>l.applyBatch([e],T));assert.equal(hits,0);});
for(const [name,make] of Object.entries({hole:()=>new Array(1),extra:()=>Object.assign([event()],{other:1}),symbol:()=>Object.assign([event()],{[Symbol('s')]:1}),nonenumerable:()=>{const a=[event()];Object.defineProperty(a,'z',{value:1});return a},proxy:()=>new Proxy([event()],{get(){throw Error('TRAP_EXECUTED')}})}))test(`strict array boundary ${name}`,()=>{const l=createLedger(config());rejectAtomic(l,()=>l.applyBatch(make(),T));});
test('proxy event rejected before traps',()=>{const l=createLedger(config());let hits=0;const p=new Proxy(event(),{get(){hits++;throw Error('trap')},ownKeys(){hits++;throw Error('trap')},getPrototypeOf(){hits++;throw Error('trap')}});rejectAtomic(l,()=>l.applyBatch([p],T),'PROXY_REJECTED');assert.equal(hits,0);});
test('config and restore getters do not execute',()=>{let hits=0;const c=config();Object.defineProperty(c,'mappings',{get(){hits++;return []},enumerable:true});assert.throws(()=>createLedger(c));const l=createLedger(config()),s=l.snapshot();Object.defineProperty(s,'records',{get(){hits++;return []},enumerable:true});assert.throws(()=>restoreLedger(s,T));assert.equal(hits,0);});

test('independent randomized set-union oracle: 40 seeds × 150 transitions',()=>{
 // Independent model stores only four semantic values: accepted, revoked, deadline, version.
 for(let seed=1;seed<=40;seed++){
  let state=seed;const rng=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const l=createLedger(config()),model=new Map(),events=new Map();let n=T,next=1;
  for(let step=0;step<150;step++){
   n+=Math.floor(rng()*12000);const keys=[...events.keys()];
   if(keys.length===0||(rng()<0.4&&next<=120)){
    const i=next++,kind=rng()<0.5?'routine':'feed',e=fresh(i,{sourceKind:kind,occurredAt:n});l.applyBatch([e],n);events.set(i,e);model.set(i,{accepted:true,revoked:false,deadline:n+(kind==='routine'?600000:30000),version:1});
   }else{
    const i=keys[Math.floor(rng()*keys.length)],old=events.get(i),m=model.get(i),pick=rng();let e;
    if(pick<0.2){e={...old,eventId:`retry:${step}`,receivedAt:n};l.applyBatch([e],n)}
    else if(pick<0.55){e=revise(old,{operation:'revoke',completionState:'revoked',revokeReason:'fixture:undo',committedAt:n,receivedAt:n});l.applyBatch([e],n);events.set(i,e);m.revoked=true;m.version++;}
    else if(pick<0.8){const earlier=old.deadlineOccurredAt-Math.floor(rng()*10000);e=revise(old,{operation:'correct',occurredAt:earlier,deadlineOccurredAt:earlier,committedAt:n,receivedAt:n});l.applyBatch([e],n);events.set(i,e);m.deadline=earlier+(e.sourceKind==='routine'?600000:30000);m.version++;}
    else {e=revise(old,{operation:'complete',completionState:'completed',revokeReason:null,committedAt:n,receivedAt:n});l.applyBatch([e],n);events.set(i,e);m.revoked=false;m.version++;}
   }
   const expected=[...model].filter(([,m])=>m.accepted&&!m.revoked&&n<m.deadline),p=l.project(n);assert.equal(p.sources.filter(s=>s.active).length,expected.length,`seed ${seed}, step ${step}`);assert.equal(p.themes.length,expected.length?1:0);if(expected.length)assert.equal(p.themes[0].expiresAt,Math.max(...expected.map(([,m])=>m.deadline)));
   if(step%17===0){const r=restoreLedger(l.snapshot(),n);assert.deepEqual(r.project(n),p);}
  }
 }
});

test('mapping/version/delivery-generation changes cannot re-admit same instance',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);
 for(const original of [{...e.original,mappingVersion:'fixture:v2'},{...e.original,definitionId:'fixture:other'},{...e.original,occurredAt:T-1}])rejectAtomic(l,()=>l.applyBatch([rev(e,{original,deadlineOccurredAt:Math.min(e.deadlineOccurredAt,original.occurredAt)})],T+1000),'ORIGINAL_CHANGED');
 rejectAtomic(l,()=>l.applyBatch([{...e,deliveryGeneration:'reconnected'}],T),'UNKNOWN_FIELD');assert.equal(theme(l).expiresAt,T+600000);
});
test('same-version conflict and chronological commit rollback cannot overwrite existing state',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);const x=rev(e);l.applyBatch([x],T+1000);
 rejectAtomic(l,()=>l.applyBatch([{...x,operation:'edit'}],T+1000),'REVISION_CONFLICT');
 rejectAtomic(l,()=>l.applyBatch([rev(x,{committedAt:T,receivedAt:T+1000})],T+1000),'COMMIT_ROLLBACK');
});
test('batch sorted revisions resolves out-of-order batch; atomic conflict leaves prior admission untouched',()=>{
 const l=createLedger(config()),e=event(),r=revoke(e);l.applyBatch([r,e],T+1000);assert.equal(active(l,T+1000).length,0);
 const q=createLedger(config());rejectAtomic(q,()=>q.applyBatch([e,{...e,operation:'edit'}],T),'REVISION_CONFLICT');
});
test('cross-field timestamps and numeric identifiers are strict',()=>{
 for(const fields of [{committedAt:T-1},{occurredAt:T+1},{deadlineOccurredAt:T+1},{original:{...event().original,committedAt:T+1}},{completionOrdinal:0},{revision:-1},{revision:1.5},{eventId:12},{completionGeneration:''}]){
  const l=createLedger(config());rejectAtomic(l,()=>l.applyBatch([event(fields)],T));
 }
});
test('nested config strict symbols/prototypes and sparse capability list are rejected',()=>{
 for(const mutate of [c=>c.mappings[0][Symbol('x')]=1,c=>Object.setPrototypeOf(c.capabilities[0],null),c=>delete c.mappings[0].requiredCapabilities[0],c=>Object.defineProperty(c.mappings[0],'secret',{value:1})]){const c=config();mutate(c);assert.throws(()=>createLedger(c));}
});
test('strict restored snapshot rejects hidden and executable nested fields',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);let hits=0;
 for(const mutate of [s=>Object.defineProperty(s.records[0].latest.original,'definitionId',{enumerable:true,get(){hits++;return 'x'}}),s=>s.seals[0][Symbol('x')]=1,s=>Object.defineProperty(s.config.mappings[0],'x',{value:1}),s=>Object.setPrototypeOf(s.records[0],null)]){const s=l.snapshot();mutate(s);assert.throws(()=>restoreLedger(s,T));}
 assert.equal(hits,0);
});

test('regression: largest legal record capacity with max registry shape restores losslessly',()=>{
 // Literal bounds deliberately independent of exported constants; changes need re-review.
 const c=config();c.maxRecords=4096;c.namespaces=Array.from({length:32},(_,i)=>i===0?'fixture:account-a':`fixture:namespace${i}`);
 c.capabilities=Array.from({length:256},(_,i)=>({id:`fixture:cap${i}`,approved:true,runtimeReady:true,channel:'environment.overlay'}));
 const baseline=c.mappings[0];c.mappings=Array.from({length:256},(_,i)=>({...baseline,definitionId:i===0?baseline.definitionId:`fixture:preset${i}`,requiredCapabilities:c.capabilities.slice(0,64).map(x=>x.id)}));
 const l=createLedger(c);
 for(let start=1;start<=4096;start+=128)l.applyBatch(Array.from({length:128},(_,j)=>fresh(start+j)),T);
 assert.equal(l.snapshot().records.length,4096);rejectAtomic(l,()=>l.applyBatch([fresh(4097)],T),'CAPACITY_REQUIRES_SEAL');
 const s=l.snapshot(),r=restoreLedger(s,T+1);assert.deepEqual(r.project(T+1),l.project(T+1));assert.equal(r.snapshot().records.length,4096);
 const oversized=config();oversized.maxRecords=4097;assert.throws(()=>createLedger(oversized),e=>e.code==='CAPACITY_LIMIT');
});

test('complete-state snapshots after missed recompletion preserve eligibility ceiling; correction retains revoked state',()=>{
 const l=createLedger(config()),e=event(),r=revoke(e);l.applyBatch([e],T);l.applyBatch([r],T+1000);
 const stillRevoked=rev(r,{operation:'correct',revision:3,occurredAt:T-1000,deadlineOccurredAt:T-1000});l.applyBatch([stillRevoked],T+1000);assert.equal(active(l,T+1000).length,0);
 const current=rev(stillRevoked,{operation:'edit',revision:5,completionState:'completed',revokeReason:null});l.applyBatch([current],T+1000);assert.equal(theme(l,T+1000).expiresAt,T+599000);
 assert.equal(active(l,T+599000).length,0);
});

test('missing initial success is explicitly diagnosable and late events cannot clear reconciliation requirement',()=>{
 for(const operation of ['edit','correct','revoke']){
  const e=event(),later=operation==='revoke'?revoke(e):rev(e,{operation}),l=createLedger(config());l.applyBatch([later],T+1000);
  let source=l.project(T+1000).sources[0];assert.equal(source.admissionReason,'needs_reconciliation');assert.equal(source.needsReconciliation,true);assert.equal(source.active,false);
  l.applyBatch([e],T+1000);l.applyBatch([rev(later,{revision:3,operation:'complete',completionState:'completed',revokeReason:null})],T+1000);
  source=l.project(T+1000).sources[0];assert.equal(source.needsReconciliation,true);assert.equal(source.active,false);
  const persisted=restoreLedger(l.snapshot(),T+1000);assert.equal(persisted.project(T+1000).sources[0].needsReconciliation,true);
 }
});
test('authoritative prior-admission snapshot reconstruction clears fail-closed diagnostic without resetting TTL',()=>{
 const e=event(),edit=rev(e,{operation:'edit'}),failedClosed=createLedger(config());failedClosed.applyBatch([edit],T+1000);assert.equal(failedClosed.project(T+1000).sources[0].needsReconciliation,true);
 const authority=createLedger(config());authority.applyBatch([e],T);authority.applyBatch([edit],T+1000);const reconstructed=restoreLedger(authority.snapshot(),T+2000);
 const source=reconstructed.project(T+2000).sources[0];assert.equal(source.needsReconciliation,false);assert.equal(source.active,true);assert.equal(source.expiresAt,T+600000);
 // Batch containing original success is intentionally distinct from an individually delivered edit-first stream.
 const batch=createLedger(config());batch.applyBatch([edit,e],T+1000);assert.equal(batch.project(T+1000).sources[0].needsReconciliation,false);
});
