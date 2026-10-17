import assert from 'node:assert/strict';
import {createSceneCoordinator} from '../bubu-scene-coordinator-v1-20261017/src/coordinator.mjs';
const r=(id,key,kind,resources,extra={})=>({id,factKey:key,kind,resources,approved:true,ready:true,mode:'sustained',...extra});
const config={policyVersion:'fixture',maxOverlays:1,sources:[{id:'theme',kind:'theme'},{id:'needs',kind:'needs'},{id:'detect',kind:'detection'},{id:'touch',kind:'interaction'}],backgrounds:[{id:'b',approved:true,ready:true}],recipes:[r('coffee','coffee','overlay',[],{layer:0}),r('hungry','hungry','face',['face.semantic']),r('ai','ai','action',['body.action']),r('pet','pet','action',['body.action','face.semantic'])],conflicts:[{recipes:['pet','hungry'],winner:'pet'},{recipes:['pet','ai'],winner:'pet'}],overlayOrder:['coffee']};
const x=createSceneCoordinator(config,{selectBackground:()=> 'b'}),focus={sessionId:'reused',localDate:'2026-10-17',timeBand:'day',timeZone:'UTC',candidateIds:['b']};
const initial=x.startFocus(focus,0);for(const s of config.sources)x.setSourceGeneration(s.id,1,true,0);
const snap=(sourceId,keys,revision=1)=>({sourceId,generation:1,revision,facts:keys.map(key=>({id:key,key,observedAt:0,expiresAt:100}))});
x.applySnapshots([snap('theme',['coffee']),snap('needs',['hungry']),snap('detect',['ai'])],0);assert.deepEqual(x.plan(0).selected,['ai','coffee','hungry']);
x.applySnapshots([snap('touch',['pet'])],1);assert.deepEqual(x.plan(1).selected,['coffee','pet']);
x.setSourceGeneration('detect',2,false,2);x.applySnapshots([snap('touch',[],2)],2);assert.deepEqual(x.plan(2).selected,['coffee','hungry']);
assert.deepEqual(x.applySnapshots([snap('detect',['ai'],9)],3),['stale_generation']);assert.equal(x.plan(3).mainAction,null);
const p=x.plan(3);assert.throws(()=>x.applySnapshots([snap('needs',[],2),snap('theme',[],1)],4),/REVISION_CONFLICT/);assert.deepEqual(x.plan(4).selected,p.selected);
assert.deepEqual(x.plan(100).selected,[]);
x.endFocus('reused',initial.selectionToken,101);const fresh=x.startFocus(focus,102);assert.notEqual(fresh.selectionToken,initial.selectionToken);
// Old callback still holds initial token; must not terminate the fresh session.
let rejected=false;try{x.endFocus('reused',initial.selectionToken,103);}catch{rejected=true;}
console.log(JSON.stringify({coexistence:true,preemption:true,disable:true,batchAtomic:true,hiddenTTL:true,staleEndRejected:rejected,after:x.plan(103).base}));
assert(rejected,'stale reused session end accepted');
