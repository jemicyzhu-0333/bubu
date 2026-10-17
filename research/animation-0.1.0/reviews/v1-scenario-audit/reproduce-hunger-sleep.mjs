// Isolated execution of exact V1 function text; never imports or starts the app.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./source/src/surfaces/pet/controller.mjs',import.meta.url),'utf8');
function slice(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b).trim();}
const setState=slice('function setState(newState, { temporary = false } = {}) {','function syncSessionActivityMode');
const timer=slice('const stateMaintenanceTimer = setInterval(() => {','// ---------- Main render loop ----------');
const base=slice('function desiredBasePresentation() {','function syncPresentationBase() {');
const late=slice('function isLateNightIdle() {','function desiredBasePresentation() {');
const extracted={setState,timer,base,late};
const defaults={state:'idle',satiation:20,hour:2,workStart:9,now:120000,idleSince:0,dragging:false,currentEgg:null,foodMenuOpen:false,dnd:false,dockedEdge:null,stopped:false,stimulationMode:'low',sessionState:'idle',sessionPaused:false};
function run(id,patch={},ticks=8){
 const config={...defaults,...patch},ctx={...config,transientVisualState:null,expressionRegistry:null,history:[],nativeStateMessages:[],callback:null,
  Date:class {static now(){return ctx.now;}getHours(){return ctx.hour;}},
  clients:{pet_setState(value){ctx.nativeStateMessages.push(value);}},
  petRenderer:{currentSessionActivity:()=>null},activityMirror:null,mirrorBaseExpressionFor:x=>x,
  syncPresentationBase(){},motionRandom:()=>1,sayContextual(){throw Error('speech should be suppressed in fixture');},
  setInterval(cb,ms){assert.equal(ms,1000);ctx.callback=cb;return 'mock-no-timer';}
 };
 vm.createContext(ctx);vm.runInContext([setState,late,base,timer,'this.readBase = desiredBasePresentation;'].join('\n'),ctx,{timeout:1000});
 ctx.history.push({tick:0,state:ctx.state,expression:ctx.readBase().expressionId});
 for(let i=1;i<=ticks;i++){ctx.callback();ctx.history.push({tick:i,state:ctx.state,expression:ctx.readBase().expressionId});ctx.now+=1000;}
 return {id,config,history:ctx.history,nativeStateMessages:ctx.nativeStateMessages};
}
const cases=[
 run('low_food_deep_night'),run('satiation_zero',{satiation:0}),run('already_hungry',{state:'hungry'}),run('already_sleeping',{state:'sleeping'}),
 run('satiation_21',{satiation:21}),run('outside_sleep_window',{hour:22}),run('docked',{dockedEdge:'left'}),run('dnd',{dnd:true}),
 run('focused',{state:'focused',sessionState:'focused'}),run('active_egg',{currentEgg:{id:'sip-tea'}}),run('food_menu',{foodMenuOpen:true}),run('dragging',{dragging:true}),
 run('idle_exact_60_seconds',{now:60000},1),run('idle_over_60_seconds',{now:60001},3),run('workstart_closes_window',{workStart:2}),run('upper_boundary_hour6',{hour:6}),run('lower_boundary_hour1',{hour:1})
];
assert.deepEqual(cases[0].history.map(x=>x.state),['idle','hungry','sleeping','hungry','sleeping','hungry','sleeping','hungry','sleeping']);
assert.deepEqual(cases[0].history.map(x=>x.expression),['life.idle','react.hungry','life.sleep','react.hungry','life.sleep','react.hungry','life.sleep','react.hungry','life.sleep']);
assert(cases.find(x=>x.id==='satiation_21').history.slice(1).every(x=>x.state==='sleeping'));
assert(cases.find(x=>x.id==='docked').history.slice(1).every(x=>x.state==='hungry'));
for(const id of ['dnd','focused','active_egg','food_menu','dragging']){const x=cases.find(x=>x.id===id);assert(x.history.every(y=>y.state===x.config.state));}
for(const id of ['outside_sleep_window','workstart_closes_window','upper_boundary_hour6']){assert(cases.find(x=>x.id===id).history.slice(1).every(x=>x.state==='hungry'));}
const out={commit:'ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a',verdict:'reproduced-in-isolated-exact-controller-code',scope:'Exact setState, maintenance callback and base-expression selection extracted, DOM/IPC/timer/speech mocked; not production app or pixel observation.',evidence:[{path:'src/surfaces/pet/controller.mjs',lines:[853,863]},{path:'src/surfaces/pet/controller.mjs',lines:[535,559]},{path:'src/surfaces/pet/controller.mjs',lines:[1405,1421]}],testsPassed:cases.length,cases,extractedSource:extracted};
fs.writeFileSync(new URL('./HUNGER-SLEEP-RESULT.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({verdict:out.verdict,testsPassed:cases.length,states:cases[0].history,nativeStateMessages:cases[0].nativeStateMessages},null,2));
