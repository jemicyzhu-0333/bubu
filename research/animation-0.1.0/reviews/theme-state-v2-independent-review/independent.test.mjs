import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger,restoreLedger} from '../bubu-theme-state-ledger-v2-20261017/src/ledger.mjs';
import {createLedger as createV1} from '../bubu-theme-state-ledger-v1-20261017/src/ledger.mjs';
import {T,config,event,revise} from '../bubu-theme-state-ledger-v2-20261017/fixtures/fixtures.mjs';
const C='fixture:epoch1:cursor1';
const snap=l=>l.snapshot(C);
const recover=(s,n,proof={sourceCursor:C,minLastNow:s.lastNow})=>restoreLedger(s,n,proof);
const active=(l,n)=>l.project(n).sources.filter(s=>s.active);
const firstTheme=(l,n)=>l.project(n).themes[0];
const fresh=(i,o={})=>event({entityId:`fixture:${i}`,eventId:`fixture:event${i}`,transactionId:`fixture:tx${i}`,...o});
const reviseAt=(e,n,o={})=>revise(e,{committedAt:n,receivedAt:n,...o});
const revoke=(e,n=T+1000)=>reviseAt(e,n,{operation:'revoke',completionState:'revoked',revokeReason:'fixture:undo'});
function atomic(l,f,code){const before=snap(l);assert.throws(f,e=>!code||e.code===code);assert.deepEqual(snap(l),before)}

test('hard horizons are half-open routine900/feed30 independently of shorter display duration',()=>{
 for(const kind of ['routine','feed']){
  const l=createLedger(config()),e=fresh(1,{sourceKind:kind}),H=T+(kind==='routine'?900000:30000);l.applyBatch([e],T);
  assert.equal(l.project(H-1).sources.length,1);assert.equal(l.project(H).sources.length,0);assert.equal(l.project(H+1).sources.length,0);
  l.applyBatch([e],H+1);assert.equal(snap(l).records.length,0);
 }
});
test('shortened deadline does not permit original revision resurrection before hard horizon',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);const short=reviseAt(e,T+1000,{operation:'correct',occurredAt:T-300000,deadlineOccurredAt:T-300000});l.applyBatch([short],T+1000);
 assert.equal(active(l,T+300000).length,0);assert.equal(snap(l).records.length,1);
 l.applyBatch([e],T+301000);assert.equal(active(l,T+301000).length,0);assert.equal(snap(l).records.length,1);
 assert.equal(l.project(T+899999).sources.length,1);assert.equal(l.project(T+900000).sources.length,0);l.applyBatch([e],T+900001);assert.equal(snap(l).records.length,0);
});
test('revoked records stay through safe horizon, never through current visible eligibility only',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);l.applyBatch([revoke(e)],T+1000);assert.equal(snap(l).records.length,1);
 for(const n of [T+30000,T+600000,T+899999]){l.applyBatch([e],n);assert.equal(active(l,n).length,0);assert.equal(snap(l).records.length,1)}l.project(T+900000);assert.equal(snap(l).records.length,0);
});
test('unknown and unready first-admission results persist through hard horizon and cannot be remapped',()=>{
 for(const mode of ['unknown','unready','unapproved']){
  const c=config(),e=event();if(mode==='unknown')c.mappings=[];if(mode==='unready')c.capabilities[0].runtimeReady=false;if(mode==='unapproved')c.mappings[0].approved=false;
  const l=createLedger(c);l.applyBatch([e],T);c.mappings=config().mappings;c.capabilities=config().capabilities;
  l.applyBatch([reviseAt(e,T+700000)],T+700000);assert.equal(active(l,T+700000).length,0);assert.equal(snap(l).records.length,1);
  const changed=reviseAt(e,T+700000,{original:{...e.original,mappingVersion:'fixture:v2'}});atomic(l,()=>l.applyBatch([changed],T+700000));
  l.project(T+900000);l.applyBatch([e],T+900000);assert.equal(snap(l).records.length,0);
 }
});
test('continuous history across 1000 windows never consumes live-window capacity',()=>{
 const c=config();c.maxRecords=2;const l=createLedger(c);let now=T;
 for(let i=1;i<=1000;i++){const e=fresh(i,{occurredAt:now});l.applyBatch([e],now);assert.equal(snap(l).records.length,1);now+=900000;l.applyBatch([e],now);assert.equal(snap(l).records.length,0)}
 l.applyBatch([fresh(1001,{occurredAt:now})],now);assert.equal(active(l,now).length,1);
});
test('many obsolete deliveries do not insert identities or block fresh completion',()=>{
 const c=config();c.maxRecords=1;const l=createLedger(c),old=Array.from({length:1000},(_,i)=>fresh(i+1));l.applyBatch(old,T+900000);assert.equal(snap(l).records.length,0);l.applyBatch([fresh(2000,{occurredAt:T+900000})],T+900000);assert.equal(active(l,T+900000).length,1);
});
test('within-window overload rejects atomically without evicting revocation tombstone',()=>{
 const c=config();c.maxRecords=1;const l=createLedger(c),e=event();l.applyBatch([e],T);l.applyBatch([revoke(e)],T+1000);
 atomic(l,()=>l.applyBatch([fresh(2,{occurredAt:T+1000})],T+1000));l.applyBatch([e],T+1000);assert.equal(active(l,T+1000).length,0);
});
test('cleanup is part of transaction: invalid final event does not delete expired records or advance time',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);atomic(l,()=>l.applyBatch([fresh(2,{occurredAt:T+900000}),fresh(3,{postCommit:false})],T+900000));assert.equal(snap(l).lastNow,T);assert.equal(snap(l).records.length,1);
});
test('same theme union, independent revocations, no additive lifetime',()=>{
 for(const order of [false,true]){const l=createLedger(config()),a=fresh(1),b=fresh(2,{sourceKind:'feed'});l.applyBatch(order?[b,a]:[a,b],T);assert.equal(firstTheme(l,T).expiresAt,T+600000);assert.equal(active(l,T+29999).length,2);assert.equal(active(l,T+30000).length,1);assert.equal(active(l,T+600000).length,0)}
 const l=createLedger(config()),a=fresh(1),b=fresh(2,{sourceKind:'feed'});l.applyBatch([a,b],T);l.applyBatch([revoke(a)],T+1000);assert.equal(firstTheme(l,T+1000).expiresAt,T+30000);
});
test('genuine generation is new while duplicates/reconnect/revision never allocate a new lifetime',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);l.applyBatch([{...e,eventId:'redelivery',receivedAt:T+1000}],T+1000);assert.equal(firstTheme(l,T+1000).expiresAt,T+600000);
 atomic(l,()=>l.applyBatch([{...e,deliveryGeneration:'connection:2'}],T+1000));l.applyBatch([revoke(e)],T+1000);
 const next=event({completionGeneration:'new-true-generation',occurredAt:T+1000});l.applyBatch([next],T+1000);assert.equal(active(l,T+1000).length,1);assert.equal(firstTheme(l,T+1000).expiresAt,T+601000);
});
test('edit later never extends and watermark can only decrease',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);const edited=reviseAt(e,T+1000,{operation:'edit',occurredAt:T+1000});l.applyBatch([edited],T+1000);assert.equal(firstTheme(l,T+1000).expiresAt,T+600000);
 const short=reviseAt(edited,T+1000,{operation:'correct',occurredAt:T-1000,deadlineOccurredAt:T-1000});l.applyBatch([short],T+1000);atomic(l,()=>l.applyBatch([reviseAt(short,T+1000,{deadlineOccurredAt:T})],T+1000));assert.equal(firstTheme(l,T+1000).expiresAt,T+599000);
});
test('missing first success remains needs-reconciliation despite late lower or newer complete',()=>{
 for(const operation of ['edit','correct','revoke']){const l=createLedger(config()),e=event(),later=operation==='revoke'?revoke(e):reviseAt(e,T+1000,{operation});l.applyBatch([later],T+1000);l.applyBatch([e],T+1000);l.applyBatch([reviseAt(later,T+1000,{operation:'complete',completionState:'completed',revokeReason:null})],T+1000);const s=l.project(T+1000).sources[0];assert.equal(s.needsReconciliation,true);assert.equal(s.active,false);}
});
test('history imports never activate; feed replay receipts and unsuccessful transactions reject',()=>{
 for(const origin of ['historical_backfill','history_edit','recovery_sync']){const l=createLedger(config()),e=event({origin,original:{...event().original,origin}});l.applyBatch([e],T);assert.equal(active(l,T).length,0)}
 for(const fields of [{replayed:true,sourceKind:'feed'},{postCommit:false},{operation:'failed'},{operation:'pending'},{operation:'cancelled'}]){const l=createLedger(config());atomic(l,()=>l.applyBatch([event(fields)],T));}
});
test('trusted time rollback after horizon cleanup rejects, including restored lastNow floor',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);l.project(T+900000);atomic(l,()=>l.applyBatch([event()],T+1));const s=snap(l);assert.throws(()=>recover(s,T+1));assert.throws(()=>recover(s,T+900000,{sourceCursor:C,minLastNow:T+900001}));
});
test('restoration keeps original remainder and drops elapsed horizon records',()=>{
 const l=createLedger(config());l.applyBatch([event()],T);const s=snap(l),r=recover(s,T+599999);assert.equal(firstTheme(r,T+599999).expiresAt,T+600000);assert.equal(active(r,T+600000).length,0);assert.equal(snap(r).records.length,1);
 const expired=recover(s,T+900000);assert.equal(snap(expired).records.length,0);expired.applyBatch([event()],T+900000);assert.equal(snap(expired).records.length,0);
});
test('old complete checkpoint blocked by newer authoritative cursor/epoch and minimum observed time',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);const stale=l.snapshot('epoch1:cursor1');l.applyBatch([revoke(e)],T+1000);const current=l.snapshot('epoch1:cursor2');
 assert.throws(()=>restoreLedger(stale,T+1000,{sourceCursor:'epoch1:cursor2',minLastNow:T+1000}));assert.throws(()=>restoreLedger(stale,T+1000,{sourceCursor:'epoch2:cursor1',minLastNow:T}));assert.throws(()=>restoreLedger(stale,T+1000));
 const r=restoreLedger(current,T+1000,{sourceCursor:'epoch1:cursor2',minLastNow:T+1000});assert.equal(active(r,T+1000).length,0);
 // Matching stale proof is explicitly NOT authenticated by the module; host must never derive authority from the stale file itself.
 const unsafeHost=restoreLedger(stale,T+1000,{sourceCursor:'epoch1:cursor1',minLastNow:T});assert.equal(active(unsafeHost,T+1000).length,1);
});
test('immutable originals reject rewriting before forget horizon and genuine namespace separation works',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);for(const original of [{...e.original,mappingVersion:'other'},{...e.original,definitionId:'other'},{...e.original,occurredAt:T-1}])atomic(l,()=>l.applyBatch([reviseAt(e,T+1000,{original,deadlineOccurredAt:Math.min(T,original.occurredAt)})],T+1000));
 l.applyBatch([event({namespace:'fixture:account-b'})],T);assert.equal(active(l,T).length,2);
});
test('snapshots and projections are defensive copies; malformed recovery stays atomic',()=>{
 const l=createLedger(config()),e=event();l.applyBatch([e],T);e.original.occurredAt=0;const s=snap(l);s.records[0].latest.deadlineOccurredAt=0;assert.equal(firstTheme(l,T).expiresAt,T+600000);
 const bad=snap(l);bad.records[0].latest.original.mappingVersion='tamper';assert.throws(()=>recover(bad,T));assert.equal(firstTheme(l,T).expiresAt,T+600000);const p=l.project(T);p.sources[0].expiresAt=1;assert.equal(firstTheme(l,T).expiresAt,T+600000);
});
for(const n of [NaN,Infinity,-1,0.5,Number.MAX_SAFE_INTEGER+1,null,'1'])test(`safe clock rejects ${String(n)}`,()=>{const l=createLedger(config());atomic(l,()=>l.project(n));});
test('time overflow/invalid order and duration policy remain strict',()=>{
 for(const fields of [{occurredAt:Number.MAX_SAFE_INTEGER-899999},{receivedAt:T+1},{committedAt:T-1},{deadlineOccurredAt:T+1},{timeDomain:'local'}]){const l=createLedger(config());atomic(l,()=>l.applyBatch([event(fields)],Number.isSafeInteger(fields.occurredAt)?fields.occurredAt:T))}
 for(const sec of [599,901,600.1,NaN,Infinity]){const c=config();c.mappings[0].durationSec=sec;assert.throws(()=>createLedger(c))}
 for(const sec of [600,750,900]){const c=config();c.mappings[0].durationSec=sec;const l=createLedger(c);l.applyBatch([event()],T);assert.equal(firstTheme(l,T).expiresAt,T+sec*1000)}
});
test('strict event/config/checkpoint descriptors, prototypes, symbols and proxy boundaries do not execute code',()=>{
 let hits=0;for(const mutate of [e=>Object.defineProperty(e,'eventId',{enumerable:true,get(){hits++;return 'x'}}),e=>Object.defineProperty(e.original,'definitionId',{enumerable:true,get(){hits++;return 'x'}}),e=>e[Symbol('x')]=1,e=>Object.defineProperty(e,'hidden',{value:1}),e=>Object.setPrototypeOf(e,{}),e=>Object.setPrototypeOf(e,null),e=>e.toJSON=()=>{hits++;return {}},e=>Object.defineProperty(e.original,'x',{value:1})]){const l=createLedger(config()),e=event();mutate(e);atomic(l,()=>l.applyBatch([e],T))}
 const l=createLedger(config()),proxy=new Proxy(event(),{get(){hits++;throw Error('trap')},ownKeys(){hits++;throw Error('trap')}});atomic(l,()=>l.applyBatch([proxy],T));
 for(const make of [()=>new Array(1),()=>Object.assign([event()],{extra:1}),()=>Object.assign([event()],{[Symbol('x')]:1})])atomic(l,()=>l.applyBatch(make(),T));
 const c=config();Object.defineProperty(c,'mappings',{enumerable:true,get(){hits++;return []}});assert.throws(()=>createLedger(c));const s=snap(l);Object.defineProperty(s,'records',{enumerable:true,get(){hits++;return []}});assert.throws(()=>recover(s,T));assert.equal(hits,0);
});
test('source-specific module cannot mutate focus/detection/inventory and never claims visual selection',()=>{const l=createLedger(config());for(const extra of [{detectionEnabled:false},{focusBackground:'x'},{inventory:1}])atomic(l,()=>l.applyBatch([{...event(),...extra}],T));l.applyBatch([event()],T);for(const p of [...l.project(T).sources,...l.project(T).themes])for(const key of ['visible','selected','performing'])assert.equal(p[key],false);});

test('independent finite-window oracle and v1 active-fact equivalence over 20 × 120 transitions',()=>{
 for(let seed=1;seed<=20;seed++){
  let random=seed;const rng=()=>((random=(Math.imul(random,1664525)+1013904223)>>>0)/4294967296);
  const c=config(),l=createLedger(c),v1=createV1({...structuredClone(c),schemaVersion:1}),model=new Map(),events=new Map();let now=T,next=1;
  const toV1=(e,i)=>({...structuredClone(e),schemaVersion:1,completionOrdinal:i});
  for(let step=0;step<120;step++){
   now+=Math.floor(rng()*20000);const ids=[...events.keys()];let i,e;
   if(!ids.length||rng()<0.4){i=next++;const kind=rng()<0.5?'routine':'feed';e=fresh(i,{sourceKind:kind,occurredAt:now});events.set(i,e);model.set(i,{revoked:false,deadline:now+(kind==='routine'?600000:30000),horizon:now+(kind==='routine'?900000:30000)});}
   else{i=ids[Math.floor(rng()*ids.length)];const old=events.get(i),m=model.get(i),pick=rng();if(pick<0.2)e={...old,eventId:`retry:${step}`,receivedAt:now};else if(pick<0.5){e=revoke(old,now);m.revoked=true;events.set(i,e)}else if(pick<0.75){const shortened=old.deadlineOccurredAt-Math.floor(rng()*10000);e=reviseAt(old,now,{operation:'correct',occurredAt:shortened,deadlineOccurredAt:shortened});m.deadline=shortened+(old.sourceKind==='routine'?600000:30000);events.set(i,e)}else{e=reviseAt(old,now,{operation:'complete',completionState:'completed',revokeReason:null});m.revoked=false;events.set(i,e)}}
   l.applyBatch([e],now);v1.applyBatch([toV1(e,i)],now);
   const expected=[...model.values()].filter(m=>!m.revoked&&now<m.deadline),p=l.project(now),old=v1.project(now);
   assert.equal(p.sources.filter(s=>s.active).length,expected.length,`oracle seed${seed} step${step}`);
   assert.equal(p.themes.length,expected.length?1:0);if(expected.length)assert.equal(p.themes[0].expiresAt,Math.max(...expected.map(m=>m.deadline)));
   const normalized=p=>p.sources.filter(s=>s.active).map(s=>({sourceId:s.sourceId,expiresAt:s.expiresAt}));assert.deepEqual(normalized(p),normalized(old),`v1 equivalence seed${seed} step${step}`);
   assert.equal(snap(l).records.length,[...model.values()].filter(m=>now<m.horizon).length);
   if(step%23===0){const restored=recover(snap(l),now);assert.deepEqual(restored.project(now),p)}
  }
 }
});
