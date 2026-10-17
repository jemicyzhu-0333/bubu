'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../stage/src/application/state/unit-of-work');
const { createLogRoutineOccurrenceCommand } = require('../stage/src/capabilities/routines/application/log-routine-occurrence');
const { createFeedCompanionWorkflow } = require('../stage/src/application/workflows/feed-companion');
const { createThemeCommitAdapter } = require('../stage/src/bootstrap/theme-commit-adapter');
const { normalizePersistedState, assertCanonicalPersistedState } = require('../stage/src/platform/persistence/persisted-schema');
const { createLedger } = require('../stage/src/capabilities/companion/domain/theme-ledger.mjs');
const { config } = require('./pinned/ledger-fixtures.mjs');
const T = Date.parse('2026-10-17T12:00:00Z');
function fixture({ registered = true, ready = true, failCommit = false } = {}) {
  let now = T, revision = 0, seq = 0;
  const c = config(); c.mappings[0].definitionId = 'fixture.preset-coffee'; c.mappings[1].definitionId = 'coffee';
  c.capabilities[0].runtimeReady = ready;
  if (!registered) c.mappings = [];
  const ledger = createLedger(c), events = [], errors = [];
  let state = normalizePersistedState({ routines:[{id:'routine-a',title:'Editable title',kind:'stimulant',presetId:'fixture.preset-coffee',createdAt:T}], pet:{foodInventory:{coffee:5}} }, {now:T});
  const repository = {snapshot:()=>structuredClone(state), revision:()=>revision,
    commit(draft) { if(failCommit) throw new Error('synthetic-disk-rejected'); assertCanonicalPersistedState(draft);state=structuredClone(draft);revision++;return structuredClone(state); }};
  const unitOfWork = createUnitOfWork({ repository });
  const clock = {now:()=>now,dayKey:at=>new Date(at).toISOString().slice(0,10)};
  const adapter = createThemeCommitAdapter({ledger,namespace:'fixture:account-a',clock,registry:c,reportError:e=>errors.push(e)});
  const publish = fact=>{events.push(fact);adapter.publishCommitted(fact);};
  const command = createLogRoutineOccurrenceCommand({unitOfWork,clock,publish,generationFactory:()=>`generation-${++seq}`,resolveMappingVersion:adapter.resolveMappingVersion});
  const feed = createFeedCompanionWorkflow({unitOfWork,clock,publish,resolveMappingVersion:adapter.resolveMappingVersion,
    foods:{coffee:{id:'coffee',satiation:5,animation:'chew'}}});
  return {command,feed,events,errors,ledger,adapter,repository, get state(){return state;},setNow:x=>now=x,
    project:()=>ledger.project(now),request:(nonce='a')=>({foodId:'coffee',commandId:`${now}-${nonce}`,issuedAt:now})};
}
test('real complete → correct → later correct → undo → recomplete retains exact generation and never extends old deadline',()=>{
 const f=fixture();const a=f.command.log({routineId:'routine-a',status:'done'});assert.equal(a.changed,true);
 const first=f.project().sources[0];assert.equal(first.active,true);assert.equal(first.expiresAt,T+600000);
 const firstIdentity=f.events[0].completion;f.setNow(T+1000);
 assert.equal(f.command.log({routineId:'routine-a',occurrenceId:a.occurrenceId,status:'done',at:T-10000,expectedAt:T,expectedStatus:'done'}).ok,true);
 assert.equal(f.project().sources[0].expiresAt,T+590000);
 f.setNow(T+2000);f.command.log({routineId:'routine-a',occurrenceId:a.occurrenceId,status:'done',at:T,expectedAt:T-10000,expectedStatus:'done'});
 assert.equal(f.project().sources[0].expiresAt,T+590000);
 assert.deepEqual({...f.events[2].completion,deadlineOccurredAt:T},firstIdentity);
 f.setNow(T+3000);assert.equal(f.command.undo({occurrenceId:a.occurrenceId}).ok,true);assert.equal(f.project().themes.length,0);
 f.setNow(T+4000);const b=f.command.log({routineId:'routine-a',status:'done'});assert.equal(b.occurrenceId,a.occurrenceId);
 assert.notEqual(f.events.at(-1).completion.generation,firstIdentity.generation);
 assert.equal(f.project().sources.filter(x=>x.active).length,1);assert.equal(f.project().themes[0].expiresAt,T+604000);assert.deepEqual(f.errors,[]);
});
test('done edits and duplicate completion never acquire fresh original time',()=>{
 const f=fixture();const a=f.command.log({routineId:'routine-a',status:'done'});f.setNow(T+5000);
 f.command.log({routineId:'routine-a',occurrenceId:a.occurrenceId,status:'done',note:'updated'});
 assert.equal(f.events.at(-1).operation,'edit');assert.equal(f.events.at(-1).completion.occurredAt,T);
 assert.equal(f.project().themes[0].expiresAt,T+600000);assert.deepEqual(f.errors,[]);
});
test('historical backfill, unknown preset, broad kind/title and unready capability never activate',()=>{
 for(const options of [{},{registered:false},{ready:false}]){const f=fixture(options);
 f.command.log({routineId:'routine-a',status:'done',...(options.registered===undefined&&options.ready===undefined?{at:T-1000}:{})});assert.equal(f.project().themes.length,0);assert.deepEqual(f.errors,[]);}
 const f=fixture();delete f.state.routines[0].presetId;f.state.routines[0].title='coffee';f.command.log({routineId:'routine-a',status:'done'});assert.equal(f.project().themes.length,0);
});
test('legacy done edit and undo never fabricate completion identity',()=>{
 const f=fixture();f.state.routineLog.days=[{dayKey:'2026-10-17',entries:[{occurrenceId:'routine-a:2026-10-17:free:0',routineId:'routine-a',status:'done',at:T,note:null,magnitude:null}]}];
 const id=f.state.routineLog.days[0].entries[0].occurrenceId;f.setNow(T+1000);f.command.log({routineId:'routine-a',occurrenceId:id,status:'done',note:'legacy edit'});f.command.undo({occurrenceId:id});assert.equal(f.project().themes.length,0);assert.equal(f.events[0].completion,null);
});
test('feed real workflow and command receipt preserve first time on replay and never re-emit',()=>{
 const f=fixture(),request=f.request();const first=f.feed.execute(request);assert.equal(first.ok,true);assert.equal(first.fedAt,T);assert.equal(first.commandId,request.commandId);assert.equal(first.replayed,false);
 assert.equal(f.project().themes[0].expiresAt,T+30000);f.setNow(T+15000);
 const replay=f.feed.execute(request);assert.equal(replay.replayed,true);assert.equal(replay.fedAt,T);assert.equal(f.events.length,1);assert.equal(f.state.pet.totalFeeds,1);assert.equal(f.project().themes[0].expiresAt,T+30000);
 assert.equal(f.adapter.publishCommitted({...f.events[0],replayed:true}).accepted,false);assert.deepEqual(f.errors,[]);
});
test('failed feed, failed routine, revision conflict and repository failure emit nothing',()=>{
 const f=fixture();f.state.pet.foodInventory.coffee=0;assert.equal(f.feed.execute(f.request()).ok,false);
 assert.equal(f.command.log({routineId:'missing',status:'done'}).ok,false);
 assert.equal(f.command.log({routineId:'routine-a',status:'done',expectedRevision:10}).ok,false);assert.equal(f.events.length,0);
 const g=fixture({failCommit:true});assert.throws(()=>g.feed.execute(g.request()),/disk-rejected/);assert.throws(()=>g.command.log({routineId:'routine-a',status:'done'}),/disk-rejected/);assert.equal(g.events.length,0);
});
test('routine and feed sharing a theme have independent TTL and exact revoke',()=>{
 const f=fixture();const r=f.command.log({routineId:'routine-a',status:'done'});f.setNow(T+1000);f.feed.execute(f.request());assert.equal(f.project().themes[0].sourceIds.length,2);
 f.setNow(T+2000);f.command.undo({occurrenceId:r.occurrenceId});assert.equal(f.project().themes[0].sourceIds.length,1);assert.equal(f.project().themes[0].expiresAt,T+31000);
 f.setNow(T+31000);assert.equal(f.project().themes.length,0);
});
test('done → skipped → done restores same semantic generation without extending deadline',()=>{
 const f=fixture();const r=f.command.log({routineId:'routine-a',status:'done'});const old=f.events[0].completion.generation;
 f.setNow(T+1000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'skipped'});assert.equal(f.project().themes.length,0);
 f.setNow(T+2000);f.command.log({routineId:'routine-a',occurrenceId:r.occurrenceId,status:'done'});assert.equal(f.events.at(-1).completion.generation,old);assert.equal(f.project().themes.length,1);assert.equal(f.project().themes[0].expiresAt,T+600000);assert.deepEqual(f.errors,[]);
});
test('receipt identity corruption is rejected and old receipts replay without fabricated fedAt',()=>{
 const f=fixture(),r=f.request();f.feed.execute(r);const receipt=f.state.pet.foodCommands[0];receipt.result.commandId=`${T}-another`;assert.throws(()=>f.feed.execute(r),/identity-mismatch/);
 receipt.result.commandId=r.commandId;for(const k of ['commandId','issuedAt','fedAt','mappingVersion'])delete receipt.result[k];f.setNow(T+1000);const replay=f.feed.execute(r);assert.equal(replay.replayed,true);assert.equal(replay.fedAt,null);assert.equal(f.events.length,1);
});
test('explicit undo/restore within TTL keeps generation and original expiry; after expiry never restarts',()=>{
 const f=fixture();const a=f.command.log({routineId:'routine-a',status:'done'}),first=f.events[0].completion;
 f.setNow(T+1000);f.command.undo({occurrenceId:a.occurrenceId});f.setNow(T+2000);
 f.command.log({routineId:'routine-a',occurrenceId:a.occurrenceId,status:'done'});
 assert.equal(f.events.at(-1).completion.generation,first.generation);assert.equal(f.project().themes[0].expiresAt,T+600000);
 f.setNow(T+3000);f.command.undo({occurrenceId:a.occurrenceId});f.setNow(T+901000);
 f.command.log({routineId:'routine-a',occurrenceId:a.occurrenceId,status:'done'});
 assert.equal(f.events.at(-1).completion.generation,first.generation);assert.equal(f.project().themes.length,0);assert.deepEqual(f.errors,[]);
});
test('undo of legacy record then same-slot restore cannot invent a live identity',()=>{
 const f=fixture();const id='routine-a:2026-10-17:free:0';f.state.routineLog.days=[{dayKey:'2026-10-17',entries:[{occurrenceId:id,routineId:'routine-a',status:'done',at:T,note:null,magnitude:null}]}];
 f.command.undo({occurrenceId:id});f.setNow(T+1000);assert.equal(f.command.log({routineId:'routine-a',occurrenceId:id,status:'done'}).ok,true);assert.equal(f.events.at(-1).completion,null);assert.equal(f.project().themes.length,0);
});
test('small correction-receipt overflow preserves business success and diagnoses suppressed slot activation',()=>{
 const {rememberRemoval}=require('../stage/src/capabilities/routines/domain/completion-receipts');const f=fixture();
 for(let i=0;i<3;i++)rememberRemoval(f.state.routineLog,{occurrenceId:`synthetic:${i}`,routineId:'routine-a',completion:null},T,{capacity:2});
 assert.equal(f.state.routineLog.completionReceipts.length,2);
 const r=f.command.log({routineId:'routine-a',occurrenceId:'routine-a:2026-10-17:free:0',status:'done'});
 assert.equal(r.ok,true);assert.equal(f.events.at(-1).themeSuppressionReason,'completion-recovery-capacity');assert.equal(f.project().themes.length,0);
 f.setNow(T+1000);const fresh=f.command.log({routineId:'routine-a',status:'done'});assert.equal(fresh.ok,true);assert.equal(f.project().themes.length,1);
});
test('correction cannot switch occurrence identity to create a fresh completion',()=>{
 const f=fixture();const a=f.command.log({routineId:'routine-a',status:'done'});f.setNow(T+1000);
 const result=f.command.log({routineId:'routine-a',occurrenceId:'routine-a:2026-10-17:free:1',status:'done',at:T,expectedAt:T,expectedStatus:'done'});
 assert.equal(result.ok,false);assert.equal(f.events.length,1);assert.equal(f.project().themes[0].expiresAt,T+600000);assert.equal(f.state.routineLog.days[0].entries[0].occurrenceId,a.occurrenceId);
});
test('headless end-to-end committed routine/feed → ledger → scene plan, no fake renderer success',()=>{
 const {createSceneCoordinator,themeProjectionSnapshot}=require('./pinned/scene-coordinator.mjs');
 const f=fixture();const scene=createSceneCoordinator({policyVersion:'fixture-only',maxOverlays:1,
 sources:[{id:'themes',kind:'theme'}],backgrounds:[{id:'fixture.background',approved:true,ready:true}],
 recipes:[{id:'fixture.overlay',factKey:'theme:fixture:coffee',kind:'overlay',resources:[],approved:true,ready:true,mode:'sustained',layer:1}],conflicts:[],overlayOrder:['fixture.overlay']}, {selectBackground:()=> 'fixture.background'});
 scene.startFocus({sessionId:'fixture.focus',localDate:'2026-10-17',timeBand:'day',timeZone:'UTC',candidateIds:['fixture.background']},T);
 scene.setSourceGeneration('themes',1,true,T);let revision=0;
 const plan=now=>{f.setNow(now);scene.applySnapshots([themeProjectionSnapshot(f.project(),{sourceId:'themes',generation:1,revision:++revision})],now);return scene.plan(now);};
 const r=f.command.log({routineId:'routine-a',status:'done'});const request=f.request();f.feed.execute(request);
 let p=plan(T);assert.equal(p.facts.length,2);assert.deepEqual(p.overlays,['fixture.overlay']);assert.equal(p.visible,false);assert.equal(p.performing,false);
 f.setNow(T+1000);f.command.undo({occurrenceId:r.occurrenceId});p=plan(T+1000);assert.equal(p.facts.length,1);assert.deepEqual(p.overlays,['fixture.overlay']);
 f.setNow(T+2000);f.feed.execute(request);p=plan(T+2000);assert.equal(p.facts.length,1);
 p=plan(T+30000);assert.deepEqual(p.overlays,[]);assert.equal(f.events.length,3);assert.deepEqual(f.errors,[]);
});
test('real bootstrap feed hook publishes only committed fact and default production registry remains empty',()=>{
 const {createCompanionFeeding}=require('../stage/src/bootstrap/companion-feeding');
 const {createThemeStateRuntime}=require('../stage/src/bootstrap/theme-state-runtime');
 const f=fixture();const runtime=createThemeStateRuntime({clock:{now:()=>T}});let handler;const facts=[];
 const b=createCompanionFeeding({unitOfWork:createUnitOfWork({repository:f.repository}),clock:{now:()=>T},foods:{coffee:{id:'coffee',satiation:5,animation:'chew'}},
  publishTheme:fact=>{facts.push(fact);runtime.publishCommitted(fact);},announceBond:()=>{},publishChange:()=>{}});
 b.register((name,fn)=>{assert.equal(name,'pet:feed');handler=fn;});const req=f.request();assert.equal(handler({},req).ok,true);assert.equal(handler({},req).replayed,true);
 assert.equal(facts.length,1);assert.equal(facts[0].postCommit,true);assert.equal(facts[0].commandId,req.commandId);assert.deepEqual(runtime.project().themes,[]);
});
